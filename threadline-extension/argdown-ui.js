/* Optional local UI for Argdown import/export. It only previews parsed
 * relationships; a user must explicitly turn one support relationship into a
 * necessary dependency through the existing CAS command. */
(() => {
  "use strict";
  const MAX_INPUT_BYTES = 200 * 1024;
  const bytes = text => new TextEncoder().encode(String(text || "")).byteLength;
  const relationKind = type => /^(support|entail|justify)$/i.test(String(type || ""))
    ? "support" : /^(attack|contrary|contradict|oppose)$/i.test(String(type || "")) ? "oppose" : "other";
  const sameId = (label, row) => label === row?.conclusion?.id;
  const operationId = () => "op_argdown_" + (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())).replace(/-/g, "").slice(0, 16);
  const textOf = row => row?.current?.text || row?.conclusion?.id || "";

  function install({ document: doc = document, chrome: extensionChrome = chrome, win = window } = {}) {
    const host = doc.querySelector("#evidence-section");
    if (!host || doc.getElementById("argdown-workbench")) return null;
    const adapter = win.ThreadLineArgdown || globalThis.ThreadLineArgdown;
    const box = doc.createElement("details");
    box.id = "argdown-workbench";
    box.className = "argdown-workbench";
    const summary = doc.createElement("summary");
    summary.textContent = "Argdown 导入与导出（预览后逐条确认）";
    const body = doc.createElement("div");
    const notice = doc.createElement("p");
    notice.className = "subtle";
    notice.textContent = "候选关系不等于确认。导入不会自动采纳结论；只有你逐条选择已有上、下游结论并确认“必要前提”后，才会登记支持关系。反对关系只保留为预览。";
    const project = doc.createElement("select"); project.setAttribute("aria-label", "Argdown 课题");
    const refresh = button(doc, "刷新已采纳结论");
    const exportButton = button(doc, "导出 Argdown 文本");
    const download = button(doc, "下载 Argdown"); download.disabled = true;
    const exported = textarea(doc, "Argdown 导出文本", 7); exported.readOnly = true;
    const imported = textarea(doc, "粘贴 Argdown 进行预览", 7);
    const preview = button(doc, "解析并预览关系");
    const proposals = doc.createElement("div"); proposals.id = "argdown-proposals";
    const status = doc.createElement("p"); status.id = "argdown-status"; status.className = "subtle"; status.setAttribute("role", "status");
    body.append(notice, label(doc, "课题", project), refresh, exportButton, download, label(doc,"已导出的 Argdown（只读）",exported), label(doc,"粘贴要导入的 Argdown",imported), preview, proposals, status);
    box.append(summary, body); host.append(box);

    let projects = [], data = null, exportedText = "", exportedProject="", request=0;
    const say = (message, bad = false) => { status.textContent = message; status.classList.toggle("warn", bad); };
    const selectedId = () => project.value;
    const send = payload => new Promise((resolve, reject) => extensionChrome.runtime.sendMessage(payload, reply => {
      if (extensionChrome.runtime.lastError) return reject(Error(extensionChrome.runtime.lastError.message));
      if (!reply?.ok) return reject(Error(reply?.error || "请求失败"));
      resolve(reply.data);
    }));
    function fillProjects() {
      const prior = project.value; project.replaceChildren();
      for (const item of projects.filter(item => !item.deleted && !item.unavailable)) {
        const option = doc.createElement("option"); option.value = item.id; option.textContent = item.name || item.id; project.append(option);
      }
      if ([...project.options].some(item => item.value === prior)) project.value = prior;
    }
    async function load({announce=true}={}) {
      const ticket=++request,oldData=data;proposals.replaceChildren();data=null;
      try {
        const directory=await send({type:"EV_PROJECTS"});if(ticket!==request)return;
        projects=directory.projects||[];fillProjects();const id=selectedId();
        if(!id){exportedText="";exported.value="";download.disabled=true;say(directory.error||"暂无可用的证据课题。请先采纳结论。",!!directory.error);return;}
        const next=await send({type:"EV_RESEARCH_LIST",projectId:id});if(ticket!==request||id!==selectedId())return;
        data=next;
        if(exportedProject!==id||oldData?.project?.evidenceRevision!==data.project.evidenceRevision){exportedText="";exported.value="";download.disabled=true;}
        if(announce)say(`已加载 ${data.rows.length} 条结论。导入只生成候选，确认后才登记关系。`);
      }catch(error){if(ticket!==request)return;data=null;exportedText="";exported.value="";download.disabled=true;say("无法加载 Argdown 工作区："+error.message,true);}
    }
    function exportArgdown() {
      if (!adapter?.exportEvidence) return say("Argdown 适配器未加载。", true);
      if (!data?.rows?.length) return say("没有可导出的已采纳结论。", true);
      try {
        exportedText = adapter.exportEvidence({ rows: data.rows, edges: data.edges || [] });
        exportedProject=selectedId();exported.value = exportedText; download.disabled = false; say("已生成 Argdown 文本；下载仅保存到你选择的位置。");
      } catch (error) { say("Argdown 导出失败：" + error.message, true); }
    }
    function selectFor(labelText, labelValue) {
      const select = doc.createElement("select"); select.setAttribute("aria-label", labelText);
      const empty = doc.createElement("option"); empty.value = ""; empty.textContent = "不映射"; select.append(empty);
      for (const row of data?.rows || []) {
        const option = doc.createElement("option"); option.value = row.conclusion.id; option.textContent = `${row.conclusion.id} · ${textOf(row).slice(0, 54)}`;
        if (sameId(labelValue, row)) option.selected = true;
        select.append(option);
      }
      return select;
    }
    function addProposal(relation) {
      const proposalData=data,proposalProject=selectedId();
      const kind = relationKind(relation.type);
      const card = doc.createElement("fieldset"); card.className = "argdown-proposal";
      const title = doc.createElement("legend"); title.textContent = `${kind === "support" ? "支持候选" : kind === "oppose" ? "反对候选" : "未识别关系"}：${relation.fromLabel} → ${relation.toLabel}`;
      const explanation = doc.createElement("p"); explanation.className = "subtle";
      explanation.textContent = kind === "support" ? "这只是 Argdown 的支持关系；请确认它在本课题中确为必要前提。" : "此关系不会转换为必要前提，可作为人工核查线索。";
      card.append(title, explanation);
      if (kind !== "support") return proposals.append(card);
      const upstream = selectFor("选择已有上游结论", relation.fromLabel);
      const downstream = selectFor("选择已有下游结论", relation.toLabel);
      const necessary = doc.createElement("input"); necessary.type = "checkbox";
      const necessaryLabel = doc.createElement("label"); necessaryLabel.textContent = " 我确认这是下游结论的必要前提，而非自动判断或事实真值。"; necessaryLabel.prepend(necessary);
      const reason = doc.createElement("input"); reason.setAttribute("aria-label","确认必要前提的理由"); reason.maxLength = 2000; reason.placeholder = "确认理由（必填）";
      const confirm = button(doc, "登记此必要前提", "primary"); confirm.disabled = true;
      const canConfirm = () => !!necessary.checked && !!upstream.value && !!downstream.value && upstream.value !== downstream.value && !!reason.value.trim();
      const update = () => { confirm.disabled = !canConfirm(); };
      upstream.addEventListener("change", update); downstream.addEventListener("change", update); necessary.addEventListener("change", update); reason.addEventListener("input", update);
      confirm.addEventListener("click", async () => {
        if (!canConfirm() || !data?.project) return;
        confirm.disabled = true;
        try {
          if(proposalData!==data||proposalProject!==selectedId())throw Error("结论范围已变化，请重新预览并确认");
          await send({ type: "EV_RESEARCH_COMMAND", projectId: proposalProject, expectedRevision: data.project.evidenceRevision,
            operationId: operationId(), command: { kind: "addDependency", upstreamConclusionId: upstream.value,
              downstreamConclusionId: downstream.value,
              upstreamVersionId: currentVersion(upstream.value), downstreamVersionId: currentVersion(downstream.value),
              reason: reason.value.trim() } });
          win.dispatchEvent(new Event("threadline-evidence-changed")); await load({announce:false});say("已登记为必要前提；这不证明任何结论为真。");
        } catch (error) {
          await load({announce:false});say("未登记：" + error.message + "。已刷新当前版本，请重新确认。", true);
        } finally { confirm.disabled = !canConfirm(); }
      });
      card.append(label(doc, "上游结论", upstream), label(doc, "下游结论", downstream), necessaryLabel, reason, confirm); proposals.append(card);
    }
    function currentVersion(id) { return data?.rows?.find(row => row.conclusion.id === id)?.current?.id; }
    function previewImport() {
      proposals.replaceChildren();
      if(!data)return say("请先加载当前课题的已采纳结论。",true);
      if (!adapter?.parse) return say("Argdown 适配器未加载。", true);
      if (bytes(imported.value) > MAX_INPUT_BYTES) return say("Argdown 文本超过 200 KiB，未解析。", true);
      try {
        const result = adapter.parse(imported.value);
        for (const warning of result.warnings || []) proposals.append(message(doc, "解析警告：" + warning));
        for (const relation of result.relations || []) addProposal(relation);
        if (!(result.relations || []).length) proposals.append(message(doc, "没有可预览的关系；不会自动创建结论。"));
        say(`仅预览 ${result.statements?.length || 0} 条语句和 ${result.relations?.length || 0} 条关系，尚未写入。`);
      } catch (error) { say("Argdown 解析失败，未创建任何关系：" + error.message, true); }
    }
    function downloadText() {
      if (!exportedText) return;
      const url = URL.createObjectURL(new Blob([exportedText], { type: "text/plain;charset=utf-8" }));
      const link = doc.createElement("a"); link.href = url; link.download = `threadline-${exportedProject || "evidence"}.argdown`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    }
    refresh.addEventListener("click", load); project.addEventListener("change", load); exportButton.addEventListener("click", exportArgdown); download.addEventListener("click", downloadText); preview.addEventListener("click", previewImport);
    win.addEventListener("threadline-evidence-changed", () => load({announce:false}).catch(() => {})); load().catch(() => {});
    return { load, previewImport, exportArgdown };
  }
  function button(doc, text, className = "secondary") { const item = doc.createElement("button"); item.type = "button"; item.className = className; item.textContent = text; return item; }
  function textarea(doc, aria, rows) { const item = doc.createElement("textarea"); item.rows = rows; item.setAttribute("aria-label", aria); return item; }
  function label(doc, text, control) { const item = doc.createElement("label"); item.textContent = text + " "; item.append(control); return item; }
  function message(doc, text) { const item = doc.createElement("p"); item.className = "subtle"; item.textContent = text; return item; }
  const API = { install, relationKind, sameId, MAX_INPUT_BYTES };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else globalThis.ThreadLineArgdownUI = API;
  if (typeof window !== "undefined" && typeof document !== "undefined" && typeof chrome !== "undefined") install();
})();
