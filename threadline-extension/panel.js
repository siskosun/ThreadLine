(() => {
  const $ = sel => document.querySelector(sel);
  const escape = value => String(value ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
  const stageLabels = { active:"研究中",review:"待验证",done:"分支完成" };
  let selectedId = null;
  let filter = "all";
  let workspace = "switch"; // every newly opened panel starts with the main workflow
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
      if (n !== latestRequest) return;
      state = data.state;
      tabs = data.tabs;
      activeTabId = data.activeTabId;
      liveByTab = data.liveByTab;
      const typing = ["edit-name","edit-goal","edit-decision","topic-name"].some(id=>document.activeElement?.id === id);
      if (typing && !force) {rerenderPending = true;renderStats();return;}
      rerenderPending = false;
      if (selectedId && !state.projects.some(p=>p.id===selectedId)) selectedId = null;
      render();
    } catch(error) {notify(error.message,true);}
  }
  function notify(value,isError=false) {
    const node = $("#toast");
    node.textContent = value;
    node.style.background = isError ? "#a34d3a" : "#273c56";
    node.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>node.classList.remove("show"),3100);
  }
  async function change(action,success) {
    if (busy) {notify("上一项更改正在保存，请稍后再试");return;}
    busy=true;
    try {
      const res=await message({type:"MUTATE",action});
      if (res?.result?.projectId) selectedId = res.result.projectId;
      await refresh(true);
      if (success) notify(success);
    } catch(error) {notify(error.message,true);}
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
  function render() {renderStats();renderCurrent();renderQuickBranches();renderTopics();renderDetails();}
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
      anchor.href=url;anchor.download=`ThreadLine-课题备份-${new Date().toISOString().slice(0,10)}.json`;
      document.body.append(anchor);anchor.click();anchor.remove();
      setTimeout(()=>URL.revokeObjectURL(url),2500);
      $('#backup-status').textContent=`已下载 ${data.state.projects.length} 个课题、${Object.keys(data.state.chats).length} 条关联。临时采集原文未包含。`;
    } catch(e){$('#backup-status').textContent='导出失败：'+e.message;}
  }
  async function importBackup(){
    const file=$('#backup-file').files?.[0];if(!file)return notify('请选择 .json 备份文件',true);
    try {
      if(file.size>ThreadLineBackup.MAX_BYTES)throw new Error('备份文件超过 2MB');
      const json=await file.text();const state=ThreadLineBackup.parse(json);
      if(!confirm(`确认用备份中的 ${state.projects.length} 个课题、${Object.keys(state.chats).length} 条关联覆盖当前数据吗？当前状态会先保留为本地快照。`))return;
      const info=await message({type:'BACKUP_IMPORT',json});
      selectedId=null;await refresh(true);
      $('#backup-status').textContent=`恢复成功：${info.projects} 个课题、${info.chats} 条关联。`;
    }catch(e){$('#backup-status').textContent='导入失败：'+e.message;}
  }
  async function rollbackBackup(){
    try {
      const snapshots=await message({type:'BACKUP_SNAPSHOTS'});
      if(!snapshots.length)return notify('尚无可恢复的快照',true);
      const latest=snapshots.at(-1);
      if(!confirm(`恢复 ${new Date(latest.at).toLocaleString()} 的快照（${latest.reason}）？当前状态也会存为新快照。`))return;
      await message({type:'BACKUP_ROLLBACK',index:latest.index});selectedId=null;
      await refresh(true);$('#backup-status').textContent='已恢复最近快照。';
    }catch(e){$('#backup-status').textContent='快照恢复失败：'+e.message;}
  }
  function formatHealthTime(value){return value?new Date(value).toLocaleString('zh-CN',{hour12:false}):'尚无已验证成功记录';}
  async function runHealth(){
    const current=activeTab();const host=$('#health-result');
    if(!current)return host.textContent='请先打开要检查的 ChatGPT 标签页。';
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
    change({type:"createProject",name,chat:key?{key,title:t.title||"新对话",url:t.url}:null},"临时课题已创建").then(()=>{$("#topic-name").value="";});
  });
  document.addEventListener("click",async event=>{
    const nav=event.target.closest("[data-workspace]");
    if (nav){setWorkspace(nav.dataset.workspace);return;}
    const f=event.target.closest("[data-filter]");
    if (f){filter=f.dataset.filter;renderTopics();return;}
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
    if (action==="open-research") {setWorkspace("research",true);return;}
    if (action==="start-new-topic") {
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
      if (tab && project) {selectedId=project.id;return associateTab(tab,project);}
      return;
    }
    if (action==="collapse-details") {selectedId=null;render();return;}
    if (action==="select-project" || action==="view-project") {
      selectedId=(action==="select-project" && selectedId===id)?null:id;filter='all';setWorkspace("switch");render();
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
    if (action==="label-chat") {
      const value=prompt("给这个分支命名（例如：A · 回测、B · 质疑）",c.label||c.title);
      if (value!==null) return change({type:"updateChat",key,patch:{label:value}},"分支名称已更新");
    }
    if (action==="note-chat") {
      const value=prompt("这个分支的进展或等待事项（最多300字）",c.note||"");
      if (value!==null) return change({type:"updateChat",key,patch:{note:value}},"分支进度已更新");
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
    if ([...select.options].some(o => o.value === current)) select.value = current;
    if(select.value!==current)select.dispatchEvent(new Event("change"));
    else await renderEvidenceProject();
  }

  async function renderEvidenceProject() {
    const request=++evidenceRequest,projectId = ev$("evidence-project").value;
    if (!projectId) { evidenceHasRows=false; ev$("evidence-handoff").disabled=true; ev$("evidence-summary").textContent = "暂无课题。先在“对话切换 → 全部课题与管理”创建课题，再从整理结果逐条采纳。"; ev$("evidence-list").replaceChildren(); return; }
    let data;
    try { data = await evSend({ type: "EV_LIST", projectId }); }
    catch (e) {
      if(request!==evidenceRequest)return;
      ev$("evidence-summary").textContent = "证据库不可用：" + e.message;
      ev$("evidence-list").replaceChildren();
      // Preserve any manually edited draft, but stop presenting it as current.
      ev$("evidence-handoff-copy").disabled = true;
      ev$("evidence-handoff-read").disabled = true;evidenceHasRows=false;
      ev$("evidence-handoff").disabled = true;
      evidenceHandoffStamp = null;
      return;
    }
    if(request!==evidenceRequest||projectId!==ev$("evidence-project").value)return;
    evidenceHasRows=!!data.rows.length;ev$("evidence-handoff").disabled=!evidenceHasRows||!!handoffPending;
    const adopted=data.rows.filter(r=>r.conclusion.status!=="withdrawn").length,withdrawn=data.rows.length-adopted;
    ev$("evidence-summary").textContent=data.rows.length?`已采纳 ${adopted} 条 · 已撤回 ${withdrawn} 条 · 共 ${data.rows.reduce((n,r)=>n+r.versions.length,0)} 个版本`+(data.projectionPending?"\n证据已保存，共享摘要待更新。":"\n点击依据查看原文；修订和撤回均保留历史。") : "尚无采纳结论。先在“研究整理”或 Fork 对照结果中逐条采纳。";
    const holder = ev$("evidence-list");
    holder.replaceChildren();
    if(data.project?.legacyNote?.text){const legacy=document.createElement("details"),title=document.createElement("summary"),body=document.createElement("pre");title.textContent="接管前的课题备注（未核验）";body.textContent=data.project.legacyNote.text;legacy.append(title,body);holder.append(legacy);}
    for (const row of data.rows) {
      const item = document.createElement("div");
      item.className = "evidence-item";
      const head = document.createElement("p");
      const c = row.conclusion;
      head.textContent = (c.status === "withdrawn" ? "[已撤回] " : "") +
        (row.current ? row.current.text : c.id) +
        (row.versions && row.versions.length > 1 ? "（修订 " + (row.versions.length - 1) + " 次）" : "");
      item.appendChild(head);
      if (row.current?.conditions) {
        const conditions = document.createElement("p");
        conditions.textContent = "适用条件：" + row.current.conditions;
        item.appendChild(conditions);
      }
      for (const fragment of row.fragments || []) {
        const box = document.createElement("details");
        const summary = document.createElement("summary");
        summary.textContent = "依据片段 · " + ({cites:"引用",supports:"支持",opposes:"反对",background:"背景"}[fragment.relation] || "引用") +
          (fragment.conversationId ? " · 会话 " + String(fragment.conversationId).slice(0, 8) + "…" : " · 仅片段（来源不可定位）");
        const pre = document.createElement("pre");
        pre.style.whiteSpace = "pre-wrap";
        pre.textContent = (fragment.before || "") + "【" + fragment.selection + "】" + (fragment.after || "");
        box.appendChild(summary); box.appendChild(pre);
        if (fragment.conversationId) {
          const locateRow = document.createElement("div");
          locateRow.className = "line";
          const btn = document.createElement("button");
          btn.type = "button"; btn.className = "secondary"; btn.textContent = "在对话中定位";
          const note = document.createElement("span");
          note.className = "subtle";
          btn.addEventListener("click", async () => {
            note.textContent = "定位中…";
            try {
              const r = await evSend({ type: "EV_LOCATE",
                conversationId: fragment.conversationId,
                messageId: fragment.messageId || null,
                role: null, contentPrefix: fragment.selection.slice(0, 40) });
              note.textContent = r.located && r.verified
                ? "已定位到原消息"
                : (r.reason === "conversation-not-open"
                    ? "对话未打开（仅片段）：https://chatgpt.com/c/" + fragment.conversationId
                    : "定位不可靠，仅显示片段");
            } catch (e) { note.textContent = "定位失败（仅片段）"; }
          });
          locateRow.appendChild(btn); locateRow.appendChild(note);
          box.appendChild(locateRow);
        }
        item.appendChild(box);
      }
      if (c.status !== "withdrawn") {
        const row2 = document.createElement("div");
        row2.className = "line";
        const amend = document.createElement("button");
        amend.type = "button"; amend.className = "secondary"; amend.textContent = "修订";
        amend.addEventListener("click", async () => {
          let signature=null,operationId=null;
          const result=await ThreadLineDialogs.form({title:"修订结论",description:"保存后生成新版本，原有正文和依据保留。",submitLabel:"保存新版本",fields:[
            {name:"text",label:"结论正文",type:"textarea",value:row.current.text,required:true,maxPoints:4000},
            {name:"conditions",label:"适用条件",type:"textarea",rows:2,value:row.current.conditions||""},
            {name:"changeImpact",label:"变更类型",type:"select",value:"substantive",options:[{value:"substantive",label:"实质修改"},{value:"wording",label:"仅调整措辞"},{value:"conditions",label:"适用条件变化"}]},
            {name:"carryForward",label:"仅措辞修改时确认原输入依赖仍成立（不自动承认下游结论）",type:"checkbox",value:false}
                  ],onSubmit:async values=>{
            if(values.carryForward&&values.changeImpact!=="wording")throw Error("承接确认仅适用于已核对的措辞修改");
            const nextSignature=JSON.stringify(values);if(signature!==nextSignature){signature=nextSignature;operationId="op_amend_"+crypto.randomUUID().replace(/-/g,"");}
            return evSend({type:"EV_AMEND",conclusionId:c.id,...values,expectedVersionId:row.current.id,operationId});
          }});
          if(result){await renderEvidenceProject();window.dispatchEvent(new Event("threadline-evidence-changed"));notify(result.projectionPending?"新版本已保存，共享摘要待更新":"新版本已保存，历史已保留");}
        });
        const withdraw = document.createElement("button");
        withdraw.type = "button"; withdraw.className = "secondary"; withdraw.textContent = "撤回";
        withdraw.addEventListener("click", async () => {
          if (!confirm("撤回该结论？历史与片段保留。")) return;
          try {
            await evSend({ type: "EV_WITHDRAW", conclusionId: c.id, reason: "面板撤回",
              expectedVersionId: row.current.id,
              operationId: "op_wd_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12) });
            await renderEvidenceProject();
          } catch (e) { alert("撤回失败：" + e.message); }
        });
        row2.appendChild(amend); row2.appendChild(withdraw);
        item.appendChild(row2);
      }
      holder.appendChild(item);
    }
  }

  ev$("evidence-refresh").addEventListener("click", () => renderEvidenceProject());
  ev$("evidence-handoff-view").addEventListener("input",()=>{++handoffEdits;});
  ev$("evidence-project").addEventListener("change",()=>{
    const view=ev$("evidence-handoff-view");
    if(handoffProject&&!view.hidden)handoffDrafts.set(handoffProject,{text:view.value,stamp:evidenceHandoffStamp});
    ++handoffGeneration;++handoffEdits;handoffPending=null;evidenceHasRows=false;ev$("evidence-handoff").disabled=true;handoffProject=ev$("evidence-project").value;
    const saved=handoffDrafts.get(handoffProject);view.value=saved?.text||"";view.hidden=!saved;evidenceHandoffStamp=saved?.stamp||null;
    for(const id of ["evidence-handoff-copy","evidence-handoff-read"]){ev$(id).hidden=!saved;ev$(id).disabled=!saved?.stamp;}
    renderEvidenceProject();
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
    }catch(error){if(generation===handoffGeneration)notify("交接生成未确认："+error.message+"。原草稿仍保留。",true);}
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
    } catch (e) { notify((copied?"文本已复制，但复制记录未保存：":"复制未完成：")+(e.message||"请核对当前状态"), true); }
  });
  ev$("evidence-handoff-read").addEventListener("click",async()=>{
    try {
      const stamp=evidenceHandoffStamp;if(!stamp||stamp.projectId!==ev$("evidence-project").value)throw Error("请先生成本课题交接预览");
      const text=ev$("evidence-handoff-view").value;
      const data=await evSend({type:"EV_LIST",projectId:stamp.projectId});
      await evSend({type:"EV_HANDOFF_RECORD",projectId:stamp.projectId,handoffId:stamp.handoffId,text,
        event:"human-read",expectedRevision:data.project.evidenceRevision,operationId:"op_read_"+crypto.randomUUID().replace(/-/g,"")});
      notify("已记录你看过此份材料；这不表示模型已理解。");
    } catch(e){notify(e.message,true);}
  });
  window.addEventListener("threadline-evidence-changed",()=>{renderEvidence().catch(e=>notify(e.message,true));refresh(true);});
  renderEvidence().catch(() => {});
  document.querySelector(".workspace-tabs").addEventListener("keydown", e => {
    if (!["ArrowLeft","ArrowRight","Home","End"].includes(e.key)) return;
    e.preventDefault();
    const names=["switch","research","evidence"],index=names.indexOf(workspace);
    const next=e.key==="Home"?names[0]:e.key==="End"?names.at(-1):names[(index+(e.key==="ArrowLeft"?-1:1)+names.length)%names.length];
    setWorkspace(next);$("#nav-"+next).focus();
  });
  setWorkspace("switch");
  refresh(true);
})();
