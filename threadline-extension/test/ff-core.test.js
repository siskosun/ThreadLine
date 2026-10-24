const test=require("node:test");
const assert=require("node:assert/strict");
const F=require("../ff-core.js");

test("FF binds one session identity across all transitions of an attempt",async()=>{
 const initial=F.newExperiment(await F.freeze("W","P"),"exp_bound001");
 const base={branch:"A",attemptId:"att_bound001",status:"pending",phase:"generating"};
 const first=F.advance(initial,{...base,expectedRevision:0,operationId:"op_bound001",
   evidence:{sessionId:"chat-original"}});
 for(const status of ["pending","failed","unknown","done"]){
   assert.throws(()=>F.advance(first,{...base,status,phase:"capturing",expectedRevision:1,
     operationId:"op_conflict01",evidence:{sessionId:"chat-other",inputLevel:"exact",
       taskCount:1,captureComplete:true,reply:"ok",endSignals:["stable","final"],persisted:true}}),
     /session identity/);
 }
 const middle=F.advance(first,{...base,expectedRevision:1,operationId:"op_bound002",evidence:{}});
 assert.equal(middle.branches.A.attempts[0].evidence.sessionId,"chat-original");
 assert.throws(()=>F.advance(middle,{...base,expectedRevision:2,operationId:"op_conflict02",
   evidence:{sessionId:"chat-other"}}),/session identity/);
 const event={...base,expectedRevision:2,operationId:"op_bound003",status:"done",phase:"capturing",
   evidence:{sessionId:"chat-original",inputLevel:"exact",taskCount:1,captureComplete:true,
     reply:"ok",endSignals:["stable","final"],persisted:true}};
 const done=F.advance(middle,event);
 assert.equal(done.branches.A.status,"done");
 assert.equal(F.advance(done,event),done);
 assert.equal(first.branches.A.attempts[0].evidence.sessionId,"chat-original");
 const failed=F.advance(middle,{...base,expectedRevision:2,operationId:"op_bound004",
   status:"failed",phase:"capturing",evidence:{}});
 const retry=F.advance(failed,{branch:"A",expectedRevision:3,operationId:"op_bound005",
   attemptId:"att_bound002",status:"pending",phase:"created",manualNewAttempt:true,
   evidence:{sessionId:"chat-new-attempt"}});
 assert.equal(retry.branches.A.attempts[0].evidence.sessionId,"chat-original");
 assert.equal(retry.branches.A.attempts[1].evidence.sessionId,"chat-new-attempt");
});

test("FF rejects malformed session identity even before completion",async()=>{
 const initial=F.newExperiment(await F.freeze("W","P"),"exp_badid001");
 for(const sessionId of [null,12,"",{},"abc"])
   assert.throws(()=>F.advance(initial,{branch:"A",attemptId:"att_badid001",status:"pending",
     phase:"generating",expectedRevision:0,operationId:"op_badid001",evidence:{sessionId}}),/session identity/);
});

