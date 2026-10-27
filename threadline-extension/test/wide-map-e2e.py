"""UI-D3: real MV3 Chromium read-only wide map of exactly one captured run.
Entirely synthetic ChatGPT route, no network login, no model sends and no user data.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

EXT=Path(os.environ.get("THREADLINE_EXTENSION_PATH",
    Path(__file__).resolve().parents[1])).resolve()
SOURCE="https://chatgpt.com/c/synthetic-map-source"
RUN="cap_00000000-0000-4000-8000-000000000001"
RUN_B="cap_00000000-0000-4000-8000-000000000002"
SITE="""<!doctype html><html lang="zh-CN"><title>模拟对话</title><body>
<form><div id="prompt-textarea" contenteditable="true"></div></form>
<div data-message-author-role="assistant">虚构研究回答</div>
</body></html>"""


def run():
    with TemporaryDirectory(prefix="threadline-ui-d3-") as profile:
        with sync_playwright() as p:
            context=p.chromium.launch_persistent_context(profile,
                executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
                channel="chromium",headless=True,
                args=["--no-sandbox","--disable-dev-shm-usage",
                      f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"])
            context.route("https://chatgpt.com/**",lambda route:route.fulfill(
                status=200,content_type="text/html; charset=utf-8",body=SITE))
            worker=context.service_workers[0] if context.service_workers else context.wait_for_event(
                "serviceworker",timeout=15000)
            extid=worker.url.split("/")[2]
            source=context.new_page()
            source.goto(SOURCE,wait_until="domcontentloaded")
            panel=context.new_page()
            panel.set_default_timeout(12000)
            panel.goto(f"chrome-extension://{extid}/panel.html",wait_until="domcontentloaded")
            panel.wait_for_function("() => document.querySelector('#library-open')!==null")
            panel.evaluate("""async ([id,url,otherId])=>{
              const now=Date.now();
              const run={id,tabId:42,conversationId:'synthetic-map-source',
                url,title:'虚构固定研究：历史数据验证',status:'done',
                createdAt:now,updatedAt:now,pageCount:1,messageCount:2,
                complete:true,mode:'synthetic-complete',notice:''};
              await ThreadLineCaptureDB.putRun(run);
              await ThreadLineCaptureDB.putPage({
                id,pageIndex:0,chunkIndex:0,
                messages:[
                  {id:'m1',role:'user',
                    content:'请验证历史队列中的增长假设并保留结论可追溯依据。'},
                  {id:'m2',role:'assistant',
                    content:'初步结论：示例指标仍需复算，尚未确认增长原因。下一步建议补充对照组。'}
                ]});
              await chrome.storage.local.set({tl_last_capture_id:id});
              await ThreadLineCaptureDB.putRun({
                ...run,id:otherId,title:'虚构研究 B：独立采集',
                createdAt:now+1,updatedAt:now+1
              });
              await ThreadLineCaptureDB.putPage({
                id:otherId,pageIndex:0,chunkIndex:0,
                messages:[{id:'b1',role:'assistant',
                  content:'第二份独立采集已明确保存，不得显示第一份导图。'}]
              });
            }""",[RUN,SOURCE,RUN_B])
            panel.reload(wait_until="domcontentloaded")
            panel.get_by_role("tab",name="研究整理").click()
            panel.locator("#capture-report").wait_for(state="visible")
            launch=panel.locator("#report-open-wide-map")
            assert launch.is_visible(),"sidebar must expose wide map action"
            assert panel.locator("#map-details").is_hidden(),"map canvas should not crowd sidebar"
            assert panel.locator("#nav-map").is_hidden(),"wide-only navigation must not clutter sidebar"
            existing=len(context.pages)
            with context.expect_page() as tab:
                launch.click()
            library=tab.value
            library.set_default_timeout(15000)
            library.wait_for_load_state("domcontentloaded")
            library.wait_for_function(
                "() => document.documentElement.dataset.surface==='library' && "+
                "document.querySelector('#workspace-map')?.hidden===false")
            library.wait_for_function(
                "() => document.querySelector('#wide-map-status')?.textContent.includes('虚构固定研究')")
            assert library.locator("#nav-map").is_visible()
            assert library.locator("#wide-map-canvas .map-node.root").count()==1
            assert library.locator("#wide-map-canvas .map-node.group").count()>=2
            assert "固定读取本地采集记录" in library.locator("#wide-map-scope").inner_text()
            assert RUN in library.locator("#wide-map-scope").inner_text()
            assert len(context.pages)==existing+1
            # Buttons and group toggles work within the wide, read-only surface.
            before=library.locator("#wide-map-canvas").evaluate("(e)=>e.style.zoom")
            library.locator("#wide-map-plus").click()
            after=library.locator("#wide-map-canvas").evaluate("(e)=>e.style.zoom")
            assert float(after)>float(before)
            group=library.locator("#wide-map-canvas .map-node.group").first
            assert group.get_attribute("aria-expanded")=="true"
            group.click()
            assert library.locator("#wide-map-canvas .map-node.group").first.get_attribute(
                "aria-expanded")=="false"
            # Generic open from sidebar does not open another tab or reset current map.
            panel.bring_to_front()
            panel.locator("#library-open").click()
            assert len(context.pages)==existing+1
            assert library.locator("#workspace-map").is_visible()
            # Explicit map navigation back uses the same tab, not another page.
            panel.bring_to_front()
            panel.locator("#report-open-wide-map").click()
            library.wait_for_function(
                "() => document.querySelector('#wide-map-status')?.textContent.includes('虚构固定研究')")
            assert len(context.pages)==existing+1
            # A new explicit map B intent must win over map A sessionStorage,
            # and choosing A again must restore A without cloning the wide tab.
            switched=panel.evaluate("""async id=>{
              const w=await chrome.windows.getCurrent();
              return await ThreadLineLibrarySurface.open({
                workspace:'map',mapRunId:id,windowId:w.id
              });
            }""",RUN_B)
            assert switched["reused"] is True
            library.wait_for_function(
                "() => document.querySelector('#wide-map-status')?.textContent.includes('虚构研究 B')")
            assert RUN_B in library.locator("#wide-map-scope").inner_text()
            assert RUN not in library.locator("#wide-map-scope").inner_text()
            assert len(context.pages)==existing+1
            panel.bring_to_front()
            panel.locator("#report-open-wide-map").click()
            library.wait_for_function(
                "() => document.querySelector('#wide-map-status')?.textContent.includes('虚构固定研究')")
            assert RUN in library.locator("#wide-map-scope").inner_text()
            assert len(context.pages)==existing+1
            # Navigating the browser source does not silently replace map target.
            source.goto("https://chatgpt.com/c/other-synthetic",wait_until="domcontentloaded")
            library.reload(wait_until="domcontentloaded")
            library.wait_for_function(
                "() => document.querySelector('#wide-map-status')?.textContent.includes('虚构固定研究')")
            assert RUN in library.locator("#wide-map-scope").inner_text()
            assert "无法" not in library.locator("#wide-map-status").inner_text()
            # No hidden read-through to another run or a fake successful import.
            panel.evaluate("id=>ThreadLineCaptureDB.remove(id)",RUN)
            library.reload(wait_until="domcontentloaded")
            library.wait_for_function(
                "() => document.querySelector('#wide-map-status')?.textContent.includes('不存在或已过期')")
            assert library.locator("#wide-map-canvas .map-node").count()==0
            context.close()
            print("PASS UI-D3: explicit run -> same wide tab, local map, no sidebar canvas, zoom/fold, reload identity and expiry")

if __name__=="__main__":
    run()
