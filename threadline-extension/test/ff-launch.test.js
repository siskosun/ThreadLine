const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const Core = require('../ff-core.js');
const TopicCore = require('../core.js');
const CaptureCore = require('../capture-core.js');

// Background-level tests for the P2 dual-branch engine. The 0-send invariant is
// asserted at the code level: every tab message and every tab creation is
// recorded and inspected.
function system({captureInjectionFails=false}={}) {
  const records = new Map(), runs = new Map(), pageStore = new Map();
  const session = new Map(), local = new Map(), events = {}, sent = [], newTabs = [], updates = [];
  let nextTab = 100;
  const tabsById = new Map();
  const ffdb = {
    async create(row){if(records.has(row.id))throw new Error('duplicate');records.set(row.id,row);},
    async createImported(row){if(records.has(row.id))throw new Error('duplicate');records.set(row.id,row);},
    async read(id){return records.get(id)||null;},
    async list(){return [...records.values()];},
    async update(id,revision,reducer){
      const before=records.get(id);
      if(!before)throw new Error('experiment not found');
      const after=reducer(before);
      if(after!==before){
        assert.equal(before.revision,revision,'stale revision in test DB');
        records.set(id,after);
      }
      return after;
    }
  };
  const captureDB = {
    async putRun(r){runs.set(r.id,r)},
    async getRun(id){return runs.get(id)},
    async modifyRun(id,p){const r=runs.get(id);runs.set(id,{...r,...p});return runs.get(id)},
    async putPage(p){pageStore.set(`${p.id}_${p.pageIndex}_${p.chunkIndex}`,p)},
    async pages(id){return [...pageStore.values()].filter(p=>p.id===id)},
    async resetPages(){}, async remove(){}, async cleanup(){return 0}
  };
  const chrome = {
    runtime:{id:'ff-launch-test',getURL:p=>'chrome-extension://ff-launch-test/'+p,
      onInstalled:{addListener(){}},onStartup:{addListener(fn){events.startup=fn}},
      onMessage:{addListener(fn){events.message=fn}}},
    tabs:{
      onUpdated:{addListener(fn){events.tabUpdated=fn}},
      onRemoved:{addListener(fn){events.tabRemoved=fn}},
      async create(options){const id=nextTab++;newTabs.push({id,options});tabsById.set(id,{id,url:options.url||'about:blank'});return {id}},
      async update(id,patch){const t=tabsById.get(id);if(!t)throw new Error('tab gone');Object.assign(t,patch);updates.push([id,patch]);return t;},
      async get(id){const t=tabsById.get(id);if(!t)throw new Error('tab gone');return t;},
      async query(){return [...tabsById.values()]},
      async sendMessage(tabId,msg){sent.push([tabId,msg.type]);
        if(msg.type==='TL_FF_READ_USER_MESSAGE'){
          const bind=session.get(`tl_ff_bind_${tabId}`);
          const row=records.get(bind?.experimentId);
          return {ok:true,data:{text:row?row.frozen.text:null,complete:true,bytes:1}};
        }
        return {ok:true};
      }
    },
    scripting:{async executeScript(){if(captureInjectionFails)throw Error('SIMULATED_INJECTION_FAILURE')}},
    sidePanel:{setPanelBehavior:async()=>{}},
    storage:{
      local:{async get(k){return {[k]:local.get(k)};},async set(v){for(const [k,x] of Object.entries(v))local.set(k,x);}},
      session:{
        async get(k){if(k==null)return Object.fromEntries(session);return {[k]:session.get(k)};},
        async set(items){for(const [k,v] of Object.entries(items))session.set(k,v);},
        async remove(keys){for(const k of [keys].flat())session.delete(k);}
      }
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),{
    importScripts(){},ThreadLineCore:TopicCore,ThreadLineCaptureCore:CaptureCore,
    ThreadLineCaptureDB:captureDB,ThreadLineFFCore:Core,ThreadLineFFDB:ffdb,
    chrome,crypto:webcrypto,console,Date,Promise,URL,TextEncoder,structuredClone
  });
  function message(payload,sender){return new Promise((resolve,reject)=>{
    events.message(payload,sender,reply=>{
      if(reply?.ok)resolve(reply.data);else reject(new Error(reply?.error||'failed'));
    });
  });}
  const ffSender = {id:'ff-launch-test',url:'chrome-extension://ff-launch-test/ff.html'};
  return {message,ffSender,session,sent,newTabs,updates,events,records,runs,pageStore,tabsById,
    async setupExperiment(operationId='create_op_000001'){
      await message({type:'FF_SET_ENABLED',enabled:true,ack:'local-only-no-send'},ffSender);
      return message({type:'FF_CREATE',operationId,
        w0:'虚构共同材料 W0',p:'虚构任务指令 P'},ffSender);
    },
    tabSender(tabId,url){return {id:'ff-launch-test',url,tab:{id:tabId,url}};}
  };
}

