"""Synthetic MV3 capture recovery across an actual disposable browser restart.

No login, no real ChatGPT content, no message send. Persist one interrupted
source run, clear its session lease by restarting Chromium, and require two
explicit user actions before any new capture could start.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

EXT = Path(os.environ.get("THREADLINE_EXTENSION_PATH", Path(__file__).resolve().parents[1])).resolve()
SITE = """<!doctype html><title>Synthetic research chat</title>
<form id="composer"><textarea></textarea><button type="submit">Send</button></form>
<script>window.submitCount=0;document.querySelector('form').onsubmit=e=>{
  e.preventDefault();window.submitCount++};</script>"""

def launch(playwright, profile):
    ctx = playwright.chromium.launch_persistent_context(
        profile, executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
        channel="chromium", headless=True, args=[
            "--no-sandbox", "--disable-dev-shm-usage",
            f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
    ctx.route("https://chatgpt.com/**",
        lambda route:route.fulfill(status=200,content_type="text/html",body=SITE))
    worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event(
        "serviceworker", timeout=15000)
    return ctx,worker,worker.url.split("/")[2]

def send(page,payload):
    return page.evaluate("p => chrome.runtime.sendMessage(p)",payload)

def run():
    run_id="cap_f3_orphan_synthetic_01"
    with TemporaryDirectory(prefix="threadline-f3-orphan-") as profile:
        with sync_playwright() as playwright:
            ctx,worker,eid=launch(playwright,profile)
            page=ctx.new_page()
            page.goto(f"chrome-extension://{eid}/ff.html",wait_until="domcontentloaded")
            enabled=send(page,{"type":"FF_SET_ENABLED","enabled":True,
                "ack":"local-only-no-send"})
            assert enabled["ok"],enabled
            created=send(page,{"type":"FF_CREATE","operationId":"create_f3orphan_e2e",
                "w0":"Synthetic source only","p":"Synthetic question"})
            assert created["ok"],created
            experiment_id=created["data"]["id"]
            launched=send(page,{"type":"FF_LAUNCH","experimentId":experiment_id,
                "operationId":"launch_f3orphan_e2e"})
            assert launched["ok"],launched
            tab_id=launched["data"]["tabIds"]["A"]
            seeded=worker.evaluate("""async args=>{
                const {experimentId,tabId,runId}=args;
                const old=await ThreadLineFFDB.read(experimentId);
                const attempt=old.branches.A.attempts.at(-1);
                const evidence={...attempt.evidence,
                    conversationId:'f3-orphan-e2e',sessionId:'f3-orphan-e2e',
                    captureRunId:runId};
                const changed=await ThreadLineFFDB.update(experimentId,old.revision,
                    record=>ThreadLineFFCore.advance(record,{
                        branch:'A',expectedRevision:old.revision,
                        operationId:'op_f3orphan_fixture_e2e',
                        attemptId:attempt.id,status:'pending',phase:'capturing',
                        reason:'synthetic interrupted browser capture',evidence}));
                const oldTime=Date.now()-65000;
                await ThreadLineCaptureDB.putRun({
                    id:runId,tabId,conversationId:'f3-orphan-e2e',
                    url:'https://chatgpt.com/c/f3-orphan-e2e',
                    status:'capturing',createdAt:oldTime,updatedAt:oldTime,
                    pageCount:1,messageCount:1,complete:false,phase:'pagination'});
                await ThreadLineCaptureDB.putPage({
                    id:runId,pageIndex:0,chunkIndex:0,
                    messages:[{id:'synthetic-source',role:'user',
                      content:'Partial captured evidence before restart'}]});
                await chrome.storage.session.set({
                    ['tl_capture_owner_'+runId]:{tabId,startedAt:oldTime}});
                return {revision:changed.revision,attemptId:attempt.id};
            }""",{"experimentId":experiment_id,"tabId":tab_id,"runId":run_id})
            assert seeded["attemptId"],seeded
            status_req={"type":"FF_CAPTURE_STATUS","experimentId":experiment_id,
                "branch":"A","runId":run_id}
            before=send(page,status_req)
            assert before["ok"] and before["data"]["state"]=="stalled",before
            assert before["data"]["manualRecoveryAvailable"] is False,before
            ctx.close()

            # Actual browser restart invalidates extension storage.session while
            # preserving the IndexedDB records in this disposable profile.
            ctx2,worker2,eid2=launch(playwright,profile)
            ff=ctx2.new_page()
            ff.goto(f"chrome-extension://{eid2}/ff.html",wait_until="domcontentloaded")
            after=send(ff,status_req)
            assert after["ok"] and after["data"]["state"]=="untracked",after
            assert after["data"]["manualRecoveryAvailable"] is True,after
            wrong=send(ff,{**status_req,"branch":"B"})
            assert not wrong["ok"],wrong
            old_row=send(ff,{"type":"FF_READ","id":experiment_id})
            assert old_row["ok"],old_row
            previous_revision=old_row["data"]["revision"]
            before_run=worker2.evaluate("id=>ThreadLineCaptureDB.getRun(id)",run_id)
            assert before_run["status"]=="capturing",before_run
            unsafe=send(ff,{"type":"FF_CAPTURE","experimentId":experiment_id,"branch":"A"})
            assert not unsafe["ok"] and "已有进行中的采集" in unsafe["error"],unsafe
            ff.locator("#ff-list button").filter(has_text=experiment_id).first.click()
            retry=ff.locator("#ff-branch-boxes button",has_text="核对后手动重新采集").first
            retry.wait_for(timeout=10000)
            ff.once("dialog",lambda dialog:dialog.accept())
            retry.click()
            ff.wait_for_function("""() => document.querySelector('#ff-notice')
                ?.textContent.includes('再次点击并确认')""",timeout=10000)
            marked=worker2.evaluate("id=>ThreadLineCaptureDB.getRun(id)",run_id)
            assert marked["status"]=="error" and marked["complete"] is False,marked
            assert marked["phase"]=="manual-untracked",marked
            pages=worker2.evaluate("id=>ThreadLineCaptureDB.pages(id)",run_id)
            assert len(pages)==1 and pages[0]["messages"][0]["content"]==(
                "Partial captured evidence before restart"),pages
            again=send(ff,{"type":"FF_CAPTURE_ABANDON","experimentId":experiment_id,
                "branch":"A","runId":run_id,"ack":"manual-reviewed-no-replay"})
            assert again["ok"] and again["data"]["alreadyAbandoned"] is True,again
            latest=send(ff,{"type":"FF_READ","id":experiment_id})
            assert latest["ok"] and latest["data"]["revision"]==previous_revision,latest
            assert latest["data"]["branches"]["A"]["status"]=="pending",latest
            assert latest["data"]["branches"]["A"]["attempts"][-1]["evidence"]["captureRunId"]==run_id
            assert "再次点击并确认" in ff.locator("#ff-notice").text_content()
            for source in ctx2.pages:
                if source.url.startswith("https://chatgpt.com/"):
                    assert source.evaluate("window.submitCount") == 0
            ctx2.close()
    print("PASS: F3 real MV3 profile restart, orphan detection, explicit manual abandon, source preservation, zero sends")

if __name__ == "__main__":
    run()
