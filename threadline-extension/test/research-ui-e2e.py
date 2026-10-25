"""Native panel integration checks for restore, Argdown and research widgets.

All evidence is synthetic and stays in a disposable extension profile.
"""
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright


EXT = Path(os.environ.get("THREADLINE_EXTENSION_PATH", Path(__file__).resolve().parents[1])).resolve()


def send(page, payload):
    return page.evaluate("payload => chrome.runtime.sendMessage(payload)", payload)


def good(page, payload):
    result = send(page, payload)
    assert result and result.get("ok"), result
    return result["data"]


def run():
    with TemporaryDirectory(prefix="threadline-research-ui-") as profile:
        with sync_playwright() as playwright:
            context = playwright.chromium.launch_persistent_context(
                profile,
                executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
                channel="chromium", headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage",
                      f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"],
            )
            worker = context.service_workers[0] if context.service_workers else \
                context.wait_for_event("serviceworker", timeout=15000)
            extension_id = worker.url.split("/")[2]

            def panel_page():
                page = context.new_page()
                page.set_default_timeout(10000)
                page.goto(f"chrome-extension://{extension_id}/panel.html", wait_until="domcontentloaded")
                page.wait_for_selector("#evidence-maintenance", state="attached")
                page.wait_for_selector("#argdown-workbench", state="attached")
                return page

            panel = panel_page()
            errors = []
            panel.on("pageerror", lambda error: errors.append(str(error)))
            created = good(panel, {"type": "MUTATE", "action": {"type": "createProject", "name": "UI 集成课题"}})
            project_id = created["state"]["projects"][0]["id"]
            prototype = context.new_page()
            prototype.goto(f"chrome-extension://{extension_id}/evidence-prototype.html", wait_until="domcontentloaded")
            source = {"selection": "合成依据", "before": "前", "after": "后", "kind": "manual", "capturedAt": 1}
            first = good(prototype, {"type": "EV_ADOPT", "projectId": project_id, "text": "上游结论", "fragments": [source], "operationId": "op_ui_arg_up"})
            second = good(prototype, {"type": "EV_ADOPT", "projectId": project_id, "text": "下游结论", "fragments": [{**source, "selection": "下游依据"}], "operationId": "op_ui_arg_down"})
            backup = good(panel, {"type": "EV_BACKUP", "projectId": project_id})
            panel.locator("#nav-evidence").click()
            expect(panel.locator("#evidence-maintenance")).to_be_visible()

            # Existing project + restore false: the maintenance UI must keep the
            # replacement control visible, then preview and commit only after it is checked.
            panel.evaluate("() => { window.confirm = () => true; }")
            maintenance = panel.locator("#evidence-maintenance")
            maintenance.locator("summary").first.click()
            file_input = maintenance.locator('input[type="file"]')
            file_input.set_input_files({
                "name": "existing-project.json", "mimeType": "application/json",
                "buffer": json.dumps(backup, ensure_ascii=False).encode("utf-8"),
            })
            replacement = maintenance.locator("#evidence-maintenance-replace")
            expect(replacement).to_be_visible()
            expect(maintenance).to_contain_text("无法预览恢复", timeout=10000)
            replacement.check()
            expect(maintenance).to_contain_text("恢复模式：替换同 ID 课题", timeout=10000)
            confirm = maintenance.get_by_role("button", name="确认恢复")
            expect(confirm).to_be_enabled()
            panel.evaluate("""() => {
                window.__restoreRequests = [];
                window.__restoreResponses = [];
                const original = chrome.runtime.sendMessage.bind(chrome.runtime);
                window.__restoreOriginalSend = chrome.runtime.sendMessage;
                chrome.runtime.sendMessage = (payload, callback) => {
                  if (payload?.type?.startsWith('EV_RESTORE_')) window.__restoreRequests.push(structuredClone(payload));
                  return original(payload, response => {
                    if (payload?.type?.startsWith('EV_RESTORE_')) window.__restoreResponses.push(structuredClone(response));
                    callback?.(response);
                  });
                };
            }""")
            panel.once("dialog", lambda dialog: dialog.accept())
            confirm.click()
            panel.wait_for_timeout(1000)
            requests = panel.evaluate("() => window.__restoreRequests")
            responses = panel.evaluate("() => window.__restoreResponses")
            assert requests and requests[-1]["type"] == "EV_RESTORE_COMMIT", requests
            assert requests[-1]["preview"]["replace"] is True, requests
            assert responses and responses[-1]["ok"] and responses[-1]["data"]["replaced"] is True, responses
            panel.evaluate("() => { chrome.runtime.sendMessage = window.__restoreOriginalSend; }")
            restored = good(panel, {"type": "EV_LIST", "projectId": project_id})
            assert len(restored["rows"]) == 2, restored

            # Export + parse in the native Argdown UI. The proposal is only an
            # editable candidate; it must disappear when its captured scope changes.
            argdown = panel.locator("#argdown-workbench")
            argdown.locator("summary").click()
            argdown.get_by_role("button", name="刷新已采纳结论").click()
            expect(argdown).to_contain_text("已加载 2 条", timeout=10000)
            argdown.get_by_role("button", name="导出 Argdown 文本").click()
            exported = argdown.locator('textarea[aria-label="Argdown 导出文本"]')
            expect(exported).not_to_have_value("")
            imported = argdown.locator('textarea[aria-label="粘贴 Argdown 进行预览"]')
            imported.fill(f"[{first['conclusionId']}]: 上游结论\n  +> [{second['conclusionId']}]: 下游结论")
            argdown.get_by_role("button", name="解析并预览关系").click()
            proposal = argdown.locator(".argdown-proposal")
            expect(proposal).to_have_count(1, timeout=10000)
            proposal.locator('input[type="checkbox"]').check()
            proposal.locator('input[placeholder="确认理由（必填）"]').fill("人工确认前提")
            candidate_button = proposal.get_by_role("button", name="登记此必要前提")
            expect(candidate_button).to_be_enabled()

            other = panel_page()
            other_errors = []
            other.on("pageerror", lambda error: other_errors.append(str(error)))
            before = good(other, {"type": "EV_LIST", "projectId": project_id})
            current = next(row for row in before["rows"] if row["conclusion"]["id"] == first["conclusionId"])["current"]["id"]
            amended = good(other, {"type": "EV_AMEND", "conclusionId": first["conclusionId"],
                                   "text": "上游结论的新版本", "expectedVersionId": current,
                                   "operationId": "op_ui_arg_stale"})
            assert amended["versionId"] != current
            panel.evaluate("() => window.dispatchEvent(new Event('threadline-evidence-changed'))")
            expect(argdown.locator(".argdown-proposal")).to_have_count(0, timeout=10000)
            assert not candidate_button.is_visible(), "old Argdown candidate must not confirm a new version"
            assert not good(panel, {"type": "EV_RESEARCH_LIST", "projectId": project_id})["edges"], "stale candidate must not persist an edge"

            # The adjacent backup and dependency widgets must have rendered without errors.
            research = panel.locator("#research-workbench")
            expect(research).to_be_attached()
            research.locator(":scope > summary").click()
            expect(research).to_contain_text("依赖、复核和 AI 建议均需人工确认")
            assert errors == [], errors
            assert other_errors == [], other_errors
            context.close()
    print("PASS: native restore replacement confirmation, Argdown stale candidate invalidation, and research/maintenance UI render")


if __name__ == "__main__":
    run()
