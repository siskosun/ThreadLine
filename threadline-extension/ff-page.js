/* Local-only Fork P1 UI. Use textContent for all untrusted experiment data. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const inputs = ["ff-w0","ff-p"];
  let pendingCreate = null; // In-memory lease while this page stays open.
  let createBusy = false;
  // A create intent survives THIS TAB's reload until its saved result is displayed.
  // Store only its SHA-256 and operation ID, never W0/P content in sessionStorage.
  const CREATE_INTENT_KEY = "tl_ff_create_intent_v1";
  function storedCreateIntent() {
    const raw = sessionStorage.getItem(CREATE_INTENT_KEY);
    if (raw === null) return null;
    let record;
    try { record = JSON.parse(raw); } catch {}
    if (!record || typeof record.operationId !== "string" ||
        !/^[a-zA-Z0-9_-]{6,100}$/.test(record.operationId) ||
        typeof record.inputHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(record.inputHash))
      throw new Error("待确认创建记录无法验证，已停止新建以避免重复实验");
    return record;
  }
  async function createIntent(w0, p) {
    const inputHash = await ThreadLineFFCore.hash(JSON.stringify([w0, p]));
    const stored = storedCreateIntent();
    if (stored?.inputHash === inputHash)
      return {operationId:stored.operationId, w0, p};
    const operationId = crypto.randomUUID();
    // If Web Storage fails, do not silently proceed with an unrecoverable ID.
    sessionStorage.setItem(CREATE_INTENT_KEY,JSON.stringify({operationId,inputHash}));
    return {operationId,w0,p};
  }
  function acknowledgeIntent(operationId) {
    const stored = storedCreateIntent();
    if (stored?.operationId === operationId)
      sessionStorage.removeItem(CREATE_INTENT_KEY);
  }
  const send = payload => new Promise((resolve,reject) => {
    chrome.runtime.sendMessage(payload,response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response?.ok) return reject(new Error(response?.error || "后台没有返回结果"));
      resolve(response.data);
    });
  });
  function notice(message, error=false) {
    $("ff-notice").textContent = message;
    $("ff-notice").dataset.error = String(error);
  }
  function bytes() {
    const value = ThreadLineFFCore.formatText($("ff-w0").value, $("ff-p").value);
    const size = ThreadLineFFCore.byteLength(value);
    $("ff-bytes").textContent = "最终发送文本：" + size.toLocaleString() +
      " / 24,000 UTF-8 字节" + (size>24000?"（超出限制）":"");
    $("ff-save").disabled = createBusy || size > 24000 || !$("ff-p").value.trim();
  }
  let currentExperiment = null;
  async function runOperation(payload, busyButton) {
    if (busyButton) busyButton.disabled = true;
    try {
      await send(payload);
      if (currentExperiment) await read(currentExperiment);
      return true;
    } catch (e) { notice(e.message, true); return false; }
    finally { if (busyButton) busyButton.disabled = false; }
  }
  function branchBox(branch, data) {
    const info = data.branches[branch], attempt = info.attempts.at(-1), ev = attempt?.evidence || {};
    const box = document.createElement("div");
    const head = document.createElement("p");
    head.className = "mono";
    head.textContent = "分支 " + branch + "：" + info.status + " · 阶段 " + info.phase +
      (attempt ? " · 尝试 " + attempt.id.slice(0, 16) : "") +
      (ev.sessionId ? " · 会话 " + ev.sessionId.slice(0, 16) : "");
    box.appendChild(head);
    const detail = document.createElement("p");
    detail.className = "subtle";
    const parts = [];
    if (ev.inputLevel) parts.push("输入一致性 " + ev.inputLevel);
    if (ev.prefill) parts.push("预填 " + (ev.prefill === "reacked" ? "已重新预填" : "已逐字核对"));
    if (typeof ev.assistantBytes === "number") parts.push("回复 " + ev.assistantBytes + " 字节");
    if (Array.isArray(ev.endSignals)) parts.push("完成信号 " + ev.endSignals.join("/"));
    if (info.status === "pending" && ev.sessionId) parts.push("回复生成后请点击采集");
    detail.textContent = parts.join("；");
    box.appendChild(detail);
    if (info.status === "pending" && attempt && Number.isInteger(ev.tabId)) {
      const row = document.createElement("p");
      if (!ev.sessionId) {
        const re = document.createElement("button");
        re.type = "button"; re.className = "secondary";
        re.textContent = "重新预填此分支";
        re.addEventListener("click", () =>
          runOperation({type:"FF_REPREFILL", experimentId:data.id, branch,
            operationId:crypto.randomUUID()}, re));
        row.appendChild(re);
      } else if (info.phase !== "capturing") {
        const cap = document.createElement("button");
        cap.type = "button"; cap.className = "secondary";
        cap.textContent = "采集回复（完成后自动核对完成条件）";
        cap.addEventListener("click", () =>
          runOperation({type:"FF_CAPTURE", experimentId:data.id, branch}, cap));
        row.appendChild(cap);
      }
      box.appendChild(row);
    }
    return box;
  }
  function renderCompare(value) {
    const section = $("ff-compare");
    const a = value.branches.A, b = value.branches.B;
    const decision = value.decision || {};
    const bothDone = a.status === "done" && b.status === "done";
    section.hidden = !(bothDone || decision.mapping);
    if (section.hidden) return;
    const replyOf = label => {
      const branch = decision.mapping?.[label];
      const attempt = branch && value.branches[branch].attempts.at(-1);
      return attempt?.evidence?.reply || "";
    };
    const note = $("ff-compare-note");
    const columns = $("ff-columns");
    columns.replaceChildren();
    $("ff-compare-btn").hidden = !!decision.mapping;
    if (!decision.mapping) {
      note.textContent = "两个分支均完成后生成 X/Y 去标签对照；对应关系在裁决前不用于展示。";
      $("ff-verdict-form").hidden = true;
      $("ff-export").hidden = true;
      $("ff-reveal").textContent = "";
      return;
    }
    if (!decision.verdict) {
      note.textContent = "对照已生成。请阅读 X/Y 两栏回复并提交裁决；提交后才显示对应关系。";
      for (const label of ["X", "Y"]) {
        const col = document.createElement("div");
        const head = document.createElement("p");
        head.className = "mono";
        head.textContent = "回复 " + label;
        const body = document.createElement("pre");
        body.id = "ff-reply-" + label;
        body.textContent = replyOf(label);
        col.appendChild(head); col.appendChild(body);
        columns.appendChild(col);
      }
      $("ff-verdict-form").hidden = false;
      $("ff-export").hidden = true;
      $("ff-reveal").textContent = "";
      return;
    }
    note.textContent = "已裁决；对应关系已揭盲。";
    for (const label of ["X", "Y"]) {
      const col = document.createElement("div");
      const head = document.createElement("p");
      head.className = "mono";
      head.textContent = "回复 " + label + " = 分支 " + decision.mapping[label];
      const body = document.createElement("pre");
      body.textContent = replyOf(label);
      col.appendChild(head); col.appendChild(body);
      columns.appendChild(col);
    }
    const v = decision.verdict;
    $("ff-verdict-form").hidden = true;
    $("ff-reveal").textContent = "裁决：" + v.preference + " · 揭盲：X = 分支 " +
      decision.mapping.X + "，Y = 分支 " + decision.mapping.Y + " · 依据：" + v.criteria +
      " · 置信度 " + v.confidence + (v.notes ? " · 备注 " + v.notes : "");
    $("ff-export").hidden = false;
  }
  async function read(id) {
    const value = await send({type:"FF_READ",id});
    currentExperiment = id;
    $("ff-meta").textContent = "实验 " + value.id + " · revision " + value.revision +
      " · " + value.frozen.bytes + " UTF-8 字节";
    $("ff-sha").textContent = "冻结 SHA-256（canonicalization-v1）：" +
      value.frozen.textHashes.frozen;
    $("ff-text").textContent = value.frozen.text;
    $("ff-detail").hidden = false;
    const launched = value.branches.A.attempts.length > 0 || value.branches.B.attempts.length > 0;
    $("ff-branches").hidden = false;
    $("ff-launch").disabled = launched &&
      (value.branches.A.status === "pending" || value.branches.A.status === "done" ||
       value.branches.B.status === "pending" || value.branches.B.status === "done");
    $("ff-launch").textContent = launched ? "重新发起（仅当两分支都非进行中且未完成）" : "发起双分支（两个新标签）";
    const boxA = $("ff-branch-a"), boxB = $("ff-branch-b");
    boxA.replaceChildren(branchBox("A", value));
    boxB.replaceChildren(branchBox("B", value));
    renderCompare(value);
  }
  async function list() {
    const values = await send({type:"FF_LIST"});
    const holder = $("ff-list");
    holder.replaceChildren();
    if (values.length === 0) {
      const empty = document.createElement("p");
      empty.textContent = "尚无实验。";
      empty.className = "subtle";
      holder.appendChild(empty);
      return;
    }
    for (const item of values) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary";
      button.textContent = item.id + " · A:" + item.statusA + " / B:" + item.statusB;
      button.addEventListener("click", () => read(item.id).catch(e=>notice(e.message,true)));
      holder.appendChild(button);
    }
  }
  async function refresh() {
    const status = await send({type:"FF_STATUS"});
    $("ff-enable").checked = status.enabled === true;
    $("ff-local").hidden = status.enabled !== true;
    if (status.enabled) await list();
    else $("ff-detail").hidden = true;
    notice(status.enabled ? "已启用：仅本地冻结/存储，不会发送消息。" :
      "功能未启用。没有自动网页操作。");
    bytes();
  }
  $("ff-enable").addEventListener("change", async event => {
    const checkbox = event.target;
    checkbox.disabled = true;
    try {
      await send({type:"FF_SET_ENABLED",enabled:checkbox.checked,ack:"local-only-no-send"});
      await refresh();
    } catch(e) {
      notice(e.message,true);
      await refresh().catch(()=>{checkbox.checked = false;});
    } finally {checkbox.disabled = false;}
  });
  for (const id of inputs) $(id).addEventListener("input", () => {
    pendingCreate = null; // Editing invalidates the previous frozen creation intent.
    bytes();
  });
  $("ff-create").addEventListener("submit", async event => {
    event.preventDefault();
    if (createBusy) return;
    createBusy = true;
    let saved = false;
    $("ff-save").disabled = true;
    try {
      const w0 = $("ff-w0").value, p = $("ff-p").value;
      if (!pendingCreate || pendingCreate.w0 !== w0 || pendingCreate.p !== p)
        pendingCreate = await createIntent(w0,p);
      const intent = pendingCreate;
      const created = await send({type:"FF_CREATE",...intent});
      saved = true;
      await list();
      await read(created.id);
      // Display errors must not turn an unchanged-input manual retry into a
      // new create. Keep the same durable ID until the result is visible.
      acknowledgeIntent(intent.operationId);
      if (pendingCreate?.operationId === intent.operationId) pendingCreate = null;
      notice("已冻结并保存到独立本地数据库；没有打开或发送网页消息。");
    } catch (error) {
      notice(saved ? "实验已保存，显示刷新失败。保留相同输入再次点击保存可恢复本次结果：" + error.message
        : error.message,true);
    } finally {createBusy = false; bytes();}
  });
  $("ff-refresh").addEventListener("click", () =>
    list().catch(error => notice(error.message,true)));
  $("ff-launch").addEventListener("click", async event => {
    if (!currentExperiment) return;
    const button = event.target;
    button.disabled = true;
    try {
      await send({type:"FF_LAUNCH", experimentId:currentExperiment,
        operationId:crypto.randomUUID()});
      await read(currentExperiment);
      notice("双分支已创建并预填；请在两个新标签中检查内容后手动发送。研线不会替你发送。");
    } catch (e) { notice(e.message, true); await read(currentExperiment).catch(()=>{}); }
    finally { button.disabled = false; }
  });
  $("ff-compare-btn").addEventListener("click", async event => {
    if (!currentExperiment) return;
    const button = event.target;
    button.disabled = true;
    try {
      await send({type:"FF_COMPARE", experimentId:currentExperiment,
        operationId:crypto.randomUUID()});
      await read(currentExperiment);
      notice("X/Y 对照已生成；对应关系在裁决前不用于展示。");
    } catch (e) { notice(e.message, true); await read(currentExperiment).catch(()=>{}); }
    finally { button.disabled = false; }
  });
  $("ff-verdict").addEventListener("click", async event => {
    if (!currentExperiment) return;
    const button = event.target;
    const payload = {type:"FF_VERDICT", experimentId:currentExperiment,
      preference:$("ff-preference").value, criteria:$("ff-criteria").value,
      confidence:$("ff-confidence").value, notes:$("ff-notes").value};
    button.disabled = true;
    try {
      await send(payload);
      await read(currentExperiment);
      notice("裁决已记录并揭盲。");
    } catch (e) { notice(e.message, true); await read(currentExperiment).catch(()=>{}); }
    finally { button.disabled = false; }
  });
  $("ff-export").addEventListener("click", async event => {
    if (!currentExperiment) return;
    const button = event.target;
    button.disabled = true;
    try {
      const snapshot = await send({type:"FF_EXPORT", experimentId:currentExperiment});
      const blob = new Blob([JSON.stringify(snapshot, null, 1)],
        {type:"application/json"});
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = snapshot.experiment.id + "-fork-export.json";
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      notice("已导出自包含 JSON；仅导出，本阶段不支持导入。");
    } catch (e) { notice(e.message, true); }
    finally { button.disabled = false; }
  });
  refresh().catch(error => notice(error.message,true));
})();
