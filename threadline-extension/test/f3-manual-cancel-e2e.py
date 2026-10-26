"""F3 manual capture cancellation inside a disposable real Chromium MV3 context.

The source is synthetic. A persisted "capturing" run is seeded so the test
does not depend on network timing. No login or user message sending occurs.
"""
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect

EXT=Path(os.environ.get("THREADLINE_EXTENSION_PATH",Path(__file__).resolve().parents[1])).resolve()
SOURCE_HTML="""<!doctype html><title>Synthetic saved ChatGPT conversation</title>
<form><textarea id="prompt-textarea"></textarea><button type="submit">Send</button></form>
<script>window.sent=0;document.querySelector('form').onsubmit=e=>{
  e.preventDefault();window.sent++};</script>"""

def run():
    with TemporaryDirectory(prefix="threadline-capture-cancel-") as profile:
        with sync_playwright() as p:
            ctx=p.chromium.launch_persistent_context(
                profile,executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
                channel="chromium",headless=True,args=["--no-sandbox","--disable-dev-shm-usage",
                    f"--disable-extensions-except={EXT}",f"--load-extension={EXT}"])
            ctx.route("https://chatgpt.com/**",lambda route:route.fulfill(
                status=200,content_type="text/html",body=SOURCE_HTML))
            worker=ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event(
                "serviceworker",timeout=15000)
            extension_id=worker.url.split("/")[2]
            source=ctx.new_page()
            source.goto("https://chatgpt.com/c/f3-cancel-synthetic",wait_until="domcontentloaded")
            panel=ctx.new_page()
            panel.goto(f"chrome-extension://{extension_id}/panel.html",
                wait_until="domcontentloaded")
            tab_id=panel.evaluate("""async () => {
                const tabs=await chrome.tabs.query({url:"https://chatgpt.com/*"});
                return tabs.find(t=>t.url?.includes('f3-cancel-synthetic'))?.id;
            }""")
            assert isinstance(tab_id,int),tab_id
            run_id="cap_manual_cancel_synthetic_01"
            seed=worker.evaluate("""async args => {
                const when=Date.now()-21000;
                await ThreadLineCaptureDB.putRun({
                    id:args.id,tabId:args.tabId,
                    conversationId:"f3-cancel-synthetic",
                    url:"https://chatgpt.com/c/f3-cancel-synthetic",
                    title:"Synthetic saved conversation",status:"capturing",
                    createdAt:when,updatedAt:when,complete:false,
                    pageCount:1,messageCount:1,mode:"",notice:"",error:""});
                await ThreadLineCaptureDB.putPage({
                    id:args.id,pageIndex:0,chunkIndex:0,messages:[
                        {id:"synthetic-1",role:"user",content:"Retained partial source"}
                    ]});
                await chrome.storage.local.set({tl_last_capture_id:args.id});
                await chrome.storage.session.set({
                    ['tl_capture_owner_'+args.id]:{tabId:args.tabId,startedAt:when}});
                return true;
            }""",{"id":run_id,"tabId":tab_id})
            assert seed is True
            panel.reload(wait_until="domcontentloaded")
            cancel=panel.locator("#capture-cancel")
            expect(cancel).to_be_visible(timeout=12000)
            expect(panel.locator("#capture-progress")).to_contain_text("无进度",timeout=12000)
            assert source.evaluate("window.sent")==0
            # The only mutation is a user-confirmed stop. No source page reply,
            # no cancellation retry, and no ChatGPT message is generated.
            panel.once("dialog",lambda dialog:dialog.accept())
            cancel.click()
            expect(cancel).to_be_hidden(timeout=10000)
            row=worker.evaluate("id=>ThreadLineCaptureDB.getRun(id)",run_id)
            assert row["status"]=="error" and row["phase"]=="user-cancelled",row
            assert row["complete"] is False,row
            pages=worker.evaluate("id=>ThreadLineCaptureDB.pages(id)",run_id)
            assert len(pages)==1 and pages[0]["messages"][0]["content"]==(
                "Retained partial source"),pages
            duplicate=panel.evaluate("p=>chrome.runtime.sendMessage(p)",
                {"type":"CAPTURE_CANCEL","id":run_id})
            assert duplicate["ok"] and duplicate["data"]["alreadyCancelled"] is True,duplicate
            # A late page completion from the same tab must be rejected.
            late=panel.evaluate("""async ({tabId,id})=>{
                const [r]=await chrome.scripting.executeScript({
                    target:{tabId},world:"ISOLATED",func:async (id)=>{
                        return await chrome.runtime.sendMessage({
                            type:"CAPTURE_END",id,complete:true,
                            mode:"paginated",pageCount:1,count:1});
                    },args:[id]});
                return r.result;
            }""",{"tabId":tab_id,"id":run_id})
            assert not late["ok"] and "已结束" in late["error"],late
            final=worker.evaluate("id=>ThreadLineCaptureDB.getRun(id)",run_id)
            assert final["status"]=="error" and final["complete"] is False,final
            assert source.evaluate("window.sent")==0,"no automatic sends"
            ctx.close()
    print("PASS: F3 synthetic MV3 manual cancel, 21s idle UI, retained partial source, late completion blocked, zero sends")

if __name__=="__main__":
    run()
