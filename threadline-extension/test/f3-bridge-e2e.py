"""F3 capture bridge liveness: lost MAIN->isolated receipt must NOT ACK start.
Synthetic MV3 Chromium page with no login, no ChatGPT requests and zero sends.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright

EXT=Path(os.environ.get("THREADLINE_EXTENSION_PATH",Path(__file__).resolve().parents[1])).resolve()
HTML='''<!doctype html><title>Offline saved conversation</title>
<form id="composer"><textarea></textarea><button type="submit">Send</button></form>
<script>window.submitCount=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();window.submitCount++}</script>'''

def run():
 with TemporaryDirectory(prefix="threadline-f3-bridge-") as profile:
  with sync_playwright() as p:
   ctx=p.chromium.launch_persistent_context(profile,
     executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
     channel="chromium",headless=True,args=["--no-sandbox","--disable-dev-shm-usage",
      f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"])
   ctx.route("https://chatgpt.com/**",lambda route:route.fulfill(status=200,content_type="text/html",body=HTML))
   worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker",timeout=15000)
   eid=worker.url.split("/")[2]
   source=ctx.new_page()
   source.goto("https://chatgpt.com/c/f3-bridge-synthetic",wait_until="domcontentloaded")
   panel=ctx.new_page()
   panel.goto(f"chrome-extension://{eid}/panel.html",wait_until="domcontentloaded")
   tab=panel.evaluate("""async () => {
     const tabs=await chrome.tabs.query({url:"https://chatgpt.com/*"});
     return tabs.find(x=>x.url?.includes("f3-bridge-synthetic"))?.id;
   }""")
   assert isinstance(tab,int),f"source tab missing: {tab}"
   # The normal manifest automatically installs BOTH bridges. Fault-inject
   # a MAIN-world bridge that cannot deliver any main-to-extension receipts;
   # otherwise this test would accidentally hit the already-installed bridge.
   panel.evaluate("""async id => chrome.scripting.executeScript({
     target:{tabId:id},world:"MAIN",func:()=>{
       const original=window.postMessage.bind(window);
       window.__TL_TEST_ORIGINAL_POST_MESSAGE=original;
       window.postMessage=(packet,target,...rest)=>{
         if(packet?.channel==="threadline-capture-v2" &&
            packet.direction==="main-to-extension")return;
         return original(packet,target,...rest);
       };
     }})""",tab)
   failed=panel.evaluate("""async id => chrome.tabs.sendMessage(id,{
       type:"TL_CAPTURE_START",id:"cap_handshake0001",conversationId:"f3-bridge-synthetic"})""",tab)
   assert failed and failed.get("ok") is False,failed
   assert "未确认" in failed.get("error",""),failed
   assert source.evaluate("window.submitCount")==0
   # Explicitly restore the bridge delivery and perform a *manual* retry;
   # this must not replay unknown sends or claim an unsupported completion.
   panel.evaluate("""async id => chrome.scripting.executeScript({
      target:{tabId:id},world:"MAIN",func:()=>{
        window.postMessage=window.__TL_TEST_ORIGINAL_POST_MESSAGE;
        delete window.__TL_TEST_ORIGINAL_POST_MESSAGE;
      }})""",tab)
   started=panel.evaluate("""async id => chrome.tabs.sendMessage(id,{
       type:"TL_CAPTURE_START",id:"cap_handshake0002",conversationId:"f3-bridge-synthetic"})""",tab)
   assert started and started.get("ok") is True,started
   assert source.evaluate("window.submitCount")==0
   ctx.close()
 print("PASS: F3 dropped MAIN receipt rejects startup, explicit manual retry ACKs, zero automatic sends")

if __name__=="__main__":run()
