const test=require('node:test');
const assert=require('node:assert/strict');
const F=require('../ff-core.js');

test('FF P4 K=4 orchestration generalizes branches, budgets and mapping',async()=>{
  const frozen=await F.freeze("W0 for four","task");
  const exp4=F.newExperiment(frozen,"exp_p4k400001",4);
  assert.equal(Object.keys(exp4.branches).length,4);
  assert.deepEqual(Object.keys(exp4.branches),["A","B","C","D"]);
  assert.throws(()=>F.newExperiment(frozen,"exp_p4k400002",5),/branch count/);
  assert.throws(()=>F.newExperiment(frozen,"exp_p4k400003",1),/branch count/);
  // Advance every branch to done, including C and D (previously impossible).
  let r=exp4;
  for(const branch of ["A","B","C","D"]){
    const conv="conv-p4-"+branch.toLowerCase()+"-0001";
    const events=[
      {operationId:"op_p4_"+branch+"_0001",status:"pending",phase:"created",evidence:{tabId:1}},
      {operationId:"op_p4_"+branch+"_ack0001",status:"pending",phase:"awaiting_send",
       evidence:{tabId:1,inputLevel:"exact",prefill:"exact_ack",
         sessionId:"chat-p4-"+branch.toLowerCase(),conversationId:conv,sentAt:Date.now()}},
      {operationId:"op_p4_"+branch+"_done0001",status:"done",phase:"capturing",
       evidence:{tabId:1,inputLevel:"exact",prefill:"exact_ack",
         sessionId:"chat-p4-"+branch.toLowerCase(),conversationId:conv,sentAt:Date.now(),
         captureComplete:true,persisted:true,taskCount:1,reply:branch+" reply",
         endSignals:["final","generation"],capturedAt:Date.now(),
         budget:{sentMs:5000,replyBytes:20}}}];
    for(const ev of events){
      r=F.advance(r,{branch,expectedRevision:r.revision,attemptId:"att_p4_"+branch,...ev});
    }
  }
  assert.equal(Object.keys(r.branches).length,4);
  assert.ok(F.eligibleForComparison(r));
  // Mapping for K=4 uses ordinal labels 1..4, deterministic per seed.
  const m1=await F.assignMapping(r,"p4seed00000001");
  assert.deepEqual(Object.keys(m1.mapping).sort(),["1","2","3","4"]);
  const m2=await F.assignMapping(r,"p4seed00000001");
  assert.deepEqual(m1.mapping,m2.mapping);
  const mappedBranches=Object.values(m1.mapping).sort();
  assert.deepEqual(mappedBranches,["A","B","C","D"],"mapping is a permutation of all branches");
  // Verdict validates against the mapping labels.
  const firstLabel=Object.keys(m1.mapping)[0];
  const v=F.recordVerdict(m1,{preference:firstLabel,criteria:"更完整",confidence:"high"});
  assert.equal(v.preference,firstLabel);
  assert.throws(()=>F.recordVerdict(m1,{preference:"X",criteria:"c",confidence:"low"}),/invalid preference/);
  // The K=2 derivation is unchanged: parity decides the X assignment.
  const exp2=F.newExperiment(frozen,"exp_p4k200001",2);
  let r2=exp2;
  for(const branch of ["A","B"]){
    const conv="conv-p4-"+branch.toLowerCase()+"-0002";
    const events=[
      {operationId:"op2_"+branch+"_0001",status:"pending",phase:"created",evidence:{tabId:1}},
      {operationId:"op2_"+branch+"_ack0001",status:"pending",phase:"awaiting_send",
       evidence:{tabId:1,inputLevel:"exact",prefill:"exact_ack",
         sessionId:"chat2-"+branch.toLowerCase(),conversationId:conv,sentAt:Date.now()}},
      {operationId:"op2_"+branch+"_done0001",status:"done",phase:"capturing",
       evidence:{tabId:1,inputLevel:"exact",prefill:"exact_ack",
         sessionId:"chat2-"+branch.toLowerCase(),conversationId:conv,sentAt:Date.now(),
         captureComplete:true,persisted:true,taskCount:1,reply:branch+" reply",
         endSignals:["final","generation"],capturedAt:Date.now(),
         budget:{sentMs:5000,replyBytes:20}}}];
    for(const ev of events){
      r2=F.advance(r2,{branch,expectedRevision:r2.revision,attemptId:"att2_"+branch,...ev});
    }
  }
  const mK2=await F.assignMapping(r2,"p4seed00000009");
  assert.deepEqual(Object.keys(mK2.mapping),["X","Y"],"K=2 keeps the phase-3 label scheme");
  // Budgets surface in the snapshot decision through the export.
  const snap=F.exportSnapshot({...r,createOperationId:"op_snap0000001",
    decision:{...m1,verdict:v}});
  assert.equal(Object.keys(snap.branches).length,4);
  assert.ok(snap.decision.mapping["1"]&&snap.decision.mapping["4"]);
});

