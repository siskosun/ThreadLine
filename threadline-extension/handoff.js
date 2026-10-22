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
  function editorText(el) {
    if (!el.isContentEditable) return String(el.value ?? '');
    const blocks = el.children ? [...el.children] : [];
    // ProseMirror's innerText includes visual blank lines between block nodes.
    // Only use the structural form when there are multiple block-level nodes;
    // a single wrapper or a plain editor keeps its native innerText.
    const blockLevel = blocks.length > 1 &&
      blocks.every(child => /^(P|PRE|LI|BLOCKQUOTE)$/i.test(child.tagName || ''));
    if (blockLevel)
      return blocks.map(child => String(child.innerText ?? child.textContent ?? '')).join('\n');
    return String(el.innerText ?? '');
  }
  function isEmptyEditor(el) {
    if (!el.isContentEditable) return !String(el.value ?? '').length;
    const rendered = String(el.innerText ?? '');
    const content = String(el.textContent ?? '');
    // ProseMirror renders an otherwise empty editor with one trailing break,
    // which makes innerText look like "\n". A real draft has text nodes,
    // spaces, additional paragraphs/breaks, or non-newline rendered text.
    if (content.length) return false;
    if ((el.querySelectorAll?.('p')?.length || 0) > 1) return false;
    if ((el.querySelectorAll?.('br')?.length || 0) > 1) return false;
    return rendered.replace(/\n/g, '').length === 0;
  }
  function fill(text){
    const el=editor();if(!el)return 'missing';
    // Even an all-whitespace draft belongs to the user. Never overwrite it.
    if(!isEmptyEditor(el))return 'occupied';
    try{
      el.focus();
      let ok=false;
      if(el.isContentEditable)ok=!!document.execCommand('insertText',false,text);
      else if('value' in el){
        const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')?.set;
        if(setter)setter.call(el,text);else el.value=text;
        el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));
        ok=true;
      }
      // A truthy execCommand receipt or a 40-character prefix proves nothing:
      // don't acknowledge incomplete, truncated or newline-damaged drafts.
      return ok && editorText(el)===text ? 'exact' : 'mismatch';
    }catch{return 'mismatch';}
  }
  async function tick(){
    if(done||working)return;working=true;
    try {
      if(!data)data=await send({type:'HANDOFF_GET'});
      if(!data?.text)return;
      attempts++;
      const outcome=fill(data.text);
      if(outcome==='exact'){
        done=true;
        banner('研线已逐字核对预填草稿。检查内容后按发送；不会自动替你发送。');
        await send({type:'HANDOFF_ACK'});return;
      }
      if(outcome==='occupied' || outcome==='mismatch'){
        // Leave the draft untouched (including partial/whitespace text).
        // Never retry insertion or ACK a partial result.
        done=true;
        banner(outcome==='occupied'
          ? '输入框已有草稿，研线不会覆盖或自动发送。可复制接续提示后自行处理。'
          : '草稿填入结果不完整或与原文不一致，未确认成功；请手动检查或复制接续提示。',
          true);
        return;
      }
      if(attempts>=12){banner('无法自动找到 ChatGPT 输入框。请点击下方按钮复制接续提示，手动粘贴。',true);done=true;}
    }catch{}finally{working=false;}
  }
  chrome.runtime.onMessage.addListener((msg,sender,reply)=>{if(msg?.type==="TL_HANDOFF_READY"){tick();reply({ok:true});}});
  const timer=setInterval(()=>{tick();if(done||attempts>15)clearInterval(timer);},1300);
  tick();setTimeout(()=>clearInterval(timer),25000);
})();
