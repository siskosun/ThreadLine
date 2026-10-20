/* Prepare a ChatGPT draft for an explicitly user-requested research continuation. Never presses Send. */
(()=>{
  if(globalThis.__TL_HANDOFF_V2__)return;globalThis.__TL_HANDOFF_V2__=true;
  let data=null,attempts=0,working=false,done=false;
  function send(payload){return new Promise((resolve,reject)=>chrome.runtime.sendMessage(payload,r=>{if(chrome.runtime.lastError)return reject(new Error(chrome.runtime.lastError.message));if(!r?.ok)return reject(new Error(r?.error||"连接研线失败"));resolve(r.data);}));}
  function editor(){return document.querySelector('#prompt-textarea,div[contenteditable="true"][data-lexical-editor],div[contenteditable="true"][data-testid="composer-input"],form [contenteditable="true"]');}
  function banner(message,error=false){
    let host=document.querySelector('#tl-handoff-banner');
    if(!host){host=document.createElement('div');host.id='tl-handoff-banner';host.style.cssText='position:fixed;right:20px;bottom:84px;z-index:2147483646;max-width:320px;padding:14px;background:white;border:1px solid #cbd9e9;box-shadow:0 8px 28px #172c4533;border-radius:13px;font:12px/1.6 system-ui,"Microsoft Yahei",sans-serif;color:#29435c;';document.body.appendChild(host);}
    host.replaceChildren();const text=document.createElement('div');text.textContent=message;host.appendChild(text);
    if(data){const btn=document.createElement('button');btn.textContent='复制接续提示';btn.style.cssText='margin:9px 8px 0 0;padding:7px 10px;border-radius:8px;background:#294d75;color:#fff;border:0;cursor:pointer';btn.onclick=async()=>{try{await navigator.clipboard.writeText(data.text);banner('已复制接续提示。请粘贴到输入框并检查后发送。');}catch{banner('复制失败，请重新点击扩展图标使用接续功能。',true);}};host.appendChild(btn);}
    const close=document.createElement('button');close.textContent='关闭提示';close.style.cssText='padding:7px 9px;border-radius:8px;background:#f1f4f8;border:1px solid #e2e8f0;cursor:pointer';close.onclick=()=>host.remove();host.appendChild(close);
    if(error)host.style.borderColor='#deac92';
  }
  function fill(text){
    const el=editor();if(!el)return false;
    if((el.innerText||el.value||'').trim())return false; // Never overwrite anything the user has typed.
    try{
      el.focus();
      let ok=false;
      if(el.isContentEditable)ok=!!document.execCommand('insertText',false,text);
      else if('value' in el){const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;if(setter)setter.call(el,text);else el.value=text;el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));ok=true;}
      return ok && (el.innerText||el.value||'').trim().length>=Math.min(text.length,40);
    }catch{return false;}
  }
  async function tick(){
    if(done||working)return;working=true;
    try {
      if(!data)data=await send({type:'HANDOFF_GET'});
      if(!data?.text)return;
      attempts++;
      if(fill(data.text)){
        banner('研线已预填研究接续提示。检查内容后按发送；不会自动替你发送。');done=true;
        await send({type:'HANDOFF_ACK'});return;
      }
      if(attempts>=12){banner('无法自动填入 ChatGPT 输入框。请点击下方按钮复制接续提示，手动粘贴。',true);done=true;}
    }catch{}finally{working=false;}
  }
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{if(msg?.type==="TL_HANDOFF_READY"){tick();reply({ok:true});}});
  const timer=setInterval(()=>{tick();if(done||attempts>15)clearInterval(timer);},1300);
  tick();setTimeout(()=>clearInterval(timer),25000);
})();
