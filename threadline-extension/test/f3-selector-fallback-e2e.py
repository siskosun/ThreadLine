"""F3 fail-closed DOM fallback in a real offline MV3 Chromium extension.

Simulates unavailable ChatGPT history endpoints and missing DOM role selectors.
Uses disposable browser storage, no ChatGPT login and no generated messages.
"""
import os
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

EXT = Path(os.environ.get("THREADLINE_EXTENSION_PATH", Path(__file__).resolve().parents[1])).resolve()
PAGE = """<!doctype html><title>Offline history test</title>
<div class="whitespace-pre-wrap">This is welcome chrome, NOT a message</div>
<div data-message-author-role="user" data-message-id="msg-user">Synthetic user question</div>
<div data-message-author-role="assistant" data-message-id="msg-answer">Synthetic assistant answer</div>
<form id="composer"><textarea></textarea><button type="submit">Send</button></form>
<script>
window.submitCount = 0;
document.querySelector("form").onsubmit = e => {e.preventDefault();window.submitCount++};
</script>
"""

def wait_for_terminal(worker, run_id, seconds=18):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        last = worker.evaluate("id => ThreadLineCaptureDB.getRun(id)", run_id)
        if last and last.get("status") in ("done", "error"):
            return last
        time.sleep(0.15)
    raise AssertionError(f"capture never reached a terminal state: {last}")

def run():
    with TemporaryDirectory(prefix="threadline-f3-selector-") as profile:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(profile,
                executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
                channel="chromium", headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage",
                    f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
            def route_handler(route):
                if "/backend-api/" in route.request.url:
                    route.fulfill(status=404, content_type="application/json", body="{}")
                else:
                    route.fulfill(status=200, content_type="text/html", body=PAGE)
            ctx.route("https://chatgpt.com/**", route_handler)
            worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event(
                "serviceworker", timeout=15000)
            eid = worker.url.split("/")[2]
            source = ctx.new_page()
            source.goto("https://chatgpt.com/c/f3-selector-synthetic", wait_until="domcontentloaded")
            panel = ctx.new_page()
            panel.goto(f"chrome-extension://{eid}/panel.html", wait_until="domcontentloaded")
            tab_id = panel.evaluate("""async () => {
                const tabs = await chrome.tabs.query({url: "https://chatgpt.com/*"});
                return tabs.find(t => t.url?.includes("f3-selector-synthetic"))?.id;
            }""")
            assert isinstance(tab_id, int), f"source tab missing: {tab_id}"
            def capture():
                reply = panel.evaluate("p => chrome.runtime.sendMessage(p)",
                    {"type":"CAPTURE_START", "tabId":tab_id})
                assert reply and reply.get("ok"), reply
                assert reply["data"]["started"] is True, reply
                return reply["data"]["id"]

            # API fails: only real role-marked text is preserved, never 'complete'.
            first_id = capture()
            first = wait_for_terminal(worker, first_id)
            assert first["status"] == "done" and first["complete"] is False, first
            assert first["mode"] == "visible-dom" and first["messageCount"] == 2, first
            pages = worker.evaluate("id => ThreadLineCaptureDB.pages(id)", first_id)
            messages = [m for page in pages for m in page.get("messages", [])]
            assert [(m["role"],m["content"]) for m in messages] == [
                ("user","Synthetic user question"),
                ("assistant","Synthetic assistant answer")], messages
            assert all("welcome chrome" not in m["content"] for m in messages)
            assert "不能当作完整对话" in first["notice"], first

            # Selector removed: neither welcome page text nor an empty page may
            # become a complete response. A fresh capture requires a manual start.
            source.evaluate("""() => document.querySelectorAll(
                '[data-message-author-role]').forEach(el =>
                el.removeAttribute('data-message-author-role'))""")
            assert source.locator("[data-message-author-role]").count() == 0
            time.sleep(0.25)
            second_id = capture()
            assert second_id != first_id
            second = wait_for_terminal(worker, second_id)
            assert second["status"] == "done" and second["complete"] is False, second
            assert second["mode"] == "visible-dom" and second["messageCount"] == 0, second
            assert worker.evaluate("id => ThreadLineCaptureDB.pages(id)", second_id) == []
            assert "不能当作完整对话" in second["notice"], second
            assert source.evaluate("window.submitCount") == 0, "no automatic sends"
            ctx.close()
    print("PASS: F3 fail-closed history API/selector fallback with source-only excerpts, zero sends")

if __name__ == "__main__":
    run()
