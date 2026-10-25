importScripts("core.js", "backup-core.js", "capture-core.js", "capture-db.js", "organize-core.js", "ff-core.js", "ff-db.js",
  "research-core.js", "evidence-core.js", "evidence-db.js", "evidence-source.js", "evidence-lifecycle.js", "evidence-workflows.js");
const STORE_KEY = "threadline_state_v1";
const SNAPSHOT_KEY = "threadline_state_snapshots";
const CAPTURE_PREFIX = "tl_capture_owner_";
let mutations = Promise.resolve();

// The sending document is the principal, not its container tab. Never trust
// a missing tab alone. A conflicting container requires independent browser
// attestation of the exact live extension panel document, not payload claims.
async function inspectPanelSender(sender) {
  const expected = chrome.runtime.getURL('panel.html');
  const origin = `chrome-extension://${chrome.runtime.id}`;
  const tabURL = sender?.tab?.url;
  const check = {
    ok:false,reason:'ID_MISMATCH',hasTab:!!sender?.tab,
    idMatches:!!chrome.runtime.id && sender?.id === chrome.runtime.id,
    urlMatches:sender?.url === expected,
    originMatches:sender?.origin === undefined || sender.origin === origin,
    frameMatches:sender?.frameId === undefined || sender.frameId === 0,
    tabUrlPresent:tabURL !== undefined && tabURL !== '',
    tabUrlMatches:tabURL === undefined || tabURL === '' || tabURL === expected,
    contextStatus:'not_checked'
  };
  if(!check.idMatches)return check;
  if(!check.urlMatches)return {...check,reason:'DOCUMENT_URL_MISMATCH'};
  if(!check.originMatches)return {...check,reason:'ORIGIN_MISMATCH'};
  if(!check.frameMatches)return {...check,reason:'FRAME_MISMATCH'};
  if(check.tabUrlMatches)return {...check,ok:true,reason:'EXACT_PANEL'};
  if(typeof tabURL !== 'string')return {...check,reason:'INVALID_TAB_URL'};
  if(typeof sender.documentId !== 'string' || !sender.documentId)
    return {...check,reason:'DOCUMENT_ID_MISSING'};
  if(typeof chrome.runtime.getContexts !== 'function')
    return {...check,reason:'CONTEXT_UNAVAILABLE',contextStatus:'unavailable'};
  let timer;
  try {
    const contexts = await Promise.race([
      chrome.runtime.getContexts({contextTypes:['SIDE_PANEL','TAB'],
        documentIds:[sender.documentId],documentUrls:[expected]}),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(null),1000);})
    ]);
    if(contexts === null)return {...check,reason:'CONTEXT_TIMEOUT',contextStatus:'timeout'};
    const verified = Array.isArray(contexts) && contexts.length === 1 && contexts.every(c=>
      c.documentId === sender.documentId && c.documentUrl === expected &&
      c.documentOrigin === origin && (c.frameId === 0 || c.frameId === -1) &&
      (c.contextType === 'SIDE_PANEL' ||
        (c.contextType === 'TAB' && Number.isInteger(sender.tab?.id) &&
          sender.tab.id >= 0 && c.tabId === sender.tab.id)));
    return {...check,ok:verified,reason:verified?'ATTESTED_PANEL':'CONTEXT_NOT_VERIFIED',
      contextStatus:verified?'verified':'not_matched'};
  } catch {
    // Never disclose raw API errors, browsing URLs, extension IDs or document IDs.
    return {...check,reason:'CONTEXT_ERROR',contextStatus:'error'};
  } finally {clearTimeout(timer);}
}
async function requirePanelSender(sender,message) {
  const check = await inspectPanelSender(sender);
  if(!check.ok){
    const error = new Error(message);
    error.code='PANEL_SOURCE_REJECTED';error.sourceCheck=check;
    throw error;
  }
}


function serialize(fn) {
  const next = mutations.then(fn,fn);
  mutations = next.catch(() => {});
  return next;
}
async function readState() {
  const record = await chrome.storage.local.get(STORE_KEY);
  return ThreadLineCore.normalizedState(record[STORE_KEY]);
}
async function writeState(previous,next,reason,extra={}) {
  const preserve = !["observeChat", "acknowledgeProject"].includes(reason);
  if (!preserve) { await chrome.storage.local.set({...extra,[STORE_KEY]:next}); return; }
  const record = await chrome.storage.local.get(SNAPSHOT_KEY);
  const before = Array.isArray(record[SNAPSHOT_KEY]) ? record[SNAPSHOT_KEY] : [];
  // Snapshots store complete, *previous* states; rollback will not erase the undo history.
  const snapshots = [...before,{at:Date.now(),reason, state:previous}].slice(-ThreadLineBackup.SNAPSHOT_LIMIT);
  await chrome.storage.local.set({...extra,[SNAPSHOT_KEY]:snapshots,[STORE_KEY]:next});
}
async function mutate(action) {
  return serialize(async () => {
    await reconcileEvidenceLocked();
    const previous = await readState();
    await guardEvidenceMutationLocked(previous, action);
    if (action.expectedRevision !== undefined && action.expectedRevision !== previous.revision) {
      throw new Error("课题已在其他窗口更新，请刷新后重新审阅，避免覆盖新结论");
    }
    const changed = ThreadLineCore.apply(previous,action);
    await writeState(previous,changed.state,action.type);
    return changed;
  });
}
async function importBackup(json) {
  return serialize(async () => {
    const restored = ThreadLineBackup.parse(json);
    await reconcileEvidenceLocked();
    const previous = await readState();
    await guardEvidenceRestoreLocked(previous, restored);
    restored.revision = Math.max(previous.revision,restored.revision)+1;
    await writeState(previous,restored,"restoreImport");
    return {revision:restored.revision,projects:restored.projects.length, chats:Object.keys(restored.chats).length};
  });
}
async function restoreSnapshot(index) {
  return serialize(async () => {
    const record = await chrome.storage.local.get(SNAPSHOT_KEY);
    const snapshots = Array.isArray(record[SNAPSHOT_KEY]) ? record[SNAPSHOT_KEY] : [];
    if (!Number.isInteger(index) || index < 0 || index >= snapshots.length) throw new Error("快照不存在");
    await reconcileEvidenceLocked();
    const previous = await readState();
    const state = ThreadLineBackup.assertState(snapshots[index].state);
    await guardEvidenceRestoreLocked(previous, state);
    state.revision = Math.max(state.revision,previous.revision)+1;
    await writeState(previous,state,"restoreSnapshot");
    return {revision:state.revision};
  });
}
async function snapshot() {
  const [state,tabs,active,live] = await Promise.all([
    readFreshState(),
    chrome.tabs.query({url:["https://chatgpt.com/*","https://chat.openai.com/*"]}),
    chrome.tabs.query({active:true,lastFocusedWindow:true}),
    chrome.storage.session.get(null)
  ]);
  const liveByTab = {};
  for (const [key,value] of Object.entries(live)) if (key.startsWith("tl_live_")) liveByTab[key.slice(8)] = value;
  return {state, tabs:tabs.map(({id,url,title,active,windowId})=>({id,url,title,active,windowId})), activeTabId:active[0]?.id ?? null, liveByTab};
}
async function pageContext(sender, payload) {
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error("无法确认标签页");
  const href = ThreadLineCore.isChatURL(payload.href) ? payload.href : sender.tab.url;
  const key = ThreadLineCore.getChatKey(href,tabId);
  if (!key) return {key:null, project:null, chat:null};
  const stateBefore = await readFreshState();
  if (key.startsWith("chat:") && stateBefore.chats[`tab:${tabId}`]) {
    await mutate({type:"remapPending",from:`tab:${tabId}`,to:key,url:href});
  }
  const state = await readFreshState();
  const {project,chat} = ThreadLineCore.getContext(state,key);
  if (chat && payload.type === "OBSERVE" && ((payload.title && payload.title !== chat.title && !chat.label) || (href && href !== chat.url))) {
    await mutate({type:"observeChat",key,title:payload.title,url:href});
  }
  if (payload.type === "OBSERVE") {
    const status = {key, title:String(payload.title||"").slice(0,130), streaming:!!payload.streaming, updatedAt:Date.now()};
    await chrome.storage.session.set({[`tl_live_${tabId}`]:status});
    try { await serialize(() => ffObserveHook(tabId, status, key)); } catch {}
  }
  const newest = payload.type === "OBSERVE" ? await readFreshState() : state;
  const current = ThreadLineCore.getContext(newest,key);
  return {key, project:current.project, chat:current.chat};
}


