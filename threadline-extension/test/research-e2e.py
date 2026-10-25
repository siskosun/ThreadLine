"""Native, disposable Chromium acceptance for the S1 lifecycle and S2--S4
workflows.  It never opens a ChatGPT page or touches a user profile."""
import copy
import os
import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import sync_playwright

EXT = Path(os.environ.get("THREADLINE_EXTENSION_PATH", Path(__file__).resolve().parents[1]))

def send(page, payload):
    return page.evaluate("p => new Promise(resolve => chrome.runtime.sendMessage(p, resolve))", payload)

def good(page, payload):
    result = send(page, payload)
    assert result and result.get("ok"), result
    return result["data"]

def bad(page, payload, text):
    result = send(page, payload)
    assert result and not result.get("ok") and text in result.get("error", ""), result
    return result

def op(name):
    return "op_" + name.ljust(8, "0")[:32]

def raw(page):
    return page.evaluate("""async () => {
      const db = await new Promise((resolve,reject) => {
        const q=indexedDB.open('threadline_evidence_v1');
        q.onsuccess=()=>resolve(q.result); q.onerror=()=>reject(q.error);
      });
      try {
        const tx=db.transaction([...db.objectStoreNames],'readonly');
        return await Promise.all([...db.objectStoreNames].map(name => new Promise((resolve,reject)=>{
          const q=tx.objectStore(name).getAll();q.onsuccess=()=>resolve([name,q.result]);q.onerror=()=>reject(q.error);
        })));
      } finally { db.close(); }
    }""")

def evidence_revision(page, project_id):
    return good(page, {"type":"EV_RESEARCH_LIST", "projectId":project_id})["project"]["evidenceRevision"]

def discard_evidence_idb(profile, extension_id):
    """Simulate loss of the native authority only; Chrome storage remains intact."""
    roots = list(Path(profile).rglob(f"chrome-extension_{extension_id}_0.indexeddb.leveldb"))
    assert roots, "Chromium did not create the extension IndexedDB directory"
    for root in roots:
        shutil.rmtree(root)

