"""MV3 continuation draft checks against a synthetic ChatGPT DOM.
Real extension and IndexedDB, never an authenticated account, never press Send.
"""
import html
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from time import monotonic, sleep
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
            current = {"draft": "", "editable": "true", "attachment": ""}
            def serve(route):
                initial = html.escape(current["draft"])
                attachment = {
                    "chip": '<button type="button" aria-label="移除 fictional.txt">fictional.txt</button>',
                    "preview": '<div data-testid="file-preview">fictional.txt</div>',
                    "selected": '<input type="file" id="upload" hidden>',
                    "controls": '<input type="file" hidden><button type="button" data-testid="upload-file-button">Upload files</button>',
                    "focus": '',
                }.get(current["attachment"], '')
                setup = ''
                if current["attachment"] == "selected":
                    setup = "const dt=new DataTransfer();dt.items.add(new File(['fake'],'fictional.txt'));document.querySelector('#upload').files=dt.files;"
                if current["attachment"] == "focus":
                    setup = "document.querySelector('#prompt-textarea').addEventListener('focus',()=>{const b=document.createElement('button');b.type='button';b.setAttribute('aria-label','Remove fictional.txt');document.querySelector('form').append(b);},{once:true});"
                if current["attachment"] == "redirect":
                    setup = "const other=document.createElement('div');other.id='other-draft';other.contentEditable='true';other.textContent='USER DRAFT';document.body.append(other);document.querySelector('#prompt-textarea').addEventListener('focus',()=>{other.focus();const r=document.createRange();r.selectNodeContents(other);const s=getSelection();s.removeAllRanges();s.addRange(r);},{once:true});"
                route.fulfill(status=200, content_type="text/html; charset=utf-8",
                    body=f"""<!doctype html><html><title>Offline ChatGPT New Chat</title>
                    <form id="composer">
                      <div id="prompt-textarea" contenteditable="true" style="white-space:pre-wrap;{'display:none' if current['editable']=='false' else ''}">{initial}</div>
                      {attachment}
                      <button type="submit">Send</button>
                    </form>
                    <script>window.submissions=0;
                      {setup}
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

            def wait_for_ack(tid):
                # The visible exact banner precedes the awaited ACK message in
                # handoff.js. Wait for its real storage receipt, never infer ACK
                # from the banner and never retry insertion or send a message.
                deadline = monotonic() + 5
                while monotonic() < deadline:
                    if status_for(tid) is None:
                        return
                    sleep(0.05)
                raise AssertionError('exact handoff did not ACK within 5 seconds')

            # Exercise actual execCommand for mixed Unicode, NBSP and code blocks.
            ticks=chr(96)*3
            prefix="中文😀\n"+ticks+"js\nconst n = 1;\n"+ticks+"\nA\u00a0B\n"
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
            wait_for_ack(tid)
            assert status_for(tid) is None, "ACK should follow exact readback only"
            page.close()

            # Browser editing models can insert an extra blank line for adjacent
            # newlines. Either full equality or an explicit NOT ACKed failure is
            # correct; a prefix-length check would falsely report success.
            current["draft"] = ""
            blank_text = "第一行\n\n最后一行"
            blank_page, blank_id = open_with_draft(blank_text)
            expect(blank_page.locator("#tl-handoff-banner")).to_be_visible(timeout=24000)
            blank_observed = blank_page.locator("#prompt-textarea").evaluate("(el)=>el.innerText")
            if blank_observed == blank_text:
                expect(blank_page.locator("#tl-handoff-banner")).to_contain_text("不会自动替你发送")
                wait_for_ack(blank_id)
                assert status_for(blank_id) is None
            else:
                expect(blank_page.locator("#tl-handoff-banner")).to_contain_text("与原文不一致")
                assert status_for(blank_id) is not None
            assert blank_page.evaluate("window.submissions") == 0
            blank_page.close()

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
            page3.close()

            # Actual extension + browser DOM, but fully synthetic: never live
            # ChatGPT acceptance. External native-style attachments remain owned.
            current["draft"] = ""
            for mode in ["chip", "preview", "selected", "focus", "redirect"]:
                current["attachment"] = mode
                occupied, occupied_id = open_with_draft("ATTACHMENT MUST NOT PREFILL")
                expect(occupied.locator("#tl-handoff-banner")).to_contain_text("不会覆盖", timeout=24000)
                assert occupied.locator("#prompt-textarea").evaluate("el=>el.innerText") == "", mode
                record = status_for(occupied_id)
                assert record is not None, "occupied drafts must not ACK"
                assert bool(record.get("attemptedAt")) == (mode in ["focus", "redirect"]), record
                if mode == "redirect":
                    assert occupied.locator("#other-draft").inner_text() == "USER DRAFT"
                if mode in ["chip", "preview"]:
                    assert occupied.get_by_text("fictional.txt", exact=True).count() == 1
                if mode == "selected":
                    assert occupied.locator("#upload").evaluate("el=>el.files.length") == 1
                assert occupied.evaluate("window.submissions") == 0
                occupied.close()
            current["attachment"] = "controls"
            controls, controls_id = open_with_draft("EMPTY UPLOAD CONTROLS ARE SAFE")
            expect(controls.locator("#tl-handoff-banner")).to_contain_text("逐字核对", timeout=24000)
            assert controls.locator("#prompt-textarea").evaluate("el=>el.innerText") == "EMPTY UPLOAD CONTROLS ARE SAFE"
            wait_for_ack(controls_id)
            assert status_for(controls_id) is None
            assert controls.evaluate("window.submissions") == 0
            controls.close()
            current["attachment"] = ""

            # A one-shot reservation prevents another automatic attempt after
            # an uncertain insertion, even when the tab reloads into a now
            # writable empty composer. No user message is ever submitted.
            current["draft"] = ""
            # A hidden editor cannot receive focus/execCommand insertion. A
            # contenteditable=false node now correctly fails BEFORE reservation,
            # so use an otherwise empty but unfocusable editor for this fault.
            current["editable"] = "false"
            page4, tid4 = open_with_draft("RESERVATION MUST NOT REPLAY")
            expect(page4.locator("#tl-handoff-banner")).to_contain_text("不会覆盖", timeout=24000)
            attempt = status_for(tid4)
            assert attempt and attempt.get("attemptedAt"), attempt
            assert page4.evaluate("window.submissions") == 0
            current["editable"] = "true"
            page4.reload(wait_until="domcontentloaded", timeout=15000)
            expect(page4.locator("#tl-handoff-banner")).to_contain_text("停止自动重试", timeout=24000)
            assert page4.locator("#prompt-textarea").evaluate("(el)=>el.innerText") == ""
            assert status_for(tid4) is not None
            assert page4.evaluate("window.submissions") == 0
            # Regression from a live page removing the unknown-state notice.
            # A DOM-only restoration must not replay the one-shot reservation.
            stored_attempt = status_for(tid4)
            page4.evaluate("""() => {
              window.bannerOriginal = document.querySelector('#tl-handoff-banner');
              window.editorInputs = 0;
              document.querySelector('#prompt-textarea').addEventListener('input',()=>window.editorInputs++);
              window.bannerOriginal.remove();
            }""")
            expect(page4.locator("#tl-handoff-banner")).to_contain_text("停止自动重试", timeout=3000)
            assert page4.evaluate("document.querySelector('#tl-handoff-banner') === window.bannerOriginal")
            assert status_for(tid4) == stored_attempt
            assert page4.evaluate("window.editorInputs") == 0
            assert page4.locator("#prompt-textarea").inner_text() == ""
            assert page4.evaluate("window.submissions") == 0
            page4.get_by_role("button", name="关闭提示", exact=True).click()
            page4.evaluate("document.body.appendChild(document.createElement('div'))")
            page4.wait_for_timeout(150)
            expect(page4.locator("#tl-handoff-banner")).to_have_count(0)
            assert status_for(tid4) == stored_attempt
            assert page4.evaluate("window.editorInputs") == 0
            assert page4.evaluate("window.submissions") == 0
            page4.close()

            # Actual MV3 scripts run on every ChatGPT tab. Ordinary saved
            # chats must not show a handoff failure without a pending intent.
            ordinary = ctx.new_page()
            ordinary.goto("https://chatgpt.com/c/ordinary-existing-chat",
                wait_until="domcontentloaded", timeout=15000)
            ordinary.wait_for_timeout(1850)
            expect(ordinary.locator("#tl-handoff-banner")).to_have_count(0)
            assert ordinary.evaluate("window.submissions") == 0
            project = ctx.new_page()
            project.goto("https://chatgpt.com/g/g-p-synthetic-project",
                wait_until="domcontentloaded", timeout=15000)
            project.wait_for_timeout(1850)
            expect(project.locator("#tl-handoff-banner")).to_have_count(0)
            assert project.evaluate("window.submissions") == 0

            # A *real* pending tab-bound intent redirected onto an old chat
            # still warns without exposing the text or consuming the lease.
            old_tab_id = panel.evaluate("""async () => {
              const tabs=await chrome.tabs.query({url:"https://chatgpt.com/*"});
              return tabs.find(t=>t.url?.includes("/c/ordinary-existing-chat"))?.id;
            }""")
            assert isinstance(old_tab_id,int), old_tab_id
            panel.evaluate("""async id => chrome.storage.session.set({
                ['tl_handoff_'+id]:{text:'SYNTHETIC REDIRECT ONLY'}
            })""", old_tab_id)
            ordinary.reload(wait_until="domcontentloaded",timeout=15000)
            expect(ordinary.locator("#tl-handoff-banner")).to_contain_text(
                "已停止预填",timeout=10000)
            assert ordinary.get_by_role("button",name="复制接续提示").count() == 0
            assert ordinary.evaluate("window.submissions") == 0
            record=status_for(old_tab_id)
            assert record and record["text"]=="SYNTHETIC REDIRECT ONLY",record
            assert not record.get("attemptedAt"),record
            project.close()
            ordinary.close()
            ctx.close()
    print("PASS: real MV3 handoff exact 23569-byte multiline readback; "
          "whitespace/normal/native-style attachment drafts untouched; focus race refused; "
          "empty upload controls accepted; only exact ACK; removed unknown banner recovered, "
          "explicit dismissal respected; 0 sends (synthetic only)")


if __name__ == "__main__":
    run()
