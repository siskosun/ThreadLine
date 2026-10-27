/* Opt-in, experimental ChatGPT web UI adapter for a dedicated extension-created tab.
   No hidden APIs, cookies, token extraction or unattended background scheduling.
   Browser DOM changes and account terms can make this adapter unavailable. */
(() => {
  if (globalThis.__threadlineWebAnalyzerInjected) return;
  globalThis.__threadlineWebAnalyzerInjected = true;
  let busy=false, cancelled=false;
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const textareaSelectors=['#prompt-textarea','[data-testid="prompt-textarea"]','div.ProseMirror[contenteditable="true"]','div[contenteditable="true"][translate="no"]','textarea'];
  const sendSelectors=['[data-testid="send-button"]','[data-testid="composer-send-button"]','button[aria-label="Send prompt"]','button[aria-label="Send message"]'];
  function visible(el){if(!el)return false;const r=el.getBoundingClientRect();const style=getComputedStyle(el);return r.width>0&&r.height>0&&style.display!=='none'&&style.visibility!=='hidden';}
  function composer(){return textareaSelectors.map(s=>document.querySelector(s)).find(visible)||null;}
  function sendButton(){return sendSelectors.map(s=>document.querySelector(s)).find(e=>visible(e)&&!e.disabled)||null;}
  function assistantMessages(){return [...document.querySelectorAll('[data-message-author-role="assistant"]')].filter(el=>visible(el)&&String(el.innerText||el.textContent||'').trim());}
  function streaming(){return !!document.querySelector('[data-testid="stop-button"],button[aria-label="Stop streaming"],button[aria-label*="Stop generating"]');}
  async function wait(getter,timeout,msg){const start=Date.now();while(Date.now()-start<timeout){if(cancelled)throw new Error('网页分析已停止');const v=getter();if(v)return v;await sleep(250);}throw new Error(msg);}
  function textOf(el){return String(el?.innerText??el?.value??el?.textContent??'').replace(/[\u200b-\u200d\ufeff]/g,'').trim();}
  async function insertPrompt(el,prompt){
    el.focus();
    if('value' in el){
      const proto=Object.getPrototypeOf(el),setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
      if(setter)setter.call(el,prompt);else el.value=prompt;
      el.dispatchEvent(new InputEvent('input',{bubbles:true,data:prompt,inputType:'insertText'}));
    }else{
      // ProseMirror needs native editing commands; plain textContent often gets reset.
      document.execCommand('selectAll',false);
      document.execCommand('insertText',false,prompt);
      if(textOf(el)!==prompt){
        el.replaceChildren(document.createTextNode(prompt));
        el.dispatchEvent(new InputEvent('input',{bubbles:true,data:prompt,inputType:'insertText'}));
      }
    }
    await sleep(420);
    if(textOf(el).replace(/\s+/g,' ')!==prompt.replace(/\s+/g,' '))throw new Error('ChatGPT 输入框未接受完整提示；没有点击发送');
  }
  async function ask(prompt){
    if(!prompt||prompt.length>33000)throw new Error('网页模式单次输入过长，请缩短分段大小');
    if(!/chatgpt\.com|chat\.openai\.com/.test(location.hostname))throw new Error('目标不是 ChatGPT 页面');
    const field=await wait(composer,30000,'ChatGPT 网页未出现输入框，请检查是否已登录');
    // Do not overwrite a pre-existing user draft in the dedicated analysis tab.
    if(textOf(field))throw new Error('专用标签页已有未发送的草稿，已停止以避免覆盖');
    const before=assistantMessages().length;
    const userCount=()=>document.querySelectorAll('[data-message-author-role="user"]').length;
    const usersBefore=userCount();
    await insertPrompt(field,prompt);
    const button=await wait(sendButton,9000,'无法找到可用发送按钮，未发送分析请求');
    button.click();
    // A DOM click is not a server receipt. First distinguish an unchanged
    // composer from a possible submission; never click Send a second time.
    await wait(()=>userCount()>usersBefore||textOf(field)===''?true:null,13000,
      '已点击发送按钮，但输入框仍保留提示且未出现用户消息；无法确认发送，未自动重试。请检查专用分析标签页');
    const reply=await wait(()=>assistantMessages().length>before?assistantMessages().at(-1):null,
      95000,'网页可能已发送分析请求，但未识别到新回答；结果未知，未自动重试。请打开专用分析标签页检查回复或模型额度');
    const started=Date.now();let last='',stable=0;
    while(Date.now()-started<260000){
      if(cancelled)throw new Error('网页分析已停止');
      const tail=assistantMessages().at(-1)||reply;
      const text=textOf(tail);
      if(text===last&&text.length>=3)stable+=1;else stable=0;
      last=text;
      if(!streaming()&&stable>=4&&text)return text;
      await sleep(850);
    }
    throw new Error('ChatGPT 回答超时，未采集未完成的输出');
  }
  chrome.runtime.onMessage.addListener((message,_sender,respond)=>{
    if(message?.type==='TL_WEB_STOP'){cancelled=true;respond({ok:true});return false;}
    if(message?.type==='TL_WEB_PING'){respond({ok:true,href:location.href});return false;}
    if(message?.type!=='TL_WEB_ASK')return false;
    if(busy){respond({ok:false,error:'分析标签页仍有正在进行的模型请求'});return false;}
    busy=true;cancelled=false;
    ask(String(message.prompt||'')).then(text=>respond({ok:true,text}),err=>respond({ok:false,error:String(err.message||err)})).finally(()=>{busy=false;});
    return true;
  });
})();
