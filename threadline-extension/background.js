importScripts("core.js", "capture-core.js", "capture-db.js", "organize-core.js");
const STORE_KEY = "threadline_state_v1";
let mutations = Promise.resolve();

function serialize(fn) {
  const next = mutations.then(fn,fn);
  mutations = next.catch(() => {});
  return next;
}
async function readState() {
  const record = await chrome.storage.local.get(STORE_KEY);
  return ThreadLineCore.normalizedState(record[STORE_KEY]);
}
async function mutate(action) {
  return serialize(async () => {
    const previous = await readState();
    const changed = ThreadLineCore.apply(previous,action);
    await chrome.storage.local.set({[STORE_KEY]:changed.state});
    return changed;
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
  captureOwners.set(id,tabId);
  try {
    // Also works with ChatGPT tabs opened before the extension was installed.
    await chrome.scripting.executeScript({target:{tabId},files:["capture-main.js"],world:"MAIN"});
    await chrome.scripting.executeScript({target:{tabId},files:["capture-page.js"],world:"ISOLATED"});
    const reply=await chrome.tabs.sendMessage(tabId,{type:"TL_CAPTURE_START",id,conversationId});
    if(!reply?.ok)throw new Error(reply?.error||"无法与源标签页通讯");
  }catch(e){captureOwners.delete(id);await ThreadLineCaptureDB.modifyRun(id,{status:"error",error:String(e.message||e)});}
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
      captureOwners.delete(run.id);return {ok:true};
    }
    case "CAPTURE_FAIL":
      await ThreadLineCaptureDB.modifyRun(run.id,{status:"error",error:String(payload.message||"采集失败").slice(0,1200)});captureOwners.delete(run.id);return {ok:true};
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
  if(organizeLocks.has(key))throw new Error('该对话正在执行其他组织操作');
  organizeLocks.add(key);
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
    if(helperId && remote.status==='moved')await chrome.tabs.remove(helperId).catch(()=>{});
    return remote;
  }finally{organizeLocks.delete(key);}
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(() => {});
});
chrome.tabs.onUpdated.addListener(async(tabId,change)=>{
  if(change.status!=="complete")return;
  try{const r=await chrome.storage.session.get(`tl_handoff_${tabId}`);if(r[`tl_handoff_${tabId}`])await chrome.tabs.sendMessage(tabId,{type:"TL_HANDOFF_READY"});}catch{}
});
chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove([`tl_live_${tabId}`,`tl_handoff_${tabId}`]).catch(() => {});
  for(const [id,owner] of captureOwners)if(owner===tabId){captureOwners.delete(id);ThreadLineCaptureDB.modifyRun(id,{status:"error",error:"源对话标签页已关闭"}).catch(()=>{});}
});
chrome.runtime.onMessage.addListener((payload,sender,reply) => {
  (async () => {
    if (!payload || typeof payload.type !== "string") throw new Error("无效消息");
    if (payload.type === "CAPTURE_START") {
      if(sender.tab)throw new Error("只有研线面板可启动采集");
      return beginCapture(payload.tabId);
    }
    if (["CAPTURE_RESET","CAPTURE_PAGE","CAPTURE_PROGRESS","CAPTURE_END","CAPTURE_FAIL"].includes(payload.type))return receiveCapture(payload,sender);
    if(payload.type === "WEB_ORGANIZE"){
      if(sender.tab)throw new Error('只有研线面板可以管理网页版项目与归档');
      return organizeWeb(payload);
    }
    if(payload.type === "NEW_CHAT"){
      if(sender.tab)throw new Error("只有研线面板可接续研究");
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
    if (payload.type === "SNAPSHOT") {
      if (sender.tab) throw new Error("无权访问面板数据");
      return snapshot();
    }
    if (payload.type === "MUTATE") {
      if (sender.tab) throw new Error("只能在扩展面板中修改课题状态");
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
