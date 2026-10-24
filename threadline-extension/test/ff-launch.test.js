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
function system() {
  const records = new Map(), runs = new Map(), pageStore = new Map();
  const session = new Map(), local = new Map(), events = {}, sent = [], newTabs = [], updates = [];
  let nextTab = 100;
  const tabsById = new Map();
  const ffdb = {
    async create(row){if(records.has(row.id))throw new Error('duplicate');records.set(row.id,row);},
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
    scripting:{async executeScript(){}},
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
  return {message,ffSender,session,sent,newTabs,updates,events,records,runs,pageStore,
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
  for(const [id] of navs)assert.ok([r.tabIdA,r.tabIdB].includes(id));
  assert.notEqual(r.tabIdA,r.tabIdB);
  for(const tabId of [r.tabIdA,r.tabIdB]){
    const intent=s.session.get(`tl_handoff_${tabId}`);
    assert.ok(intent && intent.text.includes('【共同材料 W₀】'),'frozen text seeded');
  }
  const row=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  for(const branch of ['A','B']){
    assert.equal(row.branches[branch].status,'pending');
    assert.equal(row.branches[branch].phase,'created');
    assert.equal(row.branches[branch].attempts.length,1);
    assert.equal(row.branches[branch].attempts[0].evidence.tabId,
      branch==='A'?r.tabIdA:r.tabIdB);
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
  const senderA=s.tabSender(r.tabIdA,'https://chatgpt.com/');
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
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(r.tabIdA,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(r.tabIdA,'https://chatgpt.com/'));
  const conv='https://chatgpt.com/c/conv-12345678';
  await s.message({type:'OBSERVE',href:conv,title:'会话',streaming:false,
    assistantBytes:40},s.tabSender(r.tabIdA,conv));
  const row=await s.message({type:'FF_READ',id:created.id},s.ffSender);
  const a=row.branches.A.attempts.at(-1);
  assert.equal(row.branches.A.phase,'generating');
  assert.equal(a.evidence.sessionId,'conv-12345678');
  assert.equal(a.evidence.conversationId,'conv-12345678');
  assert.equal(a.evidence.inputLevel,'exact','sent user message classified');
  // Branch B ACKs its own prefill independently of branch A.
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(r.tabIdB,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(r.tabIdB,'https://chatgpt.com/'));
  // The same conversation cannot be claimed by branch B later.
  const other='https://chatgpt.com/c/conv-12345678';
  await s.message({type:'OBSERVE',href:other,title:'会话',streaming:false},s.tabSender(r.tabIdB,other));
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
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(r.tabIdA,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(r.tabIdA,'https://chatgpt.com/'));
  const conv='https://chatgpt.com/c/conv-12345678';
  await s.message({type:'OBSERVE',href:conv,title:'会话',streaming:false},s.tabSender(r.tabIdA,conv));
  const runId='cap_test_000001';
  s.runs.set(runId,{id:runId,tabId:r.tabIdA,conversationId:'conv-12345678',
    url:conv,status:'capturing',createdAt:Date.now(),complete:false});
  s.pageStore.set(`${runId}_0_0`,{id:runId,pageIndex:0,chunkIndex:0,messages:[
    {id:'m1',role:'user',content:frozen,finished:true},
    {id:'m2',role:'assistant',content:'好的，OK。',finished:true}
  ]});
  await s.message({type:'CAPTURE_END',id:runId,complete:true,mode:'paginated',
    pageCount:1,count:2},{tab:{id:r.tabIdA,url:conv},id:'ff-launch-test',
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
  await s.message({type:'HANDOFF_BEGIN'},s.tabSender(r.tabIdA,'https://chatgpt.com/'));
  await s.message({type:'HANDOFF_ACK'},s.tabSender(r.tabIdA,'https://chatgpt.com/'));
  const conv='https://chatgpt.com/c/conv-12345678';
  await s.message({type:'OBSERVE',href:conv,title:'会话',streaming:false},s.tabSender(r.tabIdA,conv));
  const runId='cap_test_000002';
  s.runs.set(runId,{id:runId,tabId:r.tabIdA,conversationId:'conv-12345678',
    url:conv,status:'capturing',createdAt:Date.now(),complete:false});
  s.pageStore.set(`${runId}_0_0`,{id:runId,pageIndex:0,chunkIndex:0,messages:[
    {id:'m1',role:'user',content:'只有半截'}
  ]});
  await s.message({type:'CAPTURE_END',id:runId,complete:false,mode:'visible-dom',
    pageCount:1,count:1},{tab:{id:r.tabIdA,url:conv},id:'ff-launch-test',
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
  s.events.tabRemoved(r.tabIdA);
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
    tabId===r.tabIdA && type==='TL_HANDOFF_READY').length;
  const reprefill=await s.message({type:'FF_REPREFILL',experimentId:created.id,
    branch:'A',operationId:'reprefill_op_0001'},s.ffSender);
  assert.equal(reprefill.tabId,r.tabIdA);
  assert.ok(s.session.get(`tl_handoff_${r.tabIdA}`),'intent re-seeded');
  const sentAfter=s.sent.filter(([tabId,type])=>
    tabId===r.tabIdA && type==='TL_HANDOFF_READY').length;
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
  for(const [branch,tabId] of [['A',r.tabIdA],['B',r.tabIdB]]){
    await s.message({type:'HANDOFF_BEGIN'},s.tabSender(tabId,'https://chatgpt.com/'));
    await s.message({type:'HANDOFF_ACK'},s.tabSender(tabId,'https://chatgpt.com/'));
    const conv='https://chatgpt.com/c/conv-p3-'+branch.toLowerCase();
    await s.message({type:'OBSERVE',href:conv,title:'会话',streaming:false},
      s.tabSender(tabId,conv));
    const runId='cap_p3_'+branch;
    s.runs.set(runId,{id:runId,tabId,conversationId:'conv-p3-'+branch.toLowerCase(),
      url:conv,status:'capturing',createdAt:Date.now(),complete:false});
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
  await assert.rejects(s.message({type:'FF_VERDICT',experimentId:created.id,
    preference:'bogus',criteria:'c',confidence:'low'},s.ffSender),/invalid preference/);
  const afterVerdict=await s.message({type:'FF_VERDICT',experimentId:created.id,
    preference:'X',criteria:'回复更完整',confidence:'high',notes:'备注'},
    s.ffSender);
  assert.equal(afterVerdict.verdict.preference,'X');
  assert.ok(afterVerdict.verdict.decidedAt>0);
  await assert.rejects(s.message({type:'FF_VERDICT',experimentId:created.id,
    preference:'Y',criteria:'c',confidence:'low'},s.ffSender),/already recorded/);
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
