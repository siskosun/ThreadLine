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
 const f=await F.freeze("W","P");f.w0Hashes.raw="fake";
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
 assert.throws(()=>F.advance(x,{...event,expectedRevision:0}),/stale/);
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
