"""UI-D1: opt-in wide library on exact panel.html, real MV3 and IndexedDB.
All ChatGPT content and projects are synthetic. No real network, login, sending or writes to user data.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

EXT = Path(os.environ.get("THREADLINE_EXTENSION_PATH",
    Path(__file__).resolve().parents[1])).resolve()
SITE = """<!doctype html><html lang="zh-CN"><title>合成来源对话 A</title>
<body><main><div data-message-author-role="assistant">虚构消息</div>
<form><div id="prompt-textarea" contenteditable="true"></div></form></main></body></html>"""


def run():
    with TemporaryDirectory(prefix="threadline-ui-d1-") as profile:
        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                profile,
                executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
                channel="chromium", headless=True,
                args=["--no-sandbox","--disable-dev-shm-usage",
                      f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"]
            )
            context.route("https://chatgpt.com/**",lambda route:route.fulfill(
                status=200,content_type="text/html; charset=utf-8",body=SITE))
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event(
                "serviceworker",timeout=15000)
            extid = worker.url.split("/")[2]
            source = context.new_page()
            source.goto("https://chatgpt.com/c/synthetic-library-source",
                wait_until="domcontentloaded")
            panel = context.new_page()
            panel.set_default_timeout(15000)
            panel.goto(f"chrome-extension://{extid}/panel.html",
                wait_until="domcontentloaded")
            panel.wait_for_selector("#library-open",state="visible")
            panel.wait_for_function("() => document.documentElement.dataset.surface !== 'library'")
            assert panel.get_by_role("tab").count()==3, "unmodified sidebar keeps 3 tabs"
            assert panel.locator("#nav-research").is_visible()

            def send(payload):
                response=panel.evaluate("p=>chrome.runtime.sendMessage(p)",payload)
                assert response and response.get("ok"),response
                return response["data"]

            first=send({"type":"MUTATE","action":{"type":"createProject","name":"测试课题 A"}})
            pid=first["state"]["projects"][0]["id"]
            second=send({"type":"MUTATE","action":{"type":"createProject","name":"测试课题 B"}})
            ids=[x["id"] for x in second["state"]["projects"]]
            other=next(x for x in ids if x!=pid)

            def adopt_one(project_id,name,sequence):
                return send({"type":"EV_ADOPT","projectId":project_id,"text":name,
                    "conditions":"仅限虚构资料",
                    "fragments":[{"kind":"manual","selection":"合成原始依据",
                        "before":"示例：","after":"；结束。",
                        "relation":"supports","completeness":"complete"}],
                    "operationId":f"op_uid1_{sequence:04d}_synthetic"})

            # Each test runs in a disposable profile. This seeds the *real* authority DB.
            # 200 is the planned upper bound for one project's stable conclusions.
            def seed_200(project_id):
                return panel.evaluate("""async projectId=>{
                  const send=payload=>chrome.runtime.sendMessage(payload);
                  for(let i=0;i<200;i++){
                    const text=i===151 ? '唯一目标结论：稀有核查词' : '合成研究结论 '+i;
                    const response=await send({type:'EV_ADOPT',projectId,text,
                      conditions:'只用于合成测试',
                      fragments:[{kind:'manual',selection:'合成原始依据',
                        relation:'supports',completeness:'complete'}],
                      operationId:'op_uid1_bulk_'+String(i).padStart(4,'0')});
                    if(!response?.ok)throw Error('seed '+i+': '+response?.error);
                  }
                  return true;
                }""",project_id)
            assert seed_200(pid)
            adopt_one(other,"另一个课题专属结论",301)
            listing=send({"type":"EV_LIST","projectId":pid})
            assert len(listing["rows"])==200,len(listing["rows"])
            target=next(x for x in listing["rows"]
                        if "稀有核查词" in x["current"]["text"])
            con_id=target["conclusion"]["id"]
            amended=send({"type":"EV_AMEND","conclusionId":con_id,
                "text":"唯一目标结论（修订）：稀有核查词",
                "conditions":"仅限合成的第二版",
                "changeImpact":"substantive","expectedVersionId":target["current"]["id"],
                "operationId":"op_uid1_amend_0301"})
            assert amended

            # The original panel remains usable. Opening library passes the selected evidence project.
            panel.get_by_role("tab",name="证据与交接").click()
            panel.wait_for_function("() => document.querySelector('#evidence-project').options.length >= 2")
            panel.locator("#evidence-project").select_option(pid)
            panel.locator("#evidence-query").fill("稀有核查词")
            panel.locator("#evidence-filter-status").select_option("active")
            with context.expect_page() as opened:
                panel.locator("#library-open").click()
            library=opened.value
            library.set_default_timeout(15000)
            library.wait_for_load_state("domcontentloaded")
            library.wait_for_function("() => document.documentElement.dataset.surface==='library'")
            library.wait_for_function(
                "id => document.querySelector('#evidence-project').value===id",arg=pid)
            assert library.locator("#nav-research").is_hidden()
            assert library.get_by_role("tab").count()==2
            assert library.locator("#library-launch").is_hidden()
            assert library.locator("#library-header").is_visible()
            assert library.locator("#library-open-sidebar").is_visible()
            assert library.locator("#evidence-handoff").is_hidden(), "D1 keeps writes in sidebar"
            library.locator("#evidence-maintenance").wait_for(state="attached")
            assert library.locator("#evidence-maintenance").is_hidden(), "D1 keeps restore and delete in sidebar"
            assert library.locator("#evidence-query").input_value()=="稀有核查词"
            assert library.locator("#evidence-filter-status").input_value()=="active"
            library.wait_for_function(
                "() => document.querySelector('#evidence-list-count').textContent.includes('匹配 1 / 200')")
            library.locator("#evidence-query").fill("")
            library.locator("#evidence-filter-status").select_option("all")
            library.wait_for_function(
                "() => document.querySelector('#evidence-list-count').textContent.includes('匹配 200 / 200')")
            assert library.get_by_text("匹配 200 / 200 条结论").is_visible()
            library.locator("#evidence-query").fill("稀有核查词")
            library.wait_for_function("() => document.querySelector('#evidence-list-count').textContent.includes('匹配 1 / 200')")
            item=library.locator("#evidence-list .evidence-item")
            assert item.count()==1
            if item.get_attribute("open") is None:
                item.locator(":scope > summary").click()
            item.get_by_role("button",name="查看版本历史（2）").click()
            library.wait_for_function(
                "() => document.querySelectorAll('#evidence-list .evidence-history-version').length >= 2")
            versions=item.locator(".evidence-history-version")
            assert versions.count()==2
            versions.first.locator(":scope > summary").click()
            assert "唯一目标结论：稀有核查词" in versions.first.locator(
                ".evidence-history-fulltext").first.inner_text()
            assert "只用于合成测试" in versions.first.inner_text()
            source_details=versions.first.locator(".evidence-history-source")
            assert source_details.count()>=1
            source_details.first.locator(":scope > summary").click()
            assert "合成原始依据" in source_details.first.inner_text()
            versions.nth(1).locator(":scope > summary").click()
            assert "仅限合成的第二版" in versions.nth(1).inner_text()
            assert item.get_by_role("button",name="修订").is_hidden()
            assert item.get_by_role("button",name="撤回").is_hidden()
            # No change to evidence count or versions from read-only browsing.
            fresh=send({"type":"EV_LIST","projectId":pid})
            assert len(fresh["rows"])==200
            fresh_target=next(x for x in fresh["rows"] if x["conclusion"]["id"]==con_id)
            assert len(fresh_target["versions"])==2

            for width in [320,360,480,768,1280]:
                library.set_viewport_size({"width":width,"height":900})
                assert library.evaluate(
                    "() => document.documentElement.scrollWidth <= window.innerWidth+1"),width
                assert library.locator("#nav-evidence").is_visible()
                assert library.locator("#evidence-query").is_visible()
            library.get_by_role("tab",name="课题与对话").click()
            assert library.locator("#current-section").is_hidden()
            assert library.locator("#quick-section").is_hidden()
            assert library.locator("#backup-export").is_hidden()
            assert library.locator("#topic-list .topic-card").count()==2
            library.get_by_role("tab",name="结论与依据").click()
            library.locator("#evidence-project").select_option(other)
            library.wait_for_function(
                "() => document.querySelector('#evidence-summary').textContent.includes('已采纳 1 条')")
            assert "稀有核查词" not in library.locator("#evidence-list").inner_text()
            assert "另一个课题专属结论" in library.locator("#evidence-list").inner_text()

            # A library refresh must preserve this tab's view; the one-shot
            # navigation intent is already consumed and cannot be replayed.
            library.locator("#evidence-filter-status").select_option("active")
            library.locator("#evidence-query").fill("另一个课题")
            assert library.evaluate("""() => {
                const item=JSON.parse(sessionStorage.getItem(
                    ThreadLineLibrarySurface.RELOAD_KEY));
                return item.viewProjectId === document.querySelector('#evidence-project').value
                    && item.query==='另一个课题' && item.filter==='active';
            }""")
            library.reload(wait_until="domcontentloaded")
            library.wait_for_function(
                "() => document.documentElement.dataset.surface==='library'")
            library.wait_for_function(
                "id => document.querySelector('#evidence-project').value===id",arg=other)
            assert library.get_by_role("tab").count()==2
            assert library.locator("#evidence-query").input_value()=="另一个课题"
            assert library.locator("#evidence-filter-status").input_value()=="active"
            library.wait_for_function(
                "() => document.querySelector('#evidence-list-count').textContent.includes('匹配 1 / 1')")
            assert "另一个课题专属结论" in library.locator("#evidence-list").inner_text()
            library.get_by_role("tab",name="课题与对话").click()
            library.locator(f'[data-action="select-project"][data-id="{other}"]').click()
            library.wait_for_function(
                "() => document.querySelector('#detail-section').hidden===false")
            library.reload(wait_until="domcontentloaded")
            library.wait_for_function("() => document.documentElement.dataset.surface==='library'")
            library.wait_for_function("() => document.querySelector('#nav-switch').getAttribute('aria-selected')==='true'")
            library.wait_for_function(
                "id => [...document.querySelectorAll('#topic-list [data-id]')].some(node => node.dataset.id===id && node.getAttribute('aria-pressed')==='true')",
                arg=other)
            library.wait_for_function(
                "id => document.querySelector('#evidence-project').value===id",arg=other)

            # A second library tab receives independent context; no global last-project.
            with context.expect_page() as opened2:
                panel.evaluate("""id => ThreadLineLibrarySurface.open({
                    viewProjectId:id,sourceTabId:null,sourceChatKey:null
                })""",pid)
            other_library=opened2.value
            other_library.wait_for_function(
                "() => document.documentElement.dataset.surface==='library'")
            other_library.wait_for_function(
                "id => document.querySelector('#evidence-project').value===id",arg=pid)
            assert library.locator("#evidence-project").input_value()==other

            # A forged/nonexistent project must not silently fall back to project A/B.
            with context.expect_page() as opened3:
                panel.evaluate("""() => ThreadLineLibrarySurface.open({
                    viewProjectId:'missing-project',sourceTabId:null,sourceChatKey:null
                })""")
            invalid=opened3.value
            invalid.wait_for_function(
                "() => document.documentElement.dataset.surface==='library'")
            invalid.wait_for_function(
                "() => document.querySelector('#evidence-project').value===''")
            assert invalid.locator("#evidence-project option:checked").inner_text().startswith("原课题不可用")
            assert invalid.locator("#evidence-handoff").is_hidden()

            # Direct panel.html tab remains the old three-workspace panel (no valid one-time intent).
            direct=context.new_page()
            direct.goto(f"chrome-extension://{extid}/panel.html",wait_until="domcontentloaded")
            direct.wait_for_function("() => document.querySelector('#nav-switch').getAttribute('aria-selected') === 'true'")
            assert direct.get_by_role("tab").count()==3
            assert direct.locator("#library-header").is_hidden()

            # Explicit source binding must reject changed conversation URL, even on same tab ID.
            source_tab_id=panel.evaluate("""async () => {
                const tabs=await chrome.tabs.query({url:'https://chatgpt.com/*'});
                return tabs.find(t=>t.url.includes('synthetic-library-source'))?.id;
            }""")
            assert isinstance(source_tab_id,int) and source_tab_id>0
            source_key=panel.evaluate("""tabId=>ThreadLineCore.getChatKey(
                'https://chatgpt.com/c/synthetic-library-source',tabId)""",source_tab_id)
            with context.expect_page() as opened4:
                panel.evaluate("""args=>ThreadLineLibrarySurface.open(args)""",
                    {"viewProjectId":pid,"sourceTabId":source_tab_id,"sourceChatKey":source_key})
            scoped=opened4.value
            scoped.wait_for_function(
                "() => document.documentElement.dataset.surface==='library'")
            assert "来源对话：" in scoped.locator("#library-context-text").inner_text()
            source.goto("https://chatgpt.com/c/synthetic-library-changed",
                wait_until="domcontentloaded")
            scoped.locator("#library-return").click()
            scoped.wait_for_function(
                "() => document.querySelector('#critical-notice').hidden===false")
            assert "原来源标签已关闭或不再是 ChatGPT" in scoped.locator("#critical-notice-text").inner_text()
            assert scoped.locator("#library-header").is_visible()
            context.close()
    print("PASS: UI-D1 exact trusted panel wide page; 200-item search, old versions, independent contexts, source identity and fail-closed guards")


if __name__=="__main__":
    run()
