"""S3 versioned impact notifications and explicitly per-event confirmation.
Synthetic account-free Chromium MV3 test.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright
EXT=Path(os.environ.get("THREADLINE_EXTENSION_PATH",Path(__file__).resolve().parents[1])).resolve()
def run():
 with TemporaryDirectory(prefix="threadline-s3-") as profile:
  with sync_playwright() as p:
   context=p.chromium.launch_persistent_context(profile,executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
    channel="chromium",headless=True,args=["--no-sandbox","--disable-dev-shm-usage",
      f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"])
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker",timeout=15000)
   page=context.new_page();page.goto(f"chrome-extension://{worker.url.split('/')[2]}/panel.html",wait_until="domcontentloaded")
   page.wait_for_selector("#impact-workbench",state="attached")
   def send(payload,ok=True):
    r=page.evaluate("p=>chrome.runtime.sendMessage(p)",payload)
    if ok:assert r and r.get("ok"),r;return r["data"]
    assert not r.get("ok"),r;return r.get("error","")
   project=send({"type":"MUTATE","action":{"type":"createProject","name":"S3 合成影响"}})["state"]["projects"][0]["id"]
   def adopt(label):
    return send({"type":"EV_ADOPT","projectId":project,"text":"结论 "+label,
     "fragments":[{"selection":"依据 "+label,"relation":"supports","completeness":"partial"}],
     "operationId":"op_s3adopt_"+label})
   a,b,c=[adopt(x) for x in ("a","b","c")]
   def state():return send({"type":"EV_RESEARCH_LIST","projectId":project})
   def edge(up,down,op):
    r=state();return send({"type":"EV_RESEARCH_COMMAND","projectId":project,
     "expectedRevision":r["project"]["evidenceRevision"],"operationId":"op_s3edge_"+op,
     "command":{"kind":"addDependency","upstreamConclusionId":up["conclusionId"],"downstreamConclusionId":down["conclusionId"],
      "upstreamVersionId":up["versionId"],"downstreamVersionId":down["versionId"],"reason":"人工确认的必要前提"}})
   e1=edge(a,b,"ab");e2=edge(b,c,"bc")
   changed=send({"type":"EV_AMEND","conclusionId":a["conclusionId"],"text":"上游结论发生实质变化",
    "expectedVersionId":a["versionId"],"operationId":"op_s3change_main","changeImpact":"substantive"})
   r=state();events=[e for e in r["notifications"] if e["kind"]=="change"]
   assert len(events)==1,events
   event=events[0];pending={x["conclusionId"] for x in event["affected"] if x["pending"]}
   assert pending=={b["conclusionId"],c["conclusionId"]},pending
   material=send({"type":"EV_IMPACT_CONTEXT","projectId":project,"triggerEventId":event["triggerEventId"],"targetConclusionId":c["conclusionId"]})
   assert material["before"]["text"]=="结论 a"
   assert material["after"]["text"]=="上游结论发生实质变化"
   assert material["target"]["text"]=="结论 c"
   err=send({"type":"EV_IMPACT_CONTEXT","projectId":project,"triggerEventId":"evt_fake12345678","targetConclusionId":c["conclusionId"]},False)
   assert "无关联" in err,err
   def confirm(edgeId,revision,op):
    r=state();match=next(e for e in r["edges"] if e["id"]==edgeId)
    return send({"type":"EV_RESEARCH_COMMAND","projectId":project,"expectedRevision":r["project"]["evidenceRevision"],
     "operationId":"op_s3confirm_"+op,"command":{"kind":"confirmDependency","edgeId":edgeId,
       "upstreamVersionId":match["upstreamVersionId"],"downstreamVersionId":match["downstreamVersionId"],
       "reason":"已逐项核查变更和证据","coveredChanges":[{
         "triggerEventId":event["triggerEventId"],"rootConclusionId":event["conclusionId"],"rootVersionId":event["toVersion"]}]}})
   confirm(e2["edgeId"],r["project"]["evidenceRevision"],"bc")
   after=state();notice=next(e for e in after["notifications"] if e["triggerEventId"]==event["triggerEventId"])
   assert next(x for x in notice["affected"] if x["conclusionId"]==c["conclusionId"])["pending"] is False
   assert next(x for x in notice["affected"] if x["conclusionId"]==b["conclusionId"])["pending"] is True
   confirm(e1["edgeId"],after["project"]["evidenceRevision"],"ab")
   after=state();notice=next(e for e in after["notifications"] if e["triggerEventId"]==event["triggerEventId"])
   assert not any(x["pending"] for x in notice["affected"]),notice
   duplicate=send({"type":"EV_AMEND","conclusionId":a["conclusionId"],"text":"上游结论发生实质变化",
      "expectedVersionId":a["versionId"],"operationId":"op_s3change_main"})
   assert duplicate["versionId"]==changed["versionId"]
   assert len([e for e in state()["research"]["events"] if e["kind"]=="change"])==1
   context.close()
 print("PASS: S3 versioned cascade, exact event coverage, no blanket closure, explicit context, replay")
if __name__=="__main__":run()
