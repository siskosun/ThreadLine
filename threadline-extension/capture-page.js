/* Isolated-world bridge; only captures a tab after the user explicitly selects it. */
(()=>{
  if(globalThis.__TL_CAPTURE_PAGE_V2__)return;globalThis.__TL_CAPTURE_PAGE_V2__=true;
  const CHANNEL="threadline-capture-v2";let active=null;
  function send(payload){return new Promise((resolve,reject)=>{
    chrome.runtime.sendMessage(payload,r=>{if(chrome.runtime.lastError)return reject(new Error(chrome.runtime.lastError.message));if(!r?.ok)return reject(new Error(r?.error||"采集信息同步失败"));resolve(r.data);});
  });}
  function visibleDOM(){
    const out=[];
    document.querySelectorAll('[data-message-author-role="user"],[data-message-author-role="assistant"]').forEach((node,index)=>{
      const role=node.getAttribute("data-message-author-role"),value=(node.innerText||node.textContent||"").trim();
      if(value)out.push({id:node.getAttribute("data-message-id")||`dom-${index}`,role,content:value,hasNonText:false});
    });return out;
  }
  async function domFallback(message){
    if(!active)return;
    const id=active.requestId;
    await send({type:"CAPTURE_RESET",id});
    const rows=visibleDOM();
    for(let i=0;i<rows.length;i+=20)await send({type:"CAPTURE_PAGE",id,pageIndex:0,chunkIndex:i/20,messages:rows.slice(i,i+20)});
    await send({type:"CAPTURE_END",id,complete:false,mode:"visible-dom",pageCount:1,count:rows.length,notice:`未能读取完整历史（${message}）。仅采集当前页面渲染的 ${rows.length} 条可见文本消息，不能当作完整对话。`});
    active=null;
  }
  window.addEventListener("message",event=>{
    if(event.source!==window||event.origin!==location.origin)return;
    const m=event.data;if(!active||m?.channel!==CHANNEL||m.direction!=="main-to-extension"||m.requestId!==active.requestId)return;
    // Strictly serialize page writes to keep an indexed history in the extension.
    active.queue=active.queue.then(async()=>{
      if(m.kind==="reset")return send({type:"CAPTURE_RESET",id:m.requestId});
      if(m.kind==="page")return send({type:"CAPTURE_PAGE",id:m.requestId,pageIndex:m.pageIndex,chunkIndex:m.chunkIndex,messages:m.messages});
      if(m.kind==="progress")return send({type:"CAPTURE_PROGRESS",id:m.requestId,pageCount:m.pageCount,messageCount:m.messageCount,phase:m.phase});
      if(m.kind==="done"){
        await send({type:"CAPTURE_END",id:m.requestId,complete:!!m.complete,mode:m.mode,pageCount:m.pageCount,count:m.count,notice:m.notice});active=null;return;
      }
      if(m.kind==="error"){await domFallback(m.message||"无法读取历史");}
    }).catch(async error=>{try{await send({type:"CAPTURE_FAIL",id:m.requestId,message:String(error.message||error)});}catch{}active=null;});
  });
  chrome.runtime.onMessage.addListener((msg,sender,respond)=>{
    if(msg?.type==="TL_CAPTURE_START"){
      if(active){respond({ok:false,error:"这个标签页已有采集任务"});return;}
      if(!/^https:\/\/(chatgpt\.com|chat\.openai\.com)\/(?:[^?#]*\/)?c\/[a-z0-9-]+/i.test(location.href)){respond({ok:false,error:"只能采集已保存的 ChatGPT 对话"});return;}
      if(document.querySelector('[data-testid="stop-button"]')){respond({ok:false,error:"源对话仍在生成中，请等待回答完成后采集"});return;}
      active={requestId:msg.id,queue:Promise.resolve()};
      window.postMessage({channel:CHANNEL,direction:"extension-to-main",kind:"start",requestId:msg.id,conversationId:msg.conversationId},location.origin);
      respond({ok:true});return;
    }
    if(msg?.type==="TL_CAPTURE_CANCEL"&&active?.requestId===msg.id){window.postMessage({channel:CHANNEL,direction:"extension-to-main",kind:"cancel",requestId:msg.id},location.origin);respond({ok:true});return;}
  });
})();