test('FF launch creates two inactive plain-chat tabs, seeds handoff, records tab evidence',async()=>{
  const s=system();
  const created=await s.setupExperiment();
  const r=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_op_0000001'},s.ffSender);
  assert.equal(s.newTabs.length,2);
  for(const t of s.newTabs){
    assert.equal(t.options.url,undefined,'tabs are created idle, then navigated');
    assert.equal(t.options.active,false,'branch tabs must not steal focus');
  }
  const navs=s.updates.filter(([id,patch])=>patch.url==='https://chatgpt.com/');
  assert.equal(navs.length,2,'both branch tabs navigate to the plain new chat');
  for(const [id] of navs)assert.ok([r.tabIds.A,r.tabIds.B].includes(id));
  assert.notEqual(r.tabIds.A,r.tabIds.B);
  for(const tabId of [r.tabIds.A,r.tabIds.B]){
    const intent=s.session.get(`tl_handoff_${tabId}`);
    assert.ok(intent && intent.text.includes('【共同材料 W₀】'),'frozen text seeded');
  }
  const row=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  for(const branch of ['A','B']){
    assert.equal(row.branches[branch].status,'pending');
    assert.equal(row.branches[branch].phase,'created');
    assert.equal(row.branches[branch].attempts.length,1);
    assert.equal(row.branches[branch].attempts[0].evidence.tabId,
      branch==='A'?r.tabIds.A:r.tabIds.B);
  }
  // 0-send code-level invariant: only handoff delivery and readback requests.
  for(const [tabId,type] of s.sent)
    assert.ok(['TL_HANDOFF_READY','TL_FF_READ_USER_MESSAGE'].includes(type),
      'unexpected tab message: '+type);
  await assert.rejects(s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_op_0000002'},s.ffSender),/still running/);
});

test('handoff ACK moves branches to awaiting_send with exact input proof',async()=>{
  const s=system();
  const created=await s.setupExperiment();
  const r=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_op_0000003'},s.ffSender);
  const senderA=s.tabSender(r.tabIds.A,'https://chatgpt.com/');
  await s.message({type:'HANDOFF_BEGIN'},senderA);
  await s.message({type:'HANDOFF_ACK'},senderA);
  const row=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  const a=row.branches.A.attempts.at(-1);
  assert.equal(row.branches.A.phase,'awaiting_send');
  assert.equal(a.evidence.inputLevel,'exact');
  assert.equal(a.evidence.prefill,'exact_ack');
  assert.equal(row.branches.B.phase,'created','the other branch is untouched');
});

test('conversation URL binds session identity and classifies the sent user message',async()=>{
  const s=system();
  const created=await s.setupExperiment();
  const r=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_op_0000004'},s.ffSender);
  const row0=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(r.tabIds.A,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(r.tabIds.A,'https://chatgpt.com/'));
  const conv='https://chatgpt.com/c/conv-12345678';
  await s.message({type:'OBSERVE',href:conv,title:'会话',streaming:false,
    assistantBytes:40},s.tabSender(r.tabIds.A,conv));
  const row=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  const a=row.branches.A.attempts.at(-1);
  assert.equal(row.branches.A.phase,'generating');
  assert.equal(a.evidence.sessionId,'conv-12345678');
  assert.equal(a.evidence.conversationId,'conv-12345678');
  assert.equal(a.evidence.inputLevel,'exact','sent user message classified');
  // Branch B ACKs its own prefill independently of branch A.
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(r.tabIds.B,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(r.tabIds.B,'https://chatgpt.com/'));
  // The same conversation cannot be claimed by branch B later.
  const other='https://chatgpt.com/c/conv-12345678';
  await s.message({type:'OBSERVE',href:other,title:'会话',streaming:false},s.tabSender(r.tabIds.B,other));
  const row2=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  assert.equal(row2.branches.B.phase,'awaiting_send',
    'branch B ACK must advance even after branch A ACKed');
  await assert.rejects(
    s.message({type:'FF_RECORD',experimentId:created.id,branch:'B',
      expectedRevision:row2.revision,operationId:'steal_op_00000001',
      attemptId:'att_bogus_0001',status:'done',phase:'capturing',reason:''},s.ffSender),
    /completion is not available|invalid|not available/);
});

test('completed capture with two attested signals marks the branch done',async()=>{
  const s=system();
  const created=await s.setupExperiment();
  const r=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_op_0000005'},s.ffSender);
  const row0=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  const frozen=row0.frozen.text;
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(r.tabIds.A,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(r.tabIds.A,'https://chatgpt.com/'));
  const conv='https://chatgpt.com/c/conv-12345678';
  await s.message({type:'OBSERVE',href:conv,title:'会话',streaming:false},s.tabSender(r.tabIds.A,conv));
  s.tabsById.get(r.tabIds.A).url=conv;
  const started=await s.message({type:'FF_CAPTURE',experimentId:created.id,branch:'A'},s.ffSender);
  assert.equal(started.started,true);
  const runId=started.runId;
  s.pageStore.set(`${runId}_0_0`,{id:runId,pageIndex:0,chunkIndex:0,messages:[
    {id:'m1',role:'user',content:frozen,finished:true},
    {id:'m2',role:'assistant',content:'好的，OK。',finished:true}
  ]});
  await s.message({type:'CAPTURE_END',id:runId,complete:true,mode:'paginated',
    pageCount:1,count:2},{tab:{id:r.tabIds.A,url:conv},id:'ff-launch-test',
    url:'https://chatgpt.com/c/conv-12345678'});
  const row=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  assert.equal(row.branches.A.status,'done');
  const a=row.branches.A.attempts.at(-1);
  assert.equal(a.evidence.captureComplete,true);
  assert.equal(a.evidence.persisted,true);
  assert.equal(a.evidence.taskCount,1);
  assert.equal(a.evidence.reply,'好的，OK。');
  assert.deepEqual([...a.evidence.endSignals].sort(),['final','generation']);
});

test('incomplete capture keeps the branch pending instead of claiming done',async()=>{
  const s=system();
  const created=await s.setupExperiment();
  const r=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_op_0000006'},s.ffSender);
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(r.tabIds.A,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(r.tabIds.A,'https://chatgpt.com/'));
  const conv='https://chatgpt.com/c/conv-12345678';
  await s.message({type:'OBSERVE',href:conv,title:'会话',streaming:false},s.tabSender(r.tabIds.A,conv));
  s.tabsById.get(r.tabIds.A).url=conv;
  const started=await s.message({type:'FF_CAPTURE',experimentId:created.id,branch:'A'},s.ffSender);
  assert.equal(started.started,true);
  const runId=started.runId;
  s.pageStore.set(`${runId}_0_0`,{id:runId,pageIndex:0,chunkIndex:0,messages:[
    {id:'m1',role:'user',content:'只有半截'}
  ]});
  await s.message({type:'CAPTURE_END',id:runId,complete:false,mode:'visible-dom',
    pageCount:1,count:1},{tab:{id:r.tabIds.A,url:conv},id:'ff-launch-test',
    url:'https://chatgpt.com/c/conv-12345678'});
  const row=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  assert.equal(row.branches.A.status,'pending','incomplete capture cannot claim done');
  const a=row.branches.A.attempts.at(-1);
  assert.equal(a.evidence.captureComplete,false);
});

test('closing a branch tab marks it unknown without any replay',async()=>{
  const s=system();
  const created=await s.setupExperiment();
  const r=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_op_0000007'},s.ffSender);
  const before=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  const attemptA=before.branches.A.attempts.at(-1);
  s.events.tabRemoved(r.tabIds.A);
  await new Promise(resolve=>setTimeout(resolve,60));
  const row=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  assert.equal(row.branches.A.status,'unknown');
  assert.equal(row.branches.A.attempts.length,1,'no new attempt without user action');
  assert.notEqual(attemptA.id,null);
  // A pending sibling blocks a full relaunch; nothing was auto-restarted.
  await assert.rejects(s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_op_0000008'},s.ffSender),/still running/);
});

test('re-prefill re-seeds the same branch only through an explicit user action',async()=>{
  const s=system();
  const created=await s.setupExperiment();
  const r=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_op_0000009'},s.ffSender);
  // Simulate a browser restart: session bindings and intents are gone.
  for(const key of [...s.session.keys()])s.session.delete(key);
  const before=s.sent.filter(([tabId,type])=>
    tabId===r.tabIds.A && type==='TL_HANDOFF_READY').length;
  const reprefill=await s.message({type:'FF_REPREFILL',experimentId:created.id,
    branch:'A',operationId:'reprefill_op_0001'},s.ffSender);
  assert.equal(reprefill.tabId,r.tabIds.A);
  assert.ok(s.session.get(`tl_handoff_${r.tabIds.A}`),'intent re-seeded');
  const sentAfter=s.sent.filter(([tabId,type])=>
    tabId===r.tabIds.A && type==='TL_HANDOFF_READY').length;
  assert.equal(sentAfter,before+1,'exactly one new handoff delivery for the re-prefill');
});

test("FF comparison, verdict and export: gated, blind, deterministic, self-contained",async()=>{
  const s=system();
  const created=await s.setupExperiment();
  const r=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_op_0000010'},s.ffSender);
  const row0=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  const frozen=row0.frozen.text;
  // Complete BOTH branches through the P2 flow with distinct conversations.
  for(const [branch,tabId] of [['A',r.tabIds.A],['B',r.tabIds.B]]){
    await s.message({type:'HANDOFF_BEGIN'},s.tabSender(tabId,'https://chatgpt.com/'));
    await s.message({type:'HANDOFF_ACK'},s.tabSender(tabId,'https://chatgpt.com/'));
    const conv='https://chatgpt.com/c/conv-p3-'+branch.toLowerCase();
    await s.message({type:'OBSERVE',href:conv,title:'会话',streaming:false},
      s.tabSender(tabId,conv));
    s.tabsById.get(tabId).url=conv;
    const started=await s.message({type:'FF_CAPTURE',experimentId:created.id,branch},s.ffSender);
    assert.equal(started.started,true);
    const runId=started.runId;
    s.pageStore.set(`${runId}_0_0`,{id:runId,pageIndex:0,chunkIndex:0,messages:[
      {id:'m1',role:'user',content:frozen,finished:true},
      {id:'m2',role:'assistant',content:'回复 '+branch,finished:true}]});
    await s.message({type:'CAPTURE_END',id:runId,complete:true,mode:'paginated',
      pageCount:1,count:2},{tab:{id:tabId,url:conv},id:'ff-launch-test',
      url:'https://chatgpt.com/c/conv-p3-'+branch.toLowerCase()});
  }
  // Comparison before both done must be rejected: use a third experiment.
  const early=await s.setupExperiment('create_op_000002');
  await assert.rejects(s.message({type:'FF_COMPARE',experimentId:early.id,
    operationId:'compare_op_00001'},s.ffSender),/both branches/);
  const decision=await s.message({type:'FF_COMPARE',experimentId:created.id,
    operationId:'compare_op_00002'},s.ffSender);
  assert.ok(decision.mapping.X==='A'||decision.mapping.X==='B');
  const again=await s.message({type:'FF_COMPARE',experimentId:created.id,
    operationId:'compare_op_00003'},s.ffSender);
  assert.equal(again.mapping.X,decision.mapping.X,'idempotent mapping');
  // 服务端校准门禁：无 tab 的 sender 不能提交裁决。
  await assert.rejects(s.message({type:'FF_VERDICT',experimentId:created.id,
    preference:'X',criteria:'c',confidence:'low'},s.ffSender),/opened as a tab/);
  const ffTab={id:'ff-launch-test',url:'chrome-extension://ff-launch-test/ff.html',
    tab:{id:77,url:'chrome-extension://ff-launch-test/ff.html'}};
  await assert.rejects(s.message({type:'FF_VERDICT',experimentId:created.id,
    preference:'X',criteria:'c',confidence:'low'},ffTab),/passing calibration/);
  const items=require('../ff-core.js').CALIBRATION_ITEMS;
  const scored=await s.message({type:'FF_CALIBRATION',
    responses:items.map(item=>({id:item.id,choice:1}))},ffTab);
  assert.equal(scored.pass,true);
  const afterVerdict=await s.message({type:'FF_VERDICT',experimentId:created.id,
    preference:'X',criteria:'回复更完整',confidence:'high',notes:'备注'},
    ffTab);
  assert.equal(afterVerdict.verdict.preference,'X');
  assert.ok(afterVerdict.verdict.decidedAt>0);
  await assert.rejects(s.message({type:'FF_VERDICT',experimentId:created.id,
    preference:'Y',criteria:'c',confidence:'low'},ffTab),/already recorded/);
  // The mapping remains recomputable from the recorded seed.
  assert.match(decision.seed,/^[a-zA-Z0-9_-]{10,100}$/);
  const snapshot=await s.message({type:'FF_EXPORT',experimentId:created.id},s.ffSender);
  assert.equal(snapshot.kind,'threadline-fork-experiment');
  assert.equal(snapshot.frozen.text.includes('【共同材料 W₀】'),true);
  assert.equal(snapshot.branches.A.status,'done');
  assert.equal(snapshot.decision.mapping.X,decision.mapping.X);
  assert.equal(snapshot.decision.verdict.preference,'X');
  const serialized=JSON.stringify(snapshot);
  for(const banned of ['authorization','cookie','token','sessionStorage'])
    assert.ok(!serialized.toLowerCase().includes(banned),'no credentials in export');
});

test("FF P4 launches K=4 tabs, imports snapshots, and scores calibration",async()=>{
  const s=system();
  await s.message({type:'FF_SET_ENABLED',enabled:true,ack:'local-only-no-send'},s.ffSender);
  const created=await s.message({type:'FF_CREATE',operationId:'create_p4_0000001',
    w0:'K4 材料',p:'K4 任务',branchCount:4},s.ffSender);
  assert.equal(Object.keys((await s.message({type:'FF_READ',id:created.id},
    s.ffSender)).branches).length,4);
  const r=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_p4_0000001'},s.ffSender);
  assert.equal(Object.keys(r.tabIds).length,4);
  const chatTabs=s.newTabs.filter(t=>t.options.active===false).length;
  assert.equal(chatTabs,4,'four inactive branch tabs');
  // 校准评分：空作答/越界选择被拒，全对通过。
  const FCore=require('../ff-core.js');
  await assert.rejects(s.message({type:'FF_CALIBRATION',responses:[]},s.ffSender),
    /every calibration item/);
  await assert.rejects(s.message({type:'FF_CALIBRATION',
    responses:FCore.CALIBRATION_ITEMS.map(item=>({id:item.id,choice:99}))},s.ffSender),
    /invalid calibration choice/);
  const scored=await s.message({type:'FF_CALIBRATION',
    responses:FCore.CALIBRATION_ITEMS.map(item=>({id:item.id,choice:1}))},s.ffSender);
  assert.equal(scored.pass,true);
  // 导入：先从无 K4 实验的干净系统导出（构造快照）。
  const snap=await s.message({type:'FF_EXPORT',experimentId:created.id},s.ffSender);
  const conflicting=await s.message({type:'FF_IMPORT',snapshot:snap},s.ffSender)
    .catch(e=>e);
  assert.match(conflicting.message,/already exists/);
  const s2=system();
  await s2.setupExperiment('seed_create_p4001');
  const imported=await s2.message({type:'FF_IMPORT',snapshot:snap},s2.ffSender);
  assert.equal(imported.id,created.id);
  assert.equal(imported.branchCount,4);
  const importedRow=await s2.message({type:'FF_READ',id:imported.id},s2.ffSender);
  assert.equal(Object.keys(importedRow.branches).length,4);
  assert.equal(importedRow.frozen.text.includes('K4 材料'),true);
});

test("FF P4 comparison records budget parity for K=4",async()=>{
  const s=system();
  await s.message({type:'FF_SET_ENABLED',enabled:true,ack:'local-only-no-send'},s.ffSender);
  const created=await s.message({type:'FF_CREATE',operationId:'create_p4_0000002',
    w0:'预算材料',p:'预算任务',branchCount:2},s.ffSender);
  const r=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_p4_0000002'},s.ffSender);
  const row0=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  const frozen=row0.frozen.text;
  let lastRev=row0.revision;
  for(const [branch,tabId] of [['A',r.tabIds.A],['B',r.tabIds.B]]){
    await s.message({type:'HANDOFF_BEGIN'},s.tabSender(tabId,'https://chatgpt.com/'));
    await s.message({type:'HANDOFF_ACK'},s.tabSender(tabId,'https://chatgpt.com/'));
    const conv='https://chatgpt.com/c/conv-p4b-'+branch.toLowerCase();
    await s.message({type:'OBSERVE',href:conv,title:'会话',streaming:false},
      s.tabSender(tabId,conv));
    s.tabsById.get(tabId).url=conv;
    const started=await s.message({type:'FF_CAPTURE',experimentId:created.id,branch},s.ffSender);
    assert.equal(started.started,true);
    const runId=started.runId;
    s.pageStore.set(`${runId}_0_0`,{id:runId,pageIndex:0,chunkIndex:0,messages:[
      {id:'m1',role:'user',content:frozen,finished:true},
      {id:'m2',role:'assistant',content:'回复 '+branch,finished:true}]});
    await s.message({type:'CAPTURE_END',id:runId,complete:true,mode:'paginated',
      pageCount:1,count:2},{tab:{id:tabId,url:conv},id:'ff-launch-test',
      url:'https://chatgpt.com/c/conv-p4b-'+branch.toLowerCase()});
    const row=await s.message({type:'FF_READ',id:created.id},s.ffSender);
    lastRev=row.revision;
    const ev=row.branches[branch].attempts.at(-1).evidence;
    assert.ok(ev.timing && Number.isFinite(ev.timing.sentMs),'timing recorded at done');
    assert.ok(ev.timing.replyBytes>0);
  }
  const decision=await s.message({type:'FF_COMPARE',experimentId:created.id,
    operationId:'compare_p4_000001'},s.ffSender);
  assert.equal(decision.budgetParity,true,'equal budgets yield parity');
  assert.ok(decision.timings.A && decision.timings.B);
});

test("FF_SUMMARY is a panel-only read-only progress digest",async()=>{
  const s=system();
  const panelSender={id:'ff-launch-test',url:'chrome-extension://ff-launch-test/panel.html'};
  // Before enabling: summary says disabled.
  assert.equal((await s.message({type:'FF_SUMMARY'},panelSender)).enabled,false);
  await s.message({type:'FF_SET_ENABLED',enabled:true,ack:'local-only-no-send'},s.ffSender);
  // No experiments yet.
  assert.equal((await s.message({type:'FF_SUMMARY'},panelSender)).latest,null);
  // The Fork page itself must not read the panel digest, and vice versa the
  // panel cannot use the Fork page's message surface.
  await assert.rejects(s.message({type:'FF_SUMMARY'},s.ffSender),/only the panel/);
  await assert.rejects(s.message({type:'FF_LIST'},panelSender),/only Fork extension page/);
  const created=await s.setupExperiment('create_sum00000001');
  const r=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_sum0000001'},s.ffSender);
  void r;
  const summary=await s.message({type:'FF_SUMMARY'},panelSender);
  assert.equal(summary.latest.branchCount,2);
  assert.equal(summary.latest.branches.map(b=>b.label).sort().join(','),'A,B');
  const snap=JSON.stringify(summary);
  for(const banned of ['w0','frozen','reply','sessionId'])
    assert.ok(!snap.includes('"' + banned + '"'),'summary must not carry experiment content');
});

// Live K=4 acceptance run (2026-10-24, v0.8.0) found that FF_CAPTURE and
// FF_REPREFILL still carried a hardcoded A/B guard, so branches C/D of a
// K=4 experiment could never be completed. These tests pin the fix.
test('K=4: FF_CAPTURE and FF_REPREFILL address every branch of the experiment',async()=>{
  const s=system();
  await s.message({type:'FF_SET_ENABLED',enabled:true,ack:'local-only-no-send'},s.ffSender);
  const created=await s.message({type:'FF_CREATE',operationId:'k4cr_00000001',
    w0:'虚构共同材料 W0',p:'虚构任务指令 P',branchCount:4},s.ffSender);
  const r=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'k4launch_000001'},s.ffSender);
  assert.deepEqual(Object.keys(r.tabIds).sort(),['A','B','C','D']);
  // Branch C: prefill ACK, then conversation binding via OBSERVE.
  const cConv='https://chatgpt.com/c/conv-c-0000001';
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(r.tabIds.C,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(r.tabIds.C,'https://chatgpt.com/'));
  await s.message({type:'OBSERVE',href:cConv,title:'会话',streaming:false,
    assistantBytes:33},s.tabSender(r.tabIds.C,cConv));
  s.tabsById.get(r.tabIds.C).url=cConv;
  const cap=await s.message({type:'FF_CAPTURE',experimentId:created.id,
    branch:'C'},s.ffSender);
  assert.match(cap.runId,/^cap_/,'branch C capture must be accepted');
  // Branch D: re-prefill while its tab is still the plain new chat.
  const rep=await s.message({type:'FF_REPREFILL',experimentId:created.id,
    branch:'D',operationId:'k4re_000000001'},s.ffSender);
  assert.equal(rep.acks,2,'branch D re-prefill must be accepted');
  // A branch outside THIS experiment is still rejected.
  await assert.rejects(s.message({type:'FF_CAPTURE',experimentId:created.id,
    branch:'E'},s.ffSender),/invalid branch/);
  await assert.rejects(s.message({type:'FF_REPREFILL',experimentId:created.id,
    branch:'E',operationId:'k4re_000000002'},s.ffSender),/invalid branch/);
});

