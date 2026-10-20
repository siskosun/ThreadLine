"""Offline ChatGPT-like DOM verifies stale is a warning and closure is a send guard."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1024,'height':768})
 page.set_content('''<html><head><title>分支 B - ChatGPT</title></head><body>
 <form><div id="prompt-textarea" contenteditable="true">正在研究</div><button data-testid="send-button" type="submit">发送</button></form>
 </body></html>''')
 page.evaluate('''() => {
   const data={key:'chat:b',project:{id:'p1',name:'收入预测研究',goal:'验证新假设',decision:'最新结论：参数方案已更新',stage:'active',knowledgeVersion:2,lastChange:{label:'有效结论已更新'}},chat:{key:'chat:b',title:'B',label:'B 分支',stage:'active',seenVersion:1}};
   window.__ctx=data;const listeners=[];
   const native=Element.prototype.attachShadow;
   Element.prototype.attachShadow=function(opt){return native.call(this,{...opt,mode:'open'});};
   window.chrome={runtime:{id:'test',lastError:null,sendMessage:(msg,cb)=>setTimeout(()=>{
     if(msg.type==='ACK_PAGE'){data.chat.seenVersion=data.project.knowledgeVersion;}
     cb({ok:true,data:structuredClone(data)});
   },0)},storage:{onChanged:{addListener:fn=>listeners.push(fn)}}};
   window.__refreshContext=()=>listeners.forEach(fn=>fn({threadline_state_v1:{}},'local'));
 }''')
 page.add_script_tag(content=(ROOT/'vendor/shadow-helpers.js').read_text())
 page.add_script_tag(content=(ROOT/'content.js').read_text())
 page.wait_for_function("document.getElementById('threadline-shadow-root')?.shadowRoot?.getElementById('warning')?.hidden === false")
 assert '状态已更新' in page.evaluate("document.getElementById('threadline-shadow-root').shadowRoot.getElementById('heading').textContent")
 can_send=page.evaluate("() => {let e=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});return document.getElementById('prompt-textarea').dispatchEvent(e)}")
 assert can_send, 'stale information should never prevent message submission'
 page.evaluate("document.getElementById('threadline-shadow-root').shadowRoot.getElementById('ack-branch').click()")
 page.wait_for_function("document.getElementById('threadline-shadow-root').shadowRoot.getElementById('warning').hidden === true")
 page.evaluate("() => {window.__ctx.project.stage='closed';window.__ctx.project.closedAt=5000;window.__ctx.project.knowledgeVersion=3;window.__refreshContext()}")
 page.wait_for_function("document.getElementById('threadline-shadow-root').shadowRoot.getElementById('heading').textContent.includes('收口')")
 blocked=page.evaluate("() => {let e=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});return !document.getElementById('prompt-textarea').dispatchEvent(e)}")
 assert blocked,'closed project must trigger the existing send guard'
 print('PASS overlay: stale is informational, explicit acknowledgement works, closure still guards sending')
 browser.close()