const captureOwners=new Map();
async function beginCapture(tabId) {
  const tab=await chrome.tabs.get(tabId);
  const conversationId=ThreadLineCaptureCore.conversationId(tab?.url);
  if(!conversationId)throw new Error("请选择已保存且带 /c/ 地址的 ChatGPT 对话");
  const id="cap_"+crypto.randomUUID();
  const run={id,tabId,conversationId,url:tab.url,title:tab.title||"未命名对话",status:"capturing",createdAt:Date.now(),updatedAt:Date.now(),pageCount:0,messageCount:0,complete:false,mode:"",notice:"",error:""};
  await ThreadLineCaptureDB.putRun(run);
  await chrome.storage.session.set({[`${CAPTURE_PREFIX}${id}`]:{tabId,startedAt:Date.now()}});
  captureOwners.set(id,tabId);
  try {
    // Also works with ChatGPT tabs opened before the extension was installed.
    await chrome.scripting.executeScript({target:{tabId},files:["capture-main.js"],world:"MAIN"});
    await chrome.scripting.executeScript({target:{tabId},files:["capture-page.js"],world:"ISOLATED"});
    const reply=await chrome.tabs.sendMessage(tabId,{type:"TL_CAPTURE_START",id,conversationId});
    if(!reply?.ok)throw new Error(reply?.error||"无法与源标签页通讯");
  }catch(e){captureOwners.delete(id);await chrome.storage.session.remove(`${CAPTURE_PREFIX}${id}`);await ThreadLineCaptureDB.modifyRun(id,{status:"error",error:String(e.message||e)});}
  await chrome.storage.local.set({tl_last_capture_id:id});
  return {id};
}
async function receiveCapture(payload,sender){
  if(!sender.tab?.id)throw new Error("此消息只能由采集标签页提交");
  const run=await ThreadLineCaptureDB.getRun(payload.id);
  if(!run||run.tabId!==sender.tab.id||run.status!=="capturing")throw new Error("采集任务不存在或已结束");
  if(!ThreadLineCaptureCore.conversationId(sender.tab.url)||ThreadLineCaptureCore.conversationId(sender.tab.url)!==run.conversationId)throw new Error("源标签页已改变对话");
  switch(payload.type){
    case "CAPTURE_RESET":
      await ThreadLineCaptureDB.resetPages(run.id);
      await ThreadLineCaptureDB.modifyRun(run.id,{pageCount:0,messageCount:0});return {ok:true};
    case "CAPTURE_PAGE":{
      if(!Number.isInteger(payload.pageIndex)||payload.pageIndex<0||payload.pageIndex>2500||!Number.isInteger(payload.chunkIndex)||payload.chunkIndex<0||payload.chunkIndex>10000)throw new Error("分页序号错误");
      if(!Array.isArray(payload.messages)||payload.messages.length>20)throw new Error("消息批次不合法");
      const sanitized=ThreadLineCaptureCore.normalizePage(payload.messages,payload.pageIndex);
      await ThreadLineCaptureDB.putPage({id:run.id,pageIndex:payload.pageIndex,chunkIndex:payload.chunkIndex,messages:sanitized});return {ok:true};
    }
    case "CAPTURE_PROGRESS":
      await ThreadLineCaptureDB.modifyRun(run.id,{pageCount:Number(payload.pageCount)||0,messageCount:Number(payload.messageCount)||0,phase:String(payload.phase||"")});return {ok:true};
    case "CAPTURE_END":{
      const finished=await ThreadLineCaptureDB.modifyRun(run.id,{status:"done",complete:payload.complete===true,mode:String(payload.mode||""),pageCount:Number(payload.pageCount)||0,messageCount:Number(payload.count)||0,notice:String(payload.notice||"").slice(0,1200)});
      captureOwners.delete(run.id);await chrome.storage.session.remove(`${CAPTURE_PREFIX}${run.id}`);await markSuccess("capture");
      // Fork branches turn a completed capture into their completion evidence.
      try { await serialize(() => ffCaptureEnded(finished, sender.tab.id)); } catch {}
      return {ok:true};
    }
    case "CAPTURE_FAIL":
      await ThreadLineCaptureDB.modifyRun(run.id,{status:"error",error:String(payload.message||"采集失败").slice(0,1200)});captureOwners.delete(run.id);await chrome.storage.session.remove(`${CAPTURE_PREFIX}${run.id}`);return {ok:true};
    default:throw new Error("未知采集状态");
  }
}
async function openChatWithDraft(handoff,windowId,projectId){
  const text=String(handoff||"");
  if(new TextEncoder().encode(text).length>128*1024)throw new Error("接续材料超过 128 KiB，请缩小范围；未截断");
  if(!text)throw new Error("没有可用于接续的研究信息");
  const tab=await chrome.tabs.create({url:"https://chatgpt.com/",active:true,...(Number.isInteger(windowId)?{windowId}:{})});
  await chrome.storage.session.set({[`tl_handoff_${tab.id}`]:{text,projectId:projectId||null,createdAt:Date.now()}});
  if(projectId){
    const state=await readState();const project=ThreadLineCore.getProject(state,projectId);
    if(project?.stage==="active"){
      await mutate({type:"linkChat",key:`tab:${tab.id}`,projectId,title:"研究接续 · 新对话",url:tab.url||"https://chatgpt.com/"});
    }
  }
  chrome.tabs.sendMessage(tab.id,{type:"TL_HANDOFF_READY"}).catch(()=>{});
  // Close the global browser side panel in the same window, when supported.
  try{if(chrome.sidePanel.close)await chrome.sidePanel.close({windowId:tab.windowId});}catch{}
  return {tabId:tab.id,windowId:tab.windowId};
}

// ChatGPT web organization uses only visible UI on the user-selected source tab.
// Create a project in a separate helper tab so the source conversation stays intact.
const organizeLocks = new Set();
const ORG_LOCK_PREFIX = 'tl_org_lock_';
async function acquireOrganizeLock(key,run,action,tabId) {
  if(organizeLocks.has(key))throw new Error('该对话正在执行其他组织操作');
  const slot=`${ORG_LOCK_PREFIX}${key}`;
  const record=(await chrome.storage.session.get(slot))[slot];
  if(record){
    if(Date.now()-record.at<15*60*1000)throw new Error('上次网页操作仍未确认，请检查原标签页后再重试');
    // A suspended MV3 worker may have clicked the UI already. Persist uncertainty; never silently repeat.
    if(record.action==='archive')await ThreadLineCaptureDB.modifyRun(run.id,{archiveWeb:{status:'submitted_unverified',at:Date.now(),error:'后台在归档过程中中断，结果待核实'}});
    else await ThreadLineCaptureDB.modifyRun(run.id,{remoteProject:{status:'creation_unverified',name:record.name||'',at:Date.now(),error:'后台在创建/移动过程中中断，结果待核实'}});
    await chrome.storage.session.remove(slot);
    throw new Error('上次操作中途被中断，已记录为待核实。请检查 ChatGPT 后手动处理，避免重复操作');
  }
  await chrome.storage.session.set({[slot]:{at:Date.now(),tabId,runId:run.id,action,name:run.remoteProject?.name||''}});
  organizeLocks.add(key);
}
async function releaseOrganizeLock(key) {
  organizeLocks.delete(key);
  await chrome.storage.session.remove(`${ORG_LOCK_PREFIX}${key}`);
}

