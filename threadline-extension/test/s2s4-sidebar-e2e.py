"""Actual sidebar interaction smoke: S2 add -> S3 inspect -> S4 local review.
Synthetic Chrome MV3 and local IndexedDB only. No logged-in ChatGPT sends.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright,expect

EXT=Path(os.environ.get("THREADLINE_EXTENSION_PATH",Path(__file__).resolve().parents[1])).resolve()
def run():
 with TemporaryDirectory(prefix="threadline-s2s4-sidebar-") as profile:
  with sync_playwright() as playwright:
   context=playwright.chromium.launch_persistent_context(
    profile,executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
    channel="chromium",headless=True,args=["--no-sandbox","--disable-dev-shm-usage",
      f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"])
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker",timeout=15000)
   page=context.new_page()
   page.set_default_timeout(15000)
   errors=[]
   page.on("pageerror",lambda e:errors.append(str(e)))
   page.goto(f"chrome-extension://{worker.url.split('/')[2]}/panel.html",wait_until="domcontentloaded")
   page.wait_for_selector("#nav-evidence")
   def send(payload):
    r=page.evaluate("p=>chrome.runtime.sendMessage(p)",payload)
    assert r and r.get("ok"),r
    return r["data"]
   project=send({"type":"MUTATE","action":{"type":"createProject","name":"全路径侧栏交互"}})
   pid=project["state"]["projects"][0]["id"]
   def adopt(key):
    return send({"type":"EV_ADOPT","projectId":pid,"text":"结论 "+key,"conditions":"一致口径",
      "fragments":[{"selection":"支持依据 "+key,"relation":"supports","completeness":"partial"}],
      "operationId":"op_sidebarsynthetic_"+key})
   a,b=adopt("a"),adopt("b")
   page.locator("#nav-evidence").click()
   page.locator("#evidence-project").select_option(pid)
   # S2: user explicitly opens the necessary-dependency panel and inputs a reason.
   page.locator("#dependency-workbench > summary").click()
   page.wait_for_function("()=>document.querySelector('#dependency-upstream')?.options.length>=2")
   page.locator("#dependency-upstream").select_option(a["conclusionId"])
   page.locator("#dependency-downstream").select_option(b["conclusionId"])
   page.locator("#dependency-reason").fill("核对后认定 A 是 B 的必要前提")
   page.locator("#dependency-add").click()
   expect(page.locator("#dependency-edges")).to_contain_text("已对照当前版本")
   r=send({"type":"EV_RESEARCH_LIST","projectId":pid})
   assert len(r["edges"])==1,r
   # New version triggers an S3 risk; the UI only marks as possibly affected.
   send({"type":"EV_AMEND","conclusionId":a["conclusionId"],"text":"结论 a 已更改",
    "expectedVersionId":a["versionId"],"operationId":"op_sidebarsynthetic_change",
    "changeImpact":"substantive"})
   page.locator("#impact-workbench > summary").click()
   page.wait_for_function("()=>document.getElementById('impact-items')?.textContent?.includes('待核查')")
   page.get_by_role("button",name="查看变更前后与原始依据").click()
   expect(page.locator("#impact-items")).to_contain_text("结论 a 已更改")
   # S4: user freezes sources, writes own analysis and records a review result.
   page.locator("#review-workbench > summary").click()
   page.wait_for_function("()=>Array.from(document.querySelector('#review-target')?.options||[]).length>=2")
   page.locator("#review-target").select_option(b["conclusionId"])
   page.locator("#review-question").fill("B 在 A 的最新版本下是否仍成立？")
   page.locator("#review-prepare").click()
   page.wait_for_function("()=>document.querySelector('#review-blind')?.value?.includes('支持依据')")
   frozen=page.locator("#review-blind").input_value()
   assert "支持依据 a" in frozen and "支持依据 b" in frozen,frozen
   page.locator("#review-analysis").fill("依据两份来源逐项核对，当前 B 仍可成立。")
   page.locator("#review-reason").fill("完成独立材料核查并核对最新前提")
   page.locator("#review-outcome").select_option("keep")
   page.once("dialog",lambda d:d.accept())
   page.locator("#review-complete").click()
   expect(page.locator("#review-status")).to_contain_text("复核结果已保存")
   state=send({"type":"EV_RESEARCH_LIST","projectId":pid})
   reviews=state["research"]["reviews"]
   assert len(reviews)==1 and reviews[0]["completions"][0]["outcome"]=="keep"
   assert reviews[0]["completions"][0]["stale"] is False
   assert not errors,errors
   context.close()
 print("PASS: S2–S4 user sidebar add dependency, inspect source, freeze and complete local review")

if __name__=="__main__":run()