def run():
    with TemporaryDirectory(prefix="threadline-research-") as profile:
      with sync_playwright() as p:
        def launch(profile_path=profile):
          ctx = p.chromium.launch_persistent_context(profile_path, channel="chromium", headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage", f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"])
          worker = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
          eid = worker.url.split("/")[2]
          panel = ctx.new_page()
          panel.goto(f"chrome-extension://{eid}/panel.html", wait_until="domcontentloaded")
          panel.wait_for_selector("body")
          return ctx, panel, eid

        ctx, panel, eid = launch()
        created = good(panel, {"type":"MUTATE", "action":{"type":"createProject", "name":"主课题"}})
        p1 = created["state"]["projects"][0]["id"]
        created2 = good(panel, {"type":"MUTATE", "action":{"type":"createProject", "name":"保留课题"}})
        p2 = next(x["id"] for x in created2["state"]["projects"] if x["id"] != p1)
        proto = ctx.new_page()
        proto.goto(f"chrome-extension://{eid}/evidence-prototype.html", wait_until="domcontentloaded")
        source = {"selection":"原始依据", "before":"前", "after":"后", "relation":"supports", "completeness":"complete", "kind":"manual", "capturedAt":123}
        one = good(proto, {"type":"EV_ADOPT", "projectId":p1, "text":"上游结论", "fragments":[source], "operationId":op("adoptup")})
        two = good(proto, {"type":"EV_ADOPT", "projectId":p1, "text":"下游结论", "fragments":[{**source,"selection":"下游依据"}], "operationId":op("adoptdown")})
        good(proto, {"type":"EV_ADOPT", "projectId":p2, "text":"保留结论", "fragments":[{**source,"selection":"保留依据"}], "operationId":op("adoptsurv")})
        listed = good(panel, {"type":"EV_RESEARCH_LIST", "projectId":p1})
        rows = {r["conclusion"]["id"]:r for r in listed["rows"]}
        up, down = one["conclusionId"], two["conclusionId"]
        edge = good(panel, {"type":"EV_RESEARCH_COMMAND", "projectId":p1, "operationId":op("addedge"), "expectedRevision":listed["project"]["evidenceRevision"], "command":{"kind":"addDependency", "upstreamConclusionId":up, "downstreamConclusionId":down, "upstreamVersionId":rows[up]["current"]["id"], "downstreamVersionId":rows[down]["current"]["id"], "reason":"下游以该前提为必要条件"}})
        assert edge["edgeId"]
        amended = good(proto, {"type":"EV_AMEND", "conclusionId":up, "text":"上游结论已修订", "expectedVersionId":rows[up]["current"]["id"], "operationId":op("amendup")})
        research = good(panel, {"type":"EV_RESEARCH_LIST", "projectId":p1})
        assert research["notifications"] and research["notifications"][-1]["affected"][0]["conclusionId"] == down
        assert research["edges"][0]["status"] == "pending"
        prepared = good(panel, {"type":"EV_REVIEW_PREPARE", "projectId":p1, "targetConclusionId":down, "question":"上游修订后，下游是否仍成立？", "operationId":op("prepare"), "expectedRevision":evidence_revision(panel, p1)})
        good(proto, {"type":"EV_AMEND", "conclusionId":up, "text":"复核期间上游再次修订", "expectedVersionId":amended["versionId"], "operationId":op("amendagain")})
        stale = good(panel, {"type":"EV_REVIEW_COMPLETE", "projectId":p1, "reviewId":prepared["reviewId"], "outcome":"keep", "reason":"旧材料范围只能留作历史", "operationId":op("stalekeep"), "expectedRevision":evidence_revision(panel, p1)})
        assert stale["stale"] is True and stale["edgesToConfirm"] == []
        fresh = good(panel, {"type":"EV_REVIEW_PREPARE", "projectId":p1, "targetConclusionId":down, "question":"按当前上游重新核对", "operationId":op("preparefresh"), "expectedRevision":evidence_revision(panel, p1)})
        completed = good(panel, {"type":"EV_REVIEW_COMPLETE", "projectId":p1, "reviewId":fresh["reviewId"], "outcome":"keep", "reason":"当前版本已对照", "operationId":op("freshkeep"), "expectedRevision":evidence_revision(panel, p1)})
        assert completed["stale"] is False
        # Handoff records distinguish copied material from a human-read event and invalidate on a new version.
        handoff = good(panel, {"type":"EV_HANDOFF_PREPARE", "projectId":p1, "operationId":op("handoff"), "expectedRevision":evidence_revision(panel, p1)})["handoff"]
        checked = good(panel, {"type":"EV_HANDOFF_VALIDATE", "projectId":p1, "handoffId":handoff["id"], "text":handoff["text"]})
        assert checked["materialHash"] == handoff["materialHash"]
        copied = good(panel, {"type":"EV_HANDOFF_RECORD", "projectId":p1, "handoffId":handoff["id"], "text":handoff["text"], "event":"copied", "operationId":op("copied"), "expectedRevision":evidence_revision(panel, p1)})
        assert copied["event"] == "copied"
        current = good(proto,{"type":"EV_LIST","projectId":p1})["rows"]
        current_down = next(x for x in current if x["conclusion"]["id"] == down)["current"]["id"]
        good(proto,{"type":"EV_AMEND","conclusionId":down,"text":"下游变化", "expectedVersionId":current_down,"operationId":op("changedown")})
        bad(panel,{"type":"EV_HANDOFF_VALIDATE","projectId":p1,"handoffId":handoff["id"],"text":handoff["text"]},"证据已变化")
        backup = good(panel,{"type":"EV_BACKUP","projectId":p1})
        assert backup["format"] == "threadline-project-backup/1" and backup["evidence"]["project"]["research"]["edges"]
        backup_p2 = good(panel,{"type":"EV_BACKUP","projectId":p2})
        backup_revision = evidence_revision(panel, p1)
        backup_p2_revision = evidence_revision(panel, p2)
        # Keep chrome.storage markers but discard just the native authority.  A backup
        # restore must allocate a revision above that marker, rather than resurrecting
        # a stale revision from the package.
        ctx.close()
        discard_evidence_idb(profile, eid)
        ctx, panel, eid = launch()
        proto = ctx.new_page(); proto.goto(f"chrome-extension://{eid}/evidence-prototype.html", wait_until="domcontentloaded")
        restore_preview = good(panel,{"type":"EV_RESTORE_PREVIEW","backup":backup,"replace":True})
        restored = good(panel,{"type":"EV_RESTORE_COMMIT","backup":backup,"preview":restore_preview["preview"],"replace":True,"operationId":op("restoreloss")})
        assert restored["revision"] > backup_revision
        # The authoritative store was lost for two marked projects.  Restoring
        # only one must not make the global consistency guard silently accept
        # the remaining missing project.
        bad(proto,{"type":"EV_LIST","projectId":p1},"不一致")
        restore_p2_preview = good(panel,{"type":"EV_RESTORE_PREVIEW","backup":backup_p2,"replace":True})
        restored_p2 = good(panel,{"type":"EV_RESTORE_COMMIT","backup":backup_p2,"preview":restore_p2_preview["preview"],"replace":True,"operationId":op("restorep2")})
        assert restored_p2["revision"] > backup_p2_revision
        after_loss = good(proto,{"type":"EV_LIST","projectId":p1})
        assert after_loss["project"]["takeover"] is True
        assert good(proto,{"type":"EV_LIST","projectId":p2})["project"]["takeover"] is True
        # Preview binds an exact revision. A concurrent amendment makes the old delete preview unusable.
        preview = good(panel,{"type":"EV_DELETE_PREVIEW","projectId":p1})
        current = good(proto,{"type":"EV_LIST","projectId":p1})["rows"]
        current_down = next(x for x in current if x["conclusion"]["id"] == down)["current"]["id"]
        good(proto,{"type":"EV_AMEND","conclusionId":down,"text":"删除预览期间变更", "expectedVersionId":current_down,"operationId":op("deletechange")})
        bad(panel,{"type":"EV_DELETE_COMMIT","projectId":p1,"preview":preview["preview"],"operationId":op("deletestale")},"删除预览已变化")
        preview = good(panel,{"type":"EV_DELETE_PREVIEW","projectId":p1})
        deleted = good(panel,{"type":"EV_DELETE_COMMIT","projectId":p1,"preview":preview["preview"],"operationId":op("deletefresh")})
        assert deleted["deleted"] is True
        assert "删除预览期间变更" not in str(raw(panel))
        projects = good(panel,{"type":"EV_PROJECTS"})["projects"]
        assert any(x["id"] == p2 for x in projects)
        bad(proto,{"type":"EV_ENSURE","projectId":p1},"删除")
        ctx.close()
        # Tombstones must survive restart; a deleted project cannot be resurrected by ensure.
        ctx2, panel2, eid2 = launch()
        proto2 = ctx2.new_page(); proto2.goto(f"chrome-extension://{eid2}/evidence-prototype.html", wait_until="domcontentloaded")
        bad(proto2,{"type":"EV_ENSURE","projectId":p1},"删除")
        forged = copy.deepcopy(backup); forged["evidence"]["counts"] = {"conclusions":999999}
        before = raw(panel2)
        forged_preview = send(panel2,{"type":"EV_RESTORE_PREVIEW","backup":forged,"replace":True})
        if forged_preview.get("ok"):
            assert forged_preview["data"]["counts"]["conclusions"] == len(backup["evidence"]["conclusions"])
        else:
            assert forged_preview.get("error")
        assert raw(panel2) == before
        ctx2.close()
    print("PASS: native S1 lifecycle, S2 dependency, S4 review, handoff, restore and delete workflow") 

if __name__ == "__main__":
    run()