const delayOrg = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function waitOrgTab(tabId, timeoutMs=24000){
  const start=Date.now();
  while(Date.now()-start<timeoutMs){
    const tab=await chrome.tabs.get(tabId);
    if(tab.status==='complete'&&ThreadLineOrganizeCore.allowedChatUrl(tab.url))return tab;
    await delayOrg(220);
  }
  throw new Error('ChatGPT 项目助手标签页加载超时');
}
async function orgMessage(tabId, message){
  await chrome.scripting.executeScript({target:{tabId},files:['organize-core.js','organize-page.js']});
  const answer=await chrome.tabs.sendMessage(tabId,message);
  if(!answer?.ok)throw new Error(answer?.error||'ChatGPT 网页未完成此操作');
  return answer.data;
}
async function sourceForOrganization(run,tabId){
  if(!run||run.status!=='done')throw new Error('请先完成对话采集');
  if(run.tabId!==tabId)throw new Error('操作的不是采集来源标签页');
  const tab=await chrome.tabs.get(tabId);
  if(!ThreadLineOrganizeCore.allowedChatUrl(tab.url)||ThreadLineOrganizeCore.chatId(tab.url)!==run.conversationId)throw new Error('原研究对话已关闭或已切换，请重新打开来源对话');
  return tab;
}
async function organizeWeb(payload){
  if(!Number.isInteger(payload.tabId)||typeof payload.runId!=='string')throw new Error('无效的采集任务');
  const run=await ThreadLineCaptureDB.getRun(payload.runId);
  const source=await sourceForOrganization(run,payload.tabId);
  const key=run.conversationId;
  await acquireOrganizeLock(key,run,payload.action,source.id);
  try{
    if(payload.action==='archive'){
      if(run.archiveWeb?.status==='archived')return run.archiveWeb;
      let result;
      try{result=await orgMessage(source.id,{type:'TL_ORG_ARCHIVE',conversationId:key});}
      catch(error){
        const current=await chrome.tabs.get(source.id).catch(()=>null);
        const status=current && ThreadLineOrganizeCore.chatId(current.url)!==key?'submitted_unverified':'failed';
        const record={status,error:String(error.message||error),at:Date.now()};
        await ThreadLineCaptureDB.modifyRun(run.id,{archiveWeb:record});
        return record;
      }
      const record={status:result.status,at:Date.now()};
      await ThreadLineCaptureDB.modifyRun(run.id,{archiveWeb:record});
      if(record.status==="archived")await markSuccess("archive");
      return record;
    }
    if(payload.action!=='create_and_move')throw new Error('未知网页组织操作');
    const name=ThreadLineOrganizeCore.cleanText(payload.name,80);
    if(!ThreadLineOrganizeCore.validProjectName(name))throw new Error('请填写 2—80 字符的项目名称');
    if(run.remoteProject?.status==='creation_unverified')throw new Error('上次创建结果无法确认。请先打开网页版检查，避免重复创建项目。');
    let remote=run.remoteProject;
    let helperId=null;
    if(!remote?.id || remote.name!==name){
      const helper=await chrome.tabs.create({url:'https://chatgpt.com/',active:false,...(Number.isInteger(source.windowId)?{windowId:source.windowId}:{})});
      helperId=helper.id;
      try{
        await waitOrgTab(helperId);
        let created;
        try{created=await orgMessage(helperId,{type:'TL_ORG_CREATE',name});}
        catch(error){
          // A full navigation can end a content-script message while the project is created.
          const fallback=await chrome.tabs.get(helperId).catch(()=>null);
          const id=ThreadLineOrganizeCore.projectId(fallback?.url);
          if(!id){
            remote={name,status:'creation_unverified',error:String(error.message||error),helperTabId:helperId,at:Date.now()};
            await ThreadLineCaptureDB.modifyRun(run.id,{remoteProject:remote});
            return remote;
          }
          created={status:'created_navigation_verified',name,id,url:fallback.url};
        }
        if(!created?.id)throw new Error('新项目未返回有效项目标识');
        remote={name,id:created.id,url:created.url,status:'created_not_moved',at:Date.now(),reused:created.status==='existing'};
        await ThreadLineCaptureDB.modifyRun(run.id,{remoteProject:remote});
      }catch(error){
        remote={name,status:'creation_unverified',error:String(error.message||error),helperTabId:helperId,at:Date.now()};
        await ThreadLineCaptureDB.modifyRun(run.id,{remoteProject:remote});
        return remote;
      }
    }
    let moved;
    try{moved=await orgMessage(source.id,{type:'TL_ORG_MOVE',conversationId:key,name:remote.name,projectId:remote.id});}
    catch(error){
      remote={...remote,status:'created_not_moved',error:String(error.message||error),helperTabId:helperId,at:Date.now()};
      await ThreadLineCaptureDB.modifyRun(run.id,{remoteProject:remote});
      return remote;
    }
    remote={...remote,status:moved.status==='moved'||moved.status==='already_in_project'?'moved':'move_unverified',error:'',at:Date.now()};
    await ThreadLineCaptureDB.modifyRun(run.id,{remoteProject:remote});
    if(remote.status==='moved')await markSuccess("move");
    if(helperId && remote.status==='moved')await chrome.tabs.remove(helperId).catch(()=>{});
    return remote;
  }finally{await releaseOrganizeLock(key);}
}
// Called during normal UI activity too: MV3 service workers can restart without onStartup.
async function recoverCaptures(closedTabId=null) {
  const all=await chrome.storage.session.get(null);
  for (const [key,value] of Object.entries(all)) {
    if (!key.startsWith(CAPTURE_PREFIX)) continue;
    const id=key.slice(CAPTURE_PREFIX.length);
    const run=await ThreadLineCaptureDB.getRun(id);
    if (!run || run.status !== 'capturing') { await chrome.storage.session.remove(key); continue; }
    const tab = await chrome.tabs.get(value.tabId).catch(()=>null);
    if (closedTabId===value.tabId || !tab || Date.now() - (run.updatedAt||run.createdAt) > 15*60*1000) {
      await ThreadLineCaptureDB.modifyRun(id,{status:'error',error:!tab?'来源对话标签页已关闭':'采集中断或超时，请重新采集'});
      await chrome.storage.session.remove(key);
      captureOwners.delete(id);
    }
  }
}
const PAGE_HEALTH_KEY = 'tl_health_successes';
async function markSuccess(kind) {
  const record=await chrome.storage.local.get(PAGE_HEALTH_KEY);
  const prev=record[PAGE_HEALTH_KEY]||{};
  await chrome.storage.local.set({[PAGE_HEALTH_KEY]:{...prev,[kind]:Date.now()}});
}
async function inspectTab(tabId) {
  if(!Number.isInteger(tabId)) throw new Error('请先打开 ChatGPT 标签页');
  const tab=await chrome.tabs.get(tabId);
  if(!ThreadLineCore.isChatURL(tab.url)) throw new Error('只能自检 ChatGPT 网页');
  try {
    const result=await chrome.tabs.sendMessage(tabId,{type:'TL_HEALTH_CHECK'});
    if (result?.ok && result.data) return result.data;
  } catch {}
  // Content scripts in tabs opened before an extension upgrade may not handle the new probe.
  await chrome.scripting.executeScript({target:{tabId},files:['vendor/shadow-helpers.js','selectors.js','content.js']});
  const result=await chrome.tabs.sendMessage(tabId,{type:'TL_HEALTH_CHECK'});
  if (result?.ok && result.data) return result.data;
  throw new Error('未能完成只读自检');
}
// P1 only: separate FF storage and explicit local opt-in; no browser automation.
const FF_ENABLED_KEY = "tl_ff_enabled_v1";
// P2: dual-branch orchestration. Tab ids are transient pointers; the durable
// identity lives in ff-db attempt evidence. This layer only prefills through
// the production handoff path and observes read-only signals: it never clicks
// Send, never re-submits a form, and never replays an unconfirmed operation.
const FF_BIND_PREFIX = "tl_ff_bind_";
const FF_SIG_PREFIX = "tl_ff_sig_";
async function ffBinding(tabId) {
  const r = await chrome.storage.session.get(`${FF_BIND_PREFIX}${tabId}`);
  return r[`${FF_BIND_PREFIX}${tabId}`] || null;
}
async function ffSaveBinding(tabId, binding) {
  await chrome.storage.session.set({[`${FF_BIND_PREFIX}${tabId}`]: binding});
}
async function ffClearBinding(tabId) {
  await chrome.storage.session.remove(`${FF_BIND_PREFIX}${tabId}`, `${FF_SIG_PREFIX}${tabId}`);
}
async function ffSignals(tabId) {
  const r = await chrome.storage.session.get(`${FF_SIG_PREFIX}${tabId}`);
  return r[`${FF_SIG_PREFIX}${tabId}`] || {sawStreaming:false, lastABytes:-1, stableSince:0, signals:[]};
}
function ffExtractFromCapture(pages) {
  const rows = ThreadLineCaptureCore.assemble(pages || []);
  const users = rows.filter(m => m.role === "user");
  const assistants = rows.filter(m => m.role === "assistant");
  return {taskCount:users.length,message:assistants.at(-1) || null,
    reply:assistants.length ? assistants[assistants.length - 1].content : "",
    // The session data's own end marker on the final assistant message maps to
    // the attested "generation" kind (generation ended per session data).
    lastFinished:assistants.length ? assistants[assistants.length - 1].finished === true : false};
}
async function ffAdvance(binding, {status, phase, updates = {}, reason = "", operationId, manualNewAttempt = false}) {
  const existing = await ThreadLineFFDB.read(binding.experimentId);
  if (!existing) return null;
  const attempt = existing.branches[binding.branch]?.attempts.find(a => a.id === binding.attemptId);
  if (!attempt || attempt.status !== "pending") return null;
  await ThreadLineFFCore.verifyFrozen(existing.frozen);
  const event = {branch:binding.branch, expectedRevision:existing.revision,
    operationId, attemptId:binding.attemptId, status, phase, reason,
    evidence:{...attempt.evidence, ...updates}, manualNewAttempt};
  return ThreadLineFFDB.update(existing.id, existing.revision,
    record => ThreadLineFFCore.advance(record, event));
}
async function ffSeedHandoff(tabId, text) {
  await chrome.storage.session.set({[`tl_handoff_${tabId}`]:{text, createdAt:Date.now()}});
  chrome.tabs.sendMessage(tabId, {type:"TL_HANDOFF_READY"}).catch(()=>{});
}
async function ffHandoffAcked(tabId) {
  const bind = await ffBinding(tabId);
  if (!bind) return;
  const acks = bind.acks || 1;
  // Called from the HANDOFF_ACK critical section: never serialize here again.
  await ffAdvance(bind, {status:"pending", phase:"awaiting_send",
    operationId:`${bind.operationId}_${bind.branch}_ack${acks}`,
    updates:{inputLevel:"exact", prefill:acks > 1 ? "reacked" : "exact_ack"},
    reason:"handoff ACK: exact composer readback"});
}
async function ffObserveHook(tabId, status, key) {
  const bind = await ffBinding(tabId);
  if (!bind) return;
  const sig = await ffSignals(tabId);
  if (typeof key === "string" && key.startsWith("chat:")) {
    const conversationId = key.slice(5);
    const existing = await ThreadLineFFDB.read(bind.experimentId);
    const attempt = existing?.branches[bind.branch]?.attempts.find(a => a.id === bind.attemptId);
    if (attempt && attempt.status === "pending" && !attempt.evidence?.sessionId) {
      await ffAdvance(bind, {status:"pending", phase:"generating",
        operationId:`${bind.operationId}_conv_${conversationId}`,
        updates:{conversationId, sessionId:conversationId, sentAt:Date.now()},
        reason:"conversation URL bound to branch"});
      // Post-send input classification from the conversation's own rendering.
      chrome.tabs.sendMessage(tabId, {type:"TL_FF_READ_USER_MESSAGE"}).then(async res => {
        if (!res?.ok || typeof res.data?.text !== "string") return;
        await serialize(async () => {
          const row = await ThreadLineFFDB.read(bind.experimentId);
          const att = row?.branches[bind.branch]?.attempts.find(a => a.id === bind.attemptId);
          if (!att || att.status !== "pending") return;
          const level = await ThreadLineFFCore.classify(row.frozen.text, res.data.text,
            {trusted:true, complete:res.data.complete === true});
          await ffAdvance(bind, {status:"pending", phase:"generating",
            operationId:`${bind.operationId}_cls_${conversationId}`,
            updates:{inputLevel:level.level, sentBytes:res.data.bytes || 0},
            reason:"post-send user message classification: " + level.level});
        });
      }).catch(()=>{});
    }
  }
  if (status.streaming) sig.sawStreaming = true;
  else if (sig.sawStreaming && !sig.signals.includes("generation")) sig.signals.push("generation");
  if (Number.isSafeInteger(status.assistantBytes) && status.assistantBytes > 0) {
    if (status.assistantBytes !== sig.lastABytes) { sig.lastABytes = status.assistantBytes; sig.stableSince = Date.now(); }
    else if (!sig.signals.includes("stable") && Date.now() - sig.stableSince >= 5000) sig.signals.push("stable");
  }
  await chrome.storage.session.set({[`${FF_SIG_PREFIX}${tabId}`]: sig});
}
async function ffCaptureEnded(run, tabId) {
  const bind = await ffBinding(tabId);
  if (!bind) return;
  const sig = await ffSignals(tabId);
  const signals = [...new Set([...(sig.signals || []), "final"])];
  const pages = await ThreadLineCaptureDB.pages(run.id);
  const {taskCount, reply, lastFinished, message} = ffExtractFromCapture(pages);
  const provenance = {captureRunId:run.id,messageId:message?.id || null,hasNonText:!!message?.hasNonText,
    captureMode:run.mode || "unknown",captureNotice:run.notice || "",sourceUrl:run.url || null};
  if (lastFinished && !signals.includes("generation")) signals.push("generation");
  const existing = await ThreadLineFFDB.read(bind.experimentId);
  const attempt = existing?.branches[bind.branch]?.attempts.find(a => a.id === bind.attemptId);
  if (!attempt || attempt.status !== "pending") return;
  const inputLevel = attempt.evidence?.inputLevel;
  const canComplete = run.complete === true && signals.length >= 2 &&
    typeof attempt.evidence?.sessionId === "string" &&
    ["exact", "canonical_equivalent"].includes(inputLevel) &&
    taskCount === 1 && reply.length > 0;
  if (canComplete) {
    const sentAt = attempt.evidence.sentAt;
    const timing = {replyBytes:ThreadLineFFCore.byteLength(reply),
      sentMs:Number.isFinite(sentAt) ? Date.now() - sentAt : null};
    await ffAdvance(bind, {status:"done", phase:"capturing",
      operationId:`${bind.operationId}_${bind.branch}_done`,
      reason:"capture completed; completion contract satisfied",
      updates:{...provenance,captureComplete:true, persisted:true, reply, taskCount,
        endSignals:signals, capturedAt:Date.now(), timing}});
  } else {
    await ffAdvance(bind, {status:"pending", phase:"capturing",
      operationId:`${bind.operationId}_captry_${run.id}`,
      reason:"capture finished but completion contract unmet; branch stays pending",
      updates:{...provenance,captureComplete:run.complete === true, persisted:true, reply, taskCount, endSignals:signals}});
  }
}
async function ffRecoverBindings() {
  // Session bindings die with the browser; durable attempt evidence (tabId,
  // conversationId) does not. Re-bind conversation identity for tabs that
  // already sent. Never re-seeds a prefill automatically.
  const rows = await ThreadLineFFDB.list();
  for (const row of rows) {
    for (const branch of ["A", "B"]) {
      const attempt = row.branches[branch].attempts.at(-1);
      if (!attempt || attempt.status !== "pending" || attempt.evidence?.sessionId) continue;
      const tabId = attempt.evidence?.tabId;
      if (!Number.isInteger(tabId)) continue;
      let tab;
      try { tab = await chrome.tabs.get(tabId); } catch { continue; }
      const conv = ThreadLineCaptureCore.conversationId(tab.url || "");
      if (!conv || attempt.evidence?.conversationId === conv) continue;
      await serialize(() => ffAdvance({experimentId:row.id, branch, attemptId:attempt.id},
        {status:"pending", phase:"generating", operationId:`${attempt.id}_recover_${conv}`,
         updates:{conversationId:conv, sessionId:conv},
         reason:"startup recovery: conversation identity re-bound from durable tab evidence"})).catch(()=>{});
    }
  }
}
function trustedFFSender(sender) {
  const own = chrome.runtime.getURL("ff.html");
  return !!(sender && sender.id === chrome.runtime.id && sender.url === own &&
    (!sender.tab || sender.tab.url === own));
}
async function ffEnabled() {
  const state = await chrome.storage.local.get(FF_ENABLED_KEY);
  return state[FF_ENABLED_KEY] === true;
}
async function handleFF(payload, sender) {
  if (payload.type === "FF_SUMMARY") {
    // Read-only progress digest for the sidebar panel: no experiment content,
    // no evidence, no replies - only labels, statuses and phases.
    const panelURL = chrome.runtime.getURL("panel.html");
    const trustedPanel = !!(sender && sender.id === chrome.runtime.id &&
      sender.url === panelURL && (!sender.tab || sender.tab.url === panelURL));
    if (!trustedPanel) throw new Error("only the panel may read the Fork progress summary");
    if (!await ffEnabled()) return {enabled:false};
    const rows = await ThreadLineFFDB.list();
    const latest = rows.sort((a,b)=>b.createdAt-a.createdAt)[0];
    if (!latest) return {enabled:true, latest:null};
    return {enabled:true, latest:{id:latest.id,
      branchCount:Object.keys(latest.branches).length,
      branches:Object.entries(latest.branches).map(([label,b]) =>
        ({label, status:b.status, phase:b.phase}))}};
  }
  if (!trustedFFSender(sender)) throw new Error("only Fork extension page may access FF data");
  if (payload.type === "FF_STATUS")
    return {enabled:await ffEnabled(), phase:"core_only", sendsAutomatically:false};
  if (payload.type === "FF_SET_ENABLED") {
    if (typeof payload.enabled !== "boolean" || payload.ack !== "local-only-no-send")
      throw new Error("explicit local-only acknowledgement required");
    return serialize(async () => {
      await chrome.storage.local.set({[FF_ENABLED_KEY]:payload.enabled});
      return {enabled:payload.enabled};
    });
  }
  if (!await ffEnabled()) throw new Error("Fork Beta is disabled");
  if (payload.type === "FF_CREATE") {
    // The caller owns a stable operation ID for this deliberate create action.
    // A lost acknowledgement must not silently create a second experiment.
    return serialize(async () => {
      // The enabled flag must be checked within the serialized critical
      // section too. An earlier pre-queue read can become stale behind OFF.
      if (!await ffEnabled()) throw new Error("Fork Beta is disabled");
      const operationId = payload.operationId;
      if (typeof operationId !== "string" ||
        !/^[a-zA-Z0-9_-]{6,100}$/.test(operationId))
        throw new Error("explicit create operation ID required");
      const branchCount = payload.branchCount === undefined ? 2 : payload.branchCount;
      const frozen = await ThreadLineFFCore.freeze(payload.w0, payload.p);
      const id = "ff_" + operationId;
      const record = ThreadLineFFCore.newExperiment(frozen, id, branchCount);
      record.createOperationId = operationId;
      let saved = record;
      try {
        await ThreadLineFFDB.create(record);
      } catch (error) {
        const existing = await ThreadLineFFDB.read(id);
        if (!existing) throw error; // Storage failure, not a duplicate.
        await ThreadLineFFCore.verifyFrozen(existing.frozen);
        if (existing.createOperationId !== operationId ||
          existing.frozen.w0 !== frozen.w0 || existing.frozen.p !== frozen.p)
          throw new Error("create operation ID reused with different input");
        saved = existing;
      }
      return {id, revision:saved.revision, bytes:saved.frozen.bytes,
        sha256:saved.frozen.textHashes.frozen, createdAt:saved.createdAt};
    });
  }
  if (payload.type === "FF_LIST") {
    const rows = await ThreadLineFFDB.list();
    return rows.map(x => {
      const statuses = Object.fromEntries(Object.entries(x.branches || {})
        .map(([label,b]) => [label,b.status]));
      return {id:x.id, revision:x.revision, createdAt:x.createdAt,
        bytes:x.frozen?.bytes, branchCount:Object.keys(statuses).length,
        statuses, statusA:x.branches?.A?.status, statusB:x.branches?.B?.status};
    }).sort((a,b) => b.createdAt-a.createdAt);
  }
  if (payload.type === "FF_READ") {
    const row = await ThreadLineFFDB.read(payload.id);
    if (!row) throw new Error("experiment not found");
    await ThreadLineFFCore.verifyFrozen(row.frozen);
    return row;
  }
  if (payload.type === "FF_RECORD") {
    // P1 has no way to establish a trusted final message or a completed send.
    // Never allow the UI to mark a branch done; that authority belongs to P2/P3.
    if (!["pending", "failed", "unknown"].includes(payload.status))
      throw new Error("completion is not available in P1");
    if (payload.evidence !== undefined && (payload.evidence === null ||
      Array.isArray(payload.evidence) || typeof payload.evidence !== "object" ||
      Object.keys(payload.evidence).length > 0))
      throw new Error("P1 cannot accept webpage evidence");
    return serialize(async () => {
      if (!await ffEnabled()) throw new Error("Fork Beta is disabled");
      const existing = await ThreadLineFFDB.read(payload.experimentId);
      if (!existing) throw new Error("experiment not found");
      await ThreadLineFFCore.verifyFrozen(existing.frozen);
      return ThreadLineFFDB.update(existing.id, payload.expectedRevision,
        record => ThreadLineFFCore.advance(record, {
          branch:payload.branch, expectedRevision:payload.expectedRevision,
          operationId:payload.operationId, attemptId:payload.attemptId,
          status:payload.status, phase:payload.phase, reason:payload.reason || "",
          evidence:{}, manualNewAttempt:payload.manualNewAttempt === true
        }));
    });
  }
  if (payload.type === "FF_LAUNCH") {
    // Dual-branch launch: creates two plain new-chat tabs (inactive, no focus
    // steal) and seeds the production handoff prefill. Prefill-only by
    // construction: this path contains no click, no submit, and no send.
    if (typeof payload.operationId !== "string" ||
      !/^[a-zA-Z0-9_-]{6,100}$/.test(payload.operationId))
      throw new Error("explicit launch operation ID required");
    return serialize(async () => {
      if (!await ffEnabled()) throw new Error("Fork Beta is disabled");
      let record = await ThreadLineFFDB.read(payload.experimentId);
      if (!record) throw new Error("experiment not found");
      await ThreadLineFFCore.verifyFrozen(record.frozen);
      if (record.branches.A.status === "done" || record.branches.B.status === "done")
        throw new Error("a completed branch cannot be relaunched; create a new experiment");
      const tabIds = {}, attemptIds = {}, terminal = {};
      for (const branch of Object.keys(record.branches)) {
        const attempts = record.branches[branch].attempts;
        const active = attempts.at(-1);
        if (active && active.status === "pending")
          throw new Error("branch " + branch + " is still running");
        terminal[branch] = attempts.length > 0;
      }
      for (const branch of Object.keys(record.branches)) {
        // Create the tab idle, then navigate: a create-with-URL navigation can
        // start before observers attach, escaping interception and injection.
        const tab = await chrome.tabs.create({active:false});
        await chrome.tabs.update(tab.id, {url:"https://chatgpt.com/"});
        const attemptId = "att_" + crypto.randomUUID();
        tabIds[branch] = tab.id;
        attemptIds[branch] = attemptId;
        await ffSaveBinding(tab.id, {experimentId:record.id, branch, attemptId,
          operationId:payload.operationId, acks:1, tabId:tab.id, createdAt:Date.now()});
        await chrome.storage.session.set({[`tl_handoff_${tab.id}`]:
          {text:record.frozen.text, createdAt:Date.now()}});
        const terminalBranch = terminal[branch];
        record = await ThreadLineFFDB.update(record.id, record.revision, r =>
          ThreadLineFFCore.advance(r, {branch, expectedRevision:r.revision,
            operationId:payload.operationId + "_" + branch,
            attemptId, status:"pending", phase:"created",
            reason:terminalBranch ? "explicit re-launch after terminal state"
              : "P2 launch: plain new-chat tab created",
            evidence:{tabId:tab.id}, manualNewAttempt:terminalBranch}));
      }
      for (const branch of Object.keys(record.branches))
        ffSeedHandoff(tabIds[branch], record.frozen.text);
      return {tabIds, attemptIds, revision:record.revision,
        branchCount:Object.keys(record.branches).length};
    });
  }
  if (payload.type === "FF_REPREFILL") {
    // User-initiated re-prefill of the same branch after an unconfirmed state
    // (browser restart cleared the one-shot session intent). Explicit user
    // action only: the extension never re-prefills on its own.
    if (typeof payload.operationId !== "string" ||
      !/^[a-zA-Z0-9_-]{6,100}$/.test(payload.operationId))
      throw new Error("explicit re-prefill operation ID required");
    return serialize(async () => {
      if (!await ffEnabled()) throw new Error("Fork Beta is disabled");
      const existing = await ThreadLineFFDB.read(payload.experimentId);
      if (!existing) throw new Error("experiment not found");
      // K=2-4 (live K=4 finding): every branch of THIS experiment is
      // addressable; a hardcoded A/B list made C/D unreachable.
      if (!Object.prototype.hasOwnProperty.call(existing.branches, payload.branch))
        throw new Error("invalid branch");
      const attempt = existing.branches[payload.branch].attempts.at(-1);
      if (!attempt || attempt.status !== "pending" || !Number.isInteger(attempt.evidence?.tabId))
        throw new Error("no running branch attempt to re-prefill");
      const tabId = attempt.evidence.tabId;
      let bind = await ffBinding(tabId);
      if (!bind || bind.experimentId !== existing.id || bind.branch !== payload.branch) {
        let tab;
        try { tab = await chrome.tabs.get(tabId); }
        catch { throw new Error("branch tab no longer exists; launch again"); }
        if (!/^https:\/\/chatgpt\.com\/?$/.test(tab.url || ""))
          throw new Error("branch tab already left the new-chat page; check its conversation first");
        bind = {experimentId:existing.id, branch:payload.branch, attemptId:attempt.id,
          operationId:payload.operationId, acks:1, tabId, createdAt:Date.now()};
      }
      const acks = (bind.acks || 1) + 1;
      await ffSaveBinding(tabId, {...bind, acks});
      await ffSeedHandoff(tabId, existing.frozen.text);
      return {tabId, acks};
    });
  }
  if (payload.type === "FF_CAPTURE") {
    return serialize(async () => {
      if (!await ffEnabled()) throw new Error("Fork Beta is disabled");
      const existing = await ThreadLineFFDB.read(payload.experimentId);
      if (!existing) throw new Error("experiment not found");
      // K=2-4 (live K=4 finding): capture must be addressable for every
      // branch; the previous A/B guard made C/D completion impossible.
      if (!Object.prototype.hasOwnProperty.call(existing.branches, payload.branch))
        throw new Error("invalid branch");
      const attempt = existing.branches[payload.branch].attempts.at(-1);
      if (!attempt || attempt.status !== "pending" ||
        !Number.isInteger(attempt.evidence?.tabId) || !attempt.evidence.sessionId)
        throw new Error("branch has no bound conversation to capture");
      const run = await beginCapture(attempt.evidence.tabId);
      return {runId:run.id};
    });
  }
  if (payload.type === "FF_COMPARE") {
    // Blind X/Y mapping: only after BOTH branches are done with verified
    // input and complete captures. The mapping is a pure function of the
    // recorded seed, so exports can be independently recomputed.
    if (typeof payload.operationId !== "string" ||
      !/^[a-zA-Z0-9_-]{6,100}$/.test(payload.operationId))
      throw new Error("explicit comparison operation ID required");
    return serialize(async () => {
      if (!await ffEnabled()) throw new Error("Fork Beta is disabled");
      const existing = await ThreadLineFFDB.read(payload.experimentId);
      if (!existing) throw new Error("experiment not found");
      await ThreadLineFFCore.verifyFrozen(existing.frozen);
      if (existing.decision?.mapping) return existing.decision;
      if (!ThreadLineFFCore.eligibleForComparison(existing))
        throw new Error("both branches must be done with verified input and captures");
      const mapping = await ThreadLineFFCore.assignMapping(existing, payload.operationId);
      // Equal-budget parity is defined by CONFIGURATION equality across
      // branches (model/effort/tools checks), NOT by wall-clock timing:
      // human waiting time must not influence the comparison.
      const configs = [];
      const timings = {};
      for (const [label, branch] of Object.entries(existing.branches)) {
        configs.push(JSON.stringify(branch.isolation?.checks || {}));
        const ev = branch.attempts.at(-1).evidence || {};
        timings[label] = {sentMs:Number.isFinite(ev.timing?.sentMs) ? ev.timing.sentMs : null,
          replyBytes:Number.isSafeInteger(ev.timing?.replyBytes) ? ev.timing.replyBytes : null};
      }
      const budgetParity = configs.every(c => c === configs[0]);
      const saved = await ThreadLineFFDB.update(existing.id, existing.revision,
        record => ({...record, decision:{...mapping, budgetParity, timings},
          revision:record.revision + 1}));
      return saved.decision;
    });
  }
  if (payload.type === "FF_VERDICT") {
    return serialize(async () => {
      if (!await ffEnabled()) throw new Error("Fork Beta is disabled");
      // Server-side calibration gate: the submitting Fork page's tab must
      // hold a fresh passing calibration record.
      if (!Number.isInteger(sender.tab?.id))
        throw new Error("the Fork page must be opened as a tab for verdicts");
      const cal = await chrome.storage.session.get(`tl_ff_cal_${sender.tab.id}`);
      const calRecord = cal[`tl_ff_cal_${sender.tab.id}`];
      if (!calRecord || Date.now() - calRecord.passedAt > 3600000)
        throw new Error("verdict requires a passing calibration first");
      const existing = await ThreadLineFFDB.read(payload.experimentId);
      if (!existing) throw new Error("experiment not found");
      if (!existing.decision?.mapping) throw new Error("no comparison mapping assigned yet");
      const verdict = ThreadLineFFCore.recordVerdict(existing.decision, {
        preference:payload.preference, criteria:payload.criteria,
        confidence:payload.confidence, notes:payload.notes || ""});
      const saved = await ThreadLineFFDB.update(existing.id, existing.revision,
        record => ({...record, decision:{...record.decision, verdict},
          revision:record.revision + 1}));
      return saved.decision;
    });
  }
  if (payload.type === "FF_EXPORT") {
    // Read-only, credential-free by construction; export only, never import.
    const existing = await ThreadLineFFDB.read(payload.experimentId);
    if (!existing) throw new Error("experiment not found");
    await ThreadLineFFCore.verifyFrozen(existing.frozen);
    return ThreadLineFFCore.exportSnapshot(existing);
  }
  if (payload.type === "FF_IMPORT") {
    // Validated import: hashes recomputed, decision seed re-derived, and the
    // target ID must not collide. Import never mutates existing experiments.
    return serialize(async () => {
      if (!await ffEnabled()) throw new Error("Fork Beta is disabled");
      const validated = await ThreadLineFFCore.validateImport(payload.snapshot);
      const existing = await ThreadLineFFDB.read(validated.id);
      if (existing) throw new Error("an experiment with this ID already exists");
      const record = {...validated,
        createOperationId:payload.snapshot.experiment.createOperationId ||
          "import_" + crypto.randomUUID(),
        createdAt:Number.isSafeInteger(payload.snapshot.experiment.createdAt)
          ? payload.snapshot.experiment.createdAt : Date.now()};
      await ThreadLineFFDB.createImported(record);
      return {id:record.id, revision:record.revision,
        branchCount:record.branchCount};
    });
  }
  if (payload.type === "FF_CALIBRATION") {
    // Scoring happens inside ff-core; expected answers only surface in the result.
    const result = ThreadLineFFCore.judgeCalibration(payload.responses);
    // A pass is recorded against the Fork page's tab and expires after an
    // hour: verdicts require a fresh server-side calibration record, not a
    // UI-only gate.
    if (result.pass && Number.isInteger(sender.tab?.id))
      await chrome.storage.session.set(
        {[`tl_ff_cal_${sender.tab.id}`]:{passedAt:Date.now()}});
    return result;
  }
  throw new Error("unknown Fork message type");
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  recoverCaptures().catch(()=>{});
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(() => {});
  ffRecoverBindings().catch(()=>{});
  consumeAllPendingProjections().catch(()=>{});
});
chrome.tabs.onUpdated.addListener(async(tabId,change)=>{
  if(change.status!=="complete")return;
  try{const r=await chrome.storage.session.get(`tl_handoff_${tabId}`);if(r[`tl_handoff_${tabId}`])await chrome.tabs.sendMessage(tabId,{type:"TL_HANDOFF_READY"});}catch{}
});
chrome.tabs.onRemoved.addListener((tabId) => {
  recoverCaptures(tabId).catch(()=>{});
  chrome.storage.session.remove([`tl_live_${tabId}`,`tl_handoff_${tabId}`]).catch(() => {});
  for(const [id,owner] of captureOwners)if(owner===tabId)captureOwners.delete(id);
  // A closed Fork branch tab becomes an unknown branch. Never auto-replays.
  serialize(async () => {
    const bind = await ffBinding(tabId);
    if (!bind) return;
    await ffClearBinding(tabId);
    const existing = await ThreadLineFFDB.read(bind.experimentId);
    const attempt = existing?.branches[bind.branch]?.attempts.find(a => a.id === bind.attemptId);
    if (!attempt || attempt.status !== "pending") return;
    await ffAdvance(bind, {status:"unknown", phase:attempt.phase,
      operationId:`${bind.operationId}_closed_${tabId}`,
      reason:"branch tab closed before completion; no replay without explicit user action"});
  }).catch(()=>{});
});
/* ---- Evidence store (S0a prototype, plan §十一.6) -----------------------
 * The service worker is the only evidence writer. Every mutating request is
 * validated and hashed (evidence-core) BEFORE a single readwrite
 * transaction applies it (evidence-db), serialized on the same queue the
 * rest of the worker uses. Extension pages only send commands. */
