/*
  User-initiated ChatGPT pagination capture, adapted from the MIT-licensed CGO
  pagination approach (Naoki Sawada, https://github.com/nao-pon/chatgpt-conversation-optimizer).
  This MAIN-world bridge keeps authorization headers in a private closure: never
  posts credentials, never persists credentials, never sends data off-origin.
  ChatGPT's PRIVATE web endpoint can change; we fail visibly, never claim full capture.
*/
(()=>{
  if(window.__TL_CAPTURE_MAIN_V2__)return;
  Object.defineProperty(window,"__TL_CAPTURE_MAIN_V2__",{value:true,configurable:false});
  const CHANNEL="threadline-capture-v2",BRIDGE_PROTOCOL=3,MAX_PAGES=2500, PAGE_TURNS=10;
  const nativeFetch=window.fetch;
  let lastAuth="", active=null;
  function ownConversation(){return location.pathname.match(/(?:^|\/)c\/([a-z0-9-]+)(?:\/|$)/i)?.[1]?.toLowerCase()||"";}
  function possibleAuth(args){
    try {const url=new URL(args[0]?.url||String(args[0]),location.href);if(url.origin!==location.origin||!url.pathname.startsWith("/backend-api/"))return "";
      const headers=new Headers(args[1]?.headers||args[0]?.headers||{});return headers.get("authorization")||"";
    }catch{return "";}
  }
  // Passive read, without intercepting or rewriting responses. Used only for same-origin authenticated history reads.
  window.fetch=function(...args){try{const value=possibleAuth(args);if(value)lastAuth=value;}catch{}return nativeFetch.apply(this,args);};
  function post(requestId,kind,data={}){window.postMessage({channel:CHANNEL,direction:"main-to-extension",requestId,kind,...data},location.origin);}
  function visible(raw){
    if(!raw||typeof raw!=="object")return null;
    const m=raw.message||raw,role=m.author?.role||m.role;
    if(role!=="user"&&role!=="assistant")return null;
    if(m.metadata?.is_visually_hidden_from_conversation||m.metadata?.is_user_system_message||m.content?.content_type==="user_editable_context")return null;
    if(m.metadata?.message_type==="internal"||m.channel==="analysis"||m.metadata?.channel==="analysis")return null;
    let nonText=false;
    const parts=Array.isArray(m.content?.parts)?m.content.parts:[];
    const result=[];
    for(const part of parts){
      if(typeof part==="string")result.push(part);
      else if(part&&typeof part==="object"){
        if(typeof part.text==="string")result.push(part.text);
        else if(typeof part.content==="string")result.push(part.content);
        else nonText=true;
      }
    }
    if(!parts.length && typeof m.content?.text==="string") result.push(m.content.text);
    if(!parts.length && typeof m.content==="string") result.push(m.content);
    const content=result.join("\n").trim();
    if(!content&&!nonText)return null;
    // finished preserves the session data's own end marker for the message;
    // Fork completion uses it as an independently checkable signal.
    return {id:String(m.id||raw.id||""),role,content,timestamp:Number(m.create_time)||null,hasNonText:nonText,
      finished:m.status==="finished_successfully"||m.metadata?.finished===true};
  }
  async function getJSON(url,signal){
    const headers=new Headers({accept:"application/json"});if(lastAuth)headers.set("authorization",lastAuth);
    let res=await nativeFetch.call(window,url,{method:"GET",credentials:"include",headers,signal});
    if(res.status===429||res.status===503) {await new Promise(r=>setTimeout(r,1200));res=await nativeFetch.call(window,url,{method:"GET",credentials:"include",headers,signal});}
    if(!res.ok){const error=new Error(`读取对话接口失败：HTTP ${res.status}`);error.status=res.status;throw error;}
    return await res.json();
  }
  function publishMessages(requestId,pageIndex,raw){
    const converted=(raw||[]).map(visible).filter(Boolean);
    for(let i=0;i<converted.length;i+=20){post(requestId,"page",{pageIndex,chunkIndex:i/20,messages:converted.slice(i,i+20)});}
    return converted.length;
  }
  function legacyMessages(data){
    const mapping=data?.mapping;if(!mapping||typeof mapping!=="object")return null;
    const current=String(data.current_node||"");const seen=new Set();const chain=[];let cursor=current;
    while(cursor&&!seen.has(cursor)&&mapping[cursor]&&chain.length<200000){seen.add(cursor);chain.push(mapping[cursor].message||mapping[cursor]);cursor=mapping[cursor].parent||"";}
    return chain.reverse();
  }
  async function capturePaginated(id,requestId,signal){
    const params=new URLSearchParams({include_has_versions:"true",num_turns:String(PAGE_TURNS)});
    const first=await getJSON(`/backend-api/conversations/${encodeURIComponent(id)}?${params}`,signal);
    if(!Array.isArray(first?.messages)||!first.messages.length)throw new Error("分页接口没有返回可解析的消息");
    let data=first,pageIndex=0,before="",messagesTotal=0,previousCursor="";
    const seenIds=new Set(),seenCursors=new Set();let complete=false;
    while(pageIndex<MAX_PAGES){
      if(ownConversation()!==id)throw new Error("源标签页已经切换了对话，已停止采集");
      const rows=data.messages||[];let unique=0;
      for(const m of rows){const k=String(m?.id||m?.message?.id||"");if(k&&!seenIds.has(k)){seenIds.add(k);unique++;}}
      messagesTotal+=publishMessages(requestId,pageIndex,rows);
      post(requestId,"progress",{pageCount:pageIndex+1,messageCount:seenIds.size,phase:"pagination"});
      const info=data.page_info||{};
      if(info.has_previous_page===false){complete=true;break;}
      if(info.has_previous_page!==true)throw new Error("分页接口未返回完整性标记，不能判断是否采集完整");
      before=String(info.start_cursor||rows[0]?.id||rows[0]?.message?.id||"");
      if(!before||seenCursors.has(before)||before===previousCursor||(!unique&&pageIndex>0))throw new Error("分页游标未继续前进，停止以免重复采集");
      seenCursors.add(before);previousCursor=before;
      pageIndex++;
      const query=new URLSearchParams({before,include_has_versions:"true",num_turns:String(PAGE_TURNS)});
      data=await getJSON(`/backend-api/conversations/${encodeURIComponent(id)}/messages?${query}`,signal);
      if(!Array.isArray(data?.messages))throw new Error("历史消息页格式已变化");
    }
    if(!complete)throw new Error(`达到 ${MAX_PAGES} 页保护上限，历史可能不完整`);
    if(!messagesTotal)throw new Error("历史中未返回可见文字消息，无法确认采集效果");
    return {complete:true,mode:"paginated",pageCount:pageIndex+1,count:seenIds.size,notice:"仅采集当前分支可访问的文本内容，图片、文件和其他分支不保证完整"};
  }
  async function captureLegacy(id,requestId,signal){
    const data=await getJSON(`/backend-api/conversation/${encodeURIComponent(id)}`,signal);
    const chain=legacyMessages(data);if(!chain)throw new Error("旧版对话接口无法解析");
    const total=publishMessages(requestId,0,chain);
    if(!total)throw new Error("旧版接口没有可读取的可见文本消息");
    post(requestId,"progress",{pageCount:1,messageCount:total,phase:"legacy"});
    return {complete:true,mode:"legacy-active-path",pageCount:1,count:total,notice:"读取当前选中分支，分叉历史、部分附件和非文本内容可能未包含"};
  }
  async function start({requestId,conversationId}){
    if(active){post(requestId,"error",{message:"此标签页已有采集任务"});return;}
    if(!/^[a-z0-9-]{4,120}$/i.test(conversationId)||conversationId!==ownConversation()){post(requestId,"error",{message:"仅可采集此标签页当前已保存的 ChatGPT 对话"});return;}
    const controller=new AbortController();active={requestId,controller};let paginatedError="";
    // Liveness only, not a trust or authenticity signal. It precedes every
    // asynchronous network request, so the extension knows the bridge ran.
    post(requestId,"accepted",{bridgeProtocol:BRIDGE_PROTOCOL});
    try{
      let result;
      try{result=await capturePaginated(conversationId,requestId,controller.signal);}
      catch(err){paginatedError=String(err?.message||err);if(controller.signal.aborted)throw err;
        // Avoid blending previously published pagination pages into a fallback legacy response.
        post(requestId,"reset",{});
        result=await captureLegacy(conversationId,requestId,controller.signal);
        result.notice=`分页接口不可用（${paginatedError}）；已改用旧版当前分支接口。${result.notice}`;
      }
      post(requestId,"done",result);
    }catch(error){post(requestId,"error",{message:String(error?.message||error),isAbort:controller.signal.aborted,notice:paginatedError});}
    finally{if(active?.requestId===requestId)active=null;}
  }
  window.addEventListener("message",event=>{
    if(event.source!==window||event.origin!==location.origin)return;
    const m=event.data;
    if(m?.channel!==CHANNEL||m.direction!=="extension-to-main")return;
    if(typeof m.requestId!=="string"||m.requestId.length>120)return;
    if(m.kind==="start")start(m);
    if(m.kind==="cancel"&&active?.requestId===m.requestId)active.controller.abort();
  });
})();