test('FF P4 calibration scoring is hidden until judged and gates nothing by accident',async()=>{
  const items=F.CALIBRATION_ITEMS;
  assert.equal(items.length,2);
  for(const item of items)assert.equal(item.expectedIndex,undefined,'expected answers must not be exposed');
  const perfect=items.map(item=>({id:item.id,choice:1}));
  const result=F.judgeCalibration(perfect);
  assert.equal(result.pass,true);
  assert.equal(result.score,result.total);
  const wrong=F.judgeCalibration(items.map(item=>({id:item.id,choice:0})));
  assert.equal(wrong.pass,false);
  assert.throws(()=>F.judgeCalibration([{id:items[0].id,choice:1}]),/every calibration item/);
  assert.throws(()=>F.judgeCalibration(items.map(item=>({id:item.id,choice:99}))),/invalid calibration choice/);
});

test('FF P4 import validates hashes, seed-derived mapping and rejects tampering',async()=>{
  const frozen=await F.freeze("importable W0","task");
  const build=async id=>{
    let r=F.newExperiment(frozen,id,2);
    for(const branch of ["A","B"]){
      const conv="conv-imp-"+branch.toLowerCase()+"-0001";
      const events=[
        {operationId:"op_imp_"+branch+"_0001",status:"pending",phase:"created",evidence:{tabId:1}},
        {operationId:"op_imp_"+branch+"_ack001",status:"pending",phase:"awaiting_send",
         evidence:{tabId:1,inputLevel:"exact",prefill:"exact_ack",
           sessionId:"chat-imp-"+branch.toLowerCase(),conversationId:conv}},
        {operationId:"op_imp_"+branch+"_done01",status:"done",phase:"capturing",
         evidence:{tabId:1,inputLevel:"exact",prefill:"exact_ack",
           sessionId:"chat-imp-"+branch.toLowerCase(),conversationId:conv,
           captureComplete:true,persisted:true,taskCount:1,reply:branch+" reply",
           endSignals:["final","generation"]}}];
      for(const ev of events){
        r=F.advance(r,{branch,expectedRevision:r.revision,attemptId:"att_imp_"+branch,...ev});
      }
    }
    return r;
  };
  const exp=await build("ff_imp_snapshot01");
  exp.createOperationId="op_imp_create001";
  const decision=await F.assignMapping(exp,"importseed00001");
  const snapshot=F.exportSnapshot({...exp,decision});
  const validated=await F.validateImport(snapshot);
  assert.equal(validated.frozen.text,frozen.text);
  assert.deepEqual(validated.decision.mapping,decision.mapping);
  // Tampering with the frozen text is rejected by hash recomputation.
  const tampered={...snapshot,frozen:{...snapshot.frozen,
    text:snapshot.frozen.text.replace("W0","W1")}};
  await assert.rejects(()=>F.validateImport(tampered),/frozen text changed|frozen hash mismatch/);
  // Tampering with the recorded mapping is rejected by seed re-derivation.
  const flipped={...snapshot,decision:{...snapshot.decision,
    mapping:{...snapshot.decision.mapping,X:decision.mapping.Y,Y:decision.mapping.X}}};
  await assert.rejects(()=>F.validateImport(flipped),/does not match the recorded seed/);
  // Unknown snapshot kinds are rejected.
  await assert.rejects(()=>F.validateImport({...snapshot,kind:"something-else"}),/unknown snapshot kind/);
});

test('FF P4 import rejects done branches claimed without completion evidence',async()=>{
  // The state machine already refuses to CREATE such records in-process, so
  // the snapshot is built from a valid export and then mutated: the import
  // validator is the only line of defense against hand-crafted data.
  const frozen=await F.freeze("import W0","task");
  const build=async id=>{
    let r=F.newExperiment(frozen,id);
    for(const branch of ["A","B"]){
      const conv="conv-ok-"+branch.toLowerCase()+"-0001";
      const evs=[
        {operationId:"opo_"+branch+"_0001",status:"pending",phase:"created",evidence:{tabId:1}},
        {operationId:"opo_"+branch+"_ack001",status:"pending",phase:"awaiting_send",
         evidence:{tabId:1,inputLevel:"exact",prefill:"exact_ack",
           sessionId:"chat-ok-"+branch.toLowerCase(),conversationId:conv}},
        {operationId:"opo_"+branch+"_done01",status:"done",phase:"capturing",
         evidence:{tabId:1,inputLevel:"exact",prefill:"exact_ack",
           sessionId:"chat-ok-"+branch.toLowerCase(),conversationId:conv,
           captureComplete:true,persisted:true,taskCount:1,reply:branch+" reply",
           endSignals:["final","generation"]}}];
      for(const ev of evs){
        r=F.advance(r,{branch,expectedRevision:r.revision,attemptId:"att_ok_"+branch,...ev});
      }
    }
    r.createOperationId="opo_create00001";
    return r;
  };
  const exp=await build("ff_ok_snap00001");
  const decision=await F.assignMapping(exp,"okseed000001");
  const snapshot=F.exportSnapshot({...exp,decision});
  delete snapshot.branches.A.attempts.at(-1).evidence.reply;
  await assert.rejects(()=>F.validateImport(snapshot),/done attempt response incomplete/);
});