let evidenceDbPromise = null;
function evidenceDb() {
  if (!evidenceDbPromise) evidenceDbPromise = ThreadLineEvidenceDB.open();
  return evidenceDbPromise;
}
const EVIDENCE_SUMMARY_PREFIX = "tl_evidence_summary_";
let evidenceWorkflowsInstance;
function evidenceRows(state,id) {
  return Object.values(state.conclusions).filter(c=>c.projectId===id).map(c=>({conclusion:c,current:state.versions[c.currentVersionId],
    versions:Object.values(state.versions).filter(v=>v.conclusionId===c.id).map(v=>v.id),
    fragments:Object.values(state.links).filter(l=>l.versionId===c.currentVersionId).map(l=>({...state.sources[l.sourceId],relation:l.relation}))}));
}
function evidenceStateAfter(state,plan) {
  if(plan.replay)return state;
  const next=structuredClone(state),w=plan.writes;
  for(const [store,ids] of Object.entries(w.deleteIds||{}))for(const id of ids)delete next[store][id];
  for(const [store,single,bulk] of [["conclusions","conclusion","bulkConclusions"],["versions","version","bulkVersions"],["sources",null,"bulkSources"],["links",null,"bulkLinks"]]) {
    if(single&&w[single])next[store][w[single].id]=w[single];
    for(const row of [...(w[bulk]||[]),...(!single?w[store]||[]:[])])next[store][row.id]=row;
  }
  for(const operation of w.redactedOperations||[])next.operations[operation.operationId]=operation;
  next.projects[w.project.projectId]=w.project;next.operations[w.ledger.operationId]=w.ledger;return next;
}
async function evidenceBudget(state,plan) {
  if(plan.replay)return;
  const next=evidenceStateAfter(state,plan);
  if(ThreadLineEvidenceCore.bytes(JSON.stringify(next))>100*1024*1024)throw Error("证据库超过 100 MiB 产品预算，请先备份并整理；未执行写入");
  // The same validator guards writes and imports, so saved metadata stays exportable.
  if(!plan.writes.project.deleted)await ThreadLineEvidenceCore.validateExportPackage(ThreadLineEvidenceCore.exportPackage(next,plan.writes.project.projectId));
}
function evidenceWorkflows() {
  if(!evidenceWorkflowsInstance)evidenceWorkflowsInstance=ThreadLineEvidenceWorkflows.create({chrome,Core:ThreadLineEvidenceCore,DB:ThreadLineEvidenceDB,
    Lifecycle:ThreadLineEvidenceLifecycle,Source:ThreadLineEvidenceSource,Research:ThreadLineResearchCore,TopicCore:ThreadLineCore,
    CaptureDB:{getRun:(...args)=>ThreadLineCaptureDB.getRun(...args),pages:(...args)=>ThreadLineCaptureDB.pages(...args)},
    CaptureCore:{assemble:(...args)=>ThreadLineCaptureCore.assemble(...args)},FFDB:{read:(...args)=>ThreadLineFFDB.read(...args)},db:evidenceDb,serialize,
    loadAuthority:loadEvidenceAuthorityLocked,reconcile:reconcileEvidenceLocked,rows:evidenceRows,budget:evidenceBudget});
  return evidenceWorkflowsInstance;
}
function evidenceUnavailable(detail) {
  return new Error("证据权威库缺失或不完整，已停止使用旧结论：" + detail + "。请保留当前数据并检查备份。");
}
/* Only call Locked functions inside serialize. Never acquire the queue twice.
 * Persisted summaries and topic markers detect a missing/replaced authority
 * store; they are never used to reconstruct evidence or permit legacy edits. */