test('F3 startup injection failure is visible and cannot masquerade as capturing',async()=>{
  const s=system({captureInjectionFails:true});
  const created=await s.setupExperiment('create_op_failinject_0001');
  const launched=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_op_failinject_0001'},s.ffSender);
  const tabId=launched.tabIds.A;
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(tabId,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(tabId,'https://chatgpt.com/'));
  const conv='https://chatgpt.com/c/synthetic-f3-error';
  s.tabsById.get(tabId).url=conv;
  await s.message({type:'OBSERVE',href:conv,title:'合成失败会话',streaming:false,
    assistantBytes:50},s.tabSender(tabId,conv));
  const started=await s.message({type:'FF_CAPTURE',experimentId:created.id,branch:'A'},s.ffSender);
  assert.equal(started.started,false,'injection failure must not report capture started');
  assert.match(started.error,/SIMULATED_INJECTION_FAILURE/);
  assert.equal(s.runs.get(started.runId).status,'error','source run keeps failure metadata');
  const info=await s.message({type:'FF_CAPTURE_STATUS',experimentId:created.id,
    branch:'A',runId:started.runId},s.ffSender);
  assert.equal(info.state,'error');
  assert.match(info.error,/SIMULATED_INJECTION_FAILURE/);
  assert.equal(info.branchStatus,'pending','the branch is not falsely completed');
  await assert.rejects(s.message({type:'FF_CAPTURE_STATUS',experimentId:created.id,
    branch:'B',runId:started.runId},s.ffSender),/does not belong|invalid|capture/i);
  assert.ok(!s.sent.some(([,type])=>type==='TL_CAPTURE_START'),
    'failed injection must not send a capture start to any tab');
});

