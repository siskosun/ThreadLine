"""S1-only real MV3 + IndexedDB handoff and full /3 restore regression.
Synthetic topic data; no real account, website request or automatic sending.
"""
import os
from copy import deepcopy
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

            def authority_snapshot():
                # Compare all six authoritative stores, not just the
                # projected conclusion, after rejected restore attempts.
                return page.evaluate("""async () => {
                    const db=await new Promise((resolve,reject)=>{
                        const r=indexedDB.open('threadline_evidence_v1');
                        r.onsuccess=()=>resolve(r.result);
                        r.onerror=()=>reject(r.error);
                    });
                    try {
                        const names=[...db.objectStoreNames].sort();
                        const tx=db.transaction(names,'readonly');
                        return await Promise.all(names.map(name=>new Promise((resolve,reject)=>{
                            const req=tx.objectStore(name).getAll();
                            req.onsuccess=()=>resolve([name,req.result]);
                            req.onerror=()=>reject(req.error);
                        })));
                    } finally {db.close();}
                }""")

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

            # Reject untrusted topic fields before the preview can replace
            # the user's current history/version/decision.
            topic_before = next(p for p in send({"type": "SNAPSHOT"})["state"]["projects"]
                if p["id"] == project_id)
            evidence_before = send({"type": "EV_LIST", "projectId": project_id})
            authority_before = authority_snapshot()
            for poison in [
                {"history": [{"version": 999999, "field": "decision", "after": "FORGED"}]},
                {"knowledgeVersion": 99999999, "decision": "FORGED"},
                {"evidenceTakeover": False, "evidenceProjectionRevision": 99999},
                {"constructor": {"polluted": True}}
            ]:
                tampered = deepcopy(backup)
                tampered["topic"].update(poison)
                rejected = page.evaluate("p => chrome.runtime.sendMessage(p)", {
                    "type": "EV_RESTORE_PREVIEW", "backup": tampered,
                    "replace": True
                })
                assert rejected and not rejected["ok"], (poison, rejected)
                assert "备份课题" in rejected["error"], rejected
            topic_after = next(p for p in send({"type": "SNAPSHOT"})["state"]["projects"]
                if p["id"] == project_id)
            evidence_after = send({"type": "EV_LIST", "projectId": project_id})
            assert topic_after == topic_before, "rejected backup must not rewrite topic state"
            assert evidence_after["project"] == evidence_before["project"], (
                "rejected backup must not rewrite authority state")
            assert authority_snapshot() == authority_before, (
                "rejected backup must not change any authoritative IDB store")
            for reserved in ["toString", "valueOf", "hasOwnProperty"]:
                rejected = page.evaluate("p => chrome.runtime.sendMessage(p)", {
                    "type": "EV_DELETE_PREVIEW", "projectId": reserved
                })
                assert rejected and not rejected["ok"] and "课题 ID" in rejected["error"], (
                    "inherited object properties must not appear as projects", reserved, rejected)

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

            # Close and reopen the complete browser profile, not only the tab.
            resumed = playwright.chromium.launch_persistent_context(
                profile,
                executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
                channel="chromium",headless=True,args=["--no-sandbox",
                    "--disable-dev-shm-usage",
                    f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"])
            resumed_worker = resumed.service_workers[0] if resumed.service_workers else                 resumed.wait_for_event("serviceworker",timeout=15000)
            resumed_page=resumed.new_page()
            resumed_page.goto(
                f"chrome-extension://{resumed_worker.url.split('/')[2]}/panel.html",
                wait_until="domcontentloaded")
            def restored_send(payload):
                response=resumed_page.evaluate("p => chrome.runtime.sendMessage(p)",payload)
                assert response and response.get("ok"),response
                return response["data"]
            persisted=restored_send({"type":"EV_LIST","projectId":project_id})
            assert len(persisted["rows"])==1,persisted
            assert persisted["project"]["handoffs"][0]["events"][0]["text"]==edited
            topic=next(p for p in restored_send({"type":"SNAPSHOT"})["state"]["projects"]
                if p["id"]==project_id)
            assert isinstance(topic["knowledgeVersion"],int) and topic["knowledgeVersion"]<999999
            assert topic["decision"]!="FORGED" and topic.get("evidenceTakeover") is True,topic
            resumed.close()
    print("PASS: S1 /3 restore metadata guard, authority unchanged on rejection, full MV3 restart")

if __name__ == "__main__":
    run()
