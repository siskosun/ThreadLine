"""Offline Chromium smoke tests for project creation, moving, archiving and fail-closed behavior.
Requires installed python playwright + chromium, no ChatGPT login/network calls."""
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parent.parent
HTML="""<!doctype html><html><head><meta charset='utf-8'></head><body>
  <nav aria-label='Chat history' style='width:300px; min-height:200px'>
   <button id='new-project'>New project</button>
   <ul id='chats'>
    <li id='chat-row'><a href='/c/source-123'>研究对话标题</a><button aria-haspopup='menu' id='more'>More options</button></li>
   </ul><div id='project-links'></div>
  </nav>
  <div id='popups'></div>
  <script>
  window.chrome={runtime:{onMessage:{addListener:(cb)=>{window.__threadlineMessage=cb;}}}};
  const box=document.getElementById('popups'), projectLinks=document.getElementById('project-links');
  document.getElementById('new-project').addEventListener('click',()=>{
    box.innerHTML=`<div role='dialog' style='border:1px solid #888;padding:12px'>
      <label>Project name <input type='text' placeholder='Project name'></label>
      <button id='submit-project'>Create project</button>
    </div>`;
    document.getElementById('submit-project').addEventListener('click',()=>{
      const name=box.querySelector('input').value;
      if(!name)return;
      const a=document.createElement('a');a.href='/g/g-p-mock123/project';a.textContent=name;projectLinks.appendChild(a);
      window.__mockPath='/g/g-p-mock123/project';box.replaceChildren();
    });
  });
  document.getElementById('more').addEventListener('click',()=>{
    box.innerHTML=`<div role='menu'><button role='menuitem' id='move'>Move to project</button><button role='menuitem' id='archive'>Archive</button></div>`;
    document.getElementById('move').addEventListener('click',()=>{
      box.innerHTML=`<div role='menu'><button role='menuitem' id='choose-project'>季度收入预测验证</button></div>`;
      document.getElementById('choose-project').addEventListener('click',()=>{
        window.__mockPath='/g/g-p-mock123/c/source-123';box.replaceChildren();
      });
    });
    document.getElementById('archive').addEventListener('click',()=>{
      document.getElementById('chat-row').remove();box.replaceChildren();window.__mockPath='/';
    });
  });
  window.__send=(msg)=>new Promise(resolve=>window.__threadlineMessage(msg,{},resolve));
  </script>
 </body></html>"""

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path='/usr/bin/chromium',headless=True,args=['--no-sandbox'])
    def test_page(path):
        page=browser.new_page()
        page.set_content(HTML)
        page.evaluate('window.__mockPath = '+repr(path))
        page.add_script_tag(path=str(ROOT/'organize-core.js'))
        page.evaluate(r'''() => {
          ThreadLineOrganizeCore.allowedChatUrl = () => true;
          ThreadLineOrganizeCore.chatId = url => ((url==='about:blank'?window.__mockPath:new URL(url, 'https://chatgpt.com').pathname)).match(/(?:^|\/)c\/([a-zA-Z0-9_-]+)/)?.[1] || '';
          ThreadLineOrganizeCore.projectId = url => ((url==='about:blank'?window.__mockPath:new URL(url, 'https://chatgpt.com').pathname)).match(/(?:^|\/)g\/(g-p-[a-zA-Z0-9_-]+)/)?.[1] || '';
        }''')
        page.add_script_tag(path=str(ROOT/'organize-page.js'))
        return page
    helper=test_page('/')
    created=helper.evaluate("() => __send({type:'TL_ORG_CREATE',name:'季度收入预测验证'})")
    assert created['ok'] and created['data']['status']=='created', created
    assert created['data']['id']=='g-p-mock123', created
    assert helper.evaluate('window.__mockPath')=='/g/g-p-mock123/project'
    print('PASS create project through UI')
    helper.close()
    source=test_page('/c/source-123')
    moved=source.evaluate("() => __send({type:'TL_ORG_MOVE',conversationId:'source-123',name:'季度收入预测验证',projectId:'g-p-mock123'})")
    assert moved['ok'] and moved['data']['status']=='moved',moved
    assert source.evaluate('window.__mockPath')=='/g/g-p-mock123/c/source-123'
    print('PASS move selected conversation through UI')
    source.close()
    archive_page=test_page('/c/source-123')
    wrong=archive_page.evaluate("() => __send({type:'TL_ORG_ARCHIVE',conversationId:'other'})")
    assert not wrong['ok'] and '源标签页' in wrong['error'],wrong
    assert archive_page.locator('#chat-row').count()==1
    print('PASS fail closed for wrong conversation')
    archived=archive_page.evaluate("() => __send({type:'TL_ORG_ARCHIVE',conversationId:'source-123'})")
    assert archived['ok'] and archived['data']['status']=='archived',archived
    assert archive_page.locator('#chat-row').count()==0
    print('PASS archive selected conversation without deletion')
    archive_page.close()
    browser.close()