test('F3 duplicate capture is rejected without replacing the first run or triggering another start',async()=>{
  const s=system(),created=await s.setupExperiment('create_f3lease000001');
  const opened=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_f3lease000001'},s.ffSender);
  const tabId=opened.tabIds.A,conv='https://chatgpt.com/c/f3-lease-source';
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(tabId,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(tabId,'https://chatgpt.com/'));
  s.tabsById.get(tabId).url=conv;
  await s.message({type:'OBSERVE',href:conv,title:'合成采集会话',streaming:false,
    assistantBytes:40},s.tabSender(tabId,conv));
  const first=await s.message({type:'FF_CAPTURE',experimentId:created.id,branch:'A'},s.ffSender);
  assert.equal(first.started,true);
  const before=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  await assert.rejects(s.message({type:'FF_CAPTURE',experimentId:created.id,branch:'A'},s.ffSender),
    /已有进行中的采集/);
  const after=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  assert.equal(after.revision,before.revision);
  assert.equal(after.branches.A.attempts.at(-1).evidence.captureRunId,first.runId);
  assert.equal(s.runs.size,1,'no second authoritative run');
  assert.equal(s.sent.filter(([,kind])=>kind==='TL_CAPTURE_START').length,1,
    'no duplicate content-script start');
});

test('F3 same-tab foreign capture cannot complete a Fork attempt; only its linked run can',async()=>{
  const s=system(),created=await s.setupExperiment('create_f3owned000001');
  const opened=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_f3owned000001'},s.ffSender);
  const tabId=opened.tabIds.A,conv='https://chatgpt.com/c/f3-owned-source';
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(tabId,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(tabId,'https://chatgpt.com/'));
  s.tabsById.get(tabId).url=conv;
  await s.message({type:'OBSERVE',href:conv,title:'合成采集归属',streaming:false,
    assistantBytes:40},s.tabSender(tabId,conv));
  const frozen=(await s.message({type:'FF_READ',id:created.id},s.ffSender)).frozen.text;
  const linked=await s.message({type:'FF_CAPTURE',experimentId:created.id,branch:'A'},s.ffSender);
  const foreign='cap_foreign_capture_01',sender=s.tabSender(tabId,conv);
  s.runs.set(foreign,{id:foreign,tabId,conversationId:'f3-owned-source',
    url:conv,status:'capturing',createdAt:Date.now(),updatedAt:Date.now(),complete:false});
  s.pageStore.set(foreign+'_0_0',{id:foreign,pageIndex:0,chunkIndex:0,messages:[
    {id:'m1',role:'user',content:frozen,finished:true},
    {id:'m2',role:'assistant',content:'外部来源不能替代这次采集',finished:true}]});
  const ownPages=async id=>{
    s.pageStore.set(id+'_0_0',{id,pageIndex:0,chunkIndex:0,messages:[
      {id:'m1',role:'user',content:frozen,finished:true},
      {id:'m2',role:'assistant',content:'正确关联的原始回复',finished:true}]});
  };
  await s.message({type:'CAPTURE_END',id:foreign,complete:true,mode:'paginated',
    pageCount:1,count:2},sender);
  let row=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  assert.equal(row.branches.A.status,'pending','same tab does not prove run ownership');
  assert.equal(row.branches.A.attempts.at(-1).evidence.captureRunId,linked.runId);
  assert.equal(row.branches.A.attempts.at(-1).evidence.reply,undefined);
  await ownPages(linked.runId);
  await s.message({type:'CAPTURE_END',id:linked.runId,complete:true,mode:'paginated',
    pageCount:1,count:2},sender);
  row=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  assert.equal(row.branches.A.status,'done');
  assert.equal(row.branches.A.attempts.at(-1).evidence.reply,'正确关联的原始回复');
});