async function loadEvidenceAuthorityLocked() {
  await evidenceWorkflows().cleanupPending();
  const db = await evidenceDb();
  const state = await ThreadLineEvidenceDB.snapshot(db);
  const local = await chrome.storage.local.get(null);
  const topic = ThreadLineCore.normalizedState(local[STORE_KEY]);
  const taken = new Set(Object.values(state.projects).filter(p => p.takeover && !p.deleted).map(p => p.projectId));
  for (const c of Object.values(state.conclusions)) {
    taken.add(c.projectId);
    const version = state.versions[c.currentVersionId];
    if (!state.projects[c.projectId] || !version || version.conclusionId !== c.id)
      throw evidenceUnavailable("结论版本或所属课题记录缺失");
  }
  const sourceCounts = new Map();
  for (const l of Object.values(state.links)) sourceCounts.set(l.versionId, (sourceCounts.get(l.versionId) || 0) + 1);
  for (const v of Object.values(state.versions)) {
    if (!state.conclusions[v.conclusionId]) throw evidenceUnavailable("版本缺少所属结论");
    const count = sourceCounts.get(v.id) || 0;
    if ((v.changeType === "create" && !count) || (v.sourceCount !== undefined &&
        (!Number.isSafeInteger(v.sourceCount) || v.sourceCount !== count)))
      throw evidenceUnavailable("版本依据链接缺失或数量不一致");
  }
  for (const l of Object.values(state.links))
    if (!state.versions[l.versionId] || !state.sources[l.sourceId])
      throw evidenceUnavailable("依据链接或原文片段缺失");
  const markers = topic.projects.filter(p => p.evidenceTakeover).map(p =>
    ({id:p.id,revision:p.evidenceProjectionRevision || 0}));
  for (const [key,value] of Object.entries(local))
    if (key.startsWith(EVIDENCE_SUMMARY_PREFIX) && value?.evidenceRevision > 0)
      markers.push({id:key.slice(EVIDENCE_SUMMARY_PREFIX.length),revision:value.evidenceRevision});
  for (const marker of markers) {
    const p = state.projects[marker.id];
    if (p?.deleted) continue;
    if (!p || !Number.isSafeInteger(p.evidenceRevision) || p.evidenceRevision < marker.revision ||
        !Object.values(state.conclusions).some(c => c.projectId === marker.id))
      throw evidenceUnavailable("已接管课题与持久标记不一致");
    taken.add(marker.id);
  }
  return {db,state,local,topic,taken};
}
async function projectEvidenceLocked(authority) {
  const {db,state,local,topic,taken} = authority;
  const next = structuredClone(topic), updates = {}, completed = [];
  let topicChanged = false;
  for (const id of taken) {
    const p = state.projects[id];
    if (!p) throw evidenceUnavailable("接管课题缺失");
    const key = EVIDENCE_SUMMARY_PREFIX + id;
    const prior = local[key];
    const target = next.projects.find(x => x.id === id);
    const revision = p.evidenceRevision;
    const needsTopic = target && (!target.evidenceTakeover || target.evidenceProjectionRevision !== revision);
    if (needsTopic || prior?.evidenceRevision !== revision || prior?.projectionFormat !== 2) {
      const summary = ThreadLineEvidenceCore.projectSummary(state,id);
      const at = Date.now();
      updates[key] = {summary,evidenceRevision:revision,projectionRevision:revision,projectionFormat:2,updatedAt:at};
      if (needsTopic) {
        const before = target.decision;
        target.decision = summary;
        target.evidenceTakeover = true;
        target.evidenceProjectionRevision = revision;
        target.knowledgeVersion += 1;
        target.updatedAt = at;
        target.lastChange = {version:target.knowledgeVersion,at,sourceKey:null,label:"证据结论已更新，请核对更正与撤回"};
        target.history = [...target.history,{version:target.knowledgeVersion,at,sourceKey:null,
          field:"decision",before,after:summary,evidenceRevision:revision}].slice(-30);
        topicChanged = true;
      }
    }
    if (p.projectionTodo || p.projectionRevision !== revision) completed.push([id,revision]);
  }
  if (topicChanged) {
    next.revision += 1;
    // Topic projection, monotonic revision marker and summary become visible together.
    await writeState(topic,next,"evidenceProjection",updates);
  } else if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  for (const [id,revision] of completed) await ThreadLineEvidenceDB.clearProjectionTodo(db,id,revision);
  return {ok:true};
}
async function reconcileEvidenceLocked() {
  const authority = await loadEvidenceAuthorityLocked();
  await projectEvidenceLocked(authority);
  return authority;
}
async function readFreshState() {
  return serialize(async () => { await reconcileEvidenceLocked(); return readState(); });
}
async function consumeEvidenceProjection() { return serialize(() => reconcileEvidenceLocked()); }
async function consumeAllPendingProjections() {
  // Startup cannot show a UI error. Foreground reads and writes always surface it.
  await consumeEvidenceProjection().catch(() => {});
}
async function guardEvidenceMutationLocked(previous,action) {
  const {taken} = await loadEvidenceAuthorityLocked();
  const writesDecision = action.type === "updateProject" && action.patch &&
    Object.prototype.hasOwnProperty.call(action.patch,"decision");
  const removing = action.type === "deleteProject" ? [action.projectId] :
    action.type === "clearClosed" ? previous.projects.filter(p=>p.stage==="closed").map(p=>p.id) : [];
  if ((writesDecision && taken.has(action.projectId)) || removing.some(id=>taken.has(id)))
    throw new Error("该课题已由证据库接管：旧结论只读；完整证据删除协议完成前禁止删除或批量清理。请先导出并保留证据。");
}
async function guardEvidenceRestoreLocked(previous,restored) {
  const {taken,state} = await loadEvidenceAuthorityLocked();
  if(restored.projects.some(p=>state.projects[p.id]?.deleted))throw Error("旧备份不能复活已删除课题，请使用明确的证据恢复流程");
  // A legacy restore replaces the entire topic store, including omitted topics.
  if ([...previous.projects,...restored.projects].some(p=>taken.has(p.id) || p.evidenceTakeover))
    throw new Error("已有课题由证据库接管：旧备份恢复/回滚会覆盖或移除证据课题，已拒绝。请使用证据备份恢复。");
}

