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
      panel.locator('#manage-accordion').evaluate('(node)=>node.open=true')
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
      assert verified, 'UI create did not persist project in both worker and local storage'
      state=verified['persisted']
      assert isinstance(state,dict) and state.get('schema')==2, f'v2 schema not persisted: {verified!r}'
      assert verified['background']['revision']==state['revision'], 'worker and persistent revision differ'
      pid=state['projects'][0]['id']
      # The page's UUID route must retain identity when moved into a ChatGPT project URL.
      assert panel.evaluate("() => ThreadLineCore.getChatKey('https://chatgpt.com/g/g-p-123/c/demo-alpha')")=='chat:demo-alpha'
      # Write through the actual MV3 service worker runtime, then close/reopen profile.
      r=panel.evaluate('''async ({pid}) => chrome.runtime.sendMessage({type:'MUTATE',action:{type:'linkChat',key:'chat:demo-alpha',projectId:pid,title:'A',url:'https://chatgpt.com/c/demo-alpha'}})''', {'pid':pid})
      assert r['ok'],r
      r=panel.evaluate('''async ({pid}) => chrome.runtime.sendMessage({type:'MUTATE',action:{type:'updateProject',projectId:pid,patch:{decision:'已经核验的测试结论'}}})''',{'pid':pid})
      assert r['ok'],r
      panel.wait_for_timeout(800)
      # No hidden HTTP calls; this probes the real injected content script on a simulated page.
      tabs=panel.evaluate('''async () => (await chrome.runtime.sendMessage({type:'SNAPSHOT'})).data.tabs''')
      tabid=next(t['id'] for t in tabs if '/c/demo-alpha' in t['url'])
      result=panel.evaluate('''async (tabId) => chrome.runtime.sendMessage({type:'HEALTH_CHECK',tabId})''',tabid)
      assert result['ok'] and result['data']['page']['status']=='basic_ready',result
      backup=panel.evaluate('''async () => chrome.runtime.sendMessage({type:'BACKUP_EXPORT'})''')
      assert backup['ok'] and backup['data']['state']['projects'][0]['knowledgeVersion']==1
      panel.evaluate('''async () => {const db=await ThreadLineCaptureDB.getRun('not-exist');return db;}''')
      ctx.close()
      ctx2,eid2=launch()
      assert eid==eid2,'Extension ID must remain stable in a given browser profile'
      panel2=ctx2.new_page();panel2.goto(f'chrome-extension://{eid2}/panel.html')
      state2=panel2.evaluate("async () => (await chrome.storage.local.get('threadline_state_v1')).threadline_state_v1")
      assert state2['projects'][0]['decision']=='已经核验的测试结论'
      # persistent IndexedDB: real extension origin with transaction support
      panel2.evaluate('''async ()=>ThreadLineCaptureDB.putRun({id:'e2e-run',tabId:1,conversationId:'demo-alpha',status:'done',createdAt:Date.now()})''')
      saved=panel2.evaluate('''async ()=>ThreadLineCaptureDB.getRun('e2e-run')''')
      assert saved['id']=='e2e-run'
      ctx2.close()
    print('PASS: MV3 persistent Chromium + real storage.local + real IndexedDB + UI + readonly selector probe + backup + restart')

if __name__=='__main__':run()
