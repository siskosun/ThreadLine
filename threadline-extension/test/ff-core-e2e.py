"""MV3 Chromium Fork P1 smoke test with real IndexedDB and synthetic ChatGPT tab.
No authenticated account, real-site adapter, or message sending. Z0-LIVE remains blocked.
"""
import os
import time
from pathlib import Path
from tempfile import TemporaryDirectory
from playwright.sync_api import sync_playwright, expect

EXT = Path(__file__).resolve().parents[1]
SITE = """<!doctype html><title>Offline synthetic tab</title>
<form id="composer"><textarea></textarea><button type="submit">Send</button></form>
<script>window.submitCount=0;document.getElementById('composer').onsubmit=e=>{
 e.preventDefault();window.submitCount++}</script>"""


def run():
    with TemporaryDirectory(prefix="threadline-ff-") as profile:
        with sync_playwright() as p:
            def launch(handler=None):
                context = p.chromium.launch_persistent_context(
                    profile,
                    executable_path=os.environ.get("THREADLINE_CHROMIUM_PATH") or None,
                    channel="chromium", headless=True, args=[
                        "--no-sandbox", "--disable-dev-shm-usage",
                        f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"
                    ])
                def serve(route):
                    if handler and handler(route):
                        return
                    route.fulfill(status=200, content_type="text/html", body=SITE)
                context.route("https://chatgpt.com/**", serve)
                worker = context.service_workers[0] if context.service_workers else \
                    context.wait_for_event("serviceworker", timeout=15000)
                return context, worker.url.split("/")[2]

            ctx, eid = launch()
            chat = ctx.new_page()
            chat.goto("https://chatgpt.com/c/synthetic-only", wait_until="domcontentloaded")
            panel = ctx.new_page()
            panel.goto(f"chrome-extension://{eid}/panel.html", wait_until="domcontentloaded")
            panel.wait_for_selector("#ff-preview-link", state="attached")
            old = panel.evaluate("() => ThreadLineCore.emptyState()")
            page = ctx.new_page()
            page.goto(f"chrome-extension://{eid}/ff.html", wait_until="domcontentloaded")
            page.wait_for_selector("#ff-enable")
            expect(page.locator("#ff-notice")).to_contain_text("未启用")
            assert not page.locator("#ff-enable").is_checked()
            assert page.locator("#ff-local").is_hidden()

            def message(payload):
                return page.evaluate("payload => chrome.runtime.sendMessage(payload)", payload)

            assert not message({"type":"FF_CREATE","w0":"x","p":"task"})["ok"]
            assert not panel.evaluate("() => chrome.runtime.sendMessage({type:'FF_LIST'})")["ok"]
            assert not message({"type":"BACKUP_EXPORT"})["ok"]
            assert not message({"type":"MUTATE","action":{"type":"createProject","name":"malicious"}})["ok"]
            page.evaluate("(value) => chrome.storage.local.set({threadline_state_v1:value})", old)
            page.locator("#ff-enable").check()
            page.locator("#ff-local").wait_for(state="visible")
            assert message({"type":"FF_STATUS"})["data"]["enabled"] is True
            before = len(ctx.pages)

            evil = "<img src=x onerror='window.ffXss=1'>\n中文😀\n  code section"
            page.locator("#ff-w0").fill(evil)
            page.locator("#ff-p").fill("回答问题")
            page.locator("#ff-save").click()
            expect(page.locator("#ff-sha")).to_contain_text("SHA-256")
            assert not page.locator("#ff-detail img").count()
            assert page.locator("#ff-text").text_content().startswith("【共同材料 W₀】\n" + evil)
            assert page.evaluate("window.ffXss === undefined")
            assert len(ctx.pages) == before, "Fork P1 must not open ChatGPT tabs"
            assert chat.evaluate("window.submitCount") == 0, "Fork P1 must never send"
            first = message({"type":"FF_LIST"})["data"][0]["id"]
            record = message({"type":"FF_READ","id":first})
            assert record["ok"], record
            assert record["data"]["frozen"]["w0"] == evil
            assert len(record["data"]["frozen"]["textHashes"]["frozen"]) == 64
            assert record["data"]["branches"]["A"]["isolation"]["checks"]["model"] == "unknown"

            start = {"type":"FF_RECORD","experimentId":first,"branch":"A",
                     "expectedRevision":0,"operationId":"op_repeat001",
                     "attemptId":"att_repeat001","status":"unknown","phase":"awaiting_send",
                     "reason":"unverified send"}
            sent = message(start)
            assert sent["ok"] and sent["data"]["revision"] == 1, sent
            repeated = message(start)
            assert repeated["ok"] and repeated["data"]["revision"] == 1, repeated
            conflicting = message({**start, "reason":"changed"})
            assert not conflicting["ok"], conflicting
            assert not message({**start, "status":"done","operationId":"op_bad_done"})["ok"]
            assert not message({"type":"FF_RECORD","experimentId":first,"branch":"A",
                     "expectedRevision":1,"operationId":"op_retry001","attemptId":"att_retry001",
                     "status":"pending","phase":"created"})["ok"]
            retry = message({"type":"FF_RECORD","experimentId":first,"branch":"A",
                     "expectedRevision":1,"operationId":"op_retry001","attemptId":"att_retry001",
                     "status":"pending","phase":"created","manualNewAttempt":True})
            assert retry["ok"] and retry["data"]["revision"] == 2, retry
            assert retry["data"]["branches"]["A"]["attempts"][0]["status"] == "unknown"

            # A new in-flight attempt ID must not replace the pending manual
            # retry or create an ambiguous second active branch attempt.
            second_active = message({"type":"FF_RECORD","experimentId":first,
                "branch":"A","expectedRevision":2,"operationId":"op_illicitpend",
                "attemptId":"att_illicitpend","status":"pending","phase":"created"})
            assert not second_active["ok"], second_active
            assert "another active attempt" in second_active["error"], second_active
            still_current = message({"type":"FF_READ","id":first})
            assert still_current["ok"] and still_current["data"]["revision"] == 2
            assert len(still_current["data"]["branches"]["A"]["attempts"]) == 2

            concurrent = page.evaluate("""async id => Promise.all([
              chrome.runtime.sendMessage({type:'FF_RECORD',experimentId:id,branch:'B',
                expectedRevision:2,operationId:'op_race111',attemptId:'att_race111',
                status:'pending',phase:'draft_ready'}),
              chrome.runtime.sendMessage({type:'FF_RECORD',experimentId:id,branch:'B',
                expectedRevision:2,operationId:'op_race222',attemptId:'att_race111',
                status:'failed',phase:'draft_ready'})
            ])""", first)
            assert sum(bool(reply.get("ok")) for reply in concurrent) == 1, concurrent
            assert message({"type":"FF_READ","id":first})["data"]["revision"] == 3

            # Inclusive 24000 UTF-8 bytes of the final assembled text.
            overhead = len(("【共同材料 W₀】\n" + "\n\n【任务指令 P】\n任务").encode("utf-8"))
            at_limit = "x" * (24000 - overhead)
            maximum = message({"type":"FF_CREATE","operationId":"op_length001","w0":at_limit,"p":"任务"})
            assert maximum["ok"] and maximum["data"]["bytes"] == 24000, maximum
            replay = message({"type":"FF_CREATE","operationId":"op_length001","w0":at_limit,"p":"任务"})
            assert replay["ok"] and replay["data"]["id"] == maximum["data"]["id"], replay
            changed = message({"type":"FF_CREATE","operationId":"op_length001","w0":at_limit[:-1],"p":"任务"})
            assert not changed["ok"], changed
            too_large = message({"type":"FF_CREATE","operationId":"op_length002","w0":at_limit+"x","p":"任务"})
            assert not too_large["ok"], too_large

            legacy = page.evaluate("() => chrome.storage.local.get('threadline_state_v1')")
            assert legacy["threadline_state_v1"] == old, "FF must not mutate legacy topics"
            db = page.evaluate("""async () => {
              const db=await new Promise((resolve,reject)=>{
                const r=indexedDB.open('threadline_ff_v1');
                r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
              });
              const exists=db.objectStoreNames.contains('experiments');
              db.close();
              return exists;
            }""")
            assert db is True
            ctx.close()

            import json as _json
            fork_convo = _json.dumps({"messages": [
                {"id": "m1", "message": {"author": {"role": "user"},
                    "content": {"parts": ["fictional"]}, "status": "finished_successfully"}},
                {"id": "m2", "message": {"author": {"role": "assistant"},
                    "content": {"parts": ["好的，OK。"]}, "status": "finished_successfully"}}],
                "page_info": {"has_previous_page": False}})
            fork_site = """<!doctype html><title>Offline synthetic fork tab</title>
            <style>.whitespace-pre-wrap{white-space:pre-wrap}</style><form id="composer"><textarea id="prompt-textarea"></textarea>
            <button type="submit">Send</button></form><div id="log"></div>
            <script>
            // A textarea editor keeps the prefill byte-exact through the
            // handoff value-setter path; contenteditable fidelity is covered
            // by handoff-e2e. This scenario exercises the P2 state machine.
            window.submitCount=0;
            document.getElementById('composer').onsubmit=e=>{e.preventDefault();window.submitCount++;
              const text=document.getElementById('prompt-textarea').value;
              const user=document.createElement('div');
              user.setAttribute('data-message-author-role','user');
              user.innerHTML='<div class="whitespace-pre-wrap"></div>';
              user.querySelector('.whitespace-pre-wrap').textContent=text;
              document.getElementById('log').appendChild(user);
              const asst=document.createElement('div');
              asst.setAttribute('data-message-author-role','assistant');
              asst.innerHTML='<div class="whitespace-pre-wrap">好的，OK。</div>';
              document.getElementById('log').appendChild(asst);
              history.pushState(null,'','/c/fork-e2e-'+Math.random().toString(16).slice(2,10));};
            </script>"""
            def fork_handler(route):
                url = route.request.url
                print("ROUTE-HIT:", url[:70])
                if "/backend-api/" in url:
                    route.fulfill(status=200, content_type="application/json", body=fork_convo)
                    return True
                if url.rstrip("/") == "https://chatgpt.com":
                    route.fulfill(status=200, content_type="text/html", body=fork_site)
                    return True
                return False
            ctx2, eid2 = launch(handler=fork_handler)
            assert eid2 == eid, "Persistent extension ID should not change"
            reopened = ctx2.new_page()
            reopened.goto(f"chrome-extension://{eid2}/ff.html")
            expect(reopened.locator("#ff-enable")).to_be_checked()
            rows = reopened.evaluate("() => chrome.runtime.sendMessage({type:'FF_LIST'})")
            assert rows["ok"] and len(rows["data"]) == 2, rows
            after = reopened.evaluate("(id) => chrome.runtime.sendMessage({type:'FF_READ',id})", first)
            assert after["ok"] and after["data"]["revision"] == 3, after
            assert after["data"]["branches"]["A"]["attempts"][0]["status"] == "unknown"
            assert reopened.evaluate("() => chrome.storage.local.get('threadline_state_v1')")["threadline_state_v1"] == old
            tabs_before_retry = len(ctx2.pages)  # Persistent Chromium may open a blank startup tab.

            # Simulate the critical MV3 edge: the background commits FF_CREATE
            # but its success ACK is lost on the way to this page. A human
            # explicitly retries AFTER the page reloads. This must reuse the
            # pending operation ID rather than silently creating experiment #4.
            missing_ack_w0 = "Unacknowledged create: 中文😀 \\n code"
            missing_ack_p = "one frozen experiment only"
            reopened.locator("#ff-w0").fill(missing_ack_w0)
            reopened.locator("#ff-p").fill(missing_ack_p)
            patched = reopened.evaluate("""() => {
              const original = chrome.runtime.sendMessage.bind(chrome.runtime);
              window.__ffCreateLostAck = null;
              const wrapper = function(payload, cb) {
                if (payload?.type === 'FF_CREATE') {
                  window.__ffCreateLostAck = payload.operationId;
                  return original(payload, response => {
                    if (typeof cb === 'function')
                      cb({ok:false,error:'SIMULATED_CREATE_ACK_LOSS'});
                  });
                }
                return original(payload, cb);
              };
              chrome.runtime.sendMessage = wrapper;
              return chrome.runtime.sendMessage === wrapper;
            }""")
            assert patched, "cannot inject a one-off lost ACK into the extension UI"
            reopened.locator("#ff-save").click()
            expect(reopened.locator("#ff-notice")).to_contain_text(
                "SIMULATED_CREATE_ACK_LOSS", timeout=10000)
            lost_op = reopened.evaluate("window.__ffCreateLostAck")
            assert lost_op and len(lost_op) >= 6
            saved_once = reopened.evaluate(
                "() => chrome.runtime.sendMessage({type:'FF_LIST'})")
            assert saved_once["ok"] and len(saved_once["data"]) == 3, saved_once
            prior_ids = sorted(x["id"] for x in saved_once["data"])
            assert "ff_" + lost_op in prior_ids
            stored_lease = reopened.evaluate(
                "() => sessionStorage.getItem('tl_ff_create_intent_v1')")
            assert stored_lease and missing_ack_w0 not in stored_lease
            assert missing_ack_p not in stored_lease, (
                "create lease must not store the plaintext W0/P")
            pending_id = reopened.evaluate("""() => {
              const raw=sessionStorage.getItem('tl_ff_create_intent_v1');
              return raw && JSON.parse(raw).operationId;
            }""")
            assert pending_id == lost_op, "unacknowledged ID not retained in this tab"

            reopened.reload(wait_until="domcontentloaded")
            reopened.locator("#ff-w0").fill(missing_ack_w0)
            reopened.locator("#ff-p").fill(missing_ack_p)
            reopened.locator("#ff-save").click()
            expect(reopened.locator("#ff-notice")).to_contain_text(
                "已冻结并保存", timeout=10000)
            after_retry = reopened.evaluate(
                "() => chrome.runtime.sendMessage({type:'FF_LIST'})")
            assert after_retry["ok"] and len(after_retry["data"]) == 3, (
                "same manual retry after lost ACK created a duplicate",
                after_retry)
            assert sorted(x["id"] for x in after_retry["data"]) == prior_ids
            assert reopened.evaluate(
                "() => sessionStorage.getItem('tl_ff_create_intent_v1')") is None, (
                "acknowledged create intent was not cleared")

            # A real successful CREATE receipt followed by a display error is
            # still the same intent, including after reloading this tab.
            expected_rows = 3
            for failed_type in ["FF_LIST", "FF_READ"]:
                for reload_before_retry in [False, True]:
                    reopened.reload(wait_until="domcontentloaded")
                    expect(reopened.locator("#ff-notice")).to_contain_text("已启用")
                    material = f"Fictional {failed_type} recovery {reload_before_retry}"
                    task = "Display the same saved experiment"
                    reopened.locator("#ff-w0").fill(material)
                    reopened.locator("#ff-p").fill(task)
                    assert reopened.evaluate("""failedType => {
                      const original=chrome.runtime.sendMessage.bind(chrome.runtime);
                      let armed=false, injected=false;
                      const wrapper=(payload,cb)=>{
                        if(payload.type==='FF_CREATE')return original(payload,response=>{
                          armed=response?.ok===true;cb(response);
                        });
                        if(armed&&!injected&&payload.type===failedType){
                          injected=true;
                          return cb({ok:false,error:'SIMULATED_DISPLAY_FAILURE'});
                        }
                        return original(payload,cb);
                      };
                      chrome.runtime.sendMessage=wrapper;
                      return chrome.runtime.sendMessage===wrapper;
                    }""", failed_type)
                    reopened.locator("#ff-save").click()
                    expect(reopened.locator("#ff-notice")).to_contain_text("SIMULATED_DISPLAY_FAILURE")
                    expect(reopened.locator("#ff-notice")).to_contain_text("实验已保存")
                    expected_rows += 1
                    rows = reopened.evaluate("() => chrome.runtime.sendMessage({type:'FF_LIST'})")
                    assert rows["ok"] and len(rows["data"]) == expected_rows
                    saved_ids = sorted(row["id"] for row in rows["data"])
                    lease = reopened.evaluate("sessionStorage.getItem('tl_ff_create_intent_v1')")
                    assert lease and material not in lease and task not in lease
                    if reload_before_retry:
                        reopened.reload(wait_until="domcontentloaded")
                        expect(reopened.locator("#ff-notice")).to_contain_text("已启用")
                        assert reopened.evaluate("sessionStorage.getItem('tl_ff_create_intent_v1')") == lease
                        reopened.locator("#ff-w0").fill(material)
                        reopened.locator("#ff-p").fill(task)
                    reopened.locator("#ff-save").click()
                    expect(reopened.locator("#ff-notice")).to_contain_text("已冻结并保存")
                    rows = reopened.evaluate("() => chrome.runtime.sendMessage({type:'FF_LIST'})")
                    assert rows["ok"] and sorted(row["id"] for row in rows["data"]) == saved_ids, (
                        "display recovery created another experiment", failed_type, reload_before_retry)
                    assert reopened.evaluate("sessionStorage.getItem('tl_ff_create_intent_v1')") is None

            assert expected_rows == 7

            # An unreadable lease is an UNKNOWN create result, never a reason
            # to allocate another random ID and silently duplicate the record.
            reopened.evaluate("""() => sessionStorage.setItem(
              'tl_ff_create_intent_v1','INVALID_LEASE_JSON')""")
            reopened.locator("#ff-w0").fill("Unsafe new intent")
            reopened.locator("#ff-p").fill("must not persist")
            reopened.locator("#ff-save").click()
            expect(reopened.locator("#ff-notice")).to_contain_text(
                "待确认创建记录无法验证", timeout=10000)
            after_corruption = reopened.evaluate(
                "() => chrome.runtime.sendMessage({type:'FF_LIST'})")
            assert after_corruption["ok"] and len(after_corruption["data"]) == expected_rows
            assert len(ctx2.pages) == tabs_before_retry, (
                "Fork P1 create retry must not open or send ChatGPT tabs")

            # Exercise internal DB guards on real transactions, without going
            # through the safe current reducer or weakening the FF message gate.
            worker = ctx2.service_workers[0]
            guards = worker.evaluate("""async () => {
              const frozen=await ThreadLineFFCore.freeze('Fictional original','Task');
              const replacement=await ThreadLineFFCore.freeze('Fictional replacement','Task');
              const results=[];
              for(const kind of ['frozen','revision','noop']){
                const id='ff_guard_'+kind;
                await ThreadLineFFDB.create(ThreadLineFFCore.newExperiment(frozen,id));
                if(kind==='revision')for(let i=0;i<7;i++)
                  await ThreadLineFFDB.update(id,i,prev=>({...prev,revision:i+1}));
                const before=await ThreadLineFFDB.read(id);
                let rejected=false;
                try{
                  await ThreadLineFFDB.update(id,0,prev=>{
                    if(kind==='frozen')prev.frozen=replacement;
                    if(kind==='revision')prev.revision=0;
                    if(kind==='noop'){prev.frozen=replacement;return prev;}
                    return {...prev,revision:prev.revision+1};
                  });
                }catch{rejected=true;}
                const after=await ThreadLineFFDB.read(id);
                results.push({kind,rejected,unchanged:JSON.stringify(before)===JSON.stringify(after)});
              }
              const id='ff_guard_positive';
              await ThreadLineFFDB.create(ThreadLineFFCore.newExperiment(frozen,id));
              const event={branch:'A',expectedRevision:0,operationId:'op_guard001',
                attemptId:'att_guard001',status:'unknown',phase:'awaiting_send'};
              const first=await ThreadLineFFDB.update(id,0,prev=>ThreadLineFFCore.advance(prev,event));
              const replay=await ThreadLineFFDB.update(id,0,prev=>ThreadLineFFCore.advance(prev,event));
              return {results,valid:first.revision===1&&JSON.stringify(first)===JSON.stringify(replay)};
            }""")
            assert guards["valid"], guards
            assert all(row["rejected"] and row["unchanged"] for row in guards["results"]), guards

            # ---------- P2: dual-branch launch, prefill, simulated human send, capture ----------
            # Extension-created tabs are not exposed as Playwright pages in
            # headless persistent contexts, so this scenario observes everything
            # through the service worker: FF_READ states, chrome.scripting
            # readbacks, and executeScript-driven user-action simulations.
            p2create = reopened.evaluate("""() => chrome.runtime.sendMessage(
              {type:'FF_CREATE',operationId:'op_p2e2e0001',
               w0:'双分支共同材料 W0',p:'回答同一任务'})""")
            assert p2create["ok"], p2create
            p2id = p2create["data"]["id"]
            launched = reopened.evaluate("""id => chrome.runtime.sendMessage(
              {type:'FF_LAUNCH',experimentId:id,operationId:'op_p2e2e0002'})""", p2id)
            assert launched["ok"], launched
            tabA, tabB = launched["data"]["tabIds"]["A"], launched["data"]["tabIds"]["B"]
            assert tabA != tabB
            worker2 = ctx2.service_workers[0]
            def sw_read(expr, arg=None):
                return worker2.evaluate("(" + expr + ")", arg) if arg is not None else worker2.evaluate("(" + expr + ")")
            # Both branch tabs must reach awaiting_send: the handoff ACK is the
            # extension's own exact composer readback proof.
            deadline = time.time() + 30
            row = None
            while time.time() < deadline:
                row = sw_read("async id => (await ThreadLineFFDB.read(id))", p2id)
                if (row["branches"]["A"]["phase"] == "awaiting_send"
                    and row["branches"]["B"]["phase"] == "awaiting_send"):
                    break
                time.sleep(0.5)
            assert row["branches"]["A"]["phase"] == "awaiting_send", row["branches"]["A"]["phase"]
            if row["branches"]["B"]["phase"] != "awaiting_send":
                print("DIAG-B:", sw_read("""async id => {
                  const [iso] = await chrome.scripting.executeScript({target:{tabId:id},
                    func:() => ({value:JSON.stringify((document.getElementById('prompt-textarea')||{value:null}).value||null)?.slice(0,30),
                      banner:(document.querySelector('#tl-handoff-banner')||{innerText:null}).innerText?.slice(0,80)})});
                  const intent = await chrome.storage.session.get('tl_handoff_'+id);
                  const bind = await chrome.storage.session.get('tl_ff_bind_'+id);
                  const err = await chrome.storage.session.get('tl_ff_ack_err_'+id);
                  return {page:iso.result, intentPending:!!intent['tl_handoff_'+id],
                    bind:!!bind['tl_ff_bind_'+id], ackErr:err['tl_ff_ack_err_'+id]||null};
                }""", tabB))
            assert row["branches"]["B"]["phase"] == "awaiting_send", row["branches"]["B"]["phase"]
            frozen = row["frozen"]["text"]
            for tabId in [tabA, tabB]:
                count = sw_read("""async tabId => {
                  const [res] = await chrome.scripting.executeScript({target:{tabId},
                    world:'MAIN', func:() => window.submitCount});
                  return res.result;
                }""", tabId)
                assert count == 0, "0 automatic sends before the human action"
            # The human (simulated here through the same scripting authority the
            # extension itself uses) sends branch A only.
            sent = sw_read("""async tabId => {
              const [res] = await chrome.scripting.executeScript({target:{tabId},
                world:'MAIN',
                func:() => {document.querySelector('#composer button[type=submit]').click();
                  return window.submitCount;}});
              return res.result;
            }""", tabA)
            assert sent == 1, "exactly the simulated human send"
            deadline = time.time() + 25
            astate = None
            while time.time() < deadline:
                row = sw_read("async id => (await ThreadLineFFDB.read(id))", p2id)
                a = row["branches"]["A"]["attempts"][-1]
                if (row["branches"]["A"]["phase"] == "generating"
                    and a["evidence"].get("sessionId")
                    and a["evidence"].get("inputLevel") == "exact"):
                    astate = a
                    break
                time.sleep(0.5)
            if not astate:
                print("DIAG-BIND:", sw_read("""async id => {
                  const t = await chrome.tabs.get(id);
                  const live = await chrome.storage.session.get('tl_live_'+id);
                  const row = await ThreadLineFFDB.read('ff_op_p2e2e0001');
                  return {url:t.url, live:!!live['tl_live_'+id],
                    phase:row?row.branches.A.phase:null,
                    ev:row?row.branches.A.attempts.at(-1).evidence:null,
                    errs:Object.keys(await chrome.storage.session.get(null)).filter(k=>k.includes('err'))};
                }""", tabA))
            assert astate, "branch A must bind its conversation and classify the sent input"
            assert astate["evidence"]["sessionId"].startswith("fork-e2e-")
            cap = reopened.evaluate("(p) => chrome.runtime.sendMessage(p)",
              {"type":"FF_CAPTURE","experimentId":p2id,"branch":"A"})
            assert cap["ok"], cap
            deadline = time.time() + 30
            done_row = None
            while time.time() < deadline:
                row = sw_read("async id => (await ThreadLineFFDB.read(id))", p2id)
                if row["branches"]["A"]["status"] == "done":
                    done_row = row
                    break
                time.sleep(0.5)
            assert done_row, "capture completion must mark the branch done"
            # F3: explicit read-only capture diagnostic is bound to the
            # captured branch, not the active tab or caller-provided claim.
            status = reopened.evaluate("(p) => chrome.runtime.sendMessage(p)",
                {"type":"FF_CAPTURE_STATUS","experimentId":p2id,
                 "branch":"A","runId":cap["data"]["runId"]})
            assert status["ok"] and status["data"]["state"] == "done", status
            assert status["data"]["captureComplete"] is True, status
            assert "reply" not in status["data"] and "url" not in status["data"], status
            wrong = reopened.evaluate("(p) => chrome.runtime.sendMessage(p)",
                {"type":"FF_CAPTURE_STATUS","experimentId":p2id,
                 "branch":"B","runId":cap["data"]["runId"]})
            assert not wrong["ok"], "another branch cannot read this capture"
            a = done_row["branches"]["A"]["attempts"][-1]
            assert a["evidence"]["captureComplete"] is True and a["evidence"]["persisted"] is True
            assert a["evidence"]["taskCount"] == 1 and a["evidence"]["reply"] == "好的，OK。"
            assert len(set(a["evidence"]["endSignals"])) >= 2, a["evidence"]["endSignals"]
            brow = done_row["branches"]["B"]
            assert brow["status"] == "pending", "branch B stays independent"
            assert not brow["attempts"][-1]["evidence"].get("sessionId"), "no cross-talk"
            open_tabs = sw_read("async () => (await chrome.tabs.query({url:'https://chatgpt.com/*'})).length")
            assert open_tabs == 2, "the extension must not open extra tabs"

            # ---------- P3: blind X/Y comparison, verdict, self-contained export ----------
            sent_b = sw_read("""async tabId => {
              const [res] = await chrome.scripting.executeScript({target:{tabId},
                world:'MAIN',
                func:() => {document.querySelector('#composer button[type=submit]').click();
                  return window.submitCount;}});
              return res.result;
            }""", tabB)
            assert sent_b == 1, "branch B human send (simulated)"
            deadline = time.time() + 25
            bstate = None
            while time.time() < deadline:
                row = sw_read("async id => (await ThreadLineFFDB.read(id))", p2id)
                b = row["branches"]["B"]["attempts"][-1]
                if (row["branches"]["B"]["phase"] == "generating"
                    and b["evidence"].get("sessionId")
                    and b["evidence"].get("inputLevel") == "exact"):
                    bstate = b
                    break
                time.sleep(0.5)
            assert bstate, "branch B must bind and classify"
            assert bstate["evidence"]["sessionId"] != astate["evidence"]["sessionId"], (
                "distinct conversations per branch")
            capb = reopened.evaluate("(p) => chrome.runtime.sendMessage(p)",
              {"type":"FF_CAPTURE","experimentId":p2id,"branch":"B"})
            assert capb["ok"], capb
            deadline = time.time() + 30
            while time.time() < deadline:
                row = sw_read("async id => (await ThreadLineFFDB.read(id))", p2id)
                if row["branches"]["B"]["status"] == "done":
                    break
                time.sleep(0.5)
            assert row["branches"]["B"]["status"] == "done", "both branches done"
            compare = reopened.evaluate("(p) => chrome.runtime.sendMessage(p)",
              {"type":"FF_COMPARE","experimentId":p2id,"operationId":"op_p3e2e0001"})
            assert compare["ok"] and compare["data"]["mapping"], compare
            mapping = compare["data"]["mapping"]
            assert mapping["X"] in ("A", "B") and mapping["Y"] != mapping["X"]
            # UI: X/Y columns visible WITHOUT the branch labels before the verdict.
            reopened.reload(wait_until="domcontentloaded")
            reopened.locator("#ff-list button", has_text=p2id).click()
            expect(reopened.locator("#ff-reply-X")).to_be_visible(timeout=15000)
            expect(reopened.locator("#ff-reply-Y")).to_be_visible(timeout=15000)
            assert reopened.locator("#ff-reply-X").text_content() == "好的，OK。"
            reveal_before = reopened.locator("#ff-reveal").text_content()
            assert "分支" not in (reveal_before or ""), "pre-verdict reveal must stay hidden"
            # P4 calibration gate: the verdict form opens only after passing.
            reopened.locator('input[name="cal-cal-econ-0001"][value="1"]').check()
            reopened.locator('input[name="cal-cal-logic-0001"][value="1"]').check()
            reopened.locator("#ff-calibrate").click()
            expect(reopened.locator("#ff-calibration-result")).to_contain_text(
                "已通过", timeout=10000)
            page_errors = []
            reopened.on("pageerror", lambda e: page_errors.append(str(e)[:120]))
            reopened.locator("#ff-list button", has_text=p2id).click()
            reopened.wait_for_timeout(2000)
            print("PAGE-ERRORS:", page_errors,
                  "STATE:", reopened.evaluate(
                    "() => ({v:document.getElementById('ff-verdict-form').hidden,"
                    "cal:document.getElementById('ff-calibration').hidden})"))
            expect(reopened.locator("#ff-verdict-form")).to_be_visible(timeout=10000)
            # Record the verdict through the real form controls.
            reopened.locator("#ff-preference").select_option("X")
            reopened.locator("#ff-criteria").fill("X 的回复更完整（E2E 虚构裁决）")
            reopened.locator("#ff-confidence").select_option("high")
            reopened.locator("#ff-notes").fill("E2E 自动裁决")
            reopened.locator("#ff-verdict").click()
            expect(reopened.locator("#ff-reveal")).to_contain_text("裁决：X", timeout=15000)
            assert "分支" in reopened.locator("#ff-reveal").text_content(), (
                "post-verdict reveal shows the mapping")
            # S1b: adopt the revealed branch conclusion into the evidence
            # store. A topic project must exist for the prompt-based picker.
            seeded = reopened.evaluate("""() => {
              return new Promise(resolve => chrome.storage.local.get('threadline_state_v1', record => {
                const state = record['threadline_state_v1'];
                state.projects.unshift({ id: 'e2e-topic', name: 'E2E 课题', goal: '',
                  decision: '', stage: 'active', knowledgeVersion: 0, lastChange: null,
                  history: [], createdAt: 1, updatedAt: 1, closedAt: null });
                chrome.storage.local.set({ threadline_state_v1: state }, () => resolve(true));
              }));
            }""")
            assert seeded is True
            reopened.once("dialog", lambda dialog: dialog.accept("e2e-topic")
                if dialog.type == "prompt" else dialog.accept())
            adopt_buttons = reopened.locator("button", has_text="采纳该分支结论到证据库")
            adopt_buttons.first.click()
            expect(reopened.locator("#ff-columns")).to_contain_text("已采纳：con_",
                timeout=10000)
            adopted = reopened.evaluate(
                "(p) => chrome.runtime.sendMessage(p)",
                {"type": "EV_LIST", "projectId": "e2e-topic"})
            assert adopted["ok"] and len(adopted["data"]["rows"]) == 1, adopted
            adopted_row = adopted["data"]["rows"][0]
            assert adopted_row["conclusion"]["projectId"] == "e2e-topic"
            assert adopted_row["fragments"] and adopted_row["fragments"][0]["selection"]
            assert adopted_row["conclusion"]["takeover"] if "takeover" in adopted_row["conclusion"] else True
            # Duplicate adoption replays instead of creating a twin.
            reopened.once("dialog", lambda dialog: dialog.accept("e2e-topic")
                if dialog.type == "prompt" else dialog.accept())
            adopt_buttons.first.click()
            expect(reopened.locator("#ff-columns")).to_contain_text("未重复创建",
                timeout=10000)
            adopted_again = reopened.evaluate(
                "(p) => chrome.runtime.sendMessage(p)",
                {"type": "EV_LIST", "projectId": "e2e-topic"})
            assert len(adopted_again["data"]["rows"]) == 1, "duplicate adoption must not twin"
            snapshot = reopened.evaluate("(p) => chrome.runtime.sendMessage(p)",
              {"type":"FF_EXPORT","experimentId":p2id})
            assert snapshot["ok"] and snapshot["data"]["kind"] == "threadline-fork-experiment"
            assert snapshot["data"]["decision"]["verdict"]["preference"] == "X"
            assert snapshot["data"]["decision"]["mapping"] == mapping
            serialized = _json.dumps(snapshot["data"], ensure_ascii=False)
            for banned in ["authorization", "cookie", "token"]:
                assert banned not in serialized.lower(), "export must be credential-free"

            # ---------- P4: K=4 orchestration and validated import ----------
            p4create = reopened.evaluate("""() => chrome.runtime.sendMessage(
              {type:'FF_CREATE',operationId:'op_p4e2e0001',
               w0:'四分支共同材料',p:'回答同一任务',branchCount:4})""")
            assert p4create["ok"] and p4create["data"]["id"], p4create
            p4id = p4create["data"]["id"]
            p4row = reopened.evaluate("(id) => chrome.runtime.sendMessage({type:'FF_READ',id})", p4id)
            assert len(p4row["data"]["branches"]) == 4
            tabs_before_p4 = sw_read("async () => (await chrome.tabs.query({url:'https://chatgpt.com/*'})).length")
            launched4 = reopened.evaluate("""id => chrome.runtime.sendMessage(
              {type:'FF_LAUNCH',experimentId:id,operationId:'op_p4e2e0002'})""", p4id)
            assert launched4["ok"] and len(launched4["data"]["tabIds"]) == 4, launched4
            deadline = time.time() + 40
            tabs_now = 0
            while time.time() < deadline:
                tabs_now = sw_read("async () => (await chrome.tabs.query({url:'https://chatgpt.com/*'})).length")
                if tabs_now == tabs_before_p4 + 4:
                    break
                time.sleep(0.5)
            assert tabs_now == tabs_before_p4 + 4, "K=4 launch opens four tabs"
            deadline = time.time() + 40
            p4row = None
            while time.time() < deadline:
                p4row = sw_read("async id => (await ThreadLineFFDB.read(id))", p4id)
                if all(p4row["branches"][b]["phase"] == "awaiting_send" for b in p4row["branches"]):
                    break
                time.sleep(0.5)
            assert all(p4row["branches"][b]["phase"] == "awaiting_send" for b in p4row["branches"]), (
                "all four branches prefill-ACK", {b: p4row["branches"][b]["phase"] for b in p4row["branches"]})
            # Validated import: exporting the K=2 experiment then importing into
            # a fresh extension ID would need a second install; here the ID
            # collision path is asserted instead (import never overwrites).
            conflicting = reopened.evaluate("(p) => chrome.runtime.sendMessage(p)",
              {"type":"FF_IMPORT","snapshot":snapshot["data"]})
            assert not conflicting["ok"] and "already exists" in conflicting["error"], conflicting
            ctx2.close()
    print("PASS: Fork P1 default-off, permission-bound messages, 24KB input, "
          "atomic IDB/CAS and reducer guards, replay-safe attempts, post-ACK display recovery, "
          "XSS, legacy isolation and restart; P2 dual-branch launch with exact prefill, "
          "simulated human send binding, capture-driven completion and 0 automatic sends; "
          "P3 blind X/Y comparison with pre-verdict hiding, recorded verdict with reveal, "
          "and credential-free self-contained export; P4 K=4 orchestration with four "
          "prefilled tabs and validated import collision rejection (synthetic-only); "
          "S1b per-branch evidence adoption after reveal with duplicate replay")


if __name__ == "__main__":
    run()
