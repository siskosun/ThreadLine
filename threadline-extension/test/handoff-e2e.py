"""MV3 continuation draft checks against a synthetic ChatGPT DOM.
Real extension and IndexedDB, never an authenticated account, never press Send.
"""
import html
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect

EXT = Path(__file__).resolve().parents[1]


def run():
    with TemporaryDirectory(prefix="threadline-handoff-") as profile:
        with sync_playwright() as p:
            ctx = p.chromium.launch_persistent_context(
                profile, executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
                channel="chromium", headless=True, args=[
                    "--no-sandbox", "--disable-dev-shm-usage",
                    f"--disable-extensions-except={EXT}",
                    f"--load-extension={EXT}",
                ])
            current = {"draft": ""}
            def serve(route):
                initial = html.escape(current["draft"])
                route.fulfill(status=200, content_type="text/html; charset=utf-8",
                    body=f"""<!doctype html><html><title>Offline ChatGPT New Chat</title>
                    <form id="composer">
                      <div id="prompt-textarea" contenteditable="true" style="white-space:pre-wrap">{initial}</div>
                      <button type="submit">Send</button>
                    </form>
                    <script>window.submissions=0;
                      document.querySelector('form').addEventListener('submit',e=>{{
                        e.preventDefault();window.submissions++;
                      }});
                    </script></html>""")
            ctx.route("https://chatgpt.com/**", serve)
            worker = ctx.service_workers[0] if ctx.service_workers else \
                ctx.wait_for_event("serviceworker", timeout=15000)
            extension_id = worker.url.split("/")[2]
            panel = ctx.new_page()
            panel.goto(f"chrome-extension://{extension_id}/panel.html")
            panel.wait_for_selector("#manage-accordion", timeout=15000)

            def open_with_draft(payload):
                with ctx.expect_page(timeout=20000) as created:
                    response = panel.evaluate("""async text =>
                        chrome.runtime.sendMessage({type:'NEW_CHAT',handoff:text})""", payload)
                assert response["ok"], response
                tid = response["data"]["tabId"]
                page = created.value
                # Extension-created navigation in headless Chromium can bypass
                # context routing and leave an empty ChatGPT document. Reopen
                # the same tab through a page-local fully synthetic route.
                # Handoff state stays in chrome.storage.session for this tab.
                page.route("**/*", serve)
                page.goto("https://chatgpt.com/", wait_until="domcontentloaded", timeout=15000)
                if not page.url.startswith("https://chatgpt.com/"):
                    raise AssertionError("unexpected new tab URL: " + page.url +
                        " ; pages=" + repr([p.url for p in ctx.pages]))
                return page, tid

            def status_for(tid):
                return panel.evaluate("""async id =>
                  (await chrome.storage.session.get('tl_handoff_'+id))['tl_handoff_'+id] || null""", tid)

            # Exercise actual execCommand for mixed Unicode, NBSP and code blocks.
            ticks=chr(96)*3
            prefix="中文😀\n"+ticks+"js\nconst n = 1;\n"+ticks+"\nA\u00a0B\n\n"
            text = prefix + ("x" * (23569 - len(prefix.encode("utf-8"))))
            assert len(text.encode("utf-8")) == 23569
            page, tid = open_with_draft(text)
            expected_dom = page.locator("#prompt-textarea")
            # The real test fixture must be loaded before making any completion claims.
            try:
                expect(expected_dom).to_have_count(1, timeout=10000)
            except AssertionError:
                diagnostic = page.evaluate("""() => ({url:location.origin+location.pathname,
                  title:document.title,ready:document.readyState,
                  editorCount:document.querySelectorAll('#prompt-textarea').length,
                  formCount:document.querySelectorAll('form').length,
                  bodyChildren:document.body?.children.length})""")
                raise AssertionError("synthetic DOM missing: "+repr(diagnostic))
            expect(page.locator("#tl-handoff-banner")).to_be_visible(timeout=24000)
            observed = page.locator("#prompt-textarea").evaluate("(el)=>el.innerText")
            first_diff=next((i for i,(a,b) in enumerate(zip(observed,text)) if a!=b),
                            min(len(observed),len(text)))
            assert observed == text, (
                f"uncertain handoff: expectedChars={len(text)} observedChars={len(observed)} "
                f"expectedBytes={len(text.encode('utf-8'))} observedBytes={len(observed.encode('utf-8'))} "
                f"firstDiff={first_diff} expectedLF={text.count(chr(10))} observedLF={observed.count(chr(10))}; "
                "never ACK nonidentical draft")
            expect(page.locator("#tl-handoff-banner")).to_contain_text("不会自动替你发送")
            assert page.evaluate("window.submissions") == 0
            assert page.url == "https://chatgpt.com/"
            assert status_for(tid) is None, "ACK should follow exact readback only"
            page.close()

            # Whitespace-only draft remains user data, never overwritten.
            current["draft"] = "   "
            page2, tid2 = open_with_draft("DO NOT REPLACE MY DRAFT")
            expect(page2.locator("#tl-handoff-banner")).to_contain_text("不会覆盖", timeout=24000)
            assert page2.locator("#prompt-textarea").evaluate("(el)=>el.innerText") == "   "
            assert page2.evaluate("window.submissions") == 0
            assert status_for(tid2) is not None, "existing draft must NOT ACK"
            page2.close()

            current["draft"] = "用户正在写作\n第二行"
            page3, tid3 = open_with_draft("SHOULD NOT OVERWRITE")
            expect(page3.locator("#tl-handoff-banner")).to_contain_text("不会覆盖", timeout=24000)
            assert page3.locator("#prompt-textarea").evaluate("(el)=>el.innerText") == current["draft"]
            assert page3.evaluate("window.submissions") == 0
            assert status_for(tid3) is not None
            ctx.close()
    print("PASS: real MV3 handoff exact 23569-byte multiline readback; "
          "whitespace/normal drafts untouched; only exact ACK; 0 sends (synthetic only)")


if __name__ == "__main__":
    run()