test("FF completion requires distinct recognized string signal kinds",async()=>{
 const initial=F.newExperiment(await F.freeze("W","P"),"exp_signal01");
 const event={branch:"A",attemptId:"att_signal01",status:"done",phase:"capturing",
   expectedRevision:0,operationId:"op_signal01"};
 const evidence={sessionId:"chat-signal",inputLevel:"exact",taskCount:1,captureComplete:true,
   reply:"ok",persisted:true};
 for(const endSignals of [[null,false],["stable","typo"],["stable","stable"],["stable",,],
   [{type:"stable",ms:5000},{type:"stable",ms:5000}],["stable",{}],"stable,final",[]])
   assert.throws(()=>F.advance(initial,{...event,evidence:{...evidence,endSignals}}),/completion signals/);
 for(const endSignals of [["stable","final"],["generation","stable"],["generation","final"]])
   assert.equal(F.advance(initial,{...event,evidence:{...evidence,endSignals}}).branches.A.status,"done");
});
test("FF frozen input preserves BOM, CRLF, trailing spaces, CJK, emoji and code blocks",async()=>{
 const w="\uFEFF中文\r\n\`\`\`js\r\nlet x = '😀';  \r\n\`\`\` ",p="A\u00a0 B \rC";
 const f=await F.freeze(w,p);
 assert.equal(f.text,F.formatText(w,p));
 assert.equal(f.bytes,F.byteLength(f.text));
 assert.equal(await F.verifyFrozen(f),true);
 assert.equal((await F.classify(" A\u00a0B ","A B",{trusted:true,complete:true})).level,"canonical_equivalent");
 assert.equal((await F.classify("a","b",{trusted:true,complete:true})).level,"differs");
 assert.equal((await F.classify("a","a")).level,"unverified");
 assert.equal((await F.classify("a","a",{trusted:true,complete:true})).level,"exact");
});
test("FF rejects oversize UTF-8 and forged hashes",async()=>{
 await assert.rejects(F.freeze("中".repeat(8001),"p"),/24000/);
 const f=structuredClone(await F.freeze("W","P"));f.w0Hashes.raw="fake";
 await assert.rejects(F.verifyFrozen(f),/hash mismatch/);
});
test("FF status machine requires distinct completion signals and one task",async()=>{
 let x=F.newExperiment(await F.freeze("W","P"),"exp_123456");
 const event={branch:"A",expectedRevision:0,operationId:"op_123456",attemptId:"att_123456",status:"done",phase:"capturing"};
 const evidence={inputLevel:"exact",sessionId:"c/one",taskCount:1,captureComplete:true,reply:"ok",endSignals:["stable","final"],persisted:true};
 assert.throws(()=>F.advance(x,{...event,evidence:{...evidence,taskCount:2}}),/incomplete/);
 assert.throws(()=>F.advance(x,{...event,evidence:{...evidence,endSignals:["stable","stable"]}}),/signals/);
 x=F.advance(x,{...event,evidence});
 assert.equal(x.branches.A.status,"done");
 assert.equal(x.branches.B.status,"pending");
 assert.throws(()=>F.advance(x,{...event,expectedRevision:1,operationId:"op_234567"}),/terminal/);
 assert.throws(()=>F.advance(x,{...event,expectedRevision:0,operationId:"op_345678"}),/stale/);
});
test("FF unknown attempt is not silently retried or replaced",async()=>{
 let x=F.newExperiment(await F.freeze("W","P"),"exp_234567");
 x=F.advance(x,{branch:"A",expectedRevision:0,operationId:"op_345678",attemptId:"att_345678",status:"unknown",phase:"awaiting_send",reason:"uncertain send"});
 assert.throws(()=>F.advance(x,{branch:"A",expectedRevision:1,operationId:"op_456789",attemptId:"att_345678",status:"done",phase:"capturing"}),/terminal/);
 assert.equal(x.branches.A.attempts.length,1);
});

test("FF manual retry after unknown must have new attempt ID",async()=>{
 let x=F.newExperiment(await F.freeze("W","P"),"exp_retry1");
 x=F.advance(x,{branch:"A",expectedRevision:0,operationId:"op_retry1",attemptId:"att_retry1",status:"unknown",phase:"awaiting_send"});
 assert.throws(()=>F.advance(x,{branch:"A",expectedRevision:1,operationId:"op_retry2",attemptId:"att_retry2",status:"pending",phase:"created"}),/terminal/);
 x=F.advance(x,{branch:"A",expectedRevision:1,operationId:"op_retry2",attemptId:"att_retry2",status:"pending",phase:"created",manualNewAttempt:true});
 assert.equal(x.branches.A.attempts.length,2);
 assert.equal(x.branches.A.attempts[0].status,"unknown");
 assert.equal(x.branches.A.status,"pending");
});


