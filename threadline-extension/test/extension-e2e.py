"""Real MV3 Chromium persistent-context smoke test with a synthetic ChatGPT DOM.
No real accounts or network calls. Use actual extension APIs, service worker and IndexedDB.
"""
from pathlib import Path
import os
from time import monotonic, sleep
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

EXT = Path(__file__).resolve().parents[1]
SITE = '''<!doctype html><html lang="zh-CN"><head><title>研究分支 A</title></head><body>
<aside aria-label="chat history"><a href="/c/demo-alpha">研究分支 A</a></aside>
<main><div data-message-author-role="assistant">一个测试回答</div>
<form id="composer-form"><div id="prompt-textarea" contenteditable="true"></div><button data-testid="send-button" type="submit">发送</button></form></main>
<script>window.submitCount=0;document.getElementById('composer-form').addEventListener('submit',e=>{e.preventDefault();window.submitCount++});</script>
</body></html>'''


def run():
  with TemporaryDirectory(prefix='threadline-profile-') as profile:
    with sync_playwright() as p:
      def launch():
        ctx=p.chromium.launch_persistent_context(profile,executable_path=os.environ.get('THREADLINE_CHROMIUM_PATH') or None,channel='chromium',headless=True,
          args=['--no-sandbox','--disable-dev-shm-usage',f'--disable-extensions-except={EXT}',f'--load-extension={EXT}'])
        ctx.route('https://chatgpt.com/**', lambda route: route.fulfill(status=200, content_type='text/html; charset=utf-8',body=SITE))
        worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event('serviceworker',timeout=15000)
        eid=worker.url.split('/')[2]
        return ctx,eid
      ctx,eid=launch()
      chat=ctx.new_page();chat.goto('https://chatgpt.com/c/demo-alpha',wait_until='domcontentloaded')
      panel=ctx.new_page();panel.goto(f'chrome-extension://{eid}/panel.html',wait_until='domcontentloaded')
      panel.wait_for_selector('#backup-export',state='attached',timeout=15000)
      # Real browser metadata, not a forged MessageSender fixture: top-level
      # panel stays authorized, the same URL inside a child frame must not be.
      contexts=panel.evaluate("""async () => chrome.runtime.getContexts({
        contextTypes:['TAB'],documentUrls:[chrome.runtime.getURL('panel.html')]
      })""")
      assert len(contexts)==1 and contexts[0]['documentId'], contexts
      assert contexts[0]['frameId']==0, contexts
      assert contexts[0]['documentOrigin']==f'chrome-extension://{eid}', contexts
      panel.evaluate("""() => {const f=document.createElement('iframe');
        f.id='sender-test-frame';f.src=chrome.runtime.getURL('panel.html');document.body.append(f);}""")
      frame=panel.frame_locator('#sender-test-frame')
      frame.locator('#backup-export').wait_for(state='attached',timeout=15000)
      child=next(f for f in panel.frames if f.parent_frame==panel.main_frame)
      before_pages=len(ctx.pages)
      rejected=child.evaluate("""async () => chrome.runtime.sendMessage({
        type:'NEW_CHAT',handoff:'CHILD FRAME MUST NOT OPEN CHAT'
      })""")
      assert rejected['ok'] is False and rejected['code']=='PANEL_SOURCE_REJECTED', rejected
      assert rejected['sourceCheck']['reason']=='FRAME_MISMATCH', rejected
      assert len(ctx.pages)==before_pages, 'unauthorized child created a tab'
      assert '://' not in str(rejected), 'diagnostic leaked a URL'
      panel.locator('#sender-test-frame').evaluate('(f)=>f.remove()')
      assert chat.evaluate('window.submitCount')==0
      panel.locator('#manage-accordion').evaluate('(node)=>node.open=true')
      readability=panel.evaluate("""() => {
        const read=(selector,background)=>{
          const style=getComputedStyle(document.querySelector(selector));
          return {selector,font:parseFloat(style.fontSize),color:style.color,
            background:getComputedStyle(document.querySelector(background)).backgroundColor};
        };
        return [read('.brand-text p','body'),read('#nav-research','.workspace-tabs'),
          read('.manage-desc','.manage-accordion'),read('.manage-content .stat span','.stat'),
          read('.quick-empty','.quick-section')];
      }""")
      def contrast(foreground,background):
        def luminance(color):
          channels=[float(value) for value in color.removeprefix('rgb(').removesuffix(')').split(',')]
          linear=[value/255/12.92 if value/255<=0.04045 else ((value/255+0.055)/1.055)**2.4 for value in channels]
          return sum(value*weight for value,weight in zip(linear,[0.2126,0.7152,0.0722]))
        high,low=sorted([luminance(foreground),luminance(background)],reverse=True)
        return (high+0.05)/(low+0.05)
      for sample in readability:
        assert sample['font']>=12,sample
        assert contrast(sample['color'],sample['background'])>=4.5,sample
      panel.get_by_role('tab',name='证据与交接').click()
      panel.get_by_role('button',name='创建课题',exact=True).click()
      assert panel.locator('#manage-accordion').get_attribute('open') is not None
      assert panel.evaluate('document.activeElement.id')=='topic-name'
      panel.locator('#topic-name').fill('真实扩展模拟验收')
      panel.locator('#create-form button[type=submit]').click()
      # The write is complete only once both the background snapshot and the
      # persistent chrome.storage record agree. The UI may rerender sooner.
      # Playwright wait_for_function treats a returned Promise as truthy;
      # do NOT pass an async predicate there. page.evaluate does await it.
      verified=None
      deadline=monotonic()+15
      while monotonic()<deadline:
        verified=panel.evaluate("""async () => {
          const [reply,record]=await Promise.all([
            chrome.runtime.sendMessage({type:'SNAPSHOT'}),
            chrome.storage.local.get('threadline_state_v1')
          ]);
          const stored=record?.threadline_state_v1;
          if (reply?.ok && reply.data?.state?.projects?.length===1 && stored?.projects?.length===1)
            return {persisted:stored,background:reply.data.state};
          return null;
        }""")
        if verified: break
        sleep(0.15)
      if not verified:
        diagnostic=panel.evaluate("""async () => {
          const snapshot=await chrome.runtime.sendMessage({type:'SNAPSHOT'});
          const stored=await chrome.storage.local.get(null);
          return {snapshot,stored,toast:document.querySelector('#toast')?.textContent,
            location:location.href,ready:document.readyState,js:typeof ThreadLineCore};
        }""")
        raise AssertionError(f'UI create was not persisted: {diagnostic!r}'[:3200])
      state=verified['persisted']
      assert isinstance(state,dict) and state.get('schema')==2, f'v2 schema not persisted: {verified!r}'
      assert verified['background']['revision']==state['revision'], 'worker and persistent revision differ'
      pid=state['projects'][0]['id']
      # Hold the successful create acknowledgement after the write commits.
      # Selecting another topic before releasing it must remain the user's choice.
      panel.locator('[data-action="select-project"][data-id="' + pid + '"]').click()
      panel.evaluate("""() => {
        const original=chrome.runtime.sendMessage.bind(chrome.runtime);
        window.__originalCreateSendMessage=original;
        window.__releaseCreate=null;
        window.__createdCreateResponse=null;
        chrome.runtime.sendMessage=(payload,callback)=>{
          if(payload?.type==='MUTATE'&&payload.action?.type==='createProject'){
            return original(payload,response=>{
              window.__createdCreateResponse=response;
              window.__releaseCreate=()=>callback(response);
            });
          }
          return original(payload,callback);
        };
      }""")
      panel.locator('#topic-name').fill('延迟回包课题')
      panel.locator('#create-form button[type=submit]').click()
      panel.wait_for_function("() => typeof window.__releaseCreate === 'function'")
      panel.wait_for_function("() => document.querySelectorAll('#topic-list .topic-card').length === 2")
      panel.locator('[data-action="select-project"][data-id="' + pid + '"]').click()
      panel.evaluate("() => window.__releaseCreate()")
      panel.wait_for_function("id => [...document.querySelectorAll('#topic-list .topic-card')].some(n=>n.dataset.id===id&&n.getAttribute('aria-pressed')==='true')",
        arg=pid)
      delayed_result=panel.evaluate("() => window.__createdCreateResponse")
      assert delayed_result['ok'],delayed_result
      delayed_id=delayed_result['data']['result']['projectId']
      assert panel.locator('#topic-list [data-id="' + pid + '"]').get_attribute('aria-pressed')=='true'
      assert panel.locator('#topic-list [data-id="' + delayed_id + '"]').get_attribute('aria-pressed')=='false'
      panel.evaluate("""() => {
        if(window.__originalCreateSendMessage) chrome.runtime.sendMessage=window.__originalCreateSendMessage;
        for(const key of ['__originalCreateSendMessage','__createdCreateResponse','__releaseCreate']) delete window[key];
      }""")
      panel.get_by_role('tab',name='证据与交接').click()
      panel.get_by_role('button',name='打开研究整理',exact=True).click()
      assert panel.locator('#workspace-research').is_visible()
      panel.get_by_role('tab',name='对话切换').click()
      # The page's UUID route must retain identity when moved into a ChatGPT project URL.
      assert panel.evaluate("() => ThreadLineCore.getChatKey('https://chatgpt.com/g/g-p-123/c/demo-alpha')")=='chat:demo-alpha'
      # Write through the actual MV3 service worker runtime, then close/reopen profile.
      r=panel.evaluate('''async ({pid}) => chrome.runtime.sendMessage({type:'MUTATE',action:{type:'linkChat',key:'chat:demo-alpha',projectId:pid,title:'A',url:'https://chatgpt.com/c/demo-alpha'}})''', {'pid':pid})
      assert r['ok'],r
      panel.wait_for_selector('[data-action="label-chat"][data-key="chat:demo-alpha"]')
      panel.locator('[data-action="label-chat"][data-key="chat:demo-alpha"]').click()
      panel.locator('dialog.tl-dialog #tl-field-label').fill('A · 人工核验')
      panel.locator('dialog.tl-dialog button[type=submit]').click()
      panel.wait_for_function("() => !document.querySelector('dialog.tl-dialog')")
      assert panel.evaluate("document.activeElement?.dataset?.action")=='label-chat'
      current=panel.evaluate("async () => (await chrome.runtime.sendMessage({type:'SNAPSHOT'})).data.state")
      assert current['chats']['chat:demo-alpha']['label']=='A · 人工核验',current
      panel.locator('[data-action="note-chat"][data-key="chat:demo-alpha"]').click()
      panel.locator('dialog.tl-dialog #tl-field-note').fill('等待模型复核')
      panel.locator('dialog.tl-dialog button[type=submit]').click()
      panel.wait_for_function("() => !document.querySelector('dialog.tl-dialog')")
      current=panel.evaluate("async () => (await chrome.runtime.sendMessage({type:'SNAPSHOT'})).data.state")
      assert current['chats']['chat:demo-alpha']['note']=='等待模型复核',current
      # A failed acknowledgement stays visible and does not trigger a retry.
      panel.evaluate("""() => {
        const original=chrome.runtime.sendMessage.bind(chrome.runtime);
        window.__restoreSendMessage=()=>{chrome.runtime.sendMessage=original;};
        window.__updateChatCalls=0;
        chrome.runtime.sendMessage=(payload,callback)=>{
          if(payload?.type==='MUTATE'&&payload.action?.type==='updateChat'&&
             Object.prototype.hasOwnProperty.call(payload.action.patch||{},'note')){
            window.__updateChatCalls++;
            callback({ok:false,error:'SIMULATED_UPDATE_FAILURE'});
            return;
          }
          return original(payload,callback);
        };
      }""")
      panel.locator('[data-action="note-chat"][data-key="chat:demo-alpha"]').click()
      panel.locator('dialog.tl-dialog #tl-field-note').fill('这次保存应失败且保留输入')
      panel.locator('dialog.tl-dialog button[type=submit]').click()
      panel.wait_for_function("() => document.querySelector('#critical-notice')?.hidden===false")
      assert 'SIMULATED_UPDATE_FAILURE' in panel.locator('#critical-notice-text').inner_text()
      assert panel.locator('dialog.tl-dialog #tl-field-note').input_value()=='这次保存应失败且保留输入'
      panel.wait_for_timeout(3300)
      assert panel.locator('#critical-notice').is_visible(), 'critical error must outlive the transient toast'
      assert panel.evaluate('window.__updateChatCalls')==1, 'failed save must not auto-replay'
      current=panel.evaluate("async () => (await chrome.runtime.sendMessage({type:'SNAPSHOT'})).data.state")
      assert current['chats']['chat:demo-alpha']['note']=='等待模型复核',current
      panel.locator('dialog.tl-dialog button',has_text='取消').click()
      assert panel.evaluate("document.activeElement?.dataset?.action")=='note-chat'
      panel.evaluate('window.__restoreSendMessage()')
      panel.locator('#critical-notice-dismiss').click()
      assert panel.locator('#critical-notice').is_hidden()
      r=panel.evaluate('''async ({pid}) => chrome.runtime.sendMessage({type:'MUTATE',action:{type:'updateProject',projectId:pid,patch:{decision:'已经核验的测试结论'}}})''',{'pid':pid})
      assert r['ok'],r
      panel.wait_for_timeout(800)
      # No hidden HTTP calls; this probes the real injected content script on a simulated page.
      tabs=panel.evaluate('''async () => (await chrome.runtime.sendMessage({type:'SNAPSHOT'})).data.tabs''')
      tabid=next(t['id'] for t in tabs if '/c/demo-alpha' in t['url'])
      result=panel.evaluate('''async (tabId) => chrome.runtime.sendMessage({type:'HEALTH_CHECK',tabId})''',tabid)
      assert result['ok'] and result['data']['page']['status']=='basic_ready',result
      # Reproduce the reported Edge DOM shape: recognized composer form with a
      # bare submit button and unattributed user/assistant text candidates.
      chat.evaluate('''() => {
        document.querySelector('#composer-form button[type="submit"]').removeAttribute('data-testid');
        document.querySelector('main').insertAdjacentHTML('beforeend',
          '<div class="whitespace-pre-wrap">probe user</div><p>probe assistant</p>');
      }''')
      observed=panel.evaluate('''async (tabId) => chrome.runtime.sendMessage({type:'HEALTH_CHECK',tabId})''',tabid)
      assert observed['ok'],observed
      checked=observed['data']['page']['parts']
      assert checked['sendButton']['available'] and checked['sendButton']['method']=='recognized_composer_form',checked
      assert checked['conversation']['available'], 'Existing strong message role selector should retain priority'
      # Remove the role evidence to test the conservative candidate-only fallback.
      chat.evaluate('''() => document.querySelector('[data-message-author-role]').removeAttribute('data-message-author-role')''')
      weak=panel.evaluate('''async (tabId) => chrome.runtime.sendMessage({type:'HEALTH_CHECK',tabId})''',tabid)
      assert weak['ok'],weak
      assert not weak['data']['page']['parts']['conversation']['available'],weak
      assert weak['data']['page']['parts']['conversation']['candidate'],weak
      def health_for(url):
        tid=panel.evaluate('''async url => (await chrome.tabs.query({})).find(t=>t.url===url)?.id''',url)
        assert isinstance(tid,int), f'missing test tab {url}'
        observed=panel.evaluate('''async tabId => chrome.runtime.sendMessage({type:'HEALTH_CHECK',tabId})''',tid)
        assert observed['ok'],observed
        return observed['data']['page']
      plain=health_for('https://chatgpt.com/c/demo-alpha')
      assert plain['pageType']=='plain_chat' and plain['forkAllowed'] is True,plain
      project=ctx.new_page();project.goto('https://chatgpt.com/g/g-p-123/c/demo-alpha',wait_until='domcontentloaded');project.wait_for_timeout(500)
      project_health=health_for('https://chatgpt.com/g/g-p-123/c/demo-alpha')
      assert project_health['pageType']=='project_chat' and project_health['forkAllowed'] is False,project_health
      temporary=ctx.new_page();temporary.goto('https://chatgpt.com/?temporary-chat=true',wait_until='domcontentloaded');temporary.wait_for_timeout(500)
      temporary_health=health_for('https://chatgpt.com/?temporary-chat=true')
      assert temporary_health['pageType']=='temporary_chat' and temporary_health['forkAllowed'] is False,temporary_health
      backup=panel.evaluate('''async () => chrome.runtime.sendMessage({type:'BACKUP_EXPORT'})''')
      assert backup['ok'] and next(p for p in backup['data']['state']['projects'] if p['id']==pid)['knowledgeVersion']==1
      assert chat.evaluate('window.submitCount')==0
      panel.evaluate('''async () => {const db=await ThreadLineCaptureDB.getRun('not-exist');return db;}''')
      ctx.close()
      ctx2,eid2=launch()
      assert eid==eid2,'Extension ID must remain stable in a given browser profile'
      panel2=ctx2.new_page();panel2.goto(f'chrome-extension://{eid2}/panel.html')
      state2=panel2.evaluate("async () => (await chrome.storage.local.get('threadline_state_v1')).threadline_state_v1")
      assert next(p for p in state2['projects'] if p['id']==pid)['decision']=='已经核验的测试结论'
      # persistent IndexedDB: real extension origin with transaction support
      panel2.evaluate('''async ()=>ThreadLineCaptureDB.putRun({id:'e2e-run',tabId:1,conversationId:'demo-alpha',status:'done',createdAt:Date.now()})''')
      saved=panel2.evaluate('''async ()=>ThreadLineCaptureDB.getRun('e2e-run')''')
      assert saved['id']=='e2e-run'
      ctx2.close()
    print('PASS: MV3 persistent Chromium + real panel context + child-frame NEW_CHAT denied before tab creation + real storage.local + real IndexedDB + UI + readonly selector probe + backup + restart')

if __name__=='__main__':run()
