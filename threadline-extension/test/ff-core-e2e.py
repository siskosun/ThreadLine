"""MV3 Chromium Fork P1 smoke test with real IndexedDB and synthetic ChatGPT tab.
No authenticated account, real-site adapter, or message sending. Z0-LIVE remains blocked.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect

EXT = Path(__file__).resolve().parents[1]
SITE = """<!doctype html><title>Offline synthetic tab</title>
<form id="composer"><textarea></textarea><button type="submit">Send</button></form>
<script>window.submitCount=0;document.getElementById('composer').onsubmit=e=>{
 e.preventDefault();window.submitCount++}</script>"""


def run():
    with TemporaryDirectory(prefix="threadline-ff-") as profile:
        with sync_playwright() as p:
            def launch():
                context = p.chromium.launch_persistent_context(
                    profile,
                    executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
                    channel="chromium", headless=True, args=[
                        "--no-sandbox", "--disable-dev-shm-usage",
                        f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"
                    ])
                context.route("https://chatgpt.com/**", lambda route:
                    route.fulfill(status=200, content_type="text/html", body=SITE))
                worker = context.service_workers[0] if context.service_workers else \
                    context.wait_for_event("serviceworker", timeout=15000)
                return context, worker.url.split("/")[2]

            ctx, eid = launch()
            chat = ctx.new_page()
            chat.goto("https://chatgpt.com/c/synthetic-only", wait_until="domcontentloaded")
            panel = ctx.new_page()
            panel.goto(f"chrome-extension://{eid}/panel.html", wait_until="domcontentloaded")
            panel.wait_for_selector("#ff-preview-link", state="attached")
            old = panel.evaluate("() => ThreadLineCore.emptyState()")
            page = ctx.new_page()
            page.goto(f"chrome-extension://{eid}/ff.html", wait_until="domcontentloaded")
            page.wait_for_selector("#ff-enable")
            expect(page.locator("#ff-notice")).to_contain_text("未启用")
            assert not page.locator("#ff-enable").is_checked()
            assert page.locator("#ff-local").is_hidden()

            def message(payload):
                return page.evaluate("payload => chrome.runtime.sendMessage(payload)", payload)

            assert not message({"type":"FF_CREATE","w0":"x","p":"task"})["ok"]
            assert not panel.evaluate("() => chrome.runtime.sendMessage({type:'FF_LIST'})")["ok"]
            assert not message({"type":"BACKUP_EXPORT"})["ok"]
            assert not message({"type":"MUTATE","action":{"type":"createProject","name":"malicious"}})["ok"]
            page.evaluate("(value) => chrome.storage.local.set({threadline_state_v1:value})", old)
            page.locator("#ff-enable").check()
            page.locator("#ff-local").wait_for(state="visible")
            assert message({"type":"FF_STATUS"})["data"]["enabled"] is True
            before = len(ctx.pages)

            evil = "<img src=x onerror='window.ffXss=1'>\n中文😀\n  code section"
            page.locator("#ff-w0").fill(evil)
            page.locator("#ff-p").fill("回答问题")
            page.locator("#ff-save").click()
            expect(page.locator("#ff-sha")).to_contain_text("SHA-256")
            assert not page.locator("#ff-detail img").count()
            assert page.locator("#ff-text").text_content().startswith("【共同材料 W₀】\n" + evil)
            assert page.evaluate("window.ffXss === undefined")
            assert len(ctx.pages) == before, "Fork P1 must not open ChatGPT tabs"
            assert chat.evaluate("window.submitCount") == 0, "Fork P1 must never send"
            first = message({"type":"FF_LIST"})["data"][0]["id"]
            record = message({"type":"FF_READ","id":first})
            assert record["ok"], record
            assert record["data"]["frozen"]["w0"] == evil
            assert len(record["data"]["frozen"]["textHashes"]["frozen"]) == 64
            assert record["data"]["branches"]["A"]["isolation"]["checks"]["model"] == "unknown"

            start = {"type":"FF_RECORD","experimentId":first,"branch":"A",
                     "expectedRevision":0,"operationId":"op_repeat001",
                     "attemptId":"att_repeat001","status":"unknown","phase":"awaiting_send",
                     "reason":"unverified send"}
            sent = message(start)
            assert sent["ok"] and sent["data"]["revision"] == 1, sent
            repeated = message(start)
            assert repeated["ok"] and repeated["data"]["revision"] == 1, repeated
            conflicting = message({**start, "reason":"changed"})
            assert not conflicting["ok"], conflicting
            assert not message({**start, "status":"done","operationId":"op_bad_done"})["ok"]
            assert not message({"type":"FF_RECORD","experimentId":first,"branch":"A",
                     "expectedRevision":1,"operationId":"op_retry001","attemptId":"att_retry001",
                     "status":"pending","phase":"created"})["ok"]
            retry = message({"type":"FF_RECORD","experimentId":first,"branch":"A",
                     "expectedRevision":1,"operationId":"op_retry001","attemptId":"att_retry001",
                     "status":"pending","phase":"created","manualNewAttempt":True})
            assert retry["ok"] and retry["data"]["revision"] == 2, retry
            assert retry["data"]["branches"]["A"]["attempts"][0]["status"] == "unknown"

            concurrent = page.evaluate("""async id => Promise.all([
              chrome.runtime.sendMessage({type:'FF_RECORD',experimentId:id,branch:'B',
                expectedRevision:2,operationId:'op_race111',attemptId:'att_race111',
                status:'pending',phase:'draft_ready'}),
              chrome.runtime.sendMessage({type:'FF_RECORD',experimentId:id,branch:'B',
                expectedRevision:2,operationId:'op_race222',attemptId:'att_race111',
                status:'failed',phase:'draft_ready'})
            ])""", first)
            assert sum(bool(reply.get("ok")) for reply in concurrent) == 1, concurrent
            assert message({"type":"FF_READ","id":first})["data"]["revision"] == 3

            # Inclusive 24000 UTF-8 bytes of the final assembled text.
            overhead = len(("【共同材料 W₀】\n" + "\n\n【任务指令 P】\n任务").encode("utf-8"))
            at_limit = "x" * (24000 - overhead)
            maximum = message({"type":"FF_CREATE","w0":at_limit,"p":"任务"})
            assert maximum["ok"] and maximum["data"]["bytes"] == 24000, maximum
            too_large = message({"type":"FF_CREATE","w0":at_limit+"x","p":"任务"})
            assert not too_large["ok"], too_large

            legacy = page.evaluate("() => chrome.storage.local.get('threadline_state_v1')")
            assert legacy["threadline_state_v1"] == old, "FF must not mutate legacy topics"
            db = page.evaluate("""async () => {
              const db=await new Promise((resolve,reject)=>{
                const r=indexedDB.open('threadline_ff_v1');
                r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
              });
              const exists=db.objectStoreNames.contains('experiments');
              db.close();
              return exists;
            }""")
            assert db is True
            ctx.close()

            ctx2, eid2 = launch()
            assert eid2 == eid, "Persistent extension ID should not change"
            reopened = ctx2.new_page()
            reopened.goto(f"chrome-extension://{eid2}/ff.html")
            expect(reopened.locator("#ff-enable")).to_be_checked()
            rows = reopened.evaluate("() => chrome.runtime.sendMessage({type:'FF_LIST'})")
            assert rows["ok"] and len(rows["data"]) == 2, rows
            after = reopened.evaluate("(id) => chrome.runtime.sendMessage({type:'FF_READ',id})", first)
            assert after["ok"] and after["data"]["revision"] == 3, after
            assert after["data"]["branches"]["A"]["attempts"][0]["status"] == "unknown"
            assert reopened.evaluate("() => chrome.storage.local.get('threadline_state_v1')")["threadline_state_v1"] == old
            ctx2.close()
    print("PASS: Fork P1 default-off, permission-bound messages, 24KB input, "
          "atomic IDB/CAS, replay-safe attempts, XSS, legacy isolation and restart (synthetic-only)")


if __name__ == "__main__":
    run()