test("FF input byte boundary is inclusive and byte counted, not codepoint counted",async()=>{
 const overhead=F.byteLength(F.formatText("","任务"));
 const exact=await F.freeze("x".repeat(24000-overhead),"任务");
 assert.equal(exact.bytes,24000);
 await assert.rejects(F.freeze("x".repeat(24001-overhead),"任务"),/24000/);
 await assert.rejects(F.freeze("w"," "),/non-empty/);
 assert.equal(F.byteLength("😀"),4);
});
test("FF SHA-256 follows fixed canonicalization and preserves formatting",async()=>{
 const a=await F.fingerprints("\uFEFFa\r\n  b  \r");
 const b=await F.fingerprints("a\n  b  \n");
 assert.notEqual(a.raw,b.raw);
 assert.equal(a.frozen,b.frozen);
 assert.equal(a.compare,b.compare);
 assert.notEqual((await F.fingerprints("a  b")).compare,(await F.fingerprints("a b")).compare);
});
test("FF duplicate operation is idempotent across revision changes but conflicting replay fails",async()=>{
 const frozen=await F.freeze("Common","Task");
 const original=F.newExperiment(frozen,"exp_idempotent1");
 const event={branch:"A",expectedRevision:0,operationId:"op_replay01",
   attemptId:"att_replay01",status:"pending",phase:"created",evidence:{}};
 const after=F.advance(original,event);
 assert.equal(after.revision,1);
 assert.equal(F.advance(after,event),after);
 assert.equal(F.advance(after,{...event,evidence:{},reason:""}),after);
 assert.throws(()=>F.advance(after,{...event,reason:"mismatch"}),/operation ID reused/);
 assert.throws(()=>F.advance(after,{...event,operationId:"op_replay02"}),/stale revision/);
 assert.equal(original.revision,0);
 assert.equal(original.branches.A.history.length,0);
});
test("FF attempts cannot regress phases or replace terminal failures",async()=>{
 let state=F.newExperiment(await F.freeze("W","P"),"exp_phases01");
 const first={branch:"B",attemptId:"att_step001"};
 state=F.advance(state,{...first,expectedRevision:0,operationId:"op_step001",status:"pending",phase:"draft_ready"});
 assert.throws(()=>F.advance(state,{...first,expectedRevision:1,operationId:"op_step002",
   status:"pending",phase:"created"}),/phase cannot move backwards/);
 state=F.advance(state,{...first,expectedRevision:1,operationId:"op_step003",status:"failed",phase:"awaiting_send"});
 assert.equal(state.branches.B.status,"failed");
 assert.throws(()=>F.advance(state,{...first,expectedRevision:2,operationId:"op_step004",
   status:"pending",phase:"created",manualNewAttempt:true}),/terminal/);
 state=F.advance(state,{branch:"B",attemptId:"att_step002",expectedRevision:2,
   operationId:"op_step005",status:"pending",phase:"created",manualNewAttempt:true});
 assert.equal(state.branches.B.attempts[0].status,"failed");
 assert.equal(state.branches.B.attempts.length,2);
});
test("FF cannot assign the same conversation to both finished branches",async()=>{
 let state=F.newExperiment(await F.freeze("W","P"),"exp_session1");
 const evidence={inputLevel:"exact",sessionId:"chat-same",taskCount:1,
   captureComplete:true,reply:"final",endSignals:["generation","stable"],persisted:true};
 state=F.advance(state,{branch:"A",expectedRevision:0,operationId:"op_sess001",
   attemptId:"att_sess001",status:"done",phase:"capturing",evidence});
 assert.throws(()=>F.advance(state,{branch:"B",expectedRevision:1,operationId:"op_sess002",
   attemptId:"att_sess002",status:"done",phase:"capturing",evidence}),/same session/);
});
test("FF isolation settings default to unknown and legacy core is independent",async()=>{
 const state=F.newExperiment(await F.freeze("W","P"),"exp_isolate1");
 assert.equal(state.branches.A.isolation.checks.model,"unknown");
 assert.equal(state.branches.B.isolation.checks.memory,"unknown");
 assert.notStrictEqual(state.branches.A.isolation,state.branches.B.isolation);
 const legacy=require("../core.js");
 assert.equal(legacy.emptyState().schema,2);
});


