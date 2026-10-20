"""Offline DOM send-guard matrix. Real ChatGPT UI may differ; not a live-site test."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
  page=browser.new_page()
  page.set_content('''<html><body><form id="composer-form"><div id="prompt-textarea" contenteditable="true">测试</div><button data-testid="send-button" type="submit">发送</button></form>
  <div id="regenerate"><button data-testid="regenerate-response">重新生成</button></div>
  </body></html>''')
  page.evaluate('''() => {
    const data={key:'chat:a',project:{id:'p',name:'已收口课题',stage:'closed',closedAt:5,decision:'测试结论',knowledgeVersion:2},chat:{key:'chat:a',stage:'active',seenVersion:1,title:'测试'}};
    window.chrome={runtime:{id:'test',lastError:null,sendMessage:(m,reply)=>reply({ok:true,data})},storage:{onChanged:{addListener(){}}}};
    const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(p){return attach.call(this,{...p,mode:'open'})};
  }''')
  page.add_script_tag(content=(ROOT/'vendor/shadow-helpers.js').read_text())
  page.add_script_tag(content=(ROOT/'selectors.js').read_text())
  page.add_script_tag(content=(ROOT/'content.js').read_text())
  page.wait_for_function("document.getElementById('threadline-shadow-root')?.shadowRoot?.getElementById('modal')")
  events=page.evaluate('''() => {
    const prompt=document.getElementById('prompt-textarea'),btn=document.querySelector('[data-testid=send-button]'),form=document.getElementById('composer-form');
    function key(options){return prompt.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...options}))}
    const result={enter:key({}),ctrlEnter:key({ctrlKey:true}),shiftEnter:key({shiftKey:true}),composingEnter:key({isComposing:true}),
       pointer:btn.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true})),click:btn.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true})),
       submit:form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})),
       regenerate:document.querySelector('[data-testid=regenerate-response]').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))};
    return result;
  }''')
  assert events['enter']==False and events['ctrlEnter']==False
  assert events['pointer']==False and events['click']==False and events['submit']==False
  assert events['shiftEnter']==True and events['composingEnter']==True
  assert events['regenerate']==True,'Regeneration is not a new user send; explicit scope guard'
  print('PASS send guard: Enter/Ctrl+Enter/pointer/click/submit blocked; Shift+Enter/IME/regenerate allowed')
  browser.close()
