(() => {
  const $ = sel => document.querySelector(sel);
  const escape = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const stageLabels = { active:"研究中",review:"待验证",done:"分支完成" };
  let selectedId = null;
  let selectionRevision = 0;
  const setSelectedId = value => {
    if(selectedId!==value){selectedId=value;selectionRevision++;}
  };
  let filter = "all";
  let workspace = "switch"; // normal panel retains three workspaces
  let surface="sidebar",librarySourceTabId=null,librarySourceChatKey=null;
  let libraryInitialProjectId=null,librarySelectionPending=false,libraryTabId=null;
  let libraryWindowId=null;
  let libraryViewWarningShown=false;
  let state = ThreadLineCore.emptyState();
  let tabs = [];
  let activeTabId = null;
  let liveByTab = {};
  let busy = false;
  let latestRequest = 0;
  let toastTimer = null;
  let rerenderPending = false;

  async function message(payload) {
    return new Promise((resolve,reject)=>{
      chrome.runtime.sendMessage(payload,response=>{
        if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
        if (!response?.ok) return reject(new Error(response?.error || "操作失败"));
        resolve(response.data);
      });
    });
  }
  const FF_PHASE_LABELS = {created:"预填核对中", awaiting_send:"待你发送", generating:"生成中", capturing:"判定中"};
  const FF_STATUS_LABELS = {done:"已完成", failed:"失败", unknown:"未知"};
  async function renderFFProgress() {
    const node = document.getElementById("ff-progress");
    if (!node) return;
    try {
      const data = await message({type:"FF_SUMMARY"});
      if (!data || data.enabled !== true || !data.latest) { node.hidden = true; return; }
      const parts = data.latest.branches.map(b => {
        const label = b.status === "pending"
          ? (FF_PHASE_LABELS[b.phase] || b.phase)
          : (FF_STATUS_LABELS[b.status] || b.status);
        return b.label + "：" + label;
      });
      node.hidden = false;
      node.textContent = "最近实验（" + data.latest.branchCount + " 分支）：" + parts.join(" · ");
    } catch { node.hidden = true; }
  }
  async function refresh(force=false) {
    const n = ++latestRequest;
    renderFFProgress();
    try {
      const data = await message({type:"SNAPSHOT"});
      if (n !== latestRequest) return true;
      state = data.state;
      tabs = data.tabs;
      activeTabId = data.activeTabId;
      liveByTab = data.liveByTab;
      const typing = ["edit-name","edit-goal","edit-decision","topic-name"].some(id=>document.activeElement?.id === id);
      if (typing && !force) {rerenderPending = true;renderStats();return true;}
      rerenderPending = false;
      if (selectedId && !state.projects.some(p=>p.id===selectedId)) setSelectedId(null);
      render();
      return true;
    } catch(error) {
      notifyCritical("读取课题状态失败或结果未确认："+error.message+"。当前显示可能过期；请刷新后再执行破坏性操作。");
      return false;
    }
  }
  function notify(value,isError=false) {
    const node = $("#toast");
    node.textContent = value;
    node.style.background = isError ? "#a34d3a" : "#273c56";
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>node.classList.remove("show"),3100);
  }
  function notifyCritical(value) {
    const region=$("#critical-notice"),text=$("#critical-notice-text");
    if(!region||!text){notify(value,true);return;}
    text.textContent=value;
    region.hidden=false;
    const active=document.activeElement;
    if(!active||active===document.body||!active.isConnected)
      $("#critical-notice-dismiss")?.focus();
  }
  $("#critical-notice-dismiss")?.addEventListener("click",()=>{
    $("#critical-notice").hidden=true;
    $("#critical-notice-text").textContent="";
  });
  async function change(action,success) {
    if (busy) {notify("上一项更改正在保存，请稍后再试");return false;}
    const requestedSelectionRevision=selectionRevision;
    busy=true;
    try {
      const res=await message({type:"MUTATE",action});
      if (res?.result?.projectId && selectionRevision===requestedSelectionRevision)
        setSelectedId(res.result.projectId);
      const refreshed=await refresh(true);
      if (success && refreshed) notify(success);
      else if(!refreshed)notifyCritical("保存成功回执已收到，但课题状态刷新失败。请重新打开面板核对，不要重复提交。");
      return true;
    } catch(error) {
      const refreshed=await refresh(true);
      notifyCritical("操作失败或结果未确认："+error.message+"。"+
        (refreshed?"已刷新当前状态；请核对课题与分支是否已变化，再决定是否重试。":"状态刷新也失败，当前显示可能过期；请重新打开面板核对。")+
        "研线未自动重放操作。");
      return false;
    }
    finally{busy=false;}
  }
  function getKey(tab) {return tab && ThreadLineCore.getChatKey(tab.url,tab.id);}
  function activeTab() {return tabs.find(t=>t.id===activeTabId)||null;}
  function chatForTab(tab) {return state.chats[getKey(tab)] || null;}
  function relatedTabs(key) {return tabs.filter(t=>getKey(t)===key);}
  function bestTab(chat) {return relatedTabs(chat.key)[0]||null;}
  function isGenerating(tab) {
    const live = liveByTab[tab.id];
    return !!(live?.key===getKey(tab) && live.streaming && Date.now()-live.updatedAt<18000);
  }
  function shortDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    return `${d.getMonth()+1}/${d.getDate()}`;
  }
  function renderStats() {
    $("#stat-active").textContent=state.projects.filter(p=>p.stage==="active").length;
    $("#stat-closed").textContent=state.projects.filter(p=>p.stage==="closed").length;
    $("#stat-chats").textContent=Object.keys(state.chats).length;
    $("#clear-closed").disabled=!state.projects.some(p=>p.stage==="closed");
  }
  function saveLibraryView() {
    if(surface!=="library")return;
    const header=$("#library-view-project");
    if(librarySelectionPending){
      header.textContent="查看课题：正在确认…";
      return;
    }
    const selection=$("#evidence-project");
    const projectId=selection?.value||null;
    const project=state.projects.find(p=>p.id===projectId);
    const name=project?.name||(projectId?selection?.selectedOptions[0]?.textContent:"尚未选择");
    header.textContent="查看课题："+(name||"尚未选择")+"（仅浏览，不改变来源关联）";
    if(!libraryTabId)return;
    const query=$("#evidence-query")?.value||"";
    // Very long or control-character queries are not copied into sessionStorage.
    // The current search continues to work; only reload fallback loses the query.
    try{
      ThreadLineLibrarySurface.saveView(libraryTabId,{
        viewProjectId:$("#evidence-project")?.value||null,
        topicProjectId:selectedId,
        sourceTabId:librarySourceTabId,sourceChatKey:librarySourceChatKey,
        workspace,filter:$("#evidence-filter-status")?.value||"all",
        query:query.length<=160?query:""
      });
    }catch(error){
      if(!libraryViewWarningShown){
        libraryViewWarningShown=true;
        notifyCritical("资料库当前阅读位置无法保存到本标签页："+error.message+
          "。刷新后可能需要重新选择；现有课题和结论未改变。");
      }
    }
  }
  async function openLibrary() {
    const picked=workspace==="research"
      ? tabs.find(t=>String(t.id)===$("#capture-source")?.value) : activeTab();
    const key=picked&&ThreadLineCore.isChatURL(picked.url)?getKey(picked):null;
    const sourceChatKey=key?.startsWith("chat:")?key:null;
    const sourceTabId=sourceChatKey?picked.id:null;
    const viewProjectId=workspace==="evidence"
      ? ($("#evidence-project")?.value||null)
      : workspace==="switch" ? (selectedId||chatForTab(picked)?.projectId||null)
      : (chatForTab(picked)?.projectId||null);
    const search=workspace==="evidence"?$("#evidence-query")?.value||"":"";
    const filter=workspace==="evidence"?$("#evidence-filter-status")?.value||"all":"all";
    const query=search.length<=160?search:"";
    try{
      await ThreadLineLibrarySurface.open({viewProjectId,sourceTabId,sourceChatKey,filter,query});
      if(search!==query)notify("检索词超过160字，未带入宽页；请在宽页重新输入。");
    }
    catch(error){notifyCritical("打开资料库失败："+error.message+"。原侧栏数据未改变。");}
  }
  async function openSidebar() {
    if(!Number.isSafeInteger(libraryWindowId)||libraryWindowId<0){
      notifyCritical("无法确认资料库所属浏览器窗口；请通过浏览器扩展图标打开研线侧栏。");
      return;
    }
    try{
      // Called directly from a user click: Chrome requires a user gesture.
      await chrome.sidePanel.open({windowId:libraryWindowId});
    }catch(error){
      notifyCritical("打开侧栏失败："+error.message+"。请通过浏览器扩展图标打开研线。");
    }
  }
  async function returnToSource() {
    if(!librarySourceTabId){notify("没有绑定来源对话，请自行切回 ChatGPT");return;}
    const source=await chrome.tabs.get(librarySourceTabId).catch(()=>null);
    if(!source||!ThreadLineCore.isChatURL(source.url)||getKey(source)!==librarySourceChatKey){
      notifyCritical("原来源标签已关闭或不再是 ChatGPT 对话，请自行选择正确的来源。");return;
    }
    try{
      await chrome.tabs.update(source.id,{active:true});
      await chrome.windows.update(source.windowId,{focused:true});
    }catch(error){notifyCritical("无法切回来源对话："+error.message);}
  }
  function setWorkspace(next, focusCapture=false) {
    workspace = ["switch","research","evidence"].includes(next) ? next : "switch";
    document.querySelectorAll("[data-workspace]").forEach(button => {
      const selected = button.dataset.workspace === workspace;
      button.classList.toggle("selected",selected);
      button.setAttribute("aria-selected",String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    $("#workspace-switch").hidden = workspace !== "switch";
    $("#workspace-research").hidden = workspace !== "research";
    $("#workspace-evidence").hidden = workspace !== "evidence";
    if (workspace === "research" && focusCapture) {
      const tab = activeTab();
      const select = $("#capture-source");
      if (tab && Array.from(select.options).some(o => o.value === String(tab.id))) select.value = String(tab.id);
    }
    if(workspace==="evidence")renderEvidence().catch(error=>notify(error.message,true));
    saveLibraryView();
    window.scrollTo(0,0);
  }
  function activeSourceKey(projectId) {
    const key = getKey(activeTab());
    return state.chats[key]?.projectId === projectId ? key : null;
  }
  function changeDescriptions(project,seen) {
    const delta=ThreadLineCore.changesSince(project,seen);
    const label={goal:'研究目标',decision:'有效结论',stage:'课题状态'};
    if (!delta.items.length) return project.lastChange?.label || '存在历史更新，详细差异未保留';
    const rows=delta.items.slice(-4).map(v=>`${label[v.field]||v.field}：${String(v.before||'（空）').slice(0,90)} → ${String(v.after||'（空）').slice(0,90)}`);
    return `${delta.truncated?'部分较早记录已清理；':''}${rows.join('；')}`;
  }
  function renderCurrent() {
    const host = $("#current-content");
    const tab = activeTab();
    if (!tab) {
      host.innerHTML = '<p class="current-sub">当前窗口没有激活的 ChatGPT 标签页。切回目标窗口后，这里会显示对应的研究状态。</p>';
      return;
    }
    const key = getKey(tab), chat = chatForTab(tab);
    const project = chat && ThreadLineCore.getProject(state,chat.projectId);
    const stale = ThreadLineCore.isOutdated(state,chat);
    const title = chat?.label || tab.title || "新对话";
    if (project) {
      const closed = project.stage === "closed";
      const status = closed ? "课题已收口" : stale ? "有最新课题状态" : stageLabels[chat.stage];
      const badgeClass = closed ? "closed" : stale ? "review" : chat.stage === "done" ? "done" : "";
      const version = Number(project.knowledgeVersion)||0;
      host.innerHTML = `
        <div class="current-name" title="${escape(title)}">${escape(title)}</div>
        <div class="current-project-row"><strong title="${escape(project.name)}">${escape(project.name)}</strong><span class="badge ${badgeClass}">${escape(status)}</span></div>
        ${project.goal ? `<div class="current-summary"><strong>研究目标：</strong>${escape(project.goal)}</div>` : ""}
        ${project.decision ? `<div class="current-summary"><strong>当前有效结论：</strong>${escape(project.decision)}</div>` : '<div class="current-summary">尚未登记权威结论。分支的 AI 回答不代表课题已经完成。</div>'}
        ${closed ? `<div class="current-closed">课题已收口。旧分支继续发送前会有确认提醒。</div>` : ""}
        ${stale ? `<div class="current-risk"><strong>版本待核对：</strong>本分支已核对 v${chat.seenVersion||0}，课题当前 v${version}。${escape(changeDescriptions(project,chat.seenVersion))}。请先阅读新结论。</div>` : ""}
        <div class="current-actions">${isGenerating(tab) ? '<span class="badge review">AI 正在回答</span>' : ''}
          ${stale ? `<button class="primary" data-action="ack-current" data-key="${escape(key)}">已核对最新状态</button>` : `<span class="badge muted">版本 v${version} 已同步</span>`}
          <button data-action="view-project" data-id="${escape(project.id)}">管理课题</button>
          <button data-action="open-research">采集 / 分析</button>
        </div>`;
      return;
    }
    const suggestion = ThreadLineCore.suggestProject(tab.title,state.projects);
    const match = suggestion && ThreadLineCore.getProject(state,suggestion.id);
    const choices = state.projects.filter(p=>p.stage==="active");
    host.innerHTML = `<div class="current-name" title="${escape(title)}">${escape(title)}</div>
      <div class="current-sub">此对话尚未关联课题，切换前无法同步其它分支的最新状态。</div>
      ${match ? `<div class="current-actions"><button class="primary" data-action="accept-suggestion" data-id="${escape(match.id)}">关联推荐课题：${escape(match.name)}</button></div>` : ""}
      ${choices.length ? `<div class="quick-link"><label class="sr-only" for="quick-link-project">已有课题</label><select id="quick-link-project">${choices.map(p=>`<option value="${escape(p.id)}">${escape(p.name)}</option>`).join("")}</select><button data-action="quick-link-current">关联当前对话</button></div>` : ""}
      <div class="current-actions"><button data-action="start-new-topic" class="primary">＋ 创建临时课题</button><button data-action="open-research">采集 / 分析</button></div>`;
  }
  function renderQuickBranches() {
    const list = $("#quick-list");
    const tab = activeTab(), chat = chatForTab(tab);
    const project = chat && ThreadLineCore.getProject(state,chat.projectId);
    $("#quick-counter").textContent = project ? Object.values(state.chats).filter(c=>c.projectId===project.id).length + " 条" : "0 条";
    $("#quick-subtitle").textContent = project ? `当前课题 · ${project.stage==="closed"?"已收口":"研究中"} · v${project.knowledgeVersion||0}` : "关联课题后，可一键切换同题分支";
    if (!project) {list.innerHTML='<div class="quick-empty">暂无同课题分支。关联当前对话，或从下方打开「全部课题与管理」。</div>';return;}
    const branches = Object.values(state.chats).filter(c=>c.projectId===project.id)
      .sort((a,b)=>Number(a.key===chat.key)*-1+Number(b.key===chat.key)||b.updatedAt-a.updatedAt);
    list.innerHTML = branches.map(c=>{
      const opened=bestTab(c),self=c.key===chat.key;
      const stale=ThreadLineCore.isOutdated(state,c);
      const status = self ? "当前窗口" : stale ? `待同步 v${project.knowledgeVersion}` : stageLabels[c.stage];
      const presence=opened?(isGenerating(opened)?"AI 正在回答":"标签页已打开"):(c.key.startsWith("tab:")?"临时标签已关闭":"点击重新打开");
      return `<button type="button" class="quick-chat ${self?"current-chat":""}" data-action="quick-open-chat" data-key="${escape(c.key)}" ${self||(!opened&&c.key.startsWith("tab:"))?"disabled":""} title="${escape(c.label||c.title)}">
        <span class="quick-chat-main"><span class="quick-chat-name">${escape(c.label||c.title)}</span><span class="quick-chat-note">${escape(c.note||presence)}</span></span>
        <span class="quick-chat-status"><span class="${stale?"needs-sync":isGenerating(opened||{})?"live-working":""}">${escape(status)}</span>${isGenerating(opened||{})&&!self?'<br>回答中':''}</span><span class="quick-chat-arrow" aria-hidden="true">${self?"●":"›"}</span>
      </button>`;
    }).join("");
  }
  function renderTopics() {
    document.querySelectorAll("[data-filter]").forEach(n=>n.classList.toggle("selected",n.dataset.filter===filter));
    const host=$("#topic-list");
    const list=state.projects.filter(p=>filter==="all" || p.stage===filter);
    if (!list.length){host.innerHTML='<div class="empty">这里还没有课题。<br>输入名称即可创建临时研究看板。</div>';return;}
    host.innerHTML=list.map(p=>{
      const chatList=Object.values(state.chats).filter(c=>c.projectId===p.id);
      const done=chatList.filter(c=>c.stage==="done").length;
      return `<button class="topic-card ${selectedId===p.id?"selected":""}" data-action="select-project" data-id="${escape(p.id)}" aria-pressed="${selectedId===p.id}">
        <div class="topic-top"><span class="topic-title">${escape(p.name)}</span><span class="badge ${p.stage==="closed"?"closed":""}">${p.stage==="closed"?"已收口":"进行中"}</span></div>
        <div class="topic-meta">${chatList.length} 条对话 · ${done} 条已完成 · ${chatList.filter(c=>ThreadLineCore.isOutdated(state,c)).length} 条待同步 · v${p.knowledgeVersion||0}</div>
        ${p.decision?`<div class="topic-decision">${escape(p.decision)}</div>`:""}
      </button>`;
    }).join("");
  }
  function renderDetails() {
    const host=$("#detail-section");
    const p=ThreadLineCore.getProject(state,selectedId);
    if (!p){host.hidden=true;host.innerHTML="";return;}
    host.hidden=false;
    const branches=Object.values(state.chats).filter(c=>c.projectId===p.id).sort((a,b)=>b.updatedAt-a.updatedAt);
    const available=tabs.filter(t=>getKey(t) && (!chatForTab(t) || chatForTab(t)?.projectId!==p.id));
    const tabOptions=available.map(t=>{
      const old=chatForTab(t), other=old && ThreadLineCore.getProject(state,old.projectId);
      return `<option value="${t.id}">${escape((t.title||"新对话").slice(0,75))}${other?`（当前：${escape(other.name)}）`:""}</option>`;
    }).join("");
    const options=Object.keys(stageLabels).map(stage=>[stage,stageLabels[stage]]);
    const branchMarkup=branches.map(c=>{
      const tab=bestTab(c);
      return `<article class="branch-card"><div class="branch-top"><div class="branch-name">${escape(c.label||c.title)}</div><span class="badge ${c.stage==='done'?'done':c.stage==='review'?'review':''}">${stageLabels[c.stage]}</span></div>
      <div class="branch-mini">${tab?(isGenerating(tab)?"● 正在回答":"● 标签页已打开"):"○ 标签页未打开"}${c.note?" · "+escape(c.note):""}</div>
      ${ThreadLineCore.isOutdated(state,c)?`<div class="branch-version">待核对：分支 v${c.seenVersion||0} → 课题 v${p.knowledgeVersion||0}<div class="diff-preview">${escape(changeDescriptions(p,c.seenVersion))}</div></div>`:""}
      <div class="branch-actions"><select aria-label="分支状态" data-stage-key="${escape(c.key)}">${options.map(([v,label])=>`<option value="${v}" ${c.stage===v?"selected":""}>${label}</option>`).join('')}</select>
      <button data-action="go-chat" data-key="${escape(c.key)}" ${(!tab && c.key.startsWith('tab:'))?'disabled':''}>打开</button>
      <button data-action="label-chat" data-key="${escape(c.key)}">命名</button>
      <button data-action="note-chat" data-key="${escape(c.key)}">进度</button>
      ${ThreadLineCore.isOutdated(state,c)?`<button data-action="ack-branch" data-key="${escape(c.key)}">已核对</button>`:""}
      <button data-action="unlink-chat" data-key="${escape(c.key)}">移除</button></div></article>`;
    }).join("");
    const hist=(p.history||[]).slice(-8).reverse().map(v=>`<article class="history-row"><strong>v${v.version} · ${escape({goal:'目标',decision:'结论',stage:'状态'}[v.field]||v.field)}</strong><p><del>${escape(String(v.before||'（空）').slice(0,180))}</del> → ${escape(String(v.after||'（空）').slice(0,180))}</p></article>`).join('');
    host.innerHTML=`
      <div class="detail-head"><div><h2>课题详情</h2><div class="details-mini">${branches.length} 条分支 · v${p.knowledgeVersion||0} · ${p.stage==="closed"?"已收口":"进行中"}</div></div>
      <button class="text-button" data-action="collapse-details">收起详情 ↑</button></div>
      ${p.stage==="closed"?'<div class="warning">课题已收口：所有关联 ChatGPT 对话都会出现提醒，并尝试拦截旧窗口的新发送。</div>':''}
      <div id="edit-form">
        <div class="field"><label for="edit-name">课题名称</label><input id="edit-name" maxlength="80" value="${escape(p.name)}" /></div>
        <div class="field"><label for="edit-goal">当前研究目标 <span class="hint">（可选）</span></label><textarea id="edit-goal" maxlength="600" placeholder="这次研究究竟在回答什么问题？">${escape(p.goal)}</textarea></div>
        <div class="field"><label for="edit-decision">当前有效结论 / 收口依据 <span class="hint">${p.evidenceTakeover?'（证据库只读摘要，请在证据结论中修订）':'（跨窗口共享）'}</span></label><textarea class="big" id="edit-decision" ${p.evidenceTakeover?'readonly':''} maxlength="1000" placeholder="填写一两句话，所有旧窗口都可看到。">${escape(p.decision)}</textarea></div>
        <div class="detail-controls"><button class="primary" data-action="save-details">保存课题状态</button>
        <button class="${p.stage==='closed'?'soft':'danger'}" data-action="toggle-close">${p.stage==='closed'?'重新开启课题':'收口整个课题'}</button></div>
      </div>
      <details class="history-details"><summary>课题结论与状态变更记录（最近 ${Math.min((p.history||[]).length,8)} 条）</summary>${hist||'<p class="caption">旧版本没有差异历史，从下次修改开始记录。</p>'}</details>
      <div class="divider"></div>
      <div class="branch-title">关联对话 <span class="badge muted">${branches.length}</span></div>
      ${branchMarkup || '<div class="empty">尚未关联对话。<br>从下方选择已经打开的 ChatGPT 标签页。</div>'}
      ${available.length?`<div class="tab-picker"><select id="tab-to-link" aria-label="选择已打开的对话">${tabOptions}</select><button class="soft" data-action="link-selected">＋ 关联</button></div>`:'<p class="caption">没有其他打开的 ChatGPT 对话。可以先新开一个对话，再回面板关联。</p>'}
      <div class="end-actions"><button class="text-button danger" data-action="delete-project">删除此临时课题</button></div>
      <p class="caption">收口后所有已关联窗口立即共享状态。修改分支状态不会自动打开或关闭整个课题。</p>`;
  }
  function render() {
    renderStats();renderCurrent();renderQuickBranches();renderTopics();renderDetails();
    if(surface==="library") {
      // Read-focused UI only: the trusted panel retains its original backend
      // authority; do not claim CSS hiding is a security permission boundary.
      document.querySelectorAll('#workspace-switch #edit-form input, #workspace-switch #edit-form textarea, #workspace-switch .branch-actions select')
        .forEach(control=>{control.disabled=true;});
      saveLibraryView();
    }
  }
  function updatePayload(extra={}) {
    const patch = {name:$("#edit-name")?.value || "",goal:$("#edit-goal")?.value || "",...extra};
    if (!$("#edit-decision")?.readOnly) patch.decision = $("#edit-decision")?.value || "";
    return patch;
  }
  async function openChat(c) {
    if (!c) return;
    try {
      const tab=bestTab(c);
      if (tab) {
        await chrome.tabs.update(tab.id,{active:true});
        await chrome.windows.update(tab.windowId,{focused:true});
        return;
      }
      if (c.key.startsWith("tab:")) return notify("临时对话没有固定链接，原标签页已关闭",true);
      await chrome.tabs.create({url:c.url||`https://chatgpt.com/c/${c.key.slice(5)}`});
    }catch(error){notify("无法打开分支："+error.message,true);}
  }
  async function associateTab(tab,p) {
    const key=getKey(tab);
    if (!key || !p) return notify("请选择 ChatGPT 对话和目标课题",true);
    const old=state.chats[key];
    if (old && old.projectId!==p.id) {
      const prior=ThreadLineCore.getProject(state,old.projectId);
      if (!confirm(`此对话已经关联「${prior?.name||'其他课题'}」。确定改为「${p.name}」吗？`)) return;
    }
    await change({type:"linkChat",key,projectId:p.id,title:tab.title||"新对话",url:tab.url},"对话已关联，其他窗口的状态会同步更新");
  }
  async function exportBackup(){
    try {
      const data=await message({type:'BACKUP_EXPORT'});
      const text=JSON.stringify(data,null,2);
      const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));
      const anchor=document.createElement('a');
      anchor.href=url;anchor.download=`ThreadLine-课题与对话关联-${new Date().toISOString().slice(0,10)}.json`;
      document.body.append(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),2500);
      $('#backup-status').textContent=`已下载 ${data.state.projects.length} 个课题、${Object.keys(data.state.chats).length} 条关联。不包含证据库、Fork 实验或临时采集全文。`;
    } catch(e){$('#backup-status').textContent='导出失败：'+e.message;}
  }
  async function importBackup(){
    const file=$('#backup-file').files?.[0];if(!file)return notify('请选择 .json 备份文件',true);
    try {
      if(file.size>ThreadLineBackup.MAX_BYTES)throw new Error('备份文件超过 2MB');
      const json=await file.text();const state=ThreadLineBackup.parse(json);
      if(!confirm(`确认用备份中的 ${state.projects.length} 个课题、${Object.keys(state.chats).length} 条关联替换当前所有本地课题与对话关联吗？此操作不包含证据库或 Fork 实验；当前课题状态会先保留为本地快照。`))return;
      const info=await message({type:'BACKUP_IMPORT',json});
      setSelectedId(null);await refresh(true);
      $('#backup-status').textContent=`恢复成功：${info.projects} 个课题、${info.chats} 条关联。`;
    }catch(e){$('#backup-status').textContent='导入失败：'+e.message;}
  }
  async function rollbackBackup(){
    try {
      const snapshots=await message({type:'BACKUP_SNAPSHOTS'});
      if(!snapshots.length)return notify('尚无可恢复的快照',true);
      const latest=snapshots.at(-1);
      if(!confirm(`恢复 ${new Date(latest.at).toLocaleString()} 的快照（${latest.reason}）？当前状态也会存为新快照。`))return;
      await message({type:'BACKUP_ROLLBACK',index:latest.index});setSelectedId(null);
      await refresh(true);$('#backup-status').textContent='已恢复最近快照。';
    }catch(e){$('#backup-status').textContent='快照恢复失败：'+e.message;}
  }
  function formatHealthTime(value){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚无已验证成功记录';}
  async function runHealth(){
    const host=$('#health-result');
    const current=surface==="library"
      ? (librarySourceTabId?await chrome.tabs.get(librarySourceTabId).catch(()=>null):null)
      : activeTab();
    if(!current||!ThreadLineCore.isChatURL(current.url)||
      (surface==="library"&&getKey(current)!==librarySourceChatKey)){
      host.textContent='请选择有效的 ChatGPT 来源标签页；不会检查资料库自身。';return;
    }
    host.textContent='正在执行只读自检…';
    try {
      const data=await message({type:'HEALTH_CHECK',tabId:current.id});
      const parts=data.page.parts;
      host.innerHTML=`<p><strong>${data.page.status==='basic_ready'?'基本页面可识别':'可能已降级'}</strong> · ${escape(data.page.notes)}</p>`+
        Object.entries(parts).map(([k,v])=>`<p>${escape({composer:'输入框',sendButton:'发送控件',sidebar:'侧栏',conversation:'消息区域'}[k]||k)}：${v.available?'已识别':v.candidate?'发现文本候选（角色未确认）':'未识别'}</p>`).join('')+
        Object.entries({capture:'完整采集',move:'移入项目',archive:'归档'}).map(([k,name])=>`<p>${name}上次真实成功：${escape(formatHealthTime(data.lastSuccess[k]))}</p>`).join('')+
        '<p>仅通过 DOM 识别不能证明项目创建、归档、分页接口和自动分析可用；这些仍需真实任务验证。</p>';
    } catch(e){host.textContent='网页自检失败：'+e.message;}
  }
  document.addEventListener("submit",event=>{
    if (event.target.id!=="create-form") return;
    event.preventDefault();
    const name=$("#topic-name").value.trim();
    if (!name) return notify("请先填写课题名称",true);
    const t=activeTab(),key=getKey(t);
    if (key && state.chats[key]) {
      const old=ThreadLineCore.getProject(state,state.chats[key].projectId);
      if (!confirm(`当前对话已在「${old?.name||'其他课题'}」中。创建新课题时将转移它，继续吗？`)) return;
    }
    change({type:"createProject",name,chat:key?{key,title:t.title||"新对话",url:t.url}:null},"临时课题已创建").then(committed=>{
      // Failed/unknown/busy writes preserve text; a late ACK must not erase
      // a different name typed while the original request was pending.
      if(committed && $("#topic-name").value.trim()===name) $("#topic-name").value="";
    });
  });
  document.addEventListener("click",async event=>{
    const nav=event.target.closest("[data-workspace]");
    if (nav){setWorkspace(nav.dataset.workspace);return;}
    const f=event.target.closest("[data-filter]");
    if (f){filter=f.dataset.filter;renderTopics();return;}
    if(event.target.id==="library-open"){await openLibrary();return;}
    if(event.target.id==="library-open-sidebar"){await openSidebar();return;}
    if(event.target.id==="library-return"){await returnToSource();return;}
    if (event.target.id==='backup-export')return exportBackup();
    if (event.target.id==='backup-import')return importBackup();
    if (event.target.id==='backup-rollback')return rollbackBackup();
    if (event.target.id==='health-check')return runHealth();
    if (event.target.id==="clear-closed"){
      if (confirm("清理所有已收口课题？只删除扩展中的临时记录，不会删除 ChatGPT 对话。")) change({type:"clearClosed"},"已清理收口课题");
      return;
    }
    const btn=event.target.closest("[data-action]");
    if (!btn) return;
    const action=btn.dataset.action,key=btn.dataset.key,id=btn.dataset.id;
    if(surface==="library"&&!["select-project","view-project","collapse-details","go-chat"].includes(action)){
      // Read-only behavior for the normal library UI. The background still
      // trusts the same panel.html, so this is not an authorization boundary.
      notifyCritical("宽页资料库当前只支持查阅；请打开研线侧栏再修改课题或分支。");
      return;
    }
    if (action==="open-research") {setWorkspace("research",true);return;}
    if (action==="start-new-topic") {
      setWorkspace("switch");
      $("#manage-accordion").open = true;
      $("#topic-name").focus();
      $("#topic-name").scrollIntoView({block:"center",behavior:"smooth"});
      return;
    }
    if (action==="quick-link-current") {
      const tab=activeTab(),project=ThreadLineCore.getProject(state,$("#quick-link-project")?.value);
      return associateTab(tab,project);
    }
    if (action==="ack-current" || action==="ack-branch") {
      const c=state.chats[key];
      if (!c) return notify("关联分支不存在",true);
      return change({type:"acknowledgeProject",key},"已将该分支标记为核对至最新课题版本");
    }
    if (action==="quick-open-chat")return openChat(state.chats[key]);
    if (action==="accept-suggestion") {
      const tab=activeTab(),project=ThreadLineCore.getProject(state,id);
      if (tab && project) {setSelectedId(project.id);return associateTab(tab,project);}
      return;
    }
    if (action==="collapse-details") {setSelectedId(null);render();return;}
    if (action==="select-project" || action==="view-project") {
      setSelectedId((action==="select-project" && selectedId===id)?null:id);
      if(surface==="library"&&selectedId){
        const evidenceSelect=ev$("evidence-project");
        if([...evidenceSelect.options].some(option=>option.value===selectedId)){
          if(evidenceSelect.value!==selectedId){
            evidenceSelect.value=selectedId;
            evidenceSelect.dispatchEvent(new Event("change"));
          }
        }else{
          // The topics snapshot can outrun the evidence directory. Keep the
          // requested project explicit; never silently read a different one.
          libraryInitialProjectId=selectedId;
          librarySelectionPending=true;
          renderEvidence().catch(error=>notifyCritical("无法载入所选课题的证据："+error.message));
        }
      }
      filter='all';setWorkspace("switch");render();
      if (selectedId) $("#detail-section").scrollIntoView({block:"start",behavior:"smooth"});
      return;
    }
    const p=ThreadLineCore.getProject(state,selectedId);
    if (!p) return;
    if (action==="save-details") return change({type:"updateProject",expectedRevision:state.revision,projectId:p.id,sourceKey:activeSourceKey(p.id),patch:updatePayload()},"课题状态已保存；如有实质变化，其他分支会出现待核对标记");
    if (action==="toggle-close") {
      const next=p.stage==="closed"?"active":"closed";
      if (next==="closed" && !confirm("确定收口整个课题？关联的所有对话将同步显示收口提示，并尝试拦截后续发送。")) return;
      return change({type:"updateProject",expectedRevision:state.revision,projectId:p.id,sourceKey:activeSourceKey(p.id),patch:updatePayload({stage:next})},next==="closed"?"课题已收口，旧对话会收到提醒":"课题已重新开启");
    }
    if (action==="delete-project") {
      if (confirm(`删除临时课题「${p.name}」和其中的关联记录？ChatGPT 原对话不会删除。`)) change({type:"deleteProject",projectId:p.id},"临时课题已删除");
      return;
    }
    if (action==="link-selected") {
      const tab=tabs.find(t=>t.id===Number($("#tab-to-link")?.value));
      return associateTab(tab,p);
    }
    const c=state.chats[key];
    if (!c) return;
    if (action==="go-chat") return openChat(c);
    if (action==="label-chat" || action==="note-chat") {
      const isLabel=action==="label-chat",field=isLabel?"label":"note";
      const title=isLabel?"编辑分支名称":"编辑分支进度";
      const baseRevision=state.revision;
      const current=String(isLabel?(c.label||c.title||""):(c.note||""));
      const value=Array.from(current).slice(0,isLabel?80:300).join("");
      return ThreadLineDialogs.form({
        title,
        description:isLabel
          ?"最多 80 个字符。留空会清除自定义名称；保存失败时输入会保留。"
          :"记录当前进展或等待事项，最多 300 个字符。保存失败时输入会保留。",
        submitLabel:isLabel?"保存名称":"保存进度",
        fields:[{name:field,label:isLabel?"分支名称":"进展或等待事项",
          type:isLabel?"text":"textarea",rows:4,value,
          maxLength:isLabel?80:300,maxPoints:isLabel?80:300,
          hint:isLabel?"示例：A · 回测、B · 质疑":"只记录当前进展，不自动改变分支状态"}],
        onSubmit:async values=>{
          try{
            const result=await message({type:"MUTATE",action:{
              type:"updateChat",key,expectedRevision:baseRevision,
              patch:{[field]:values[field]}
            }});
            const refreshed=await refresh(true);
            if(refreshed)notify(isLabel?"分支名称已更新":"分支进度已更新");
            else notifyCritical("已收到保存成功回执，但当前状态刷新失败。请刷新面板核对结果，不要重复提交。");
            return result;
          }catch(error){
            const refreshed=await refresh(true);
            notifyCritical((isLabel?"分支名称":"分支进度")+"保存失败或结果未确认："+error.message+
              "。"+(refreshed?"已刷新状态；":"状态刷新也失败，当前显示可能过期；")+
              "输入仍保留。请先核对当前分支，再决定是否重试。不会自动重放。");
            throw error;
          }
        }
      });
    }
    if (action==="unlink-chat") {
      if (confirm("从当前课题移除此对话？不会删除原始 ChatGPT 对话。")) return change({type:"unlinkChat",key},"已移除关联");
    }
  });
  document.addEventListener("change",event=>{
    const key=event.target.dataset?.stageKey;
    if (key) change({type:"updateChat",key,patch:{stage:event.target.value}},"分支状态已更新");
  });
  document.addEventListener("focusout",()=>{
    if (rerenderPending && !["edit-name","edit-goal","edit-decision","topic-name"].some(id=>document.activeElement?.id===id)) refresh(true);
  });
  chrome.storage.onChanged.addListener((changes,area)=>{
    if ((area==="local" && changes.threadline_state_v1) || (area==="session" && Object.keys(changes).some(k=>k.startsWith("tl_live_")))) refresh();
  });
  chrome.tabs.onActivated.addListener(()=>refresh());
  chrome.tabs.onUpdated.addListener((id,change)=>{if (change.url || change.title || change.status==='complete') refresh();});
  chrome.tabs.onRemoved.addListener(()=>refresh());
  chrome.windows.onFocusChanged.addListener(()=>refresh());
  setInterval(()=>{refresh();renderFFProgress();},12000);

  /* ---- Evidence conclusions (S1b): read-only views + amend/withdraw ----
   * The panel only sends EV_* commands; the service worker is the writer. */
  const evSend = payload => new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, response => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      if (!response || !response.ok) return reject(new Error((response && response.error) || "后台无返回"));
      resolve(response.data);
    });
  });
  const ev$ = id => document.getElementById(id);
  let evidenceHandoffStamp = null;
  let evidenceRequest = 0,evidenceDirectory=0,handoffGeneration=0,handoffEdits=0,handoffProject=null,handoffPending=null,evidenceHasRows=false;
  const handoffDrafts=new Map();
  let evidenceListCache=null,evidenceVisibleLimit=ThreadLineEvidenceList.PAGE_SIZE;

  async function renderEvidence() {
    const ticket=++evidenceDirectory,snapshot = await evSend({ type: "EV_PROJECTS" });
    if(ticket!==evidenceDirectory)return;
    const select = ev$("evidence-project");
    const current = select.value;
    select.replaceChildren();
    for (const project of (snapshot.projects || []).filter(p=>!p.deleted)) {
      const option = document.createElement("option");
      option.value = project.id;
      option.textContent = (project.name || project.id)+(project.unavailable?"（需恢复）":"");
      select.appendChild(option);
    }
    const restoringLibraryView=surface==="library"&&librarySelectionPending;
    if(restoringLibraryView){
      librarySelectionPending=false;
      if(libraryInitialProjectId&&[...select.options].some(o=>o.value===libraryInitialProjectId)){
        select.value=libraryInitialProjectId;
      }else{
        const option=document.createElement("option");option.value="";
        option.textContent=libraryInitialProjectId
          ?"原课题不可用，请重新选择":"请选择要查看的课题";
        select.insertBefore(option,select.firstChild);
        select.value="";
        if(libraryInitialProjectId)
          notifyCritical("资料库找不到原课题；未自动切换到其他课题，请明确选择。");
      }
    }else if ([...select.options].some(o => o.value === current)) select.value = current;
    else if(surface==="library"){
      // When the selected project is missing or no project was chosen, never
      // allow the native select element to silently pick another project.
      const option=document.createElement("option");option.value="";
      option.textContent=current?"所选课题已不可用，请重新选择":"请选择要查看的课题";
      select.insertBefore(option,select.firstChild);
      select.value="";
      if(current)notifyCritical("当前查看课题已不可用；未自动切换到其他课题，请明确选择。");
    }
    if(restoringLibraryView){
      // Initial wide-page project is a *navigation* choice. Keep the topic
      // detail tab on the same project without changing chat associations.
      setSelectedId(select.value||null);
      render();
    }
    if(select.value!==current&&!restoringLibraryView)
      select.dispatchEvent(new Event("change"));
    else await renderEvidenceProject(); // restoration is not a user project switch
    saveLibraryView();
  }

  function createEvidenceNext(action,label) {
    const next=document.createElement("button");
    next.type="button";next.className="secondary evidence-next";next.dataset.action=action;next.textContent=label;
    if(surface==="library") {
      const hint=document.createElement("p");hint.className="subtle";
      hint.textContent="当前资料库以查阅为主；请在研线侧栏执行创建、采纳或整理操作。";
      return hint;
    }
    return next;
  }

  async function renderEvidenceProject() {
    const request=++evidenceRequest,projectId = ev$("evidence-project").value;
    if (!projectId) { evidenceListCache=null;evidenceHasRows=false;ev$("evidence-handoff").disabled=true;ev$("evidence-summary").textContent=surface==="library"?"请选择要查看的课题；创建、采纳及修订仍在研线侧栏进行。":"暂无课题。先创建课题，再从整理结果逐条采纳。";ev$("evidence-list-count").textContent="";ev$("evidence-more").hidden=true;ev$("evidence-list").replaceChildren(createEvidenceNext("start-new-topic","创建课题"));return true; }
    let data;
    try { data = await evSend({ type: "EV_LIST", projectId }); }
    catch (e) {
      if(request!==evidenceRequest)return;
      ev$("evidence-summary").textContent = "证据库不可用：" + e.message;
      notifyCritical("证据读取失败或结果未确认："+e.message+"。当前证据列表可能不完整，请刷新并核对权威库状态。");
      evidenceListCache=null;renderEvidenceRows();
      // Preserve any manually edited draft, but stop presenting it as current.
      ev$("evidence-handoff-copy").disabled = true;
      ev$("evidence-handoff-read").disabled = true;evidenceHasRows=false;
      ev$("evidence-handoff").disabled = true;
      evidenceHandoffStamp = null;
      return false;
    }
    if(request!==evidenceRequest||projectId!==ev$("evidence-project").value)return true;
    evidenceHasRows=!!data.rows.length;ev$("evidence-handoff").disabled=!evidenceHasRows||!!handoffPending;
    const adopted=data.rows.filter(r=>r.conclusion.status!=="withdrawn").length,withdrawn=data.rows.length-adopted;
    ev$("evidence-summary").textContent=data.rows.length?`已采纳 ${adopted} 条 · 已撤回 ${withdrawn} 条 · 共 ${data.rows.reduce((n,r)=>n+r.versions.length,0)} 个版本`+(data.projectionPending?"\n证据已保存，共享摘要待更新。":"\n点击依据查看原文；修订和撤回均保留历史。") : "尚无采纳结论。先在“研究整理”或 Fork 对照结果中逐条采纳。";
    evidenceListCache={projectId,rows:data.rows,legacyNote:data.project?.legacyNote?.text||""};
    renderEvidenceRows();
    return true;
  }


  function historyTime(value) {
    return Number.isSafeInteger(value) && value >= 0
      ? new Date(value).toLocaleString()
      : "时间未知";
  }

  function renderVersionHistory(holder, data) {
    holder.replaceChildren();
    const labels={create:"首次采纳",adopt:"首次采纳",amend:"修订"};
    const impacts={wording:"仅措辞",substantive:"实质修改",conditions:"适用条件变化"};
    const relations={cites:"引用",supports:"支持",opposes:"反对",background:"背景"};
    if(data.status==="withdrawn"){
      const withdrawn=document.createElement("p");
      withdrawn.className="subtle";
      withdrawn.textContent="当前结论已撤回"+(data.withdrawnAt?" · "+historyTime(data.withdrawnAt):"")+
        (data.withdrawalReason?" · 原因："+data.withdrawalReason:"");
      holder.appendChild(withdrawn);
    }
    for(const [index,version] of data.versions.entries()){
      const details=document.createElement("details"),summary=document.createElement("summary"),body=document.createElement("div");
      details.className="evidence-history-version";
      summary.textContent="版本 "+(index+1)+(version.id===data.currentVersionId?"（当前）":"")+
        " · "+(labels[version.changeType]||"历史版本")+
        (version.changeImpact?" · "+(impacts[version.changeImpact]||version.changeImpact):"")+
        " · "+historyTime(version.createdAt)+" · 来源 "+version.sourceCount+" 条";
      body.className="evidence-history-version-body";
      const meta=document.createElement("p");meta.className="subtle";
      meta.textContent="版本 ID："+version.id+" · 作者："+(version.creator||"未知")+
        (version.predecessorId?" · 前一版本："+version.predecessorId:"");
      body.appendChild(meta);
      const text=document.createElement("pre");text.className="evidence-history-fulltext";
      text.textContent=version.text;
      body.appendChild(text);
      const conditions=document.createElement("p");
      conditions.textContent="适用条件："+(version.conditions||"未填写");
      body.appendChild(conditions);
      const sourceTitle=document.createElement("p");sourceTitle.className="subtle";
      sourceTitle.textContent="来源范围："+version.sourceCount+" 条连接"+
        (version.recordedSourceCount!==null&&version.recordedSourceCount!==version.sourceCount
          ?"（记录数 "+version.recordedSourceCount+" 与实际连接数不一致）":"");
      body.appendChild(sourceTitle);
      if(version.recordedSourceCount!==null&&version.recordedSourceCount!==version.sourceCount){
        const warning=document.createElement("p");warning.className="evidence-history-warning";
        warning.textContent="来源连接记录与版本元数据不一致，请按原始证据核对；系统未补造缺失来源。";
        body.appendChild(warning);
      }
      if(!version.fragments.length){
        const none=document.createElement("p");none.className="subtle";
        none.textContent=version.recordedSourceCount>0
          ?"该版本记录了来源数量，但未找到来源连接；来源不可用。"
          :"该版本没有记录来源片段。";
        body.appendChild(none);
      }
      for(const fragment of version.fragments){
        if(!fragment.available){
          const missing=document.createElement("p");missing.className="evidence-history-warning";
          missing.textContent="来源记录缺失 · "+(relations[fragment.relation]||"来源")+
            " · ID "+fragment.sourceId+"。仅显示已有版本正文，不推断原文。";
          body.appendChild(missing);continue;
        }
        const source=document.createElement("details"),sourceSummary=document.createElement("summary");
        source.className="evidence-history-source";
        sourceSummary.textContent=(relations[fragment.relation]||"来源")+
          (fragment.conversationId?" · 会话 "+fragment.conversationId:" · 仅片段（无会话 ID）");
        const sourceMeta=document.createElement("p");sourceMeta.className="subtle";
        sourceMeta.textContent="来源 ID："+fragment.sourceId+
          (fragment.messageId?" · 消息 ID："+fragment.messageId:" · 无消息 ID")+
          (fragment.sourceRole?" · 角色："+fragment.sourceRole:"")+
          (fragment.capturedAt!==null?" · 采集时间："+historyTime(fragment.capturedAt):"")+
          (fragment.completeness?" · 完整性："+fragment.completeness:"")+
          (fragment.url?" · 来源 URL："+fragment.url:"");
        const excerpt=document.createElement("pre");excerpt.className="evidence-history-fulltext";
        excerpt.textContent=(fragment.before||"")+"【"+fragment.selection+"】"+(fragment.after||"");
        source.append(sourceSummary,sourceMeta,excerpt);body.appendChild(source);
      }
      details.append(summary,body);holder.appendChild(details);
    }
  }

  function renderEvidenceRows() {
    const holder=ev$("evidence-list"),more=ev$("evidence-more"),count=ev$("evidence-list-count");
    const cache=evidenceListCache;
    if(!cache||cache.projectId!==ev$("evidence-project").value){
      holder.replaceChildren();count.textContent="";more.hidden=true;return;
    }
    const opened=new Set([...holder.querySelectorAll(".evidence-item[open]")].map(el=>el.dataset.conclusionId));
    const view=ThreadLineEvidenceList.select(cache.rows,{
      query:ev$("evidence-query").value,status:ev$("evidence-filter-status").value,limit:evidenceVisibleLimit
    });
    holder.replaceChildren();
    if(cache.legacyNote){
      const legacy=document.createElement("details"),title=document.createElement("summary"),body=document.createElement("pre");
      title.textContent="接管前的课题备注（未核验）";body.textContent=cache.legacyNote;
      legacy.append(title,body);holder.appendChild(legacy);
    }
    count.textContent=`匹配 ${view.matched} / ${view.total} 条结论，当前显示 ${view.rows.length} 条`;
    more.hidden=!view.hasMore;
    more.textContent=`再显示 ${Math.min(ThreadLineEvidenceList.PAGE_SIZE,view.matched-view.rows.length)} 条结论`;
    if(!view.rows.length){
      if(!view.total)holder.appendChild(createEvidenceNext("open-research","打开研究整理"));
      else {
        const empty=document.createElement("p");empty.className="subtle";
        empty.textContent="没有符合搜索或状态筛选的结论，可清除条件重新查找。";
        holder.appendChild(empty);
      }
    }
    for(const row of view.rows){
      const c=row.conclusion,item=document.createElement("details"),summary=document.createElement("summary"),content=document.createElement("div");
      item.className="evidence-item";item.dataset.conclusionId=c.id;
      item.open=opened.has(c.id)||view.rows.length===1;
      summary.className="evidence-item-header";
      summary.textContent=(c.status==="withdrawn"?"已撤回 · ":"已采纳 · ")+ThreadLineEvidenceList.preview(row)
        +(row.versions?.length>1?" · 修订 "+(row.versions.length-1)+" 次":"")
        +" · "+(row.fragments?.length||0)+" 条依据";
      content.className="evidence-item-body";
      const head=document.createElement("p");
      head.textContent=(c.status==="withdrawn"?"[已撤回] ":"")+(row.current?.text||c.id);
      content.appendChild(head);item.append(summary,content);
      if(row.current?.conditions){
        const conditions=document.createElement("p");conditions.textContent="适用条件："+row.current.conditions;
        content.appendChild(conditions);
      }
      for(const fragment of row.fragments||[]){
        const box=document.createElement("details"),sourceSummary=document.createElement("summary");
        sourceSummary.textContent="依据片段 · "+({cites:"引用",supports:"支持",opposes:"反对",background:"背景"}[fragment.relation]||"引用")+
          (fragment.conversationId?" · 会话 "+String(fragment.conversationId).slice(0,8)+"…":" · 仅片段（来源不可定位）");
        const pre=document.createElement("pre");pre.style.whiteSpace="pre-wrap";
        pre.textContent=(fragment.before||"")+"【"+fragment.selection+"】"+(fragment.after||"");
        box.append(sourceSummary,pre);
        if(fragment.conversationId){
          const locateRow=document.createElement("div");locateRow.className="line";
          const btn=document.createElement("button");btn.type="button";btn.className="secondary";btn.textContent="在对话中定位";
          const note=document.createElement("span");note.className="subtle";
          btn.addEventListener("click",async()=>{
            note.textContent="定位中…";
            try{
              const result=await evSend({type:"EV_LOCATE",conversationId:fragment.conversationId,messageId:fragment.messageId||null,role:null,contentPrefix:fragment.selection.slice(0,40)});
              note.textContent=result.located&&result.verified?"已定位到原消息":
                (result.reason==="conversation-not-open"?"对话未打开（仅片段）：https://chatgpt.com/c/"+fragment.conversationId:"定位不可靠，仅显示片段");
            }catch(error){note.textContent="定位失败（仅片段）";}
          });
          locateRow.append(btn,note);box.appendChild(locateRow);
        }
        content.appendChild(box);
      }
      const historyButton=document.createElement("button");
      historyButton.type="button";historyButton.className="secondary evidence-history-toggle";
      historyButton.textContent="查看版本历史（"+row.versions.length+"）";
      historyButton.setAttribute("aria-expanded","false");
      const historyPanel=document.createElement("div");historyPanel.className="evidence-history";historyPanel.hidden=true;
      const historyStatus=document.createElement("p");historyStatus.className="subtle";
      historyStatus.setAttribute("role","status");historyStatus.setAttribute("aria-live","polite");
      const historyItems=document.createElement("div");
      historyPanel.append(historyStatus,historyItems);
      let historyLoaded=false,historyBusy=false;
      historyButton.addEventListener("click",async()=>{
        if(historyBusy)return;
        if(!historyPanel.hidden){
          historyPanel.hidden=true;historyButton.setAttribute("aria-expanded","false");return;
        }
        historyPanel.hidden=false;historyButton.setAttribute("aria-expanded","true");
        if(historyLoaded)return;
        const projectId=evidenceListCache?.projectId;
        if(!projectId){historyStatus.textContent="请先选择课题后重试。";return;}
        historyBusy=true;historyButton.disabled=true;historyStatus.textContent="正在读取版本历史…";
        try{
          const history=await evSend({type:"EV_HISTORY",projectId,conclusionId:c.id});
          if(!item.isConnected||evidenceListCache?.projectId!==projectId)return;
          if(history.projectId!==projectId||history.conclusionId!==c.id||!Array.isArray(history.versions))
            throw new Error("返回的课题或结论身份不匹配");
          renderVersionHistory(historyItems,history);
          historyStatus.textContent="已读取 "+history.versions.length+" 个版本；历史正文与来源仅供核对，不可在此修改。";
          historyLoaded=true;
        }catch(error){
          if(item.isConnected&&evidenceListCache?.projectId===projectId)
            historyStatus.textContent="版本历史读取失败："+error.message+"。可重新尝试。";
        }finally{
          historyBusy=false;
          if(item.isConnected)historyButton.disabled=false;
        }
      });
      content.append(historyButton,historyPanel);
      if(c.status!=="withdrawn"&&surface!=="library"){
        // Do not even create edit/withdraw controls for the wide read surface.
        // The service worker retains the unchanged, exact-panel trust policy.
        const row2=document.createElement("div");row2.className="line";
        const amend=document.createElement("button");amend.type="button";amend.className="secondary evidence-write-action";amend.textContent="修订";
        amend.addEventListener("click",async()=>{
          let signature=null,operationId=null;
          const result=await ThreadLineDialogs.form({title:"修订结论",description:"保存后生成新版本，原有正文和依据保留。",submitLabel:"保存新版本",fields:[
            {name:"text",label:"结论正文",type:"textarea",value:row.current.text,required:true,maxPoints:4000},
            {name:"conditions",label:"适用条件",type:"textarea",rows:2,value:row.current.conditions||""},
            {name:"changeImpact",label:"变更类型",type:"select",value:"substantive",options:[{value:"substantive",label:"实质修改"},{value:"wording",label:"仅调整措辞"},{value:"conditions",label:"适用条件变化"}]}
          ],onSubmit:async values=>{
            const nextSignature=JSON.stringify(values);
            if(signature!==nextSignature){signature=nextSignature;operationId="op_amend_"+crypto.randomUUID().replace(/-/g,"");}
            try{
              return await evSend({type:"EV_AMEND",conclusionId:c.id,...values,expectedVersionId:row.current.id,operationId});
            }catch(error){
              const refreshed=await renderEvidenceProject();
              notifyCritical("修订失败或结果未确认："+error.message+
                "。"+(refreshed?"已刷新当前版本；":"当前版本刷新也失败；")+
                "输入仍保留。请核对历史后再决定是否重试，不会自动重放。");
              throw error;
            }
          }});
          if(result){
            const refreshed=await renderEvidenceProject();
            window.dispatchEvent(new Event("threadline-evidence-changed"));
            if(refreshed)notify(result.projectionPending?"新版本已保存，共享摘要待更新":"新版本已保存，历史已保留");
            else notifyCritical("新版本已保存回执已收到，但当前证据列表刷新失败。请刷新核对，不要重复提交。");
          }
        });
        const withdraw=document.createElement("button");withdraw.type="button";withdraw.className="secondary evidence-write-action";withdraw.textContent="撤回";
        let withdrawPending=false;
        withdraw.addEventListener("click",async()=>{
          if(withdrawPending)return;
          const targetProjectId=evidenceListCache?.projectId;
          if(!targetProjectId)return;
          const accepted=await ThreadLineDialogs.confirm({
            title:"撤回这条结论？",
            description:"撤回后它不再作为当前有效结论展示，但历史版本、适用条件和来源片段会保留。",
            confirmLabel:"撤回结论",cancelLabel:"取消",danger:true
          });
          if(!accepted)return;
          if(targetProjectId!==ev$("evidence-project").value){
            notifyCritical("查看课题已切换，撤回未发送。请回到原课题核对后再操作。");
            return;
          }
          withdrawPending=true;withdraw.disabled=true;
          try{
            await evSend({type:"EV_WITHDRAW",conclusionId:c.id,reason:"面板撤回",expectedVersionId:row.current.id,operationId:"op_wd_"+crypto.randomUUID().replace(/-/g,"").slice(0,12)});
            if(targetProjectId!==ev$("evidence-project").value){
              notify("原课题中的结论已撤回；当前查看课题未变更。");
              return;
            }
            const refreshed=await renderEvidenceProject();
            if(refreshed){
              const current=[...ev$("evidence-list").querySelectorAll(".evidence-item")]
                .find(node=>node.dataset.conclusionId===c.id);
              current?.querySelector(":scope > summary")?.focus();
              notify("结论已撤回，历史与来源片段已保留");
            }else notifyCritical("撤回成功回执已收到，但当前证据列表刷新失败。请刷新核对，不要重复撤回。");
          }catch(error){
            if(targetProjectId!==ev$("evidence-project").value){
              notifyCritical("原课题中的撤回失败或结果未确认；当前查看课题已切换。请切回原课题核对状态，研线未自动重放。");
              return;
            }
            const refreshed=await renderEvidenceProject();
            notifyCritical("撤回失败或结果未确认："+error.message+
              "。"+(refreshed?"已刷新当前结论；":"当前结论刷新也失败；")+
              "请核对状态与历史后再决定是否重试。研线未自动重放撤回操作。");
          }finally{
            withdrawPending=false;
            if(withdraw.isConnected)withdraw.disabled=false;
          }
        });
        row2.append(amend,withdraw);content.appendChild(row2);
      }
      holder.appendChild(item);
    }
  }

  ev$("evidence-refresh").addEventListener("click", () => renderEvidenceProject());
  ev$("evidence-query").addEventListener("input",()=>{
    evidenceVisibleLimit=ThreadLineEvidenceList.PAGE_SIZE;renderEvidenceRows();saveLibraryView();
  });
  ev$("evidence-filter-status").addEventListener("change",()=>{
    evidenceVisibleLimit=ThreadLineEvidenceList.PAGE_SIZE;renderEvidenceRows();saveLibraryView();
  });
  ev$("evidence-more").addEventListener("click",()=>{
    evidenceVisibleLimit+=ThreadLineEvidenceList.PAGE_SIZE;renderEvidenceRows();
    const more=ev$("evidence-more");
    if(!more.hidden)more.focus();
    else ev$("evidence-list").querySelector(".evidence-item:last-of-type > summary")?.focus();
  });
  ev$("evidence-handoff-view").addEventListener("input",()=>{++handoffEdits;});
  ev$("evidence-project").addEventListener("change",()=>{
    if(surface==="library"&&!librarySelectionPending){
      // Evidence and topic sections share a navigation default, not a write
      // target, capture source or global cross-window selection.
      setSelectedId(ev$("evidence-project").value||null);
      render();
    }
    evidenceListCache=null;evidenceVisibleLimit=ThreadLineEvidenceList.PAGE_SIZE;
    ev$("evidence-query").value="";ev$("evidence-filter-status").value="all";renderEvidenceRows();
    const view=ev$("evidence-handoff-view");
    if(handoffProject&&!view.hidden)handoffDrafts.set(handoffProject,{text:view.value,stamp:evidenceHandoffStamp});
    ++handoffGeneration;++handoffEdits;handoffPending=null;evidenceHasRows=false;ev$("evidence-handoff").disabled=true;handoffProject=ev$("evidence-project").value;
    const saved=handoffDrafts.get(handoffProject);view.value=saved?.text||"";view.hidden=!saved;evidenceHandoffStamp=saved?.stamp||null;
    for(const id of ["evidence-handoff-copy","evidence-handoff-read"]){ev$(id).hidden=!saved;ev$(id).disabled=!saved?.stamp;}
    renderEvidenceProject();
    saveLibraryView();
  });
  ev$("evidence-handoff").addEventListener("click",async()=>{
    const projectId=ev$("evidence-project").value;if(!projectId||handoffPending)return;
    const generation=++handoffGeneration,edits=handoffEdits;handoffPending={generation,projectId};ev$("evidence-handoff").disabled=true;
    const applies=()=>generation===handoffGeneration&&projectId===ev$("evidence-project").value&&edits===handoffEdits;
    try{
      const data=await evSend({type:"EV_LIST",projectId});if(!applies())return;
      const result=await evSend({type:"EV_HANDOFF_PREPARE",projectId,expectedRevision:data.project.evidenceRevision,operationId:"op_handoff_"+crypto.randomUUID().replace(/-/g,"")});
      if(!applies()){notify("新预览已保存到原课题历史；当前编辑的草稿已保留。");return;}
      const view=ev$("evidence-handoff-view");view.hidden=false;view.value=result.handoff.text;handoffProject=projectId;
      evidenceHandoffStamp={projectId,handoffId:result.handoff.id};handoffDrafts.set(projectId,{text:view.value,stamp:evidenceHandoffStamp});
      for(const id of ["evidence-handoff-copy","evidence-handoff-read"]){ev$(id).hidden=false;ev$(id).disabled=false;}
      window.dispatchEvent(new Event("threadline-evidence-changed"));
    }catch(error){if(generation===handoffGeneration)notifyCritical("交接生成结果未确认："+error.message+"。原草稿仍保留；请核对该课题的交接历史后再决定是否重试。研线未自动重放。");}
    finally{if(handoffPending?.generation===generation){handoffPending=null;ev$("evidence-handoff").disabled=!evidenceHasRows;}}
  });
  ev$("evidence-handoff-copy").addEventListener("click", async () => {
    let copied=false;
    try {
      const stamp = evidenceHandoffStamp;
      if (!stamp || stamp.projectId !== ev$("evidence-project").value) throw new Error("课题已变化，请重新生成预览；当前草稿仍保留");
      const text=ev$("evidence-handoff-view").value;
      await evSend({type:"EV_HANDOFF_VALIDATE",projectId:stamp.projectId,handoffId:stamp.handoffId,text});
      await navigator.clipboard.writeText(text);
      copied=true;
      const data=await evSend({type:"EV_LIST",projectId:stamp.projectId});
      await evSend({type:"EV_HANDOFF_RECORD",projectId:stamp.projectId,handoffId:stamp.handoffId,text,event:"copied",
        expectedRevision:data.project.evidenceRevision,operationId:"op_copied_"+crypto.randomUUID().replace(/-/g,"")});
      notify("已复制编辑后的交接材料");
    } catch (e) { notifyCritical((copied?"文本已复制，但复制记录未保存：":"复制未完成：")+(e.message||"请核对当前状态")+"。请刷新并核对交接记录；不会自动重放。"); }
  });
  ev$("evidence-handoff-read").addEventListener("click",async()=>{
    try {
      const stamp=evidenceHandoffStamp;if(!stamp||stamp.projectId!==ev$("evidence-project").value)throw Error("请先生成本课题交接预览");
      const text=ev$("evidence-handoff-view").value;
      const data=await evSend({type:"EV_LIST",projectId:stamp.projectId});
      await evSend({type:"EV_HANDOFF_RECORD",projectId:stamp.projectId,handoffId:stamp.handoffId,text,
        event:"human-read",expectedRevision:data.project.evidenceRevision,operationId:"op_read_"+crypto.randomUUID().replace(/-/g,"")});
      notify("已记录你看过此份材料；这不表示模型已理解。");
    } catch(e){notifyCritical("交接已读记录失败或结果未确认："+e.message+"。请核对当前课题的交接历史后再决定是否重试。");}
  });
  window.addEventListener("threadline-evidence-changed",()=>{renderEvidence().catch(e=>notifyCritical("证据课题列表读取失败："+e.message));refresh(true);});
  async function initializeSurface() {
    let tab=null,intent=null,saved=null;
    try{tab=await chrome.tabs.getCurrent();}catch{}
    if(tab?.id){
      try{intent=await ThreadLineLibrarySurface.consume(tab.id);}
      catch(error){notifyCritical("资料库导航意图读取失败："+error.message+"；已恢复原始侧栏布局。");}
      if(!intent){
        try{saved=ThreadLineLibrarySurface.loadView(tab.id);}
        catch(error){notifyCritical("资料库上次阅读位置不可用："+error.message+"；已恢复原始侧栏布局。");}
      }
    }
    if(!intent&&!saved)return; // ordinary side panel and direct panel.html remain unchanged
    const view=saved||{
      viewProjectId:intent.viewProjectId,topicProjectId:null,
      sourceTabId:intent.sourceTabId,sourceChatKey:intent.sourceChatKey,
      workspace:"evidence",filter:intent.filter,query:intent.query
    };
    surface="library";
    libraryTabId=tab.id;
    libraryWindowId=tab.windowId;
    librarySourceTabId=view.sourceTabId;
    librarySourceChatKey=view.sourceChatKey;
    libraryInitialProjectId=view.viewProjectId;
    librarySelectionPending=true;
    if(saved)setSelectedId(view.topicProjectId);
    $("#evidence-query").value=view.query;
    $("#evidence-filter-status").value=view.filter;
    document.documentElement.dataset.surface="library";
    $("#library-launch").hidden=true;
    $("#library-header").hidden=false;
    $("#nav-research").hidden=true;
    $("#nav-research").tabIndex=-1;
    $("#nav-switch").lastChild.textContent=" 课题与对话";
    $("#nav-evidence").lastChild.textContent=" 结论与依据";
    $("#manage-accordion").open=true;
    const manageLabel=document.querySelector("#manage-accordion > summary > span");
    if(manageLabel)manageLabel.textContent="课题与对话（只读）";
    const manageDesc=document.querySelector("#manage-accordion .manage-desc");
    if(manageDesc)manageDesc.textContent="查看";
    const context=$("#library-context-text");
    if(librarySourceTabId){
      const source=await chrome.tabs.get(librarySourceTabId).catch(()=>null);
      if(source&&ThreadLineCore.isChatURL(source.url)&&getKey(source)===librarySourceChatKey)
        context.textContent="来源对话："+(source.title||"未命名")+
          "。查看别的课题不会改变此来源或任何采集任务。";
      else{
        librarySourceTabId=null;librarySourceChatKey=null;
        context.textContent="原来源对话已关闭或改变；请明确选择课题，不能据此运行网页自检。";
      }
    }else context.textContent="来源对话未指定；只浏览研究资料，操作目标由当前选中的课题决定。";
    $("#library-return").hidden=!librarySourceTabId;
    setWorkspace(view.workspace);
    if(view.workspace==="switch")
      renderEvidence().catch(error=>notifyCritical("证据课题列表读取失败："+error.message));
  }
  document.querySelector(".workspace-tabs").addEventListener("keydown", e => {
    if (!["ArrowLeft","ArrowRight","Home","End"].includes(e.key)) return;
    e.preventDefault();
    const names=surface==="library"?["switch","evidence"]:["switch","research","evidence"];
    const index=names.indexOf(workspace);
    const next=e.key==="Home"?names[0]:e.key==="End"?names.at(-1):names[(index+(e.key==="ArrowLeft"?-1:1)+names.length)%names.length];
    setWorkspace(next);$("#nav-"+next).focus();
  });
  setWorkspace("switch"); // original eager navigation: no async blank panel
  renderEvidence().catch(error=>notifyCritical("证据课题列表读取失败："+error.message));
  initializeSurface().catch(error=>
    notifyCritical("资料库初始化失败："+error.message+"。请重新打开面板核对。"));
  refresh(true);
})();