test("FF refuses malformed UTF-16 instead of silently hashing replacement bytes",async()=>{
 const bad="\uD800",replacement="\uFFFD";
 assert.notEqual(bad,replacement);
 assert.equal(F.wellFormed("中文😀"),true);
 assert.equal(F.wellFormed(bad),false);
 assert.equal(F.wellFormed("\uDC00"),false);
 await assert.rejects(F.freeze(bad,"P"),/ill-formed Unicode/);
 await assert.rejects(F.freeze("W",bad),/ill-formed Unicode/);
 await assert.rejects(F.hash(bad),/ill-formed Unicode/);
 const safe=await F.freeze("W","P");
 assert.equal(await F.verifyFrozen(safe),true);
 assert.equal((await F.classify(replacement,bad,{trusted:true,complete:true})).level,"unverified");
});


test("FF attempt ID cannot migrate from branch A to B",async()=>{
 let exp=F.newExperiment(await F.freeze("W","P"),"exp_unique01");
 exp=F.advance(exp,{branch:"A",expectedRevision:0,operationId:"op_unique01",
   attemptId:"att_unique01",status:"pending",phase:"draft_ready"});
 assert.throws(()=>F.advance(exp,{branch:"B",expectedRevision:1,operationId:"op_unique02",
   attemptId:"att_unique01",status:"pending",phase:"created"}),/another branch/);
 assert.equal(exp.branches.B.attempts.length,0);
});


test("FF must reject a second attempt ID while a branch is still pending",async()=>{
 let x=F.newExperiment(await F.freeze("Common","Task"),"exp_oneactive01");
 x=F.advance(x,{branch:"A",expectedRevision:0,operationId:"op_active001",
   attemptId:"att_active001",status:"pending",phase:"draft_ready"});
 assert.throws(()=>F.advance(x,{branch:"A",expectedRevision:1,operationId:"op_active002",
   attemptId:"att_active002",status:"pending",phase:"created"}),
   /another active attempt|already pending/);
 assert.throws(()=>F.advance(x,{branch:"A",expectedRevision:1,operationId:"op_active003",
   attemptId:"att_active002",status:"unknown",phase:"awaiting_send"}),
   /another active attempt|already pending/);
 assert.equal(x.revision,1);
 assert.equal(x.branches.A.attempts.length,1);
 // The current attempt may still progress using its own identity.
 x=F.advance(x,{branch:"A",expectedRevision:1,operationId:"op_active004",
   attemptId:"att_active001",status:"unknown",phase:"awaiting_send"});
 assert.equal(x.branches.A.status,"unknown");
 // A new attempt is allowed ONLY after manual restart of that terminal state.
 x=F.advance(x,{branch:"A",expectedRevision:2,operationId:"op_active005",
   attemptId:"att_active002",status:"pending",phase:"created",manualNewAttempt:true});
 assert.equal(x.branches.A.attempts.length,2);
 assert.equal(x.branches.A.attempts[0].status,"unknown");
 assert.equal(x.branches.A.attempts[1].status,"pending");
});

