"""S0a evidence prototype E2E on a one-shot synthetic profile (plan §十一.6).
Real MV3 service worker + real IndexedDB, no accounts, no external sites.
Probes: single-writer adoption protocol (12 timed operations), restart
recovery of the authoritative store, read-only summary projection, withdraw
with history, export/import roundtrip, storage.estimate visibility."""
import json
import os
import copy
import hashlib
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

EXT = Path(__file__).resolve().parents[1]


def wait_true(page, expression, timeout=30):
    import time
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = page.evaluate(expression)
        if last:
            return
        time.sleep(0.2)
    raise AssertionError("condition not met: " + expression + " last=" + repr(last))


def send(page, payload):
    return page.evaluate("p => new Promise(r => chrome.runtime.sendMessage(p,r))", payload)


def raw_evidence(page):
    return page.evaluate("""async () => {
        const db = await new Promise((resolve,reject) => {
            const q=indexedDB.open('threadline_evidence_v1');
            q.onsuccess=()=>resolve(q.result); q.onerror=()=>reject(q.error);
        });
        try {
            const names=[...db.objectStoreNames], tx=db.transaction(names,'readonly');
            return await Promise.all(names.map(name=>new Promise((resolve,reject)=>{
                const q=tx.objectStore(name).getAll();
                q.onsuccess=()=>resolve([name,q.result]);q.onerror=()=>reject(q.error);
            })));
        } finally {db.close();}
    }""")


