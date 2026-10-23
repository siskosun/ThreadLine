/* Local-only Fork P1 UI. Use textContent for all untrusted experiment data. */
(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const inputs = ["ff-w0","ff-p"];
  let pendingCreate = null; // In-memory lease while this page stays open.
  // One unacknowledged create intent survives THIS TAB's page/worker reload.
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
    $("ff-save").disabled = size > 24000 || !$("ff-p").value.trim();
  }
  async function read(id) {
    const value = await send({type:"FF_READ",id});
    $("ff-meta").textContent = "实验 " + value.id + " · revision " + value.revision +
      " · " + value.frozen.bytes + " UTF-8 字节";
    $("ff-sha").textContent = "冻结 SHA-256（canonicalization-v1）：" +
      value.frozen.textHashes.frozen;
    $("ff-text").textContent = value.frozen.text;
    $("ff-detail").hidden = false;
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
    $("ff-save").disabled = true;
    try {
      const w0 = $("ff-w0").value, p = $("ff-p").value;
      if (!pendingCreate || pendingCreate.w0 !== w0 || pendingCreate.p !== p)
        pendingCreate = await createIntent(w0,p);
      const intent = pendingCreate;
      const created = await send({type:"FF_CREATE",...intent});
      // An accepted ACK proves this intent was persisted by the worker. Clear
      // its lease; a lost ACK leaves the same ID available after page reload.
      acknowledgeIntent(intent.operationId);
      if (pendingCreate?.operationId === intent.operationId) pendingCreate = null;
      await list();
      await read(created.id);
      notice("已冻结并保存到独立本地数据库；没有打开或发送网页消息。");
    } catch (error) {notice(error.message,true);}
    finally {bytes();}
  });
  $("ff-refresh").addEventListener("click", () =>
    list().catch(error => notice(error.message,true)));
  refresh().catch(error => notice(error.message,true));
})();