test('F3 untracked run requires missing lease, idle window and manual abandonment before retry',async()=>{
  const s=system(),created=await s.setupExperiment('create_f3orphan_001');
  const opened=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_f3orphan_001'},s.ffSender);
  const tabId=opened.tabIds.A,conv='https://chatgpt.com/c/f3-orphan-source';
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(tabId,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(tabId,'https://chatgpt.com/'));
  s.tabsById.get(tabId).url=conv;
  await s.message({type:'OBSERVE',href:conv,title:'重启孤儿采集',streaming:false,
    assistantBytes:40},s.tabSender(tabId,conv));
  const first=await s.message({type:'FF_CAPTURE',experimentId:created.id,branch:'A'},s.ffSender);
  assert.equal(first.started,true);
  const req={type:'FF_CAPTURE_ABANDON',experimentId:created.id,
    branch:'A',runId:first.runId,ack:'manual-reviewed-no-replay'};
  const pageKey=first.runId+'_0_0';
  s.pageStore.set(pageKey,{id:first.runId,pageIndex:0,chunkIndex:0,
    messages:[{id:'m1',role:'user',content:'保留的部分片段'}]});
  const snapshot=structuredClone(s.pageStore.get(pageKey));
  const status=()=>s.message({type:'FF_CAPTURE_STATUS',experimentId:created.id,
    branch:'A',runId:first.runId},s.ffSender);
  assert.equal((await status()).state,'capturing');
  s.runs.get(first.runId).updatedAt=Date.now()-61000;
  await assert.rejects(s.message(req,s.ffSender),/活动标记/);
  assert.equal((await status()).state,'stalled','a live session lease blocks recovery');
  s.session.delete('tl_capture_owner_'+first.runId);
  assert.equal((await status()).state,'untracked');
  s.runs.get(first.runId).updatedAt=Date.now();
  assert.equal((await status()).manualRecoveryAvailable,false);
  await assert.rejects(s.message(req,s.ffSender),/最近仍有更新/);
  s.runs.get(first.runId).updatedAt=Date.now()-61000;
  const stale=await status();
  assert.equal(stale.state,'untracked');
  assert.equal(stale.manualRecoveryAvailable,true);
  assert.equal(stale.branchStatus,'pending');
  const before=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  await assert.rejects(s.message({type:'FF_CAPTURE',experimentId:created.id,branch:'A'},s.ffSender),
    /已有进行中的采集/);
  await assert.rejects(s.message({...req,ack:'silently-retry'},s.ffSender),/需要用户确认/);
  await assert.rejects(s.message({...req,branch:'B'},s.ffSender),/不匹配/);
  await assert.rejects(s.message({...req,runId:'cap_other'},s.ffSender),/不匹配/);
  assert.equal(s.runs.get(first.runId).status,'capturing');
  const ended=await s.message(req,s.ffSender);
  assert.equal(ended.manualAbandoned,true);
  assert.deepEqual(await s.message(req,s.ffSender),
    {runId:first.runId,state:'error',alreadyAbandoned:true});
  assert.equal(s.runs.get(first.runId).status,'error');
  assert.equal(s.runs.get(first.runId).complete,false);
  assert.deepEqual(s.pageStore.get(pageKey),snapshot,'stored partial pages survive');
  assert.equal((await s.message({type:'FF_READ',id:created.id},s.ffSender)).revision,before.revision);
  assert.equal((await status()).state,'error');
  await assert.rejects(s.message({type:'CAPTURE_END',id:first.runId,complete:true,
    mode:'paginated',pageCount:1,count:1},s.tabSender(tabId,conv)),/已结束/);
  assert.equal((await s.message({type:'FF_READ',id:created.id},s.ffSender)).branches.A.status,'pending');
  assert.equal(s.sent.filter(([,kind])=>kind==='TL_CAPTURE_START').length,1,
    'abandonment does not initiate a new capture');
  const next=await s.message({type:'FF_CAPTURE',experimentId:created.id,branch:'A'},s.ffSender);
  assert.notEqual(next.runId,first.runId);
  assert.equal(s.runs.get(first.runId).status,'error');
  assert.equal(s.runs.size,2,'new capture requires a separate manual request');
  assert.equal(s.sent.filter(([,kind])=>kind==='TL_CAPTURE_START').length,2);
});

