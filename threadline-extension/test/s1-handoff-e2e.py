"""S1-only real MV3 + IndexedDB handoff and full /3 restore regression.
Synthetic topic data; no real account, website request or automatic sending.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

EXT = Path(os.environ.get("THREADLINE_EXTENSION_PATH", Path(__file__).resolve().parents[1])).resolve()

def run():
    with TemporaryDirectory(prefix="threadline-s1-handoff-") as profile:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                profile,
                executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
                channel="chromium",
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage",
                      f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"],
            )
            worker = context.service_workers[0] if context.service_workers else context.wait_for_event(
                "serviceworker", timeout=15000
            )
            ext_id = worker.url.split("/")[2]
            page = context.new_page()
            page.set_default_timeout(10000)
            page.goto(f"chrome-extension://{ext_id}/panel.html", wait_until="domcontentloaded")
            page.wait_for_selector("#evidence-section", state="attached")

            def send(payload):
                response = page.evaluate("p => chrome.runtime.sendMessage(p)", payload)
                assert response and response.get("ok"), response
                return response["data"]

            def op(n):
                return "op_s1handoff_" + n

            created = send({"type": "MUTATE", "action": {
                "type": "createProject", "name": "S1 恢复测试"
            }})
            project_id = created["state"]["projects"][0]["id"]
            adoption = send({"type": "EV_ADOPT", "projectId": project_id,
                "text": "指标变化只在指定口径下成立",
                "conditions": "同一用户群与相同时间窗",
                "fragments": [{
                    "kind": "capture", "conversationId": "synthetic-conversation",
                    "messageId": "synthetic-message", "sourceRole": "assistant",
                    "url": "https://chatgpt.com/c/synthetic-conversation",
                    "selection": "合成原始依据", "before": "", "after": "",
                    "relation": "supports", "completeness": "partial"
                }], "operationId": op("adopt")})
            assert adoption["conclusionId"].startswith("con_"), adoption
            rows = send({"type": "EV_LIST", "projectId": project_id})
            assert len(rows["rows"]) == 1 and rows["rows"][0]["current"]["conditions"]

            prepared = send({"type": "EV_HANDOFF_PREPARE", "projectId": project_id,
                "expectedRevision": rows["project"]["evidenceRevision"],
                "operationId": op("prepare")})
            handoff = prepared["handoff"]
            assert "合成原始依据" in handoff["text"], handoff
            assert "指标变化只在指定口径下成立" in handoff["text"], handoff
            assert "待复核依赖" not in handoff["text"], handoff

            edited = handoff["text"] + "\n人工交接备注：尚未核对外部事实。"
            result = send({"type": "EV_HANDOFF_VALIDATE", "projectId": project_id,
                "handoffId": handoff["id"], "text": edited})
            assert result["materialHash"] and result["scopeHash"], result
            rows = send({"type": "EV_LIST", "projectId": project_id})
            send({"type": "EV_HANDOFF_RECORD", "projectId": project_id,
                "handoffId": handoff["id"], "text": edited, "event": "human-read",
                "expectedRevision": rows["project"]["evidenceRevision"],
                "operationId": op("read")})

            backup = send({"type": "EV_BACKUP", "projectId": project_id})
            assert backup["format"] == "threadline-project-backup/1"
            assert backup["evidence"]["format"] == "threadline-evidence/3"
            assert len(backup["evidence"]["project"]["handoffs"]) == 1
            assert backup["evidence"]["project"]["handoffs"][0]["events"][0]["text"] == edited
            assert "research" not in backup["evidence"]["project"]

            deletion = send({"type": "EV_DELETE_PREVIEW", "projectId": project_id})
            send({"type": "EV_DELETE_COMMIT", "preview": deletion["preview"],
                "operationId": op("delete")})

            preview = send({"type": "EV_RESTORE_PREVIEW", "backup": backup,
                "replace": True})
            assert preview["preview"]["replace"] is True
            restored = send({"type": "EV_RESTORE_COMMIT", "backup": backup,
                "preview": preview["preview"], "operationId": op("restore")})
            assert restored.get("restored") == 1, restored
            fresh = send({"type": "EV_LIST", "projectId": project_id})
            assert len(fresh["rows"]) == 1
            assert fresh["project"]["handoffs"][0]["events"][0]["text"] == edited
            checked = send({"type": "EV_HANDOFF_VALIDATE", "projectId": project_id,
                "handoffId": handoff["id"], "text": edited})
            assert checked["materialHash"] == result["materialHash"]
            context.close()
    print("PASS: isolated S1 adoption, /3 handoff, delete and complete restore")

if __name__ == "__main__":
    run()
