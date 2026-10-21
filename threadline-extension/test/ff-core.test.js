const test=require("node:test");
const assert=require("node:assert/strict");
const F=require("../ff-core.js");
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