test('F3 an already completed run cannot be manually reclassified as abandoned',async()=>{
  const s=system(),created=await s.setupExperiment('create_f3done_00001');
  const opened=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_f3done_00001'},s.ffSender);
  const tabId=opened.tabIds.B,conv='https://chatgpt.com/c/f3-done-source';
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(tabId,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(tabId,'https://chatgpt.com/'));
  s.tabsById.get(tabId).url=conv;
  await s.message({type:'OBSERVE',href:conv,title:'采集完成优先',streaming:false,
    assistantBytes:30},s.tabSender(tabId,conv));
  const run=await s.message({type:'FF_CAPTURE',experimentId:created.id,branch:'B'},s.ffSender);
  const text=(await s.message({type:'FF_READ',id:created.id},s.ffSender)).frozen.text;
  s.pageStore.set(run.runId+'_0_0',{id:run.runId,pageIndex:0,chunkIndex:0,messages:[
    {id:'m1',role:'user',content:text,finished:true},
    {id:'m2',role:'assistant',content:'先完成的合成采集',finished:true}
  ]});
  await s.message({type:'CAPTURE_END',id:run.runId,complete:true,mode:'paginated',
    pageCount:1,count:2},s.tabSender(tabId,conv));
  assert.equal((await s.message({type:'FF_READ',id:created.id},s.ffSender)).branches.B.status,'done');
  s.runs.get(run.runId).updatedAt=Date.now()-61000;
  await assert.rejects(s.message({type:'FF_CAPTURE_ABANDON',experimentId:created.id,
    branch:'B',runId:run.runId,ack:'manual-reviewed-no-replay'},s.ffSender),
    /不匹配|已变化/);
  assert.equal(s.runs.get(run.runId).status,'done');
});

