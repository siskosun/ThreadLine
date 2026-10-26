"""S5 optional official Argdown parser, preview-only import, explicit necessary edge.
Synthetic Chromium MV3; no ChatGPT account, external network or auto-send.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect
EXT=Path(os.environ.get("THREADLINE_EXTENSION_PATH",Path(__file__).resolve().parents[1])).resolve()
def run():
 with TemporaryDirectory(prefix="threadline-s5-") as profile:
  with sync_playwright() as p:
   context=p.chromium.launch_persistent_context(profile,executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
    channel="chromium",headless=True,args=["--no-sandbox","--disable-dev-shm-usage",
      f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"])
   worker=context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker",timeout=15000)
   page=context.new_page();page.goto(f"chrome-extension://{worker.url.split('/')[2]}/panel.html",wait_until="domcontentloaded")
   page.wait_for_selector("#argdown-loader",state="attached")
   assert page.evaluate("typeof ThreadLineArgdown")=="undefined","Argdown parser must not auto-load"
   def send(payload):
    r=page.evaluate("p=>chrome.runtime.sendMessage(p)",payload)
    assert r and r.get("ok"),r
    return r["data"]
   pid=send({"type":"MUTATE","action":{"type":"createProject","name":"S5 合成互通"}})["state"]["projects"][0]["id"]
   def adopt(s):
    return send({"type":"EV_ADOPT","projectId":pid,"text":"结论 "+s,
     "fragments":[{"selection":"依据 "+s,"relation":"cites","completeness":"partial"}],
     "operationId":"op_s5adopt_"+s})
   a,b=adopt("one"),adopt("two")
   page.locator("#nav-evidence").click()
   page.locator("#argdown-loader > summary").click()
   page.locator("#argdown-loader button").click()
   page.wait_for_function("()=>typeof ThreadLineArgdown === 'object' && !!document.getElementById('argdown-workbench')",timeout=15000)
   assert page.evaluate("ThreadLineArgdownUI.relationKind('attack')")=="oppose"
   page.locator("#argdown-workbench").evaluate("(e)=>e.open=true")
   source=f"[{a['conclusionId']}]: 上游条件\n  +> [{b['conclusionId']}]: 下游结论"
   page.get_by_label("粘贴 Argdown 进行预览").fill(source)
   page.get_by_role("button",name="解析并预览关系").click()
   proposal=page.locator("#argdown-proposals fieldset")
   expect(proposal).to_have_count(1)
   before=send({"type":"EV_RESEARCH_LIST","projectId":pid})
   assert not before["edges"],"Argdown preview must not mutate"
   proposal.locator('input[type="checkbox"]').check()
   proposal.get_by_label("确认必要前提的理由").fill("这是经人工核对的必要前提")
   proposal.get_by_role("button",name="登记此必要前提").click()
   expect(page.locator("#argdown-status")).to_contain_text("已登记为必要前提",timeout=15000)
   result=send({"type":"EV_RESEARCH_LIST","projectId":pid})
   assert len(result["edges"])==1 and result["edges"][0]["status"]=="confirmed",result
   page.get_by_role("button",name="导出 Argdown 文本").click()
   exported=page.get_by_label("Argdown 导出文本").input_value()
   parsed=page.evaluate("text => ThreadLineArgdown.parse(text)",exported)
   assert len(parsed["relations"])==1 and parsed["relations"][0]["type"]=="support",parsed
   context.close()
 print("PASS: S5 lazy Argdown, official parser, preview-only import, human confirmation and export")
if __name__=="__main__":run()
