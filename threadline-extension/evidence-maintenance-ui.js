/* User-facing evidence maintenance.  This script never writes evidence from
 * the panel: every destructive action is preview -> explicit confirmation ->
 * one stable operation id.  It intentionally does not depend on SNAPSHOT so
 * recovery remains reachable when the normal topic projection is damaged. */
(() => {
  "use strict";
  const MAX_PACKAGE_BYTES = 20 * 1024 * 1024;
  const countsOf = value => Object.fromEntries(["conclusions", "versions", "sources", "links"]
    .map(key => [key, Number.isSafeInteger(value?.[key]) && value[key] >= 0 ? value[key] : 0]));
  const operationId = prefix => "op_" + prefix + "_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  const normalizeBackup = parsed => {
    if (parsed?.format === "threadline-project-backup/1" && parsed.evidence)
      return parsed;
    if (["threadline-evidence/1", "threadline-evidence/2", "threadline-evidence/3"].includes(parsed?.format))
      return { format: "threadline-project-backup/1", topic: null, evidence: parsed, legacyEvidenceOnly: true };
    throw new Error("请选择研线证据备份（/1、/2 或 /3）");
  };
  async function parseBackupFile(file) {
    if (!file) throw new Error("请选择备份文件");
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_PACKAGE_BYTES)
      throw new Error("备份文件超过 20 MiB，未读取文件内容");
    let parsed;
    try { parsed = JSON.parse(await file.text()); }
    catch { throw new Error("备份不是有效 JSON"); }
    return normalizeBackup(parsed);
  }
  const countText = counts => {
    const c = countsOf(counts);
    return `结论 ${c.conclusions}、版本 ${c.versions}、来源片段 ${c.sources}、链接 ${c.links}`;
  };
  const download = (filename, data) => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  function install({ document: doc = document, chrome: extensionChrome = chrome, win = window } = {}) {
    const host = doc.querySelector("#evidence-section");
    if (!host || doc.getElementById("evidence-maintenance")) return null;
    const send = payload => new Promise((resolve, reject) => extensionChrome.runtime.sendMessage(payload, reply => {
      if (extensionChrome.runtime.lastError) return reject(new Error(extensionChrome.runtime.lastError.message));
      if (!reply?.ok) return reject(new Error(reply?.error || "后台无返回"));
      resolve(reply.data);
    }));
    const box = doc.createElement("details");
    box.id = "evidence-maintenance";
    box.style.cssText = "margin-top:14px;border-top:1px solid #e6eaf0;padding-top:10px";
    const title = doc.createElement("summary");
    title.textContent = "证据备份、恢复与删除";
    title.style.cssText = "cursor:pointer;font-size:12px;font-weight:700;color:#466078";
    const body = doc.createElement("div"); body.style.cssText = "padding:9px 0 2px";
    const notice = doc.createElement("p"); notice.textContent = "备份包含结论和对话原文片段。删除只清理本课题可确定的证据、摘要与课题历史；采集/Fork 原始资料、外部文件和已复制内容不会自动删除。";
    notice.className = "subtle"; notice.style.lineHeight = "1.65";
    const select = doc.createElement("select"); select.setAttribute("aria-label", "选择维护课题");
    select.style.cssText = "max-width:100%;margin:3px 0 8px";
    const status = doc.createElement("p"); status.setAttribute("role", "status"); status.className = "subtle"; status.style.whiteSpace = "pre-line";
    const actions = doc.createElement("div"); actions.className = "line";
    const backup = button("导出证据备份"), pick = button("选择备份文件恢复"), diagnostic = button("导出故障原始包"), remove = button("预览删除范围", "danger");
    actions.append(backup, pick, diagnostic, remove);
    const input = doc.createElement("input"); input.type = "file"; input.accept = "application/json,.json"; input.hidden = true;
    const restorePanel = doc.createElement("div"); restorePanel.hidden = true; restorePanel.style.cssText = "border:1px solid #dce5ee;border-radius:9px;padding:9px;margin:8px 0";
    const restoreText = doc.createElement("p"); restoreText.className = "subtle"; restoreText.style.whiteSpace = "pre-line";
    const replace = doc.createElement("input"); replace.type = "checkbox"; replace.id = "evidence-maintenance-replace";
    const replaceLabel = doc.createElement("label"); replaceLabel.htmlFor = replace.id; replaceLabel.textContent = "替换同 ID 的当前证据课题（会删除当前状态，请先自行导出备份）"; replaceLabel.style.cssText = "display:block;font-size:11px;margin:7px 0"; replaceLabel.prepend(replace);
    const restore = button("确认恢复", "primary"), cancelRestore = button("取消"); restore.disabled = true;
    restorePanel.append(restoreText, replaceLabel, restore, cancelRestore);
    const retry = button("重试未完成的删除清理"); retry.hidden = true;
    body.append(notice, select, actions, input, restorePanel, retry, status); box.append(title, body); host.append(box);
    let projects = [], pendingRestore = null, pendingDelete = null;
    const say = (text, bad = false) => { status.textContent = text; status.style.color = bad ? "#a34d3a" : ""; };
    function selected() { return projects.find(project => project.id === select.value) || null; }
    function button(label, className = "secondary") { const item = doc.createElement("button"); item.type = "button"; item.className = className; item.textContent = label; return item; }
    function emitChanged() { win.dispatchEvent(new CustomEvent("threadline-evidence-changed")); }
    async function refresh() {
      try {
        const data = await send({ type: "EV_PROJECTS" });
        projects = Array.isArray(data.projects) ? data.projects : [];
        const old = select.value; select.replaceChildren();
        for (const project of projects) {
          const option = doc.createElement("option"); option.value = project.id;
          option.textContent = `${project.name || project.id}${project.deleted ? "（已删除）" : project.unavailable ? "（需恢复）" : ""}`;
          option.disabled = !!project.deleted; select.append(option);
        }
        if ([...select.options].some(option => option.value === old)) select.value = old;
        if (!projects.length) say(data.error || "没有可维护的证据课题。可导出故障原始包或选择备份恢复。", !!data.error);
        else if (data.error) say(data.error, true); else say("请选择课题后导出、恢复或删除证据。 ");
      } catch (error) { projects = []; select.replaceChildren(); say("证据课题目录不可用：" + error.message + "。仍可导出故障原始包。", true); }
    }
    backup.addEventListener("click", async () => {
      const project = selected(); if (!project) return say("请先选择一个可用课题。", true);
      if (!win.confirm("此备份包含对话原文片段。请确认你有权保存和导出这些内容。")) return;
      backup.disabled = true;
      try { const data = await send({ type: "EV_BACKUP", projectId: project.id }); download(`threadline-evidence-${project.id}.json`, data); say("已导出：" + countText(data.evidence?.counts)); }
      catch (error) { say("导出失败：" + error.message, true); }
      finally { backup.disabled = false; }
    });
    diagnostic.addEventListener("click", async () => {
      diagnostic.disabled = true;
      try { const data = await send({ type: "EV_DIAGNOSTIC_EXPORT" }); download("threadline-evidence-diagnostic.json", data); say("已导出故障原始包；它包含原文，不能直接作为普通恢复包。 "); }
      catch (error) { say("故障包导出失败：" + error.message, true); }
      finally { diagnostic.disabled = false; }
    });
    pick.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files?.[0]; input.value = ""; pendingRestore = null; restore.disabled = true; restorePanel.hidden = true;
      try {
        const backupFile = await parseBackupFile(file);
        pendingRestore = { backup: backupFile, replace: false, operationId: operationId("restore") };
        replace.checked=false;restorePanel.hidden=false;restoreText.textContent="备份包含原文片段。若同 ID 课题已存在，请选择替换模式后再次预览。替换会删除当前状态，建议先导出。";
        const data = await send({ type: "EV_RESTORE_PREVIEW", backup: backupFile, replace: false });
        pendingRestore.preview = data.preview; pendingRestore.counts = data.counts;
        restoreText.textContent = `${backupFile.legacyEvidenceOnly ? "旧式仅证据包；将创建或关联恢复课题。\n" : ""}恢复范围：${countText(data.counts)}。\n${data.includesOriginalExcerpts ? "包含对话原文片段。" : "不含完整原文片段。"}\n恢复模式：新建。请确认后再写入。`;
        restorePanel.hidden = false; restore.disabled = false; say("恢复仅为预览，尚未写入。 ");
      } catch (error) { say("无法预览恢复：" + error.message, true); }
    });
    replace.addEventListener("change", async () => {
      if (!pendingRestore) return;
      restore.disabled = true; pendingRestore.replace = replace.checked;
      try {
        const data = await send({ type: "EV_RESTORE_PREVIEW", backup: pendingRestore.backup, replace: pendingRestore.replace });
        pendingRestore.preview = data.preview; pendingRestore.counts = data.counts;
        restoreText.textContent = `恢复范围：${countText(data.counts)}。\n${data.includesOriginalExcerpts ? "包含对话原文片段。" : "不含完整原文片段。"}\n恢复模式：${pendingRestore.replace ? "替换同 ID 课题；当前证据将被删除，请先自行导出备份。" : "新建。"}\n请确认后再写入。`;
        restore.disabled = false;
      } catch (error) { say("无法预览恢复：" + error.message, true); }
    });
    restore.addEventListener("click", async () => {
      if (!pendingRestore?.preview) return;
      if (!win.confirm("确认按当前预览恢复？不会自动发送任何材料。")) return;
      restore.disabled = true;
      try {
        const data = await send({ type: "EV_RESTORE_COMMIT", backup: pendingRestore.backup, preview: pendingRestore.preview, operationId: pendingRestore.operationId });
        say(`已恢复 ${data.restored ?? pendingRestore.counts?.conclusions ?? 0} 条结论。`); pendingRestore = null; restorePanel.hidden = true; emitChanged(); await refresh();
      } catch (error) { say("恢复结果未知或失败：" + error.message + "。可用同一预览重试，不会自动重试。", true); restore.disabled = false; }
    });
    cancelRestore.addEventListener("click", () => { pendingRestore = null; restorePanel.hidden = true; });
    remove.addEventListener("click", async () => {
      const project = selected(); if (!project) return say("请先选择一个可用课题。", true);
      remove.disabled = true;
      try {
        const data = await send({ type: "EV_DELETE_PREVIEW", projectId: project.id });
        pendingDelete = { preview: data.preview, operationId: operationId("delete") };
        const warning = `${countText(data.counts)}。${data.retainedOriginalsNotice || "采集/Fork 原始资料、外部文件及已复制内容会保留。"}`;
        if (!win.confirm("确认删除本课题可确定的证据副本？\n" + warning)) { say("已取消删除。 "); return; }
        const result = await send({ type: "EV_DELETE_COMMIT", preview: pendingDelete.preview, operationId: pendingDelete.operationId });
        retry.hidden = !result.cleanupPending; say(result.cleanupPending ? "证据已删除，课题副本清理待完成；可用下方按钮重试。" : "证据与可确定的课题副本已删除。 "); emitChanged(); await refresh();
      } catch (error) { say("删除结果未知或失败：" + error.message + "。不会自动重试。", true); }
      finally { remove.disabled = false; }
    });
    retry.addEventListener("click", async () => {
      if (!pendingDelete) return;
      retry.disabled = true;
      try { const result = await send({ type: "EV_DELETE_COMMIT", preview: pendingDelete.preview, operationId: pendingDelete.operationId }); retry.hidden = !result.cleanupPending; say(result.cleanupPending ? "清理仍待完成。" : "删除清理已完成。 "); emitChanged(); await refresh(); }
      catch (error) { say("重试清理失败：" + error.message + "。未自动继续。", true); }
      finally { retry.disabled = false; }
    });
    win.addEventListener("threadline-evidence-changed", () => refresh().catch(() => {}));
    refresh().catch(() => {});
    return { refresh, parseBackupFile };
  }
  const API = { install, parseBackupFile, normalizeBackup, countsOf, MAX_PACKAGE_BYTES };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else globalThis.ThreadLineEvidenceMaintenanceUI = API;
  if (typeof window !== "undefined" && typeof document !== "undefined" && typeof chrome !== "undefined") install();
})();
