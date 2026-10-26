"""Actual MV3 toolbar badge changes with topic versions in disposable Chromium.

No ChatGPT account, synthetic project/links only, and no message Send.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

EXT=Path(os.environ.get("THREADLINE_EXTENSION_PATH",Path(__file__).resolve().parents[1])).resolve()

def run():
    with TemporaryDirectory(prefix="threadline-review-badge-") as profile:
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
            panel.wait_for_selector("#nav-switch",timeout=15000)

            def send(action):
                result=panel.evaluate("a=>chrome.runtime.sendMessage({type:'MUTATE',action:a})",action)
                assert result["ok"],result
                return result["data"]
            def wait_badge(value):
                panel.wait_for_function("""async expected =>
                    (await chrome.action.getBadgeText({})) === expected""",
                    arg=value,timeout=10000)
            wait_badge("")
            created=send({"type":"createProject","name":"Badge synthetic topic"})
            project_id=created["result"]["projectId"]
            for name in ["alpha","beta"]:
                send({"type":"linkChat","key":"chat:"+name,
                    "projectId":project_id,"title":name,
                    "url":"https://chatgpt.com/c/"+name})
            wait_badge("")
            send({"type":"updateProject","projectId":project_id,
                "sourceKey":"chat:alpha","patch":{"decision":"A synthetic adopted fact"}})
            wait_badge("1")
            title=panel.evaluate("() => chrome.action.getTitle({})")
            assert "1 条关联对话待核对" in title,title
            send({"type":"acknowledgeProject","key":"chat:beta"})
            wait_badge("")
            title=panel.evaluate("() => chrome.action.getTitle({})")
            assert title=="打开研线课题面板",title
            context.close()
    print("PASS: toolbar review badge 0->1->0 after real MV3 topic updates/ack; no sends")

if __name__=="__main__":
    run()