async function handleEvidence(payload, sender) {
  if (!payload || typeof payload.type !== "string") throw new Error("无效消息");
  const ownPages = ["evidence-prototype.html", "panel.html", "ff.html"];
  const senderPath = (() => { try { return new URL(sender.url).pathname.replace(/^\//, ""); } catch { return ""; } })();
  if (!ownPages.includes(senderPath))
    throw new Error("证据消息仅限扩展页面");
  const Core = ThreadLineEvidenceCore;
  const advanced = await evidenceWorkflows().handle(payload);
  if (advanced !== undefined) return advanced;
  if (payload.type === "EV_ENSURE") {
    return serialize(async () => {
      const {db} = await loadEvidenceAuthorityLocked();
      if (typeof payload.projectId !== "string" || !payload.projectId.trim()) throw new Error("缺少课题 ID");
      return {project:await ThreadLineEvidenceDB.ensureProject(db,payload.projectId,Core)};
    });
  }
  if (payload.type === "EV_LIST") {
    return serialize(async () => {
    const authority = await loadEvidenceAuthorityLocked();
    let projectionError = null;
    try { await projectEvidenceLocked(authority); } catch (e) { projectionError = String(e.message || e); }
    const state = await ThreadLineEvidenceDB.snapshot(authority.db);
    const rows = Object.values(state.conclusions)
      .filter(c => c.projectId === payload.projectId)
      .sort((a, b) => (b.adoptedAt || 0) - (a.adoptedAt || 0))
      .map(c => {
        const versions = Object.values(state.versions)
          .filter(v => v.conclusionId === c.id)
          .sort((a, b) => b.createdAt - a.createdAt);
        const fragments = Object.values(state.links)
          .filter(l => l.versionId === c.currentVersionId)
          .map(l => ({ relation: l.relation, ...(state.sources[l.sourceId] || {}) }));
        return { conclusion: c, versions: versions.map(v => v.id), current: state.versions[c.currentVersionId], fragments };
      });
    const project = state.projects[payload.projectId] || null;
    return { project, rows, summary:Core.projectSummary(state,payload.projectId),
      projectionPending:!!projectionError,projectionError };
    });
  }
  if (payload.type === "EV_SUMMARY") {
    return serialize(async () => {
      const authority = await loadEvidenceAuthorityLocked();
      let projectionPending = false;
      try { await projectEvidenceLocked(authority); } catch { projectionPending = true; }
      return {summary:Core.projectSummary(authority.state,payload.projectId),projectionPending};
    });
  }
  if (payload.type === "EV_ADOPT" || payload.type === "EV_WITHDRAW" || payload.type === "EV_IMPORT" || payload.type === "EV_AMEND") {
    return serialize(async () => {
      const authority = await loadEvidenceAuthorityLocked();
      const {db,topic,taken} = authority;
      let state = authority.state;
      let plan;
      if (payload.type === "EV_AMEND") {
        const input = {text:payload.text};
        for (const field of ["conditions","fragments","expectedVersionId","changeImpact"])
          if (Object.prototype.hasOwnProperty.call(payload,field)) input[field] = payload[field];
        plan = await Core.planAmendment(state,payload.conclusionId,input,payload.operationId);
      } else if (payload.type === "EV_ADOPT") {
        // Topic-store projects adopt without a prior EV_ENSURE call.
        await ThreadLineEvidenceDB.ensureProject(db, payload.projectId, Core);
        // Refresh after ensureProject so planning sees the project row.
        state = await ThreadLineEvidenceDB.snapshot(db);
        // Capture the legacy decision text verbatim at takeover time.
        const legacyDecision = taken.has(payload.projectId) ? "" :
          topic.projects.find(x => x.id === payload.projectId)?.decision || "";
        plan = await Core.planAdoption(state, {
          projectId: payload.projectId, text: payload.text,
          conditions: payload.conditions, fragments: payload.fragments,
          legacyDecision
        }, payload.operationId);
      }
      else if (payload.type === "EV_WITHDRAW")
        plan = await Core.planWithdrawal(state, payload.conclusionId, payload.reason, payload.operationId);
      else
        plan = await Core.importPackage(state, payload.pkg, payload.operationId);
      await evidenceBudget(state,plan);
      const result = await ThreadLineEvidenceDB.applyPlan(db,plan);
      // Once authority committed, projection failure must never report the write as failed.
      try { await reconcileEvidenceLocked(); return {...result,projectionPending:false}; }
      catch (e) { return {...result,projectionPending:true,projectionError:String(e.message || e)}; }
    });
  }
  if (payload.type === "EV_EXPORT") {
    return serialize(async () => {
      const {state} = await loadEvidenceAuthorityLocked();
      const pkg = Core.exportPackage(state,payload.projectId);
      await Core.validateExportPackage(pkg);
      return pkg;
    });
  }
  if (payload.type === "EV_IMPORT_PREVIEW") {
    return serialize(async () => {
      const {state} = await loadEvidenceAuthorityLocked();
      await Core.importPackage(state,payload.pkg,payload.operationId);
      return {format:payload.pkg.format,projectId:payload.pkg.projectId,
        counts:Object.fromEntries(["conclusions","versions","sources","links"].map(k=>[k,payload.pkg[k].length])),includesOriginalExcerpts:true,
        legacyNoteUnavailable:payload.pkg.format === "threadline-evidence/1"};
    });
  }
  if (payload.type === "EV_DIAGNOSTIC_EXPORT") {
    // Explicit separate raw export preserves damaged records; it is never a normal import package.
    return serialize(async () => {
      const db = await evidenceDb();
      const data = {format:"threadline-evidence-diagnostic/1",at:Date.now(),
        warning:"故障原始数据；未经验证；包含原文；不可作为正常备份导入",state:await ThreadLineEvidenceDB.snapshot(db)};
      if (Core.bytes(JSON.stringify(data)) > Core.LIMITS.packageBytes) throw new Error("故障备份超过 20 MiB，请保留浏览器配置并联系维护者");
      return data;
    });
  }
  if (payload.type === "EV_LOCATE") {
    // Identity-first location in a live conversation tab (S0b locator).
    // Any failure degrades to "fragment only" — the caller never jumps.
    if (typeof payload.conversationId !== "string" || !payload.conversationId)
      throw new Error("缺少会话 ID");
    const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    const target = tabs.find(tab => (tab.url || "").includes("/c/" + payload.conversationId));
    if (!target) return { located: false, reason: "conversation-not-open",
      url: "https://chatgpt.com/c/" + payload.conversationId };
    const results = await chrome.scripting.executeScript({
      target: { tabId: target.id },
      func: (messageId, role, contentPrefix) => {
        const node = messageId
          ? document.querySelector('[data-message-id="' + messageId + '"]') : null;
        const verify = el => {
          if (!el) return false;
          if (role && el.getAttribute("data-message-author-role") !== role) return false;
          if (contentPrefix) {
            const text = (el.textContent || "").replace(/\s+/g, " ").trim();
            if (!text.startsWith(contentPrefix.replace(/\s+/g, " ").trim())) return false;
          }
          return true;
        };
        if (node && verify(node)) {
          node.scrollIntoView({ behavior: "smooth", block: "center" });
          return { located: true, verified: true };
        }
        return { located: false, verified: false, reason: node ? "identity-mismatch" : "not-found" };
      },
      args: [payload.messageId || null, payload.role || null, payload.contentPrefix || null]
    });
    return results && results[0] && results[0].result
      ? results[0].result
      : { located: false, reason: "injection-failed" };
  }
  if (payload.type === "EV_QUOTA") {
    let estimate = null;
    try { if (navigator.storage && navigator.storage.estimate) estimate = await navigator.storage.estimate(); } catch {}
    let persisted = null;
    try { if (navigator.storage && navigator.storage.persisted) persisted = await navigator.storage.persisted(); } catch {}
    return { estimate, persisted };
  }
  throw new Error("未知证据消息: " + payload.type);
}
chrome.runtime.onMessage.addListener((payload,sender,reply) => {
  (async () => {
    if (!payload || typeof payload.type !== "string") throw new Error("无效消息");
    if (payload.type.startsWith("EV_")) return handleEvidence(payload, sender);
    if (payload.type.startsWith("FF_")) return handleFF(payload, sender);
    if (payload.type === "CAPTURE_START") {
      await requirePanelSender(sender,"只有研线面板可启动采集");
      return beginCapture(payload.tabId);
    }
    if (["CAPTURE_RESET","CAPTURE_PAGE","CAPTURE_PROGRESS","CAPTURE_END","CAPTURE_FAIL"].includes(payload.type))return receiveCapture(payload,sender);
    if(payload.type === "WEB_ORGANIZE"){
      await requirePanelSender(sender,'只有研线面板可以管理网页版项目与归档');
      return organizeWeb(payload);
    }
    if(payload.type === "NEW_CHAT"){
      await requirePanelSender(sender,"只有研线面板可接续研究");
      return openChatWithDraft(payload.handoff,payload.windowId,payload.projectId);
    }
    if(["HANDOFF_GET","HANDOFF_BEGIN","HANDOFF_ACK"].includes(payload.type)){
      // A stale tab, Project/Temporary redirect or background page cannot
      // consume a draft reservation from another ChatGPT document.
      const eligible = input => {
        try {
          const u = new URL(input);
          return u.protocol === "https:" &&
            ["chatgpt.com","chat.openai.com"].includes(u.hostname) &&
            u.pathname === "/" && !u.search && !u.hash;
        } catch {return false;}
      };
      if (!Number.isInteger(sender.tab?.id) ||
          !eligible(sender.tab.url) || !eligible(sender.url))
        throw new Error("only a plain new ChatGPT document may access handoff");
      const key = `tl_handoff_${sender.tab.id}`;
      if (payload.type === "HANDOFF_GET") {
        const found = await chrome.storage.session.get(key);
        const record = found[key];
        return record ? {...record,autoAttempted:Number.isFinite(record.attemptedAt)} : null;
      }
      if (payload.type === "HANDOFF_BEGIN") {
        // Reserve the only automatic insertion BEFORE touching the composer.
        // Serialize against duplicate content-script or worker invocations.
        return serialize(async () => {
          const found = await chrome.storage.session.get(key);
          const record = found[key];
          if (!record?.text || Number.isFinite(record.attemptedAt))
            return {autoFill:false};
          await chrome.storage.session.set({[key]:{...record,attemptedAt:Date.now()}});
          return {autoFill:true};
        });
      }
      return serialize(async () => {
        const found = await chrome.storage.session.get(key);
        if (!Number.isFinite(found[key]?.attemptedAt))
          throw new Error("no reserved handoff attempt to acknowledge");
        await chrome.storage.session.remove(key);
        // A Fork-bound tab's exact prefill ACK is its branch's input proof.
        try { await ffHandoffAcked(sender.tab.id); } catch {}
        return {ok:true};
      });
    }
    if (payload.type === "ACK_PAGE") {
      // A content script can only acknowledge the page that sent the message.
      if (!sender.tab?.id || !ThreadLineCore.isChatURL(sender.tab.url)) throw new Error("仅允许 ChatGPT 对话核对状态");
      const key = ThreadLineCore.getChatKey(sender.tab.url, sender.tab.id);
      const proposed = ThreadLineCore.getChatKey(payload.href, sender.tab.id);
      if (!key || key !== proposed) throw new Error("来源对话已改变，请重新核对");
      await mutate({type:"acknowledgeProject",key});
      const state = await readState();
      return {key,...ThreadLineCore.getContext(state,key)};
    }
    if (payload.type === "BACKUP_EXPORT") {
      await requirePanelSender(sender,'只能由研线侧栏导出');
      const state=await readFreshState();
      const record=await chrome.storage.local.get(SNAPSHOT_KEY);
      return ThreadLineBackup.create(state,record[SNAPSHOT_KEY]||[]);
    }
    if (payload.type === "BACKUP_IMPORT") {
      await requirePanelSender(sender,'只能由研线侧栏导入');
      return importBackup(payload.json);
    }
    if (payload.type === "BACKUP_SNAPSHOTS") {
      await requirePanelSender(sender,'只能由研线侧栏读取');
      const record=await chrome.storage.local.get(SNAPSHOT_KEY);
      return (record[SNAPSHOT_KEY]||[]).map((r,index)=>({index,at:r.at,reason:r.reason,revision:r.state?.revision}));
    }
    if (payload.type === "BACKUP_ROLLBACK") {
      await requirePanelSender(sender,'只能由研线侧栏恢复');
      return restoreSnapshot(payload.index);
    }
    if (payload.type === "HEALTH_CHECK") {
      await requirePanelSender(sender,'只能由研线侧栏自检');
      const result=await inspectTab(payload.tabId);
      const record=await chrome.storage.local.get(PAGE_HEALTH_KEY);
      return {page:result,lastSuccess:record[PAGE_HEALTH_KEY]||{},at:Date.now()};
    }
    if (payload.type === "SNAPSHOT") {
      await requirePanelSender(sender,"无权访问面板数据");
      await recoverCaptures();
      return snapshot();
    }
    if (payload.type === "MUTATE") {
      await requirePanelSender(sender,"只能在扩展面板中修改课题状态");
      const action = payload.action || {};
      return mutate(action);
    }
    if (["PAGE_CONTEXT","OBSERVE"].includes(payload.type)) {
      if (!sender.tab || !ThreadLineCore.isChatURL(sender.tab.url)) throw new Error("仅支持 ChatGPT 页面");
      return pageContext(sender,payload);
    }
    throw new Error("无效消息类型");
  })().then(data=>reply({ok:true,data}),err=>reply({ok:false,error:String(err.message||err),
    ...(err.code==='PANEL_SOURCE_REJECTED'?{code:err.code,sourceCheck:err.sourceCheck}:{})}));
  return true;
});
