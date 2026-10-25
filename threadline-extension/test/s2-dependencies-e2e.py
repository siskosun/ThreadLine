"""Native S2 dependency registration and version freshness in MV3 IndexedDB.
No real ChatGPT account or send. Isolated Chromium profile.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright
EXT=Path(os.environ.get("THREADLINE_EXTENSION_PATH",Path(__file__).resolve().parents[1])).resolve()
def run():
 with TemporaryDirectory(prefix="threadline-s2-") as profile:
  with sync_playwright() as p:
   context=p.chromium.launch_persistent_context(profile,executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
      channel="chromium",headless=True,args=["--no-sandbox","--disable-dev-shm-usage",
      f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"])
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker",timeout=15000)
   page=context.new_page();page.goto(f"chrome-extension://{worker.url.split('/')[2]}/panel.html",wait_until="domcontentloaded")
   page.wait_for_selector("#dependency-workbench",state="attached")
   def send(payload,ok=True):
    r=page.evaluate("p=>chrome.runtime.sendMessage(p)",payload)
    if ok:assert r and r.get("ok"),r;return r["data"]
    assert not r.get("ok"),r;return r.get("error","")
   create=send({"type":"MUTATE","action":{"type":"createProject","name":"S2 合成依赖"}})
   pid=create["state"]["projects"][0]["id"]
   def adopt(text,key):
    return send({"type":"EV_ADOPT","projectId":pid,"text":text,
      "fragments":[{"selection":"模拟证据 "+key,"before":"","after":"","relation":"supports","completeness":"partial"}],
      "operationId":"op_s2adopt_"+key})
   a=adopt("成立前提","one");b=adopt("依赖前提的结论","two")
   research=send({"type":"EV_RESEARCH_LIST","projectId":pid})
   assert len(research["rows"])==2 and not research["edges"]
   def row(cid):return next(x for x in research["rows"] if x["conclusion"]["id"]==cid)
   command={"kind":"addDependency","upstreamConclusionId":a["conclusionId"],"downstreamConclusionId":b["conclusionId"],
     "upstreamVersionId":row(a["conclusionId"])["current"]["id"],
     "downstreamVersionId":row(b["conclusionId"])["current"]["id"],"reason":"必要前提经人工核验"}
   created=send({"type":"EV_RESEARCH_COMMAND","projectId":pid,
     "expectedRevision":research["project"]["evidenceRevision"],"operationId":"op_s2cmd_create", "command":command})
   assert created["edgeId"].startswith("dep_"),created
   research=send({"type":"EV_RESEARCH_LIST","projectId":pid})
   assert len(research["edges"])==1 and research["edges"][0]["status"]=="confirmed",research
   reverse={**command,"upstreamConclusionId":b["conclusionId"],"downstreamConclusionId":a["conclusionId"],
     "upstreamVersionId":row(b["conclusionId"])["current"]["id"],"downstreamVersionId":row(a["conclusionId"])["current"]["id"]}
   err=send({"type":"EV_RESEARCH_COMMAND","projectId":pid,
     "expectedRevision":research["project"]["evidenceRevision"],"operationId":"op_s2cmd_cycle","command":reverse},False)
   assert "环" in err,err
   amend=send({"type":"EV_AMEND","conclusionId":a["conclusionId"],
     "text":"成立前提（已修订）","expectedVersionId":a["versionId"],"operationId":"op_s2amend_one"})
   research=send({"type":"EV_RESEARCH_LIST","projectId":pid})
   edge=research["edges"][0]
   assert edge["status"]=="pending" and "上游" in edge["reason"],edge
   confirmed=send({"type":"EV_RESEARCH_COMMAND","projectId":pid,
    "expectedRevision":research["project"]["evidenceRevision"],"operationId":"op_s2cmd_confirm",
    "command":{"kind":"confirmDependency","edgeId":edge["id"],"upstreamVersionId":amend["versionId"],
      "downstreamVersionId":b["versionId"],"reason":"新版本全文及依据已核查"}})
   assert confirmed["confirmationId"].startswith("dep_"),confirmed
   research=send({"type":"EV_RESEARCH_LIST","projectId":pid})
   assert research["edges"][0]["status"]=="confirmed"
   backup=send({"type":"EV_BACKUP","projectId":pid})
   assert backup["evidence"]["format"]=="threadline-evidence/3"
   assert len(backup["evidence"]["project"]["research"]["edges"])==1
   assert len(backup["evidence"]["project"]["research"]["confirmations"])==2
   # S4 commands become available in the next independent slice; test the
   # unchanged rejection of unknown privileged evidence commands instead.
   err=send({"type":"EV_UNKNOWN_PRIVILEGED","projectId":pid},False)
   assert "未知证据消息" in err,err
   context.close()
 print("PASS: S2 exact-version dependency, stale update rejection, cycle denial, /3 backup, S4 isolation")
if __name__=="__main__":run()
