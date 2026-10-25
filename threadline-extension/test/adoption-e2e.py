"""Native ordinary-capture adoption contract on a synthetic extension profile.

It uses only panel.html, its CaptureDB API and the shared adoption dialog.  No
ChatGPT page, account, or network request is involved.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright


EXT = Path(os.environ.get("THREADLINE_EXTENSION_PATH", Path(__file__).resolve().parents[1])).resolve()


def run():
    with TemporaryDirectory(prefix="threadline-adoption-") as profile:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                profile,
                executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
                channel="chromium",
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage",
                      f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"],
            )
            worker = context.service_workers[0] if context.service_workers else \
                context.wait_for_event("serviceworker", timeout=15000)
            extension_id = worker.url.split("/")[2]
            page = context.new_page()
            page.set_default_timeout(10000)
            page.goto(f"chrome-extension://{extension_id}/panel.html", wait_until="domcontentloaded")
            page.wait_for_selector("#evidence-section", state="attached")
            page.wait_for_function("() => !!window.ThreadLineEvidenceAdoption")

            def message(payload):
                return page.evaluate("payload => chrome.runtime.sendMessage(payload)", payload)

            created = message({"type": "MUTATE", "action": {
                "type": "createProject", "name": "普通采集采纳 E2E"
            }})
            assert created["ok"], created
            project_id = created["data"]["state"]["projects"][0]["id"]

            # Seed the extension's actual CaptureDB with a repeated excerpt.
            seeded = page.evaluate("""async () => {
                const run = {id:'capture-e2e-repeat', conversationId:'synthetic-capture',
                  url:'https://chatgpt.com/c/synthetic-capture', complete:true,
                  mode:'api', notice:'synthetic complete', createdAt:10, updatedAt:11};
                await ThreadLineCaptureDB.putRun(run);
                await ThreadLineCaptureDB.putPage({id:run.id,pageIndex:0,chunkIndex:0,messages:[{
                  id:'message-exact', role:'assistant',
                  content:'重复片段；中间内容；重复片段。', finished:true
                }]});
                return ThreadLineCaptureDB.getRun(run.id);
            }""")
            assert seeded["id"] == "capture-e2e-repeat"

            # Open the real dialog from the panel, then use the second occurrence.
            opened = page.evaluate("""async projectId => {
                window.__ordinaryAdoption = null;
                void ThreadLineEvidenceAdoption.open({
                  text:'', sources:[{label:'合成来源',captureRunId:'capture-e2e-repeat',
                    messageIndex:0,content:'重复片段；中间内容；重复片段。',coverage:'原始采集：分页完成'}],
                  submit: async form => {
                    const payload = {type:'EV_ADOPT_CAPTURE',projectId:form.projectId,text:form.text,
                      conditions:form.conditions,selections:form.selections.map(x => ({
                        captureRunId:x.source.captureRunId,messageIndex:x.source.messageIndex,
                        selection:x.selection,selectionStart:x.selectionStart,
                        selectionEnd:x.selectionEnd,relation:x.relation
                      })),operationId:'op_capture_e2e_repeat'};
                    window.__ordinaryAdoption = payload;
                    return chrome.runtime.sendMessage(payload);
                  }
                });
            }""", project_id)
            assert opened is None
            dialog = page.locator("dialog.evidence-adoption-dialog")
            expect(dialog).to_be_visible()
            dialog.locator("#evidence-adopt-project").select_option(project_id)
            original = dialog.locator('textarea[aria-label="原始消息全文"]')
            expect(original).to_have_value("重复片段；中间内容；重复片段。")
            # The same text occurs twice: the user-selected offset must choose the latter.
            original.evaluate("el => { el.focus(); el.setSelectionRange(10, 14); }")
            dialog.get_by_role("button", name="使用上方选中文本").click()
            dialog.locator("#evidence-adopt-text").fill("人工确认第二处重复片段")
            dialog.get_by_role("button", name="确认采纳").click()
            expect(dialog).to_contain_text("已采纳。", timeout=10000)
            expect(dialog).to_be_hidden(timeout=5000)

            payload = page.evaluate("() => window.__ordinaryAdoption")
            assert payload["selections"] == [{
                "captureRunId": "capture-e2e-repeat", "messageIndex": 0,
                "selection": "重复片段", "selectionStart": 10, "selectionEnd": 14,
                "relation": "cites"
            }], payload
            listing = message({"type": "EV_LIST", "projectId": project_id})
            assert listing["ok"] and len(listing["data"]["rows"]) == 1, listing
            source = listing["data"]["rows"][0]["fragments"][0]
            assert source["selection"] == "重复片段"
            assert source["selectionStart"] == 10 and source["selectionEnd"] == 14
            assert source["messageId"] == "message-exact"

            # A precise operation is replay-safe even after the transient capture cache is removed.
            page.evaluate("() => ThreadLineCaptureDB.remove('capture-e2e-repeat')")
            replay = message(payload)
            assert replay["ok"], replay
            assert replay["data"]["conclusionId"] == listing["data"]["rows"][0]["conclusion"]["id"]
            assert replay["data"]["revision"] == 1, "replay must not advance the authoritative revision"
            assert len(message({"type": "EV_LIST", "projectId": project_id})["data"]["rows"]) == 1
            changed_text = {**payload, "text": "同一操作 ID 的不同正文"}
            changed_offset = {**payload, "selections": [{**payload["selections"][0], "selectionStart": 0, "selectionEnd": 4}]}
            assert not message(changed_text)["ok"], "same operation id cannot change conclusion text"
            assert not message(changed_offset)["ok"], "same operation id cannot change source coordinates"

            # Synthetic page-/0:page- IDs are local fallback identities, never exact message IDs.
            degraded = page.evaluate("""async () => {
                const run = {id:'capture-e2e-page-id', conversationId:'synthetic-capture',
                  url:'https://chatgpt.com/c/synthetic-capture', complete:false,
                  mode:'dom', notice:'synthetic partial', createdAt:20, updatedAt:21};
                await ThreadLineCaptureDB.putRun(run);
                await ThreadLineCaptureDB.putPage({id:run.id,pageIndex:0,chunkIndex:0,messages:[{
                  id:'page-0',role:'assistant',content:'只可作为局部片段。'
                }]});
            }""")
            assert degraded is None
            fallback = message({
                "type": "EV_ADOPT_CAPTURE", "projectId": project_id,
                "text": "页面回退来源", "conditions": "",
                "selections": [{"captureRunId": "capture-e2e-page-id", "messageIndex": 0,
                                "selection": "局部片段", "selectionStart": 4,
                                "selectionEnd": 8, "relation": "background"}],
                "operationId": "op_capture_e2e_page_id"
            })
            assert fallback["ok"], fallback
            rows = message({"type": "EV_LIST", "projectId": project_id})["data"]["rows"]
            fallback_source = next(row for row in rows if row["current"]["text"] == "页面回退来源")["fragments"][0]
            assert fallback_source["messageId"] is None
            assert fallback_source["sourceLocalId"] == "0:page-0"
            context.close()
    print("PASS: native ordinary adoption uses exact selected offsets, seals replay payloads after cache expiry, and degrades page identities")


if __name__ == "__main__":
    run()
