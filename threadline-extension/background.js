importScripts("core.js", "backup-core.js", "capture-core.js", "capture-db.js", "organize-core.js", "ff-core.js", "ff-db.js");
const STORE_KEY = "threadline_state_v1";
const SNAPSHOT_KEY = "threadline_state_snapshots";
const CAPTURE_PREFIX = "tl_capture_owner_";
let mutations = Promise.resolve();

// The side panel normally sends messages without sender.tab. Chrome also
// attaches sender.tab when the same extension-owned panel.html is opened in a
// regular tab (e.g. full-width review and actual persistent-context E2E).
// Trust that exact internal page, never a ChatGPT content script/tab URL.
function isTrustedPanelSender(sender) {
  if (!sender?.tab) return true;
  const expected = chrome.runtime.getURL?.('panel.html');
  return !!(expected && sender.id === chrome.runtime.id &&
    sender.url === expected && (!sender.tab.url || sender.tab.url === expected));
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
async function writeState(previous,next,reason) {
  const preserve = !["observeChat", "acknowledgeProject"].includes(reason);
  if (!preserve) { await chrome.storage.local.set({[STORE_KEY]:next}); return; }
  const record = await chrome.storage.local.get(SNAPSHOT_KEY);
  const before = Array.isArray(record[SNAPSHOT_KEY]) ? record[SNAPSHOT_KEY] : [];
  // Snapshots store complete, *previous* states; rollback will not erase the undo history.
  const snapshots = [...before,{at:Date.now(),reason, state:previous}].slice(-ThreadLineBackup.SNAPSHOT_LIMIT);
  await chrome.storage.local.set({[SNAPSHOT_KEY]:snapshots,[STORE_KEY]:next});
}
async function mutate(action) {
  return serialize(async () => {
    const previous = await readState();
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
    const previous = await readState();
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
    const previous = await readState();
    const state = ThreadLineBackup.assertState(snapshots[index].state);
    state.revision = Math.max(state.revision,previous.revision)+1;
    await writeState(previous,state,"restoreSnapshot");
    return {revision:state.revision};
  });
}
async function snapshot() {
  const [state,tabs,active,live] = await Promise.all([
    readState(),
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
  const stateBefore = await readState();
  if (key.startsWith("chat:") && stateBefore.chats[`tab:${tabId}`]) {
    await mutate({type:"remapPending",from:`tab:${tabId}`,to:key,url:href});
  }
  const state = await readState();
  const {project,chat} = ThreadLineCore.getContext(state,key);
  if (chat && payload.type === "OBSERVE" && ((payload.title && payload.title !== chat.title && !chat.label) || (href && href !== chat.url))) {
    await mutate({type:"observeChat",key,title:payload.title,url:href});
  }
  if (payload.type === "OBSERVE") {
    const status = {key, title:String(payload.title||"").slice(0,130), streaming:!!payload.streaming, updatedAt:Date.now()};
    await chrome.storage.session.set({[`tl_live_${tabId}`]:status});
  }
  const newest = payload.type === "OBSERVE" ? await readState() : state;
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
      await ThreadLineCaptureDB.modifyRun(run.id,{status:"done",complete:payload.complete===true,mode:String(payload.mode||""),pageCount:Number(payload.pageCount)||0,messageCount:Number(payload.count)||0,notice:String(payload.notice||"").slice(0,1200)});
      captureOwners.delete(run.id);await chrome.storage.session.remove(`${CAPTURE_PREFIX}${run.id}`);await markSuccess("capture");return {ok:true};
    }
    case "CAPTURE_FAIL":
      await ThreadLineCaptureDB.modifyRun(run.id,{status:"error",error:String(payload.message||"采集失败").slice(0,1200)});captureOwners.delete(run.id);await chrome.storage.session.remove(`${CAPTURE_PREFIX}${run.id}`);return {ok:true};
    default:throw new Error("未知采集状态");
  }
}
async function openChatWithDraft(handoff,windowId,projectId){
  const text=String(handoff||"").slice(0,30000);
  if(!text)throw new Error("没有可用于接续的研究信息");
  const tab=await chrome.tabs.create({url:"https://chatgpt.com/",active:true,...(Number.isInteger(windowId)?{windowId}:{})});
  await chrome.storage.session.set({[`tl_handoff_${tab.id}`]:{text,createdAt:Date.now()}});
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
    return serialize(async () => {
      const frozen = await ThreadLineFFCore.freeze(payload.w0, payload.p);
      const id = "ff_" + crypto.randomUUID().replace(/-/g, "");
      const record = ThreadLineFFCore.newExperiment(frozen, id);
      await ThreadLineFFDB.create(record); // Reply after IDB transaction completes.
      return {id, revision:record.revision, bytes:frozen.bytes,
        sha256:frozen.textHashes.frozen, createdAt:record.createdAt};
    });
  }
  if (payload.type === "FF_LIST") {
    const rows = await ThreadLineFFDB.list();
    return rows.map(x => ({id:x.id, revision:x.revision, createdAt:x.createdAt,
      bytes:x.frozen?.bytes, statusA:x.branches?.A?.status,
      statusB:x.branches?.B?.status})).sort((a,b) => b.createdAt-a.createdAt);
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
  throw new Error("unknown Fork message type");
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  recoverCaptures().catch(()=>{});
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(() => {});
});
chrome.tabs.onUpdated.addListener(async(tabId,change)=>{
  if(change.status!=="complete")return;
  try{const r=await chrome.storage.session.get(`tl_handoff_${tabId}`);if(r[`tl_handoff_${tabId}`])await chrome.tabs.sendMessage(tabId,{type:"TL_HANDOFF_READY"});}catch{}
});
chrome.tabs.onRemoved.addListener((tabId) => {
  recoverCaptures(tabId).catch(()=>{});
  chrome.storage.session.remove([`tl_live_${tabId}`,`tl_handoff_${tabId}`]).catch(() => {});
  for(const [id,owner] of captureOwners)if(owner===tabId)captureOwners.delete(id);
});
chrome.runtime.onMessage.addListener((payload,sender,reply) => {
  (async () => {
    if (!payload || typeof payload.type !== "string") throw new Error("无效消息");
    if (payload.type.startsWith("FF_")) return handleFF(payload, sender);
    if (payload.type === "CAPTURE_START") {
      if(!isTrustedPanelSender(sender))throw new Error("只有研线面板可启动采集");
      return beginCapture(payload.tabId);
    }
    if (["CAPTURE_RESET","CAPTURE_PAGE","CAPTURE_PROGRESS","CAPTURE_END","CAPTURE_FAIL"].includes(payload.type))return receiveCapture(payload,sender);
    if(payload.type === "WEB_ORGANIZE"){
      if(!isTrustedPanelSender(sender))throw new Error('只有研线面板可以管理网页版项目与归档');
      return organizeWeb(payload);
    }
    if(payload.type === "NEW_CHAT"){
      if(!isTrustedPanelSender(sender))throw new Error("只有研线面板可接续研究");
      return openChatWithDraft(payload.handoff,payload.windowId,payload.projectId);
    }
    if(payload.type === "HANDOFF_GET"){
      if(!sender.tab?.id||!ThreadLineCore.isChatURL(sender.tab.url))throw new Error("只允许新 ChatGPT 页面访问其接续提示");
      const record=await chrome.storage.session.get(`tl_handoff_${sender.tab.id}`);
      return record[`tl_handoff_${sender.tab.id}`]||null;
    }
    if(payload.type === "HANDOFF_ACK"){
      if(!sender.tab?.id)throw new Error("无法确认目标标签页");
      await chrome.storage.session.remove(`tl_handoff_${sender.tab.id}`);return {ok:true};
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
      if(!isTrustedPanelSender(sender))throw new Error('只能由研线侧栏导出');
      const state=await readState();
      const record=await chrome.storage.local.get(SNAPSHOT_KEY);
      return ThreadLineBackup.create(state,record[SNAPSHOT_KEY]||[]);
    }
    if (payload.type === "BACKUP_IMPORT") {
      if(!isTrustedPanelSender(sender))throw new Error('只能由研线侧栏导入');
      return importBackup(payload.json);
    }
    if (payload.type === "BACKUP_SNAPSHOTS") {
      if(!isTrustedPanelSender(sender))throw new Error('只能由研线侧栏读取');
      const record=await chrome.storage.local.get(SNAPSHOT_KEY);
      return (record[SNAPSHOT_KEY]||[]).map((r,index)=>({index,at:r.at,reason:r.reason,revision:r.state?.revision}));
    }
    if (payload.type === "BACKUP_ROLLBACK") {
      if(!isTrustedPanelSender(sender))throw new Error('只能由研线侧栏恢复');
      return restoreSnapshot(payload.index);
    }
    if (payload.type === "HEALTH_CHECK") {
      if(!isTrustedPanelSender(sender))throw new Error('只能由研线侧栏自检');
      const result=await inspectTab(payload.tabId);
      const record=await chrome.storage.local.get(PAGE_HEALTH_KEY);
      return {page:result,lastSuccess:record[PAGE_HEALTH_KEY]||{},at:Date.now()};
    }
    if (payload.type === "SNAPSHOT") {
      if (!isTrustedPanelSender(sender)) throw new Error("无权访问面板数据");
      await recoverCaptures();
      return snapshot();
    }
    if (payload.type === "MUTATE") {
      if (!isTrustedPanelSender(sender)) throw new Error("只能在扩展面板中修改课题状态");
      return mutate(payload.action);
    }
    if (["PAGE_CONTEXT","OBSERVE"].includes(payload.type)) {
      if (!sender.tab || !ThreadLineCore.isChatURL(sender.tab.url)) throw new Error("仅支持 ChatGPT 页面");
      return pageContext(sender,payload);
    }
    throw new Error("无效消息类型");
  })().then(data=>reply({ok:true,data}),err=>reply({ok:false,error:String(err.message||err)}));
  return true;
});