test('K=4 startup recovery rebinds C/D as well as A/B without auto-prefill',async()=>{
  const s=system();
  await s.message({type:'FF_SET_ENABLED',enabled:true,ack:'local-only-no-send'},s.ffSender);
  const created=await s.message({type:'FF_CREATE',
    operationId:'create_k4recover0001',w0:'合成材料',p:'合成任务',branchCount:4},s.ffSender);
  const launched=await s.message({type:'FF_LAUNCH',experimentId:created.id,
    operationId:'launch_k4recover0001'},s.ffSender);
  for(const branch of ['A','B','C','D']){
    const tabId=launched.tabIds[branch];
    s.tabsById.get(tabId).url='https://chatgpt.com/c/recover-'+branch.toLowerCase()+'-1234';
  }
  // Mimic a Chrome restart: ephemerally registered intents vanish, while
  // existing tabs and user-created conversation identities remain durable.
  s.session.clear();
  const sentBefore=s.sent.length;
  s.events.startup();
  let last;
  for(let i=0;i<100;i++){
    last=await s.message({type:'FF_READ',id:created.id},s.ffSender);
    if(Object.values(last.branches).every(b=>b.phase==='generating'))break;
    await new Promise(r=>setTimeout(r,10));
  }
  for(const branch of ['A','B','C','D']){
    const attempt=last.branches[branch].attempts.at(-1);
    assert.equal(attempt.evidence.sessionId,'recover-'+branch.toLowerCase()+'-1234',
      'recovered branch '+branch);
    assert.equal(last.branches[branch].phase,'generating');
  }
  assert.equal(s.sent.length,sentBefore,'startup recovery never re-seeds user drafts');
});
