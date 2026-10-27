/* One-shot navigation only. Not a permission token or evidence-write authority.
 * The target tab loads the exact trusted panel.html document (no query/hash).
 * All mutations continue to be checked by the existing service worker. */
(function(root){
  "use strict";
  const PREFIX="tl_library_intent_v1_";
  const TTL_MS=120000;
  const MAX_ID=128;
  const key=tabId=>PREFIX+tabId;
  const isTabId=value=>Number.isSafeInteger(value)&&value>0;
  const isProjectId=value=>value===null||(typeof value==="string"&&value.length>0&&
    value.length<=MAX_ID&&!/[\u0000-\u001f\u007f]/.test(value));
  const isChatKey=value=>value===null||(typeof value==="string"&&value.length>0&&
    value.length<=256&&!/[\u0000-\u001f\u007f]/.test(value));
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
  const exposed=Object.freeze({TTL_MS,key,isTabId,isProjectId,isChatKey,validIntent,open,consume});
  if(typeof module!=="undefined"&&module.exports)module.exports=exposed;
  if(root)root.ThreadLineLibrarySurface=exposed;
})(typeof globalThis!=="undefined"?globalThis:null);
