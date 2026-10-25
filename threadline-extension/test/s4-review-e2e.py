"""S4 frozen review: staleness, historical result, manual keep/adjust and /3 backup.
Synthetic real MV3/IDB, no ChatGPT account and no automatic send.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright
EXT=Path(os.environ.get("THREADLINE_EXTENSION_PATH",Path(__file__).resolve().parents[1])).resolve()
def run():
 with TemporaryDirectory(prefix="threadline-s4-") as profile:
  with sync_playwright() as p:
   context=p.chromium.launch_persistent_context(profile,executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
    channel="chromium",headless=True,args=["--no-sandbox","--disable-dev-shm-usage",
     f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"])
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker",timeout=15000)
   page=context.new_page();page.goto(f"chrome-extension://{worker.url.split('/')[2]}/panel.html",wait_until="domcontentloaded")
   page.wait_for_selector("#review-workbench",state="attached")
   def send(payload,ok=True):
    response=page.evaluate("p=>chrome.runtime.sendMessage(p)",payload)
    if ok:assert response and response.get("ok"),response;return response["data"]
    assert not response.get("ok"),response;return response.get("error","")
   pid=send({"type":"MUTATE","action":{"type":"createProject","name":"S4 合成独立复核"}})["state"]["projects"][0]["id"]
   def adopt(s):
    return send({"type":"EV_ADOPT","projectId":pid,"text":"研究结论 "+s,"conditions":"相同样本",
     "fragments":[{"selection":"合成证据 "+s,"relation":"supports","completeness":"partial"}],
     "operationId":"op_s4adopt_"+s})
   a,b=adopt("a"),adopt("b")
   def state():return send({"type":"EV_RESEARCH_LIST","projectId":pid})
   r=state()
   edge=send({"type":"EV_RESEARCH_COMMAND","projectId":pid,"expectedRevision":r["project"]["evidenceRevision"],
    "operationId":"op_s4edge0001","command":{"kind":"addDependency",
      "upstreamConclusionId":a["conclusionId"],"downstreamConclusionId":b["conclusionId"],
      "upstreamVersionId":a["versionId"],"downstreamVersionId":b["versionId"],"reason":"必要前提经确认"}})
   send({"type":"EV_AMEND","conclusionId":a["conclusionId"],"text":"关键前提变化",
    "expectedVersionId":a["versionId"],"operationId":"op_s4change001"})
   r=state();assert any(x["pending"] for e in r["notifications"] for x in e["affected"])
   def prepare(i):
    r=state();return send({"type":"EV_REVIEW_PREPARE","projectId":pid,
       "targetConclusionId":b["conclusionId"],"question":"核对当前条件与来源",
       "expectedRevision":r["project"]["evidenceRevision"],"operationId":"op_s4prep_"+i})
   first=prepare("first")
   assert first["review"]["targetVersionId"]==b["versionId"]
   assert len(first["review"]["sourceSnapshots"])==2
   before=send({"type":"EV_REVIEW_REFERENCE","projectId":pid,"reviewId":first["reviewId"]})
   assert before["text"]=="研究结论 b"
   # New upstream version must make frozen review stale rather than overwriting.
   latest=state()["rows"]
   arow=next(x for x in latest if x["conclusion"]["id"]==a["conclusionId"])
   send({"type":"EV_AMEND","conclusionId":a["conclusionId"],"text":"关键前提再次变化",
     "expectedVersionId":arow["current"]["id"],"operationId":"op_s4change002"})
   r=state()
   stale=send({"type":"EV_REVIEW_COMPLETE","projectId":pid,"reviewId":first["reviewId"],
     "outcome":"keep","reason":"旧版本原文已有变化，仅保留历史",
     "expectedRevision":r["project"]["evidenceRevision"],"operationId":"op_s4complete_stale"})
   assert stale["stale"] is True,stale
   assert any(x["pending"] for e in state()["notifications"] for x in e["affected"])
   second=prepare("fresh")
   r=state()
   kept=send({"type":"EV_REVIEW_COMPLETE","projectId":pid,"reviewId":second["reviewId"],
     "outcome":"keep","reason":"已核查冻结的所有祖先来源及当前条件",
     "analysis":"独立核对完成","expectedRevision":r["project"]["evidenceRevision"],
     "operationId":"op_s4complete_keep"})
   assert kept["stale"] is False,kept
   assert not any(x["pending"] for e in state()["notifications"] for x in e["affected"])
   third=prepare("revised")
   r=state()
   revised=send({"type":"EV_REVIEW_COMPLETE","projectId":pid,"reviewId":third["reviewId"],
     "outcome":"revise","reason":"下游当前判断需要调整","text":"研究结论 b 已调整",
     "analysis":"经复核修订","expectedRevision":r["project"]["evidenceRevision"],
     "operationId":"op_s4complete_revise"})
   assert revised["stale"] is False and revised["versionId"].startswith("ver_"),revised
   r=state();v=next(x for x in r["rows"] if x["conclusion"]["id"]==b["conclusionId"])
   assert v["current"]["text"]=="研究结论 b 已调整" and v["current"]["conditions"]=="相同样本"
   backup=send({"type":"EV_BACKUP","projectId":pid})
   assert backup["evidence"]["format"]=="threadline-evidence/3"
   assert len(backup["evidence"]["project"]["research"]["reviews"])==3
   err=send({"type":"EV_REVIEW_COMPLETE","projectId":pid,"reviewId":third["reviewId"],
     "outcome":"keep","reason":"重复完成","expectedRevision":r["project"]["evidenceRevision"],
     "operationId":"op_s4complete_again"},False)
   assert err,err
   context.close()
 print("PASS: S4 frozen review, ancestor staleness, exact keep, atomic revise, immutable /3 history")
if __name__=="__main__":run()
