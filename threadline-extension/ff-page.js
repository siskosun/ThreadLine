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
    if (info.status === "pending" && attempt) {
      const next = {created:"下一步：等待预填逐字核对（绿色横幅）",
        awaiting_send:"下一步：在该分支标签中手动点击发送",
        generating:"下一步：回复生成完成后点「采集回复」",
        capturing:"等待采集与完成判定"}[info.phase];
      if (next) parts.push(next);
    }
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
        cap.addEventListener("click", async () => {
          const started = await runOperation(
            {type:"FF_CAPTURE", experimentId:data.id, branch}, cap);
          if (!started) return;
          notice("采集已启动（分支 " + branch + "）。采集在分支标签页完成后自动核对，稍候此处会刷新。");
          // The capture run finishes asynchronously in the branch tab; the
          // immediate re-read inside runOperation still shows the old phase,
          // so poll a few times to surface the result without a manual refresh.
          for (const delay of [4000, 9000, 15000]) {
            setTimeout(() => {
              if (currentExperiment === data.id) read(currentExperiment).catch(() => {});
            }, delay);
          }
        });
        row.appendChild(cap);
      }
      box.appendChild(row);
    }
    return box;
  }
  function renderAdoptControl(label, value, decision, replyText) {
    const holder = document.createElement("div");
    holder.className = "line";
    const branch = decision.mapping[label];
    const attempt = value.branches[branch] && value.branches[branch].attempts.at(-1);
    const reply = replyText || "";
    const evidence = attempt && attempt.evidence;
    const status = document.createElement("span");
    status.className = "subtle";
    const adopt = document.createElement("button");
    adopt.type = "button"; adopt.className = "secondary";
    adopt.textContent = "采纳该分支结论到证据库";
    adopt.addEventListener("click", async () => {
      adopt.disabled = true;
      try {
        if (!evidence?.captureRunId || !evidence?.messageId || !reply)
          throw new Error("此旧实验缺少完整回复来源，无法精确采纳；请重新采集该分支");
        await ThreadLineEvidenceAdoption.open({sources:[{
          label:"Fork " + label + " · 已采集最终回复",
          experimentId:value.id,branch:branch,attemptId:attempt.id,
          captureRunId:evidence.captureRunId,messageId:evidence.messageId,
          coverage:evidence.captureComplete?"原始采集：分页完成":"原始采集：部分历史",
          nonText:!!evidence.hasNonText,aiCoverage:"不适用（Fork 原始回复）"
        }],submit:form=>send({type:"EV_ADOPT_FORK",projectId:form.projectId,text:form.text,conditions:form.conditions,
          experimentId:value.id,branch:form.source.branch,attemptId:form.source.attemptId,
          selection:form.selection,relation:form.relation,
          operationId:"op_fork_adopt_"+crypto.randomUUID().replace(/-/g,"").slice(0,12)})});
        status.textContent = "已提交采纳；请在研线面板的证据结论中查看。";
      } catch (e) { status.textContent = "采纳失败：" + e.message; }
      finally { adopt.disabled = false; }
    });
    holder.appendChild(adopt); holder.appendChild(status);
    return holder;
  }

  function renderCompare(value) {
    const section = $("ff-compare");
    const branches = value.branches;
    const branchLabels = Object.keys(branches);
    const decision = value.decision || {};
    const bothDone = branchLabels.every(label => branches[label].status === "done");
    section.hidden = !(bothDone || decision.mapping);
    if (section.hidden) return;
    const replyOf = label => {
      const branch = decision.mapping?.[label];
      const attempt = branch && branches[branch].attempts.at(-1);
      return attempt?.evidence?.reply || "";
    };
    const note = $("ff-compare-note");
    const columns = $("ff-columns");
    columns.replaceChildren();
    $("ff-compare-btn").hidden = !!decision.mapping;
    if (!decision.mapping) {
      note.textContent = "所有分支完成后生成去标签对照；对应关系在裁决前不用于展示。";
      $("ff-verdict-form").hidden = true;
      $("ff-export").hidden = true;
      $("ff-reveal").textContent = "";
      return;
    }
    const labels = Object.keys(decision.mapping);
    const timings = decision.timings || {};
    if (!decision.verdict) {
      const parity = decision.budgetParity === false
        ? "（注意：各分支配置不一致，等预算前提不成立，请谨慎解读）" : "";
      note.textContent = "对照已生成" + parity + "。请先完成裁判校准（全部答对后开放裁决），再阅读各栏回复并提交裁决；提交后才显示对应关系。";
      for (const label of labels) {
        const col = document.createElement("div");
        const head = document.createElement("p");
        head.className = "mono";
        head.textContent = "回复 " + label;
        const body = document.createElement("pre");
        body.id = "ff-reply-" + label;
        body.textContent = replyOf(label);
        const timing = timings[decision.mapping[label]];
        if (timing && timing.sentMs !== null) {
          const b = document.createElement("p");
          b.className = "subtle";
          b.textContent = "耗时（仅供参考）：发送至采集 " + Math.round(timing.sentMs/1000) +
            " 秒 · 回复 " + (timing.replyBytes ?? "?") + " 字节";
          col.appendChild(b);
        }
        col.appendChild(head); col.appendChild(body);
        columns.appendChild(col);
      }
      // P4 裁判校准：全部答对前不开放裁决表单。
      const cal = $("ff-calibration");
      cal.hidden = false;
      $("ff-verdict-form").hidden = true;
      $("ff-export").hidden = true;
      $("ff-reveal").textContent = "";
      if (!calibrationPassed) {
        const items = $("ff-calibration-items");
        items.replaceChildren();
        for (const item of calibrationItems) {
          const box = document.createElement("div");
          const q = document.createElement("p");
          q.textContent = item.material + " —— " + item.question;
          box.appendChild(q);
          item.options.forEach((opt, idx) => {
            const line = document.createElement("label");
            line.className = "line";
            const radio = document.createElement("input");
            radio.type = "radio"; radio.name = "cal-" + item.id; radio.value = String(idx);
            line.appendChild(radio);
            line.appendChild(document.createTextNode(opt));
            box.appendChild(line);
          });
          items.appendChild(box);
        }
        return;
      }
      $("ff-calibration").hidden = true;
      $("ff-verdict-form").hidden = false;
      $("ff-export").hidden = true;
      $("ff-reveal").textContent = "";
      const pref = $("ff-preference");
      pref.replaceChildren();
      for (const label of labels) {
        const opt = document.createElement("option");
        opt.value = label; opt.textContent = label + " 更好";
        pref.appendChild(opt);
      }
      const tieOpt = document.createElement("option"); tieOpt.value = "tie"; tieOpt.textContent = "相当";
      const incOpt = document.createElement("option"); incOpt.value = "inconclusive"; incOpt.textContent = "无法判断";
      pref.appendChild(tieOpt); pref.appendChild(incOpt);
      return;
    }
    note.textContent = "已裁决；对应关系已揭盲。";
    for (const label of labels) {
      const col = document.createElement("div");
      const head = document.createElement("p");
      head.className = "mono";
      head.textContent = "回复 " + label + " = 分支 " + decision.mapping[label];
      const body = document.createElement("pre");
      body.textContent = replyOf(label);
      col.appendChild(head); col.appendChild(body);
      // S1b: per-branch adoption into the evidence store. The reply becomes
      // the source fragment bound to this attempt's conversation; duplicate
      // adoptions replay instead of creating twins.
      col.appendChild(renderAdoptControl(label, value, decision, replyOf(label)));
      columns.appendChild(col);
    }
    const v = decision.verdict;
    $("ff-calibration").hidden = true;
    $("ff-verdict-form").hidden = true;
    $("ff-reveal").textContent = "裁决：" + v.preference + " · 揭盲：" +
      labels.map(label => label + " = 分支 " + decision.mapping[label]).join("，") +
      " · 依据：" + v.criteria + " · 置信度 " + v.confidence +
      (v.notes ? " · 备注 " + v.notes : "");
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
    const launched = Object.values(value.branches).some(b => b.attempts.length > 0);
    const blocked = Object.values(value.branches).some(b =>
      b.status === "pending" || b.status === "done");
    $("ff-branches").hidden = false;
    $("ff-launch").disabled = launched && blocked;
    $("ff-launch").textContent = launched ? "重新发起（仅当所有分支都非进行中且未完成）" : "发起双分支（K 个新标签）";
    // P4: render every branch's operations, not just A/B.
    const branchBoxes = $("ff-branch-boxes");
    branchBoxes.replaceChildren();
    for (const label of Object.keys(value.branches)) {
      branchBoxes.appendChild(branchBox(label, value));
    }
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
      const statuses = item.statuses || {A:item.statusA, B:item.statusB};
      const mark = s => s === "done" ? "✓" : s === "failed" ? "✗" : s === "unknown" ? "?" : "…";
      button.textContent = item.id + " · K=" + (item.branchCount || Object.keys(statuses).length) +
        " · " + Object.entries(statuses).map(([l,s]) => l + mark(s)).join(" ");
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
      const branchCount = Number($("ff-branch-count").value) || 2;
      const created = await send({type:"FF_CREATE",...intent,branchCount});
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
  let calibrationPassed = false;
  const calibrationItems = ThreadLineFFCore.CALIBRATION_ITEMS;
  $("ff-calibrate").addEventListener("click", async event => {
    const button = event.target;
    button.disabled = true;
    try {
      const responses = calibrationItems.map(item => {
        const picked = document.querySelector('input[name="cal-' + item.id + '"]:checked');
        return {id:item.id, choice:picked ? Number(picked.value) : -1};
      });
      const result = await send({type:"FF_CALIBRATION",responses});
      $("ff-calibration-result").textContent = "校准得分 " + result.score + "/" + result.total +
        (result.pass ? "：已通过，裁决已开放。" : "：未通过，请重新阅读材料后作答。");
      if (result.pass) { calibrationPassed = true; if (currentExperiment) await read(currentExperiment); }
    } catch (e) { notice(e.message, true); }
    finally { button.disabled = false; }
  });
  $("ff-import-file").addEventListener("change", async event => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const snapshot = JSON.parse(await file.text());
      const imported = await send({type:"FF_IMPORT",snapshot});
      notice("已导入实验 " + imported.id + "（revision " + imported.revision + "，" +
        imported.branchCount + " 分支）。");
      await list();
    } catch (e) { notice("导入被拒绝：" + e.message, true); }
    finally { event.target.value = ""; }
  });
  $("ff-refresh").addEventListener("click", () =>
    list().catch(error => notice(error.message,true)));
  $("ff-launch").addEventListener("click", async event => {
    // Live-run finding: a silent no-op here reads as a dead button when the
    // button sits below the fold and no experiment has been selected.
    if (!currentExperiment) {
      notice("请先在下方“已冻结的实验”列表中选择一个实验，再发起分支标签。", true);
      return;
    }
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
      notice("已导出自包含 JSON。可在实验列表的导入入口经严格验证后导入（哈希与映射重算，不覆盖既有实验）。");
    } catch (e) { notice(e.message, true); }
    finally { button.disabled = false; }
  });
  const manifest = chrome.runtime.getManifest();
  $("ff-version-note").textContent = "当前加载版本 v" + manifest.version +
    "。侧载扩展不会自动更新：升级新版后请在扩展管理页手动「重新加载」，并完全重启浏览器。";
  refresh().catch(error => notice(error.message,true));
})();
