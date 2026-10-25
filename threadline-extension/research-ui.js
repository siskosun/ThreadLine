/* Local dependency/review workbench. It never sends evidence automatically. */
(() => {
  "use strict";
  const send = payload => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, response => {
      if (chrome.runtime.lastError) {
        reject(Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(Error(response?.error || "请求失败"));
        return;
      }
      resolve(response.data);
    });
  });
  const q = id => document.getElementById(id);
  const op = p => p + crypto.randomUUID().replace(/-/g, "").slice(0,12);
  const el = (tag, attrs = {}, text = "") => {
    const node = document.createElement(tag);
    Object.assign(node, attrs);
    node.textContent = text;
    return node;
  };
  let data, current;
  const pid = () => q("evidence-project")?.value || "";
  const row = id => data?.rows?.find(r => r.conclusion.id === id);
  const active = () => row(current) || data?.rows?.[0];
  const version = id => row(id)?.current?.id;
  const say = (text, bad=false) => { q("research-notice").textContent=text; q("research-notice").classList.toggle("warn",bad); };
  function blankReview() {
    q("research-review-id").value = "";
    q("research-blind").value = "";
    q("research-reference").value = "";
  }
  function option(r){ return new Option((r.current?.text || r.conclusion.id).slice(0,78),r.conclusion.id); }
  async function refresh(){
    if(!pid()) return;
    try { data=await send({type:"EV_RESEARCH_LIST",projectId:pid()}); if(!current) current=data.rows?.[0]?.conclusion.id; render(); }
    catch(e){say("依赖与复核不可用："+e.message,true);}
  }
  function drawGraph(target, edges) {
    const host = q("research-graph");
    host.replaceChildren();
    if (!target || !edges.length) {
      host.textContent = "当前结论尚未记录依赖。";
      return;
    }
    const ids = [...new Set(edges.flatMap(edge => [edge.upstreamConclusionId, edge.downstreamConclusionId]))];
    const shown = ids.slice(0,20);
    const height = Math.max(96, shown.length * 34 + 24);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 560 ${height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "当前结论的一跳依赖图");
    const positions = new Map(shown.map((id, index) => [id, {
      x: id === target.conclusion.id ? 280 : (index % 2 ? 470 : 90),
      y: id === target.conclusion.id ? height / 2 : 28 + index * 34
    }]));
    edges
      .filter(edge => positions.has(edge.upstreamConclusionId) && positions.has(edge.downstreamConclusionId))
      .forEach(edge => {
        const upstream = positions.get(edge.upstreamConclusionId);
        const downstream = positions.get(edge.downstreamConclusionId);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
        line.setAttribute("d", `M ${upstream.x} ${upstream.y} L ${downstream.x} ${downstream.y}`);
        line.setAttribute("stroke", "#7a8ca3");
        svg.append(line);
      });
    for (const id of shown) {
      const position = positions.get(id);
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      circle.setAttribute("cx", position.x);
      circle.setAttribute("cy", position.y);
      circle.setAttribute("r", id === target.conclusion.id ? 19 : 14);
      circle.setAttribute("fill", id === target.conclusion.id ? "#2868a5" : "#dbe7f4");
      label.setAttribute("x", position.x);
      label.setAttribute("y", position.y + 28);
      label.setAttribute("text-anchor", "middle");
      label.textContent = (row(id)?.current?.text || id).slice(0,15);
      svg.append(circle, label);
    }
    host.append(svg);
    if (ids.length > shown.length) {
      host.append(el("p", {className:"subtle"}, `图中显示前 ${shown.length} 项，关系列表保留全部 ${ids.length} 项。`));
    }
  }
  function render(){
    if(!data)return; const target=active(), selects=[q("research-target"),q("research-upstream"),q("research-downstream")];
    selects.forEach(s=>{s.replaceChildren();data.rows.forEach(r=>s.add(option(r)));});
    if(target){current=target.conclusion.id;q("research-target").value=current;q("research-downstream").value=current;}
    const edges=(data.edges||[]).filter(e=>e.status!=="removed"&&(e.upstreamConclusionId===current||e.downstreamConclusionId===current)),list=q("research-edges"); list.replaceChildren();
    for(const e of edges){const li=el("li",{},`${e.upstreamConclusionId===current?"当前结论依赖":"上游依赖当前结论"} · ${e.reason||"未说明"} · ${e.status||"active"}`),confirm=el("button",{type:"button",className:"secondary"},"确认已对照版本"),remove=el("button",{type:"button",className:"secondary"},"移除关系");confirm.onclick=()=>command({kind:"confirmDependency",edgeId:e.id,upstreamVersionId:e.upstreamVersionId,downstreamVersionId:e.downstreamVersionId,reason:prompt("确认理由：")||""});remove.onclick=()=>command({kind:"removeDependency",edgeId:e.id,reason:prompt("移除理由：")||""});li.append(" ",confirm," ",remove);list.append(li);}
    if(!edges.length)list.append(el("li",{},"没有已登记关系。未登记不表示没有依赖。"));
    const pending = (data.notifications || []).filter(note => note.pending !== false);
    const describePending = note => {
      const knownTargets = (note.targetIDs || [])
        .map(id => row(id)?.current?.text || id)
        .join("、");
      const reasons = Array.isArray(note.reasons) ? note.reasons.filter(Boolean).join("；") : "";
      return reasons || knownTargets || note.reason || note.targetConclusionId || "变化";
    };
    q("research-pending").textContent = pending.length
      ? `待核对 ${pending.length} 项：${pending.map(describePending).join("；")}`
      : "没有待核对通知。";
    q("research-history").textContent=(data.research?.events||[]).slice(-6).map(e=>`${e.kind||"事件"}：${e.reason||""}`).join("\n")||"尚无依赖或复核历史。"; drawGraph(target,edges);
  }
  async function command(command){
    try{await send({type:"EV_RESEARCH_COMMAND",projectId:pid(),expectedRevision:data.project?.evidenceRevision,command,operationId:op("op_research_")});await refresh();say("已保存。关系表示需核对的前提，不代表事实为真。");window.dispatchEvent(new Event("threadline-evidence-changed"));}
    catch(e){say("未保存："+e.message,true);}
  }
  async function prepare() {
    const target = active();
    const question = q("research-question").value.trim();
    if (!target || !question) {
      say("请选择结论并填写独立核对问题", true);
      return;
    }
    blankReview();
    try {
      const response = await send({
        type: "EV_REVIEW_PREPARE",
        projectId: pid(),
        targetConclusionId: target.conclusion.id,
        question,
        expectedRevision: data.project?.evidenceRevision,
        operationId: op("op_review_")
      });
      const materials = response.review?.blindMaterials || [];
      q("research-blind").value = typeof materials === "string"
        ? materials
        : JSON.stringify({question,materials}, null, 2);
      q("research-review-id").value = response.review?.id || "";
      if (Number.isSafeInteger(response.revision)) {
        data.project.evidenceRevision = response.revision;
      }
      say("已冻结独立核对材料。先独立分析，再按需查看旧结论。");
    } catch (error) {
      say("无法准备复核：" + error.message, true);
    }
  }
  async function reference() {
    try {
      const response = await send({
        type: "EV_REVIEW_REFERENCE",
        projectId: pid(),
        reviewId: q("research-review-id").value
      });
      q("research-reference").value = `${response.text || ""}\n\n适用条件：${response.conditions || ""}`;
    } catch (error) {
      say("无法读取旧结论：" + error.message, true);
    }
  }
  async function complete() {
    try {
      const reason = q("research-review-reason").value.trim();
      const outcome = q("research-outcome").value;
      const reviewId = q("research-review-id").value;
      if (!reviewId || !reason) {
        throw Error("请先准备复核并填写理由");
      }
      const payload = {
        type: "EV_REVIEW_COMPLETE",
        projectId: pid(),
        reviewId,
        outcome,
        reason,
        expectedRevision: data.project?.evidenceRevision,
        operationId: op("op_review_")
      };
      if (outcome === "revise") {
        payload.text = q("research-revised-text").value;
      }
      const response = await send(payload);
      await refresh();
      say(response.stale
        ? "复核材料已过期，仅作为历史保留；未改变当前结论。"
        : "复核结果已记录。");
    } catch (error) {
      say("复核未完成：" + error.message, true);
    }
  }
  async function promptForDeps(){try{const r=await send({type:"EV_DEPENDENCY_PROMPT",projectId:pid()});await navigator.clipboard.writeText(r.prompt||"");say("已复制包含结论文本的 AI 建议提示词；粘贴返回 JSON 后仍须逐项确认。范围哈希："+(r.scopeHash||"未知"));}catch(e){say("无法生成提示词："+e.message,true);}}
  async function preview(){try{const r=await send({type:"EV_SUGGESTIONS_PREVIEW",projectId:pid(),json:q("research-suggestions").value}),host=q("research-proposals");host.replaceChildren();for(const p of r.proposals||[]){const b=el("button",{type:"button",className:"secondary"},"确认此条关系");b.onclick=()=>command({kind:"addDependency",upstreamConclusionId:p.upstreamConclusionId,downstreamConclusionId:p.downstreamConclusionId,upstreamVersionId:p.upstreamVersionId,downstreamVersionId:p.downstreamVersionId,reason:p.reason||"人工确认 AI 建议"});host.append(el("p",{},`${p.upstreamConclusionId} → ${p.downstreamConclusionId}：${p.reason||""}`),b);}}catch(e){say("建议预览失败："+e.message,true);}}
  function mount(){
    const host=q("evidence-section");if(!host||q("research-workbench"))return; const box=el("details",{id:"research-workbench",className:"research-workbench"});box.append(el("summary",{},"依赖与复核（S2–S5）"));
    const body=el("div",{});body.innerHTML=`<p class="subtle">只显示当前结论的一跳关系。依赖、复核和 AI 建议均需人工确认，不自动发送或改写结论。</p><label>当前结论 <select id="research-target"></select></label><div id="research-graph"></div><p id="research-pending" class="subtle"></p><ul id="research-edges"></ul><label>上游结论 <select id="research-upstream"></select></label><label>下游结论 <select id="research-downstream"></select></label><label>必要前提理由 <input id="research-reason"/></label><button id="research-add" type="button">登记人工确认的依赖</button><pre id="research-history" class="subtle"></pre><hr/><label>独立复核问题 <input id="research-question"/></label><button id="research-prepare" type="button">冻结独立核对材料</button><textarea id="research-blind" rows="6" readonly aria-label="独立核对材料"></textarea><button id="research-copy-blind" type="button" class="secondary">复制独立核对材料</button><button id="research-reference-btn" type="button" class="secondary">查看旧结论</button><textarea id="research-reference" rows="4" readonly aria-label="旧结论参考"></textarea><input id="research-review-id" type="hidden"/><label>复核结果 <select id="research-outcome"><option value="keep">保留</option><option value="revise">修订</option><option value="withdraw">撤回</option><option value="inconclusive">无法判断</option></select></label><label>理由 <textarea id="research-review-reason" rows="2"></textarea></label><label>修订正文（仅“修订”使用）<textarea id="research-revised-text" rows="3"></textarea></label><button id="research-complete" type="button">记录复核结果</button><hr/><p class="subtle">复制提示词会将当前结论文本写入剪贴板；不会自动发送。</p><button id="research-prompt" type="button" class="secondary">复制 AI 依赖建议提示词</button><label>粘贴建议 JSON（仅预览）<textarea id="research-suggestions" rows="4"></textarea></label><button id="research-preview" type="button" class="secondary">预览建议</button><div id="research-proposals"></div><p id="research-notice" role="status" class="subtle"></p>`;
    box.append(body);host.append(box);q("research-target").onchange=e=>{current=e.target.value;blankReview();render();};q("research-add").onclick=()=>command({kind:"addDependency",upstreamConclusionId:q("research-upstream").value,downstreamConclusionId:q("research-downstream").value,upstreamVersionId:version(q("research-upstream").value),downstreamVersionId:version(q("research-downstream").value),reason:q("research-reason").value});q("research-prepare").onclick=prepare;q("research-reference-btn").onclick=reference;q("research-complete").onclick=complete;q("research-prompt").onclick=promptForDeps;q("research-preview").onclick=preview;q("research-copy-blind").onclick=()=>navigator.clipboard.writeText(q("research-blind").value).then(()=>say("已复制独立核对材料；粘贴到外部工具仍须由你决定。"),e=>say("复制失败："+e.message,true));window.addEventListener("threadline-evidence-changed",refresh);q("evidence-project")?.addEventListener("change",()=>{current=null;blankReview();refresh();});refresh();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount);else mount();
})();
