/* One-shot navigation only. Not a permission token or evidence-write authority.
 * The target tab loads the exact trusted panel.html document (no query/hash).
 * All mutations continue to be checked by the existing service worker. */
(function(root){
  "use strict";
  const PREFIX="tl_library_intent_v1_";
  const OPEN_PREFIX="tl_library_open_v1_";
  const TTL_MS=120000;
  const MAX_ID=128;
  const RELOAD_KEY="tl_library_view_v1";
  const VALID_WORKSPACES=new Set(["switch","evidence","map"]);
  const isMapRunId=value=>value===null||
    (typeof value==="string"&&/^cap_[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value));
  const VALID_FILTERS=new Set(["all","active","withdrawn"]);
  const isQuery=value=>typeof value==="string"&&value.length<=160&&
    !/[\u0000-\u001f\u007f]/.test(value);
  const key=tabId=>PREFIX+tabId;
  const openKey=tabId=>OPEN_PREFIX+tabId;
  const isWindowId=value=>Number.isSafeInteger(value)&&value>=0;
  const isTabId=value=>Number.isSafeInteger(value)&&value>0;
  const isProjectId=value=>value===null||(typeof value==="string"&&value.length>0&&
    value.length<=MAX_ID&&!/[\u0000-\u001f\u007f]/.test(value));
  // A tab:NN fallback is not a stable conversation identity. Do not pin
  // return-navigation or diagnostics to an unsaved/new-chat tab.
  const isChatKey=value=>value===null||
    (typeof value==="string"&&/^chat:[a-z0-9-]{1,240}$/.test(value));
  function validIntent(record,tabId,now=Date.now()){
    return !!record&&typeof record==="object"&&
      record.schema===1&&isTabId(tabId)&&record.tabId===tabId&&
      Number.isSafeInteger(record.createdAt)&&
      Number.isSafeInteger(now)&&now-record.createdAt>=0&&
      now-record.createdAt<=TTL_MS&&
      isProjectId(record.viewProjectId)&&isChatKey(record.sourceChatKey)&&
      VALID_FILTERS.has(record.filter)&&isQuery(record.query)&&
      VALID_WORKSPACES.has(record.workspace??"evidence")&&
      isMapRunId(record.mapRunId??null)&&
      ((record.workspace??"evidence")!=="map"||record.mapRunId!==null&&record.mapRunId!==undefined)&&
      (record.sourceTabId===null
        ? record.sourceChatKey===null
        : isTabId(record.sourceTabId)&&record.sourceChatKey!==null);
  }
  function validOpen(record,tab) {
    return !!record&&typeof record==="object"&&
      isTabId(tab?.id)&&isWindowId(tab?.windowId)&&
      record.schema===1&&record.tabId===tab.id&&
      record.windowId===tab.windowId;
  }
  async function registerOpen(tab,api=chrome){
    if(!isTabId(tab?.id)||!isWindowId(tab?.windowId))
      throw new Error("无法登记资料库页面身份");
    await api.storage.session.set({[openKey(tab.id)]:{
      schema:1,tabId:tab.id,windowId:tab.windowId
    }});
  }
  async function findOpen(api,windowId,now=Date.now()){
    if(!isWindowId(windowId))return null;
    const exact=api.runtime.getURL("panel.html");
    // Only tabs in the caller's own window. No global selected project.
    const tabs=await api.tabs.query({windowId,url:exact});
    for(const tab of tabs){
      if(tab.url!==exact||tab.windowId!==windowId||!isTabId(tab.id))continue;
      const known=await api.storage.session.get([openKey(tab.id),key(tab.id)]);
      if(validOpen(known[openKey(tab.id)],tab)||
        validIntent(known[key(tab.id)],tab.id,now))
        return tab;
    }
    return null;
  }
  async function open({viewProjectId=null,sourceTabId=null,sourceChatKey=null,
    filter="all",query="",windowId=null,workspace="evidence",mapRunId=null}={},api=chrome,now=Date.now()){
    if(!isProjectId(viewProjectId)||!isChatKey(sourceChatKey)||
      !VALID_FILTERS.has(filter)||!isQuery(query)||
      !VALID_WORKSPACES.has(workspace)||!isMapRunId(mapRunId)||
      (workspace==="map"&&mapRunId===null)||
      (sourceTabId===null?sourceChatKey!==null:!isTabId(sourceTabId)||sourceChatKey===null))
      throw new Error("资料库导航参数无效");
    if(windowId!==null&&!isWindowId(windowId))
      throw new Error("资料库窗口编号无效");
    // Reuse a real existing library tab without overwriting its reading state.
    // Repeated returns must not create a growing stack of wide pages.
    const previous=await findOpen(api,windowId,now);
    if(previous){
      if(workspace==="map"){
        // This explicitly requested map changes the current wide tab's view,
        // not its permissions. Reload is intentional only for a new map.
        // A generic "open library" still preserves the previous view.
        const k=key(previous.id);
        await api.storage.session.set({[k]:{
          schema:1,tabId:previous.id,viewProjectId,sourceTabId,sourceChatKey,
          filter,query,workspace,mapRunId,createdAt:now
        }});
        try{await api.tabs.reload(previous.id);}
        catch(error){await api.storage.session.remove(k).catch(()=>{});throw error;}
      }
      await api.tabs.update(previous.id,{active:true});
      if(api.windows?.update)await api.windows.update(previous.windowId,{focused:true});
      return {tabId:previous.id,reused:true,...(workspace==="map"?{navigated:true}:{})};
    }
    let tab=null;
    try{
      // Create a blank tab, persist target-tab-scoped context, then navigate.
      // The page cannot win a race against session storage setup.
      tab=await api.tabs.create({url:"about:blank",active:false,
        ...(windowId!==null?{windowId}:{})});
      if(!isTabId(tab?.id))throw new Error("无法确认资料库标签页");
      await api.storage.session.set({[key(tab.id)]:{
        schema:1,tabId:tab.id,viewProjectId,sourceTabId,sourceChatKey,
        filter,query,workspace,mapRunId,createdAt:now
      }});
      await api.tabs.update(tab.id,{url:api.runtime.getURL("panel.html"),active:true});
      return {tabId:tab.id,reused:false};
    }catch(error){
      if(isTabId(tab?.id)){
        await api.storage.session.remove(key(tab.id)).catch(()=>{});
        await api.tabs.remove(tab.id).catch(()=>{});
      }
      throw error;
    }
  }
  async function consume(tabId,api=chrome,now=Date.now()){
    if(!isTabId(tabId))return null;
    const k=key(tabId);
    let result;
    try{
      result=await api.storage.session.get(k);
    }finally{
      // A failed cleanup must fail closed, not leave reusable context.
      await api.storage.session.remove(k);
    }
    return validIntent(result?.[k],tabId,now)?result[k]:null;
  }
  // sessionStorage is scoped to this extension tab. A reload can resume the
  // reading surface without reusing the one-shot chrome.storage.session intent.
  // A duplicated tab has a different Chrome tab ID and must not inherit this view.
  // This is UI navigation state, never authorization or an operation target.
  function validView(view,tabId){
    return !!view&&typeof view==="object"&&view.schema===1&&isTabId(tabId)&&
      view.tabId===tabId&&isProjectId(view.viewProjectId)&&isProjectId(view.topicProjectId)&&
      isChatKey(view.sourceChatKey)&&
      (view.sourceTabId===null
        ? view.sourceChatKey===null
        : isTabId(view.sourceTabId)&&view.sourceChatKey!==null)&&
      VALID_WORKSPACES.has(view.workspace)&&VALID_FILTERS.has(view.filter)&&
      isMapRunId(view.mapRunId??null)&&
      (view.workspace!=="map"||view.mapRunId!==null&&view.mapRunId!==undefined)&&
      isQuery(view.query);
  }
  function saveView(tabId,view,storage=root?.sessionStorage){
    const record={schema:1,tabId,
      viewProjectId:view.viewProjectId??null,
      topicProjectId:view.topicProjectId??null,
      sourceTabId:view.sourceTabId??null,
      sourceChatKey:view.sourceChatKey??null,
      workspace:view.workspace,filter:view.filter,query:view.query??"",
      mapRunId:view.mapRunId??null};
    if(!validView(record,tabId))throw new Error("资料库阅读状态无效");
    storage.setItem(RELOAD_KEY,JSON.stringify(record));
    return record;
  }
  function loadView(tabId,storage=root?.sessionStorage){
    if(!isTabId(tabId))return null;
    const raw=storage.getItem(RELOAD_KEY);
    if(raw===null)return null;
    try{
      const record=JSON.parse(raw);
      if(validView(record,tabId))return record;
    }catch{}
    storage.removeItem(RELOAD_KEY);
    return null;
  }
  const exposed=Object.freeze({TTL_MS,RELOAD_KEY,key,openKey,isTabId,isWindowId,
    isProjectId,isChatKey,isMapRunId,validIntent,validView,validOpen,
    findOpen,registerOpen,open,consume,saveView,loadView});
  if(typeof module!=="undefined"&&module.exports)module.exports=exposed;
  if(root)root.ThreadLineLibrarySurface=exposed;
})(typeof globalThis!=="undefined"?globalThis:null);
