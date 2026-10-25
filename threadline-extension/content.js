(() => {
  if (globalThis.__threadlineContentInjected) return;
  globalThis.__threadlineContentInjected = true;
  // Observes minimal metadata only; never reads or transmits messages/prompts.
  let knownHref = location.href;
  let lastFingerprint = "";
  let context = {key:null,project:null,chat:null};
  let guardIdentity = "";
  let navigationVersion = 0;
  let allowedOnThisPage = false;
  let pausedModal = false;
  let refreshTimer = 0;
  let orphaned = false;
  let mount = null;
  let ui = null;

  function send(type, extra = {}) {
    if (!chrome.runtime?.id) { orphaned = true; return Promise.reject(new Error("扩展已重新加载，请刷新此页面")); }
    return new Promise((resolve,reject) => {
      try {
        chrome.runtime.sendMessage({type,href:location.href,...extra},response => {
          if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
          if (!response?.ok) return reject(new Error(response?.error || "无法连接扩展"));
          resolve(response.data);
        });
      } catch(error) { orphaned = true; reject(error); }
    });
  }

  // UI-only compatibility probe: no fetch, no cookies, no mutation, no message bodies.
  chrome.runtime.onMessage.addListener((msg,_sender,reply) => {
    if (msg?.type === 'TL_HEALTH_CHECK') {
      try { reply({ok:true,data:ThreadLineSelectors.probe(document,location.href)}); }
      catch (error) { reply({ok:false,error:String(error.message||error)}); }
      return false;
    }
    if (msg?.type === 'TL_FF_READ_USER_MESSAGE') {
      // Fork post-send readback: the conversation's own rendered user message.
      // Read-only, textContent-based, never the composer and never a send.
      try {
        const nodes = [...document.querySelectorAll('[data-message-author-role="user"]')];
        const texts = nodes.map(n => (n.querySelector('.whitespace-pre-wrap') || n).innerText ?? '');
        reply({ok:true,data:{text:texts[0] ?? null, userCount:nodes.length,
          bytes:texts.length ? new TextEncoder().encode(texts[0]).length : 0,
          complete:nodes.length === 1}});
      } catch (error) { reply({ok:false,error:String(error.message||error)}); }
      return false;
    }
    return false;
  });
  function watch() {
    if (orphaned) return;
    if (knownHref !== location.href) {
      knownHref = location.href;
      navigationVersion++;
      allowedOnThisPage = false;
      pausedModal = false;
      guardIdentity = "";
      context = {key:null,project:null,chat:null};
      if (ui) paint();
      lastFingerprint = "";
    }
    const title = ThreadLinePage.extractTitle(document);
    const streaming = ThreadLinePage.isStreaming(document);
    // Light reply-size fingerprint for Fork stability signals. Reads only a
    // byte count of the last rendered assistant message; never its content.
    const assistantBytes = (() => {
      try {
        const a = [...document.querySelectorAll('[data-message-author-role="assistant"]')];
        return a.length ? new TextEncoder().encode(a[a.length - 1].innerText ?? '').length : -1;
      } catch { return -1; }
    })();
    const fp = `${location.href}||${title}||${streaming}||${assistantBytes}`;
    if (fp === lastFingerprint) return;
    lastFingerprint = fp;
    const requestVersion = navigationVersion;
    send("OBSERVE",{title,streaming,assistantBytes:assistantBytes >= 0 ? assistantBytes : undefined}).then(data => {
      if (requestVersion !== navigationVersion || knownHref !== location.href) return;
      applyContext(data);
    }).catch(()=>{});
  }
  function scheduleWatch() {
    // Throttle, not debounce: constant streaming mutations must not starve live-status updates.
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {refreshTimer = 0;watch();},850);
  }
  function updateContext() {
    if (orphaned) return;
    const currentHref = location.href;
    send("PAGE_CONTEXT").then(data=>{
      if (location.href !== currentHref) return;
      applyContext(data);
    }).catch(()=>{});
  }

  function applyContext(data) {
    const p = data?.project, c = data?.chat;
    const nextGuard = p?.stage === "closed"
      ? `project:${p.id}:${p.closedAt ?? 0}`
      : (c?.stage === "done" ? `branch:${c.key}:done` : "");
    if (nextGuard && nextGuard !== guardIdentity) allowedOnThisPage = false;
    guardIdentity = nextGuard;
    context = data || {key:null,project:null,chat:null};
    paint();
  }
  function createUI() {
    mount = document.createElement("div");
    mount.id = "threadline-shadow-root";
    mount.style.cssText = "position:fixed;bottom:24px;right:20px;z-index:2147483645;pointer-events:none;";
    document.documentElement.appendChild(mount);
    const shadow = mount.attachShadow({mode:"closed"});
    shadow.innerHTML = `
      <style>
        *{box-sizing:border-box} #root{font-family:system-ui,-apple-system,'Segoe UI','Microsoft Yahei',sans-serif;color:#253142;width:min(342px,calc(100vw - 28px));pointer-events:auto;}
        #pill{display:flex;align-items:center;gap:8px;padding:10px 12px;border:1px solid #dfe5ec;background:#fff;box-shadow:0 8px 28px #0f172a1a;border-radius:13px;cursor:default;font-size:12px;line-height:1.45;max-width:100%;}
        #dot{width:8px;height:8px;background:#3d9188;border-radius:50%;flex:none} #pill.guard #dot{background:#d7803e}
        #topic{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:148px} #branch{color:#617084;white-space:nowrap;font-size:11px;margin-left:auto}
        #warning{margin-bottom:9px;border-radius:14px;border:1px solid #efc5a0;background:#fff9f2;box-shadow:0 12px 32px #2c210d25;padding:14px;line-height:1.55}
        .hd{font-size:13px;font-weight:750;color:#924817;margin-bottom:5px;} .detail{font-size:12px;color:#755841;}
        #decision{font-size:12px;white-space:pre-wrap;max-height:90px;overflow:auto;color:#594939;margin-top:7px}
        #ack-line{margin-top:9px}#ack-line[hidden]{display:none!important}
        #modal{margin-bottom:9px;padding:14px;border-radius:14px;background:#fff;border:1px solid #dab899;box-shadow:0 10px 35px #08132733;}
        .actions{display:flex;gap:8px;margin-top:12px;}
        button{min-height:36px;appearance:none;border:1px solid #d7dce5;background:#fff;padding:8px 10px;border-radius:9px;color:#273a50;font-size:12px;cursor:pointer;line-height:1.3;}
        button.primary{background:#243b59;color:#fff;border-color:#243b59} button:focus-visible{outline:2px solid #659bce;outline-offset:2px}
        #root[hidden], #warning[hidden],#modal[hidden]{display:none!important}
      </style>
      <div id="root" hidden>
        <div id="modal" hidden role="alertdialog" aria-live="assertive" aria-label="课题状态拦截">
          <div class="hd" id="modal-heading">课题已收口</div>
          <div class="detail">已拦截这次发送。请确认是否仍要在旧分支继续研究；解除后需重新按一次发送。</div>
          <div class="actions"><button id="cancel">保持暂停</button><button class="primary" id="unlock">本标签临时解除</button></div>
        </div>
        <div id="warning" hidden aria-live="polite">
          <div class="hd" id="heading"></div>
          <div class="detail" id="message"></div>
          <div id="decision" tabindex="0" aria-label="最新课题结论，可滚动查看" hidden></div>
          <div id="ack-line" hidden><button id="ack-branch" class="primary">已核对最新课题状态</button></div>
        </div>
        <div id="pill"><span id="dot"></span><span id="topic"></span><span id="branch"></span></div>
      </div>`;
    ui = {
      root:shadow.querySelector("#root"),
      pill:shadow.querySelector("#pill"),
      topic:shadow.querySelector("#topic"),
      branch:shadow.querySelector("#branch"),
      heading:shadow.querySelector("#heading"),
      warning:shadow.querySelector("#warning"),
      message:shadow.querySelector("#message"),
      decision:shadow.querySelector("#decision"),
      ackLine:shadow.querySelector("#ack-line"),
      ackButton:shadow.querySelector("#ack-branch"),
      modal:shadow.querySelector("#modal"),
      modalHeading:shadow.querySelector("#modal-heading")
    };
    shadow.querySelector("#cancel").addEventListener("click",()=>{pausedModal=false;paint();});
    shadow.querySelector("#unlock").addEventListener("click",()=>{allowedOnThisPage=true;pausedModal=false;paint();});
    ui.ackButton.addEventListener("click", async () => {
      if (!context.project || !context.chat) return;
      ui.ackButton.disabled = true;
      try { applyContext(await send("ACK_PAGE")); }
      catch (e) { ui.ackButton.textContent = "核对失败，请在侧栏重试"; }
      finally { ui.ackButton.disabled = false; }
    });
  }
  function guarded() {
    return !!context.project && (context.project.stage === "closed" || context.chat?.stage === "done") && !allowedOnThisPage;
  }
  function paint() {
    if (!ui) createUI();
    const project = context.project;
    const chat = context.chat;
    ui.root.hidden = !project;
    if (!project) return;
    ui.topic.textContent = `${project.name} / ${chat?.label || chat?.title || "未命名分支"}`;
    ui.pill.title = `研线课题：${project.name}；请点击浏览器工具栏图标打开面板`;
    const closed = project.stage === "closed";
    const done = chat?.stage === "done";
    const stale = (project.knowledgeVersion || 0) > (chat?.seenVersion || 0);
    ui.pill.classList.toggle("guard",(closed||done||stale) && !allowedOnThisPage);
    ui.branch.textContent = allowedOnThisPage ? "本页已解锁" : (closed ? "课题已收口" : done ? "分支已完成" : stale ? "有最新课题状态" : chat?.stage === "review" ? "等待验证" : "研究中");
    ui.warning.hidden = !(closed||done||stale);
    ui.heading.textContent = closed ? "整个课题已收口" : done ? "此研究分支已完成" : `课题状态已更新 · v${project.knowledgeVersion}`;
    ui.message.textContent = allowedOnThisPage
      ? "已临时允许此标签继续发送。刷新或切换到其他对话后恢复拦截。"
      : closed || done ? "请先确认整个课题的最新结论，再决定是否继续。"
      : `本分支上次核对 v${chat?.seenVersion || 0}，课题已有 v${project.knowledgeVersion} 的更新。当前仅提醒，不会拦截发送。`;
    ui.decision.textContent = project.decision ? `当前有效结论：${project.decision}` : (stale ? (project.lastChange?.label || "课题已更新，但没有填写有效结论") : "");
    ui.decision.hidden = !ui.decision.textContent;
    ui.ackLine.hidden = !stale;
    if (stale) ui.ackButton.textContent = "已核对最新课题状态";
    ui.modal.hidden = !pausedModal;
    ui.modalHeading.textContent = closed ? "课题已收口 · 已暂停发送" : "分支已完成 · 已暂停发送";
  }
  function composerEditor(el) {
    const target = el instanceof Element ? el : el?.parentElement;
    if (!target) return null;
    const editor = target.closest('#prompt-textarea, [contenteditable="true"], textarea');
    if (!editor) return null;
    // Avoid treating message-edit and search fields as the main composer.
    if (editor.id === "prompt-textarea") return editor;
    const form = editor.closest('form');
    if (!form || !form.querySelector('[data-testid="send-button"], [data-testid="composer-send-button"], button[type="submit"]')) return null;
    return editor;
  }
  function submitButton(el) {
    if (!(el instanceof Element)) return false;
    const btn = el.closest('button[data-testid="send-button"], button[data-testid="composer-send-button"], form button[type="submit"]');
    if (!btn) return false;
    if (btn.matches('[data-testid="send-button"],[data-testid="composer-send-button"]')) return true;
    return !!btn.closest('form')?.querySelector('#prompt-textarea, [contenteditable="true"]');
  }
  function stop(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    pausedModal = true;
    paint();
  }
  document.addEventListener("keydown",event=>{
    if (!guarded()) return;
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && composerEditor(event.target)) stop(event);
  },true);
  document.addEventListener("pointerdown",event=>{
    if (guarded() && submitButton(event.target)) stop(event);
  },true);
  document.addEventListener("click",event=>{
    if (guarded() && submitButton(event.target)) stop(event);
  },true);
  document.addEventListener("submit",event=>{
    if (guarded() && event.target instanceof Element && event.target.querySelector('#prompt-textarea,[contenteditable="true"]')) stop(event);
  },true);
  chrome.storage.onChanged.addListener((changes,area)=>{
    if (area === "local" && changes.threadline_state_v1) updateContext();
  });
  document.addEventListener("visibilitychange",()=>{ if (!document.hidden) {watch();updateContext();} });
  window.addEventListener("popstate",scheduleWatch);
  const observer = new MutationObserver(scheduleWatch);
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:false});
  setInterval(()=>{if (knownHref !== location.href) watch();},1200);
  watch();
})();
