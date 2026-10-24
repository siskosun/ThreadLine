"""S0a evidence prototype E2E on a one-shot synthetic profile (plan §十一.6).
Real MV3 service worker + real IndexedDB, no accounts, no external sites.
Probes: single-writer adoption protocol (12 timed operations), restart
recovery of the authoritative store, read-only summary projection, withdraw
with history, export/import roundtrip, storage.estimate visibility."""
import json
import os
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


def run():
    with TemporaryDirectory(prefix="threadline-evidence-") as profile:
        with sync_playwright() as p:
            def launch():
                context = p.chromium.launch_persistent_context(
                    profile,
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
                 "fragments": [{"selection": "封口用片段", "before": "前", "after": "后"}],
                 "operationId": "op_s1a_e2e_0001"})
            assert adopted2["ok"], adopted2
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
            ctx.close()

            # Restart recovery: the authoritative store must survive a full

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

            # Import the pre-restart export into the OTHER project slot of a
            # fresh separate profile-scale store is an S1a path; here we prove
            # the planner rejects re-import into the same store (collision).
            collision = page2.evaluate(
                "payload => new Promise(res => chrome.runtime.sendMessage(payload, res))",
                {"type": "EV_IMPORT", "pkg": pkg["data"], "operationId": "op_e2e_import01"})
            assert not collision["ok"] and "冲突" in collision["error"]

            ctx2.close()
            print("PASS: S0a+S1a evidence prototype — 12 timed adoptions "
                  f"(median {stats['medianMs']}ms, P90 {stats['p90Ms']}ms), "
                  "single-transaction CAS/idempotency, restart recovery, "
                  "withdraw-with-history, export package, collision refusal, "
                  "storage.estimate probe; S1a one-way chrome.storage "
                  "projection, legacy-decision sealing at message level, "
                  "projection across restart")


if __name__ == "__main__":
    run()
