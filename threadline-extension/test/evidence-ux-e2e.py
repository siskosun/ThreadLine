"""Genuine Chromium MV3 test of first-run evidence panel UX.

Disposable profile, no login, external messages, or ChatGPT send action.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect

EXT=Path(os.environ.get("THREADLINE_EXTENSION_PATH",Path(__file__).resolve().parents[1])).resolve()

def run():
    with TemporaryDirectory(prefix="threadline-evidence-ux-") as profile:
        with sync_playwright() as playwright:
            context=playwright.chromium.launch_persistent_context(
                profile,executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
                channel="chromium",headless=True,args=["--no-sandbox","--disable-dev-shm-usage",
                    f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"])
            worker=context.service_workers[0] if context.service_workers else \
                context.wait_for_event("serviceworker",timeout=15000)
            eid=worker.url.split("/")[2]
            panel=context.new_page()
            panel.goto(f"chrome-extension://{eid}/panel.html",wait_until="domcontentloaded")
            expect(panel.locator("#nav-evidence")).to_be_visible(timeout=15000)
            tabs=panel.locator(".workspace-tabs [data-workspace]")
            assert tabs.count()==3
            for width in [320,360,400,480]:
                panel.set_viewport_size({"width":width,"height":740})
                positions=tabs.evaluate_all("""nodes=>nodes.map(n=>{
                  const r=n.getBoundingClientRect();
                  return {x:r.x,y:r.y,w:r.width,right:r.right};
                })""")
                assert all(abs(p["y"]-positions[0]["y"])<=1 for p in positions),(
                    "tabs must occupy one row",width,positions)
                assert len(set(round(p["x"]) for p in positions))==3,positions
                assert panel.evaluate("""() => document.documentElement.scrollWidth
                  <= document.documentElement.clientWidth+1"""),(
                    "horizontal overflow",width)
            panel.locator("#nav-evidence").click()
            expect(panel.locator("#workspace-evidence")).to_be_visible()
            expect(panel.locator("#evidence-empty")).to_be_visible(timeout=12000)
            expect(panel.locator("#evidence-go-create")).to_be_visible()
            expect(panel.locator("#evidence-go-research")).to_be_hidden()
            assert panel.locator("#evidence-project").is_disabled()
            expect(panel.locator("#evidence-project option")).to_have_text("尚无课题")
            assert panel.locator("#evidence-handoff").is_disabled()
            panel.locator("#evidence-go-create").click()
            expect(panel.locator("#workspace-switch")).to_be_visible()
            assert panel.locator("#manage-accordion").evaluate("e=>e.open")
            assert panel.evaluate("document.activeElement?.id")=="topic-name"
            panel.locator("#topic-name").fill("合成首次使用课题")
            panel.locator("#create-form button[type=submit]").click()
            expect(panel.locator("#stat-active")).to_have_text("1")
            panel.locator("#nav-evidence").click()
            expect(panel.locator("#evidence-go-research")).to_be_visible(timeout=12000)
            expect(panel.locator("#evidence-go-create")).to_be_hidden()
            assert not panel.locator("#evidence-project").is_disabled()
            assert panel.locator("#evidence-project").input_value()!=""
            assert panel.locator("#evidence-handoff").is_disabled()
            panel.locator("#evidence-go-research").click()
            expect(panel.locator("#workspace-research")).to_be_visible()
            assert panel.evaluate("document.activeElement?.id")=="capture-source"
            panel.locator("#nav-research").focus()
            panel.keyboard.press("ArrowRight")
            expect(panel.locator("#workspace-evidence")).to_be_visible()
            expect(panel.locator("#nav-evidence")).to_have_attribute("aria-selected","true")
            assert panel.evaluate("document.activeElement?.id")=="nav-evidence"
            context.close()
    print("PASS: S1 empty-state Chromium MV3, three tabs on 320-480px, keyboard focus, project/research actions; no sends")

if __name__=="__main__":
    run()
