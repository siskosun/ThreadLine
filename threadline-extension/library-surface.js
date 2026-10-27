/* One-shot navigation only. Not a permission token or evidence-write authority.
 * The target tab loads the exact trusted panel.html document (no query/hash).
 * All mutations continue to be checked by the existing service worker. */
(function(root){
  "use strict";
  const PREFIX="tl_library_intent_v1_";
  const TTL_MS=120000;
  const MAX_ID=128;
  const RELOAD_KEY="tl_library_view_v1";
  const VALID_WORKSPACES=new Set(["switch","evidence"]);
  const VALID_FILTERS=new Set(["all","active","withdrawn"]);
  const key=tabId=>PREFIX+tabId;
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
      (record.sourceTabId===null
        ? record.sourceChatKey===null
        : isTabId(record.sourceTabId)&&record.sourceChatKey!==null);
  }
  async function open({viewProjectId=null,sourceTabId=null,sourceChatKey=null}={},api=chrome,now=Date.now()){
    if(!isProjectId(viewProjectId)||!isChatKey(sourceChatKey)||
      (sourceTabId===null?sourceChatKey!==null:!isTabId(sourceTabId)||sourceChatKey===null))
      throw new Error("资料库导航参数无效");
    let tab=null;
    try{
      // Create a blank tab, persist target-tab-scoped context, then navigate.
      // The page cannot win a race against session storage setup.
      tab=await api.tabs.create({url:"about:blank",active:false});
      if(!isTabId(tab?.id))throw new Error("无法确认资料库标签页");
      await api.storage.session.set({[key(tab.id)]:{
        schema:1,tabId:tab.id,viewProjectId,sourceTabId,sourceChatKey,createdAt:now
      }});
      await api.tabs.update(tab.id,{url:api.runtime.getURL("panel.html"),active:true});
      return {tabId:tab.id};
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
      typeof view.query==="string"&&view.query.length<=160&&
      !/[\u0000-\u001f\u007f]/.test(view.query);
  }
  function saveView(tabId,view,storage=root?.sessionStorage){
    const record={schema:1,tabId,
      viewProjectId:view.viewProjectId??null,
      topicProjectId:view.topicProjectId??null,
      sourceTabId:view.sourceTabId??null,
      sourceChatKey:view.sourceChatKey??null,
      workspace:view.workspace,filter:view.filter,query:view.query??""};
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
  const exposed=Object.freeze({TTL_MS,RELOAD_KEY,key,isTabId,isProjectId,isChatKey,
    validIntent,validView,open,consume,saveView,loadView});
  if(typeof module!=="undefined"&&module.exports)module.exports=exposed;
  if(root)root.ThreadLineLibrarySurface=exposed;
})(typeof globalThis!=="undefined"?globalThis:null);