test("FF branch evidence accepts P2 bindings and rejects malformed ones",async()=>{
 const initial=F.newExperiment(await F.freeze("W","P"),"exp_p2evd0001");
 const base={branch:"A",attemptId:"att_p2evd0001",status:"pending",phase:"created",
   expectedRevision:0,operationId:"op_p2evd0001"};
 const launched=F.advance(initial,{...base,
   evidence:{tabId:42,conversationId:"conv-12345678",inputLevel:"exact",prefill:"exact_ack"}});
 assert.equal(launched.branches.A.attempts[0].evidence.tabId,42);
 for(const [field,bad] of [["tabId",-1],["tabId","7"],["conversationId","short"],
   ["inputLevel","guessed"],["prefill","magic"],["assistantBytes",-3]]){
   const ev={...launched.branches.A.attempts[0].evidence,[field]:bad};
   assert.throws(()=>F.advance(launched,{...base,expectedRevision:1,
     operationId:"op_p2evd0002",evidence:ev}),new RegExp("invalid (tab binding|conversation identity|input level|prefill provenance|reply size)"),
     field+" must be validated");
 }
 // Re-prefill provenance is legal within the same awaiting phase.
 const reacked=F.advance(launched,{...base,expectedRevision:1,operationId:"op_p2evd0003",
   status:"pending",phase:"awaiting_send",
   evidence:{tabId:42,conversationId:"conv-12345678",inputLevel:"exact",prefill:"reacked"}});
 assert.equal(reacked.branches.A.phase,"awaiting_send");
});

test("FF P3 mapping is gated, seed-deterministic, and verdict is validated",async()=>{
  const frozen=await F.freeze("W0 material","task");
  const build=async (id)=>{
    let r=F.newExperiment(frozen,id);
    for(const branch of ["A","B"]){
      const tabId=branch==="A"?1:2, conv="conv-"+branch.toLowerCase()+"-0001";
      const events=[
        {operationId:"op_"+branch+"_00000001",status:"pending",phase:"created",evidence:{tabId}},
        {operationId:"op_"+branch+"_ack00001",status:"pending",phase:"awaiting_send",
         evidence:{tabId,inputLevel:"exact",prefill:"exact_ack",
           sessionId:"chat-"+branch.toLowerCase(),conversationId:conv}},
        {operationId:"op_"+branch+"_done00001",status:"done",phase:"capturing",
         evidence:{tabId,inputLevel:"exact",prefill:"exact_ack",
           sessionId:"chat-"+branch.toLowerCase(),conversationId:conv,
           captureComplete:true,persisted:true,taskCount:1,reply:branch+" reply",
           endSignals:["final","generation"]}}];
      for(const [i,ev] of events.entries()){
        r=F.advance(r,{branch,expectedRevision:r.revision,attemptId:"att_"+branch+"_0001",...ev});
      }
    }
    return r;
  };
  const pending=F.newExperiment(frozen,"exp_p3map00001");
  assert.equal(F.eligibleForComparison(pending),false);
  await assert.rejects(()=>F.assignMapping(pending,"seed0000001"),/both branches/);
  const done=await build("exp_p3map00002");
  done.createOperationId="op_create00001";
  assert.equal(F.eligibleForComparison(done),true);
  const m1=await F.assignMapping(done,"seed0000001");
  const m2=await F.assignMapping(done,"seed0000001");
  assert.equal(m1.mapping.X,m2.mapping.X,"same seed must map identically");
  assert.ok(m1.mapping.X==="A"||m1.mapping.X==="B");
  const m3=await F.assignMapping(done,"seed0000002");
  await assert.rejects(()=>F.assignMapping({...done,decision:m1},"seed0000003"),/already assigned/);
  const verdict=F.recordVerdict(m1,{preference:"X",criteria:"更完整",confidence:"high",notes:"备注"});
  assert.equal(verdict.preference,"X");
  assert.throws(()=>F.recordVerdict({...m1,verdict},{preference:"Y",criteria:"c",confidence:"low"}),/already recorded/);
  assert.throws(()=>F.recordVerdict(m1,{preference:"bogus",criteria:"c",confidence:"low"}),/invalid preference/);
  assert.throws(()=>F.recordVerdict(m1,{preference:"X",criteria:"",confidence:"low"}),/criteria required/);
  const snap=F.exportSnapshot({...done,createOperationId:"op_create00001",decision:{...m1,verdict}});
  assert.equal(snap.kind,"threadline-fork-experiment");
  assert.equal(snap.frozen.textHashes.rule,"canonicalization-v1");
  assert.equal(snap.decision.mapping.X,m1.mapping.X);
  assert.equal(snap.decision.verdict.preference,"X");
});