def run():
    with TemporaryDirectory(prefix="threadline-evidence-") as profile:
        with sync_playwright() as p:
            def launch(profile_path=profile):
                context = p.chromium.launch_persistent_context(
                    profile_path,
                    executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
                    channel="chromium", headless=True, args=[
                        "--no-sandbox", "--disable-dev-shm-usage",
                        f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"
                    ])
                worker = context.service_workers[0] if context.service_workers else \
                    context.wait_for_event("serviceworker", timeout=15000)
                eid = worker.url.split("/")[2]
                page = context.new_page()
                page.goto(f"chrome-extension://{eid}/evidence-prototype.html",
                          wait_until="domcontentloaded")
                page.wait_for_selector("#ev-adopt", state="attached")
                wait_true(page, "() => Array.isArray(window.__timings)")
                return context, page, eid

            ctx, page, eid = launch()
            page.select_option("#ev-project", "proto-p1")

            # 12-operation timed adoption protocol (page-side clocks).
            page.click("#ev-run-protocol")
            wait_true(page, "() => window.__timings.length === 12", timeout=60)
            stats = page.evaluate("window.__timingsStats()")
            trials = page.evaluate("window.__timings")
            assert stats["valid"] == 12, stats
            assert stats["medianMs"] <= 30000, stats
            assert stats["p90Ms"] <= 60000, stats

            listing = page.evaluate(
                "payload => new Promise(res => chrome.runtime.sendMessage(payload, res))",
                {"type": "EV_LIST", "projectId": "proto-p1"})
            assert listing["ok"], listing
            rows = listing["data"]["rows"]
            assert len(rows) == 12, len(rows)
            assert listing["data"]["project"]["evidenceRevision"] == 12
            assert rows[0]["fragments"][0]["selection"].startswith("线路B转化率")
            # Repeating the actual unchanged form must not create another conclusion.
            for trial_count in (13, 14):
                page.click("#ev-adopt")
                wait_true(page, f"() => window.__timings.length === {trial_count}")
            duplicate_listing = send(page, {"type": "EV_LIST", "projectId": "proto-p1"})
            assert len(duplicate_listing["data"]["rows"]) == 12
            assert duplicate_listing["data"]["project"]["evidenceRevision"] == 12

            summary = page.evaluate(
                "payload => new Promise(res => chrome.runtime.sendMessage(payload, res))",
                {"type": "EV_SUMMARY", "projectId": "proto-p1"})
            assert summary["data"]["summary"].startswith("证据库摘析（只读投影，v12，采纳 12 条）")

            # Withdraw the newest conclusion through the UI; history survives.
            page.on("dialog", lambda d: d.accept())
            page.locator(".item button", has_text="撤回").first.click()
            wait_true(page, "() => document.querySelectorAll('#ev-list .item').length === 12")
            summary2 = page.evaluate(
                "payload => new Promise(res => chrome.runtime.sendMessage(payload, res))",
                {"type": "EV_SUMMARY", "projectId": "proto-p1"})
            assert "[已撤回]" in summary2["data"]["summary"]

            pkg = page.evaluate(
                "payload => new Promise(res => chrome.runtime.sendMessage(payload, res))",
                {"type": "EV_EXPORT", "projectId": "proto-p1"})
            assert pkg["ok"], pkg
            assert pkg["data"]["counts"]["conclusions"] == 12
            assert pkg["data"]["includesOriginalExcerpts"] is True

            quota = page.evaluate(
                "() => new Promise(res => chrome.runtime.sendMessage({type:'EV_QUOTA'}, res))")
            assert quota["ok"] and quota["data"]["estimate"] is not None

            # S1a: chrome.storage one-way projection + message-level sealing.
            projection = page.evaluate(
                "() => new Promise(res => chrome.storage.local.get("
                "'tl_evidence_summary_proto-p1', r => res(r)))")
            entry = projection["tl_evidence_summary_proto-p1"]
            assert entry and entry["summary"].startswith("证据库摘析（只读投影，")
            assert entry["evidenceRevision"] == 13

            panel = ctx.new_page()
            panel.goto(f"chrome-extension://{eid}/panel.html", wait_until="domcontentloaded")
            panel.wait_for_selector("body *")
            created = panel.evaluate(
                "payload => new Promise(res => chrome.runtime.sendMessage(payload, res))",
                {"type": "MUTATE", "action": {"type": "createProject", "name": "S1a 封口课题"}})
            assert created["ok"], created
            project_id = created["data"]["state"]["projects"][0]["id"]
            ensured = page.evaluate(
                "payload => new Promise(res => chrome.runtime.sendMessage(payload, res))",
                {"type": "EV_ENSURE", "projectId": project_id})
            assert ensured["ok"]
            adopted2 = page.evaluate(
                "payload => new Promise(res => chrome.runtime.sendMessage(payload, res))",
                {"type": "EV_ADOPT", "projectId": project_id, "text": "封口课题的第一条结论",
                 "conditions": "仅适用合成样本 A",
                 "fragments": [{"selection": "封口用片段", "before": "前", "after": "后",
                                "conversationId": "synthetic-evidence-conversation",
                                "messageId": "synthetic-evidence-message", "kind": "manual",
                                "captureRunId": "original-run", "capturedAt": 123,
                                "url": "https://example.invalid/source"}],
                 "operationId": "op_s1a_e2e_0001"})
            assert adopted2["ok"], adopted2
            # Render the real panel, not only the prototype/message handlers.
            # No ChatGPT tab is opened: location must show the fragment fallback.
            panel_errors = []
            panel.on("pageerror", lambda error: panel_errors.append(str(error)))
            panel.set_viewport_size({"width": 360, "height": 900})
            panel.reload(wait_until="domcontentloaded")
            panel.get_by_role("tab", name="证据与交接").click()
            # Research navigation may already expand the accordion. Do not
            # accidentally close it by blindly toggling the summary.
            accordion = panel.locator("#evidence-accordion")
            if accordion.get_attribute("open") is None:
                accordion.locator("summary").click()
            assert accordion.get_attribute("open") is not None
            panel.wait_for_function(
                "id => [...document.querySelector('#evidence-project').options]"
                ".some(option => option.value === id)", arg=project_id)
            panel.select_option("#evidence-project", project_id)
            panel.click("#evidence-refresh")
            maintenance = panel.locator("#evidence-maintenance")
            if maintenance.get_attribute("open") is None:
                maintenance.locator(":scope > summary").click()
            panel.wait_for_function(
                "id => document.querySelector('#evidence-maintenance > div > select')?.value === id",
                arg=project_id)
            assert "与当前查看课题一致" in maintenance.locator(":scope > div > p[role=status]").first.inner_text()
            try:
                panel.locator("#evidence-list .evidence-item").wait_for(timeout=5000)
            except Exception as error:
                raise AssertionError(f"evidence panel failed to render: {panel_errors}") from error
            assert panel.locator("#evidence-list .evidence-item").count() == 1
            assert "匹配 1 / 1 条结论" in panel.locator("#evidence-list-count").inner_text()
            panel.locator("#evidence-query").fill("不存在的查询词")
            assert "匹配 0 / 1 条结论" in panel.locator("#evidence-list-count").inner_text()
            assert "没有符合搜索或状态筛选" in panel.locator("#evidence-list").inner_text()
            panel.locator("#evidence-query").fill("")
            panel.select_option("#evidence-filter-status","withdrawn")
            assert "匹配 0 / 1 条结论" in panel.locator("#evidence-list-count").inner_text()
            panel.select_option("#evidence-filter-status","all")
            assert "匹配 1 / 1 条结论" in panel.locator("#evidence-list-count").inner_text()
            assert panel.locator("#evidence-list button", has_text="修订").count() == 1
            assert panel.locator("#evidence-list button", has_text="撤回").count() == 1
            # Accessible withdrawal confirmation and durable error feedback.
            withdraw_button = panel.locator("#evidence-list button", has_text="撤回")
            withdraw_button.click()
            panel.locator("dialog.tl-confirm-dialog").wait_for()
            panel.locator("dialog.tl-confirm-dialog button", has_text="取消").click()
            assert panel.locator("dialog.tl-confirm-dialog").count() == 0
            still_adopted = send(panel, {"type":"EV_LIST","projectId":project_id})["data"]["rows"][0]
            assert still_adopted["conclusion"]["status"] == "adopted"
            panel.evaluate("""() => {
                const original=chrome.runtime.sendMessage.bind(chrome.runtime);
                window.__restoreWithdrawMessage=()=>{chrome.runtime.sendMessage=original;};
                window.__withdrawCalls=0;
                chrome.runtime.sendMessage=(payload,callback)=>{
                    if(payload?.type==="EV_WITHDRAW"){
                        window.__withdrawCalls++;
                        callback({ok:false,error:"SIMULATED_WITHDRAW_FAILURE"});
                        return;
                    }
                    return original(payload,callback);
                };
            }""")
            panel.locator("#evidence-list button", has_text="撤回").click()
            panel.locator("dialog.tl-confirm-dialog button", has_text="撤回结论").click()
            panel.wait_for_function("() => document.querySelector('#critical-notice')?.hidden===false")
            assert "SIMULATED_WITHDRAW_FAILURE" in panel.locator("#critical-notice-text").inner_text()
            panel.wait_for_timeout(3300)
            assert panel.locator("#critical-notice").is_visible(), "withdraw error must outlive transient toast"
            assert panel.evaluate("window.__withdrawCalls") == 1, "withdraw must not auto-replay"
            after_failed_withdraw = send(panel, {"type":"EV_LIST","projectId":project_id})["data"]["rows"][0]
            assert after_failed_withdraw["conclusion"]["status"] == "adopted"
            panel.evaluate("window.__restoreWithdrawMessage()")
            panel.locator("#critical-notice-dismiss").click()
            assert panel.locator("#critical-notice").is_hidden()

            # Successful withdrawal returns keyboard focus to the same conclusion,
            # now visibly marked withdrawn, without changing the selected topic.
            success_project_id = "ux08-success"
            ensured_success = send(page, {"type":"EV_ENSURE","projectId":success_project_id})
            assert ensured_success["ok"], ensured_success
            adopted_success = send(page, {"type":"EV_ADOPT","projectId":success_project_id,
                "text":"成功撤回焦点验收","conditions":"仅用于合成测试",
                "fragments":[{"selection":"撤回后保留的来源片段"}],
                "operationId":"op_ux08success001"})
            assert adopted_success["ok"], adopted_success
            panel.evaluate("() => window.dispatchEvent(new Event('threadline-evidence-changed'))")
            panel.wait_for_function("id => [...document.querySelector('#evidence-project').options].some(o=>o.value===id)",
                arg=success_project_id)
            panel.select_option("#evidence-project",success_project_id)
            panel.wait_for_function("id => [...document.querySelectorAll('#evidence-list .evidence-item')].some(n=>n.dataset.conclusionId===id)",
                arg=adopted_success["data"]["conclusionId"])
            panel.locator("#evidence-list button", has_text="撤回").click()
            panel.locator("dialog.tl-confirm-dialog button", has_text="撤回结论").click()
            panel.wait_for_function("id => [...document.querySelectorAll('#evidence-list .evidence-item')].some(n=>n.dataset.conclusionId===id&&n.textContent.includes('已撤回'))",
                arg=adopted_success["data"]["conclusionId"])
            assert panel.evaluate("id => document.activeElement?.closest('.evidence-item')?.dataset?.conclusionId===id",
                adopted_success["data"]["conclusionId"])
            success_listing = send(panel, {"type":"EV_LIST","projectId":success_project_id})
            assert success_listing["ok"], success_listing
            success_row = next(row for row in success_listing["data"]["rows"]
                if row["conclusion"]["id"] == adopted_success["data"]["conclusionId"])
            assert success_row["conclusion"]["status"] == "withdrawn"
            panel.select_option("#evidence-project",project_id)
            panel.wait_for_function("id => document.querySelector('#evidence-project').value===id",arg=project_id)
            panel.wait_for_function("id => [...document.querySelectorAll('#evidence-list .evidence-item')].some(n=>n.dataset.conclusionId===id)",
                arg=adopted2["data"]["conclusionId"])
            # A late withdrawal acknowledgement must not replace the project
            # the user switched to while the original operation was pending.
            delayed_project_id = "ux08-delayed"
            ensured_delayed = send(page, {"type":"EV_ENSURE","projectId":delayed_project_id})
            assert ensured_delayed["ok"], ensured_delayed
            adopted_delayed = send(page, {"type":"EV_ADOPT","projectId":delayed_project_id,
                "text":"延迟撤回范围验收","conditions":"仅用于合成测试",
                "fragments":[{"selection":"延迟撤回保留的来源"}],
                "operationId":"op_ux08delayed001"})
            assert adopted_delayed["ok"], adopted_delayed
            panel.evaluate("() => window.dispatchEvent(new Event('threadline-evidence-changed'))")
            panel.wait_for_function("id => [...document.querySelector('#evidence-project').options].some(o=>o.value===id)",
                arg=delayed_project_id)
            panel.select_option("#evidence-project",delayed_project_id)
            panel.wait_for_function("id => [...document.querySelectorAll('#evidence-list .evidence-item')].some(n=>n.dataset.conclusionId===id)",
                arg=adopted_delayed["data"]["conclusionId"])
            panel.evaluate("""() => {
                const original=chrome.runtime.sendMessage.bind(chrome.runtime);
                window.__restoreDelayedWithdraw=()=>{chrome.runtime.sendMessage=original;};
                window.__releaseDelayedWithdraw=null;
                window.__delayedWithdrawCalls=0;
                chrome.runtime.sendMessage=(payload,callback)=>{
                    if(payload?.type==="EV_WITHDRAW"){
                        window.__delayedWithdrawCalls++;
                        return original(payload,response=>{
                            window.__delayedWithdrawResponse=response;
                            window.__releaseDelayedWithdraw=()=>callback(response);
                        });
                    }
                    return original(payload,callback);
                };
            }""")
            panel.locator("#evidence-list button", has_text="撤回").click()
            panel.locator("dialog.tl-confirm-dialog button", has_text="撤回结论").click()
            panel.wait_for_function("() => typeof window.__releaseDelayedWithdraw === 'function'")
            assert panel.locator("#evidence-list button", has_text="撤回").is_disabled()
            assert panel.evaluate("window.__delayedWithdrawCalls")==1
            panel.select_option("#evidence-project",project_id)
            panel.wait_for_function("id => document.querySelector('#evidence-project').value===id",arg=project_id)
            panel.wait_for_function("id => [...document.querySelectorAll('#evidence-list .evidence-item')].some(n=>n.dataset.conclusionId===id)",
                arg=adopted2["data"]["conclusionId"])
            panel.evaluate("() => window.__releaseDelayedWithdraw()")
            panel.wait_for_timeout(100)
            assert panel.locator("#evidence-project").input_value()==project_id
            assert panel.locator("#evidence-list .evidence-item").first.get_attribute("data-conclusion-id")==adopted2["data"]["conclusionId"]
            delayed_listing = send(panel, {"type":"EV_LIST","projectId":delayed_project_id})
            assert delayed_listing["ok"], delayed_listing
            delayed_row = next(row for row in delayed_listing["data"]["rows"]
                if row["conclusion"]["id"] == adopted_delayed["data"]["conclusionId"])
            assert delayed_row["conclusion"]["status"] == "withdrawn"
            assert panel.evaluate("window.__delayedWithdrawCalls")==1
            panel.evaluate("window.__restoreDelayedWithdraw()")
            first = panel.locator("#evidence-list .evidence-item").first
            assert first.get_attribute("open") is not None
            summary = first.locator(":scope > summary")
            assert summary.evaluate("node => node.getBoundingClientRect().height") >= 36
            first.locator(".evidence-item-body > details > summary").first.click()
            panel.locator("#evidence-list button", has_text="在对话中定位").click()
            panel.wait_for_function(
                "() => document.querySelector('#evidence-list').textContent"
                ".includes('对话未打开（仅片段）')")
            assert panel_errors == [], panel_errors
            # Exercise the actual text-only edit control and retain original evidence identity.
            original = send(panel, {"type": "EV_LIST", "projectId": project_id})["data"]["rows"][0]
            # S1 now uses the inline accessible form, not window.prompt.
            # Exercise the actual text field and submit path without weakening
            # the evidence/source preservation assertions below.
            panel.locator("#evidence-list button", has_text="修订").click()
            action_bounds = panel.locator("dialog.tl-dialog").evaluate("""dialog => {
                const outer = dialog.getBoundingClientRect();
                return [...dialog.querySelectorAll('.tl-actions button')].map(button => {
                  const rect = button.getBoundingClientRect();
                  return {text:button.textContent,visible:rect.top >= Math.max(0, outer.top) &&
                    rect.bottom <= Math.min(innerHeight, outer.bottom) &&
                    rect.left >= Math.max(0, outer.left) && rect.right <= Math.min(innerWidth, outer.right)};
                });
            }""")
            assert all(button["visible"] for button in action_bounds), action_bounds
            panel.locator("dialog.tl-dialog #tl-field-text").fill("面板修订后的结论")
            panel.locator("dialog.tl-dialog button[type=submit]").click()
            panel.wait_for_function("() => document.querySelector('#evidence-list').textContent.includes('面板修订后的结论')")
            changed = send(panel, {"type": "EV_LIST", "projectId": project_id})["data"]["rows"][0]
            assert changed["current"]["conditions"] == original["current"]["conditions"]
            assert changed["fragments"] == original["fragments"], "text edits preserve source IDs, times and provenance"
            retry_request = {"type": "EV_AMEND", "conclusionId": adopted2["data"]["conclusionId"],
                             "text": "可重试修订", "operationId": "op_native_retry001"}
            retry_first = send(panel, retry_request)
            retry_second = send(panel, retry_request)
            assert retry_first["ok"] and retry_second["ok"], (retry_first, retry_second)
            assert retry_first["data"]["versionId"] == retry_second["data"]["versionId"]
            assert not send(panel, {**retry_request, "text": "相同操作的不同正文"})["ok"]
            current_topic = send(panel, {"type": "SNAPSHOT"})["data"]["state"]
            topic = next(p for p in current_topic["projects"] if p["id"] == project_id)
            assert "可重试修订" in topic["decision"] and topic["knowledgeVersion"] == 3
            panel.click("#evidence-handoff")
            # The click starts an asynchronous EV_LIST request. Wait for the
            # actual generated material rather than reading before its response;
            # keep the same content assertion and do not mask request failures.
            panel.wait_for_function(
                "() => document.querySelector('#evidence-handoff-view')?.value.includes('仅适用合成样本 A')")
            assert "仅适用合成样本 A" in panel.locator("#evidence-handoff-view").input_value()
            panel.locator("#evidence-handoff-view").fill("人工修改的交接材料")
            assert panel.locator("#evidence-handoff-view").input_value() == "人工修改的交接材料"
            # Isolate the clipboard side effect; the authority and panel remain native.
            panel.evaluate("""() => {window.__copied=[]; Object.defineProperty(navigator,'clipboard',
                {value:{writeText:async text=>window.__copied.push(text)},configurable:true});}""")
            panel.click("#evidence-handoff-copy")
            panel.wait_for_function("() => document.body.textContent.includes('已复制编辑后的交接材料')")
            assert panel.evaluate("window.__copied") == ["人工修改的交接材料"]
            # Two extension windows start from one version; only one edit may commit.
            second_panel = ctx.new_page()
            second_panel.goto(f"chrome-extension://{eid}/panel.html", wait_until="domcontentloaded")
            stale_version = retry_first["data"]["versionId"]
            fresh_edit = send(second_panel, {"type": "EV_AMEND", "conclusionId": adopted2["data"]["conclusionId"],
                "text": "另一窗口的新修订", "expectedVersionId": stale_version, "operationId": "op_second_window01"})
            assert fresh_edit["ok"], fresh_edit
            before_stale = raw_evidence(page)
            stale_edit = send(panel, {"type": "EV_AMEND", "conclusionId": adopted2["data"]["conclusionId"],
                "text": "旧窗口的过期修订", "expectedVersionId": stale_version, "operationId": "op_stale_window001"})
            assert not stale_edit["ok"] and "其他窗口修订" in stale_edit["error"], stale_edit
            assert raw_evidence(page) == before_stale
            panel.click("#evidence-handoff-copy")
            panel.wait_for_function("() => document.body.textContent.includes('证据已变化，请重新核对预览')")
            assert panel.locator("#evidence-handoff-view").input_value() == "人工修改的交接材料"
            assert panel_errors == [], panel_errors
            assert panel.evaluate("window.__copied") == ["人工修改的交接材料"]
            sealed = panel.evaluate(
                "payload => new Promise(res => chrome.runtime.sendMessage(payload, res))",
                {"type": "MUTATE", "action": {"type": "updateProject",
                 "projectId": project_id, "patch": {"decision": "绕过封口"}}})
            assert not sealed["ok"] and "证据库接管" in sealed["error"], sealed
            still_ok = panel.evaluate(
                "payload => new Promise(res => chrome.runtime.sendMessage(payload, res))",
                {"type": "MUTATE", "action": {"type": "updateProject",
                 "projectId": project_id, "patch": {"goal": "目标仍可编辑"}}})
            assert still_ok["ok"], still_ok
            # Actual old-editor payload excludes its read-only decision field.
            second_panel.reload(wait_until="domcontentloaded")
            second_panel.locator("#manage-accordion > summary").click()
            second_panel.locator(f'[data-action="select-project"][data-id="{project_id}"]').click()
            assert second_panel.locator("#edit-decision").evaluate("e => e.readOnly")
            second_panel.locator("#edit-goal").fill("通过旧界面更新目标")
            second_panel.locator('[data-action="save-details"]').click()
            second_panel.wait_for_function("() => document.body.textContent.includes('课题状态已保存')")
            after_ui = send(second_panel, {"type": "SNAPSHOT"})["data"]["state"]
            assert next(p for p in after_ui["projects"] if p["id"] == project_id)["goal"] == "通过旧界面更新目标"
            before_delete = raw_evidence(page)
            refused_delete = send(panel, {"type": "MUTATE", "action": {"type": "deleteProject", "projectId": project_id}})
            assert not refused_delete["ok"] and "证据库接管" in refused_delete["error"]
            assert raw_evidence(page) == before_delete
            ctx.close()

            # Restart recovery: the authoritative store must survive a full
            # browser restart on the same one-shot profile (projection todos
            # recompute; no external replays).
            ctx2, page2, eid2 = launch()
            page2.select_option("#ev-project", "proto-p1")
            listing2 = page2.evaluate(
                "payload => new Promise(res => chrome.runtime.sendMessage(payload, res))",
                {"type": "EV_LIST", "projectId": "proto-p1"})
            assert listing2["ok"], listing2
            rows2 = listing2["data"]["rows"]
            assert len(rows2) == 12, "evidence must survive browser restart"
            assert listing2["data"]["project"]["evidenceRevision"] == 13, \
                "withdrawal revision must persist"
            withdrawn = [r for r in rows2 if r["conclusion"]["status"] == "withdrawn"]
            assert len(withdrawn) == 1
            # S1a: the one-way projection also survives the restart.
            projection2 = page2.evaluate(
                "() => new Promise(res => chrome.storage.local.get("
                "'tl_evidence_summary_proto-p1', r => res(r)))")
            assert projection2["tl_evidence_summary_proto-p1"]["evidenceRevision"] == 13
            # A new browser/service-worker instance uses the durable ledger.
            restarted_retry = send(page2, retry_request)
            assert restarted_retry["ok"], restarted_retry
            assert restarted_retry["data"]["versionId"] == retry_first["data"]["versionId"]
            restored_rows = send(page2, {"type": "EV_LIST", "projectId": project_id})["data"]["rows"]
            assert len(restored_rows[0]["versions"]) == 4

            # Import the pre-restart export into the OTHER project slot of a
            # fresh separate profile-scale store is an S1a path; here we prove
            # the planner rejects re-import into the same store (collision).
            collision = page2.evaluate(
                "payload => new Promise(res => chrome.runtime.sendMessage(payload, res))",
                {"type": "EV_IMPORT", "pkg": pkg["data"], "operationId": "op_e2e_import01"})
            assert not collision["ok"] and "冲突" in collision["error"]

            # Lose authority only in this disposable profile, retain the independent storage marker.
            page2.evaluate("""async () => {
                const db=await new Promise(r=>{const q=indexedDB.open('threadline_evidence_v1');q.onsuccess=()=>r(q.result);});
                await new Promise((resolve,reject)=>{
                    const tx=db.transaction([...db.objectStoreNames],'readwrite');
                    for(const n of db.objectStoreNames)tx.objectStore(n).clear();
                    tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);
                });db.close();
            }""")
            for message in [{"type": "EV_LIST", "projectId": "proto-p1"},
                            {"type": "EV_ENSURE", "projectId": "proto-p1"}]:
                missing = send(page2, message)
                assert not missing["ok"] and "权威库缺失" in missing["error"], missing

            ctx2.close()
            # Restore both backup versions into a truly empty, isolated native IDB.
            for format_version in (1, 2):
                with TemporaryDirectory(prefix="threadline-restore-") as recovery_profile:
                    restored_ctx, restored_page, _ = launch(recovery_profile)
                    empty_pkg = send(restored_page, {"type": "EV_EXPORT", "projectId": "proto-p1"})["data"]
                    empty_before = raw_evidence(restored_page)
                    empty_restore = send(restored_page, {"type": "EV_IMPORT", "pkg": empty_pkg, "operationId": "op_empty_native001"})
                    assert not empty_restore["ok"] and "空证据包" in empty_restore["error"], empty_restore
                    assert raw_evidence(restored_page) == empty_before
                    incoming = copy.deepcopy(pkg["data"])
                    if format_version == 1:
                        incoming["format"] = "threadline-evidence/1"
                        incoming.pop("project", None)
                        for version in incoming["versions"]:
                            version.pop("sourceCount", None)
                    restore_request = {"type": "EV_IMPORT", "pkg": incoming, "operationId": "op_native_import01"}
                    preview = send(restored_page, {**restore_request, "type": "EV_IMPORT_PREVIEW"})
                    assert preview["ok"], preview
                    recovered = send(restored_page, restore_request)
                    repeated = send(restored_page, restore_request)
                    assert recovered["ok"] and repeated["ok"], (recovered, repeated)
                    data = send(restored_page, {"type": "EV_LIST", "projectId": "proto-p1"})["data"]
                    assert data["project"]["takeover"] and len(data["rows"]) == 12
                    assert data["project"]["evidenceRevision"] == 1
                    before_invalid = raw_evidence(restored_page)
                    # Different conclusion/version/link IDs with an existing source ID and valid hash.
                    bad = copy.deepcopy(incoming)
                    cmap = {c["id"]: f"con_collision_{i:08d}" for i, c in enumerate(bad["conclusions"])}
                    vmap = {v["id"]: f"ver_collision_{i:08d}" for i, v in enumerate(bad["versions"])}
                    for c in bad["conclusions"]:
                        c["id"] = cmap[c["id"]]; c["currentVersionId"] = vmap[c["currentVersionId"]]
                    for v in bad["versions"]:
                        v["id"] = vmap[v["id"]]; v["conclusionId"] = cmap[v["conclusionId"]]
                        if v["predecessorId"]: v["predecessorId"] = vmap[v["predecessorId"]]
                    for i, link in enumerate(bad["links"]):
                        link["id"] = f"lnk_collision_{i:08d}"; link["versionId"] = vmap[link["versionId"]]
                    source = bad["sources"][0]; source["selection"] = "不得覆盖旧来源"
                    source["textHash"] = hashlib.sha256((source["before"] + source["selection"] + source["after"]).encode()).hexdigest()
                    failed = send(restored_page, {"type": "EV_IMPORT", "pkg": bad, "operationId": "op_native_collision1"})
                    assert not failed["ok"] and "冲突" in failed["error"], failed
                    assert raw_evidence(restored_page) == before_invalid, "invalid import must leave every store unchanged"
                    restored_ctx.close()
            print("PASS: S0a+S1a evidence prototype — 12 timed adoptions "
                  f"(median {stats['medianMs']}ms, P90 {stats['p90Ms']}ms), "
                  "single-transaction CAS/idempotency, restart recovery, "
                  "withdraw-with-history, export package, collision refusal, "
                  "storage.estimate probe; S1a one-way chrome.storage "
                  "projection, legacy-decision sealing at message level, "
                  "projection across restart; real panel renders conversation-backed evidence, "
                  "amend/withdraw controls and fragment-only location fallback; native IDB restart replay, "
                  "v1/v2 restore sealing, source-collision rollback, metadata retention and authority-loss refusal")


if __name__ == "__main__":
    run()
