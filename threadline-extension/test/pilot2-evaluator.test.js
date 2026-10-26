const test=require("node:test");
const assert=require("node:assert/strict");
const {createHash}=require("node:crypto");
const {readFileSync}=require("node:fs");
const {resolve}=require("node:path");
const evaluate=import("../../scripts/evaluate-pilot2.mjs");
let evaluateData;
test.before(async()=>{({evaluateData}=await evaluate);});
const digest=x=>createHash("sha256").update(x).digest("hex");
function fixture(){
 const protocol={format:"threadline-pilot2-protocol/1",status:"FROZEN",
   freeze:{at:"2026-10-25T08:00:00Z",commitSha:"synthetic-commit",reviewedBy:"synthetic-independent-human",
     ruleFrozenBeforeScoring:true},tierRuleId:"threadline-s2-tier/1",
   tierRuleSha256:digest(readFileSync(resolve(__dirname,"../../scripts/pilot2-tier-rule.mjs"))),
   cases:[]},observations={format:"threadline-pilot2-observations/1",status:"EXECUTED",records:[]};
 for(let i=0;i<6;i++){
  const projectId="p_synthetic_"+i,root="con_root"+String(i).padStart(8,"0"),
    dependent="con_child"+String(i).padStart(8,"0"),unrelated="con_isolated"+String(i).padStart(8,"0");
  const research={schema:1,edges:[{id:"dep_synthetic"+String(i).padStart(8,"0"),active:true,revision:1,
    projectId,upstreamConclusionId:root,downstreamConclusionId:dependent,type:"necessary"}],
    confirmations:[],events:[],reviews:[]};
  const conclusions=Object.fromEntries([root,dependent,unrelated].map(id=>[id,{id,projectId,currentVersionId:"ver_"+id,status:"adopted"}]));
  const frozenState={projects:{[projectId]:{research}},conclusions,versions:{}};
  const c={id:"case_"+i,projectId,order:i%2?["C","B","A"]:["A","B","C"],
    independentAnnotations:[
      {annotatorId:"rater_alpha",independent:true,submittedAt:"2026-10-25T01:00:00Z",
        annotationSha256:digest("rater-alpha-independent-original-"+i)},
      ...(i<2?[{annotatorId:"rater_beta",independent:true,submittedAt:"2026-10-25T02:00:00Z",
        annotationSha256:digest("rater-beta-independent-original-"+i)}]:[])
    ],
    adjudication:i<2?{reviewedBy:"rater_adjudicator",disagreementsResolved:true,
      resolvedAt:"2026-10-25T03:00:00Z",resolutionSha256:digest("blind-resolution-"+i)}:undefined,
    goldNecessaryEdgePairs:[[root,dependent]],events:[]};
  const kinds=["premise_error","definition_change","source_lost","wording_only","unrelated"];
  for(let j=0;j<kinds.length;j++){
   const kind=kinds[j],sourceCorpusSha256=digest("shared synthetic source "+i+"/"+j),carryForwardConfirmed=kind==="wording_only",
      rootConclusionId=kind==="unrelated"?unrelated:root,goldAffectedIds=j<3?[dependent]:[];
   c.events.push({id:"event_"+j,kind,observedChangeKind:"amend",rootConclusionId,critical:j===0,sourceCorpusSha256,carryForwardConfirmed,
     goldAffectedIds,goldMateriality:Object.fromEntries(goldAffectedIds.map(id=>[id,"substantive"])),
     goldCriticalIds:j===0?[dependent]:[],sourceSnapshotStatus:"verified",
     sourceSnapshotEvidenceSha256:digest("source-snapshot-"+i+"-"+j),
     handoffIncludedIds:[],handoffScopeSha256:digest("handoff-scope-"+i+"-"+j),frozenState});
   const record={caseId:c.id,eventId:"event_"+j,arms:{
    A:{correctContinuation:false,wronglyRevisedTrueClaim:false,elapsedMs:100000,learningMs:0,humanInterventions:3,modelCalls:2,
      receiptId:"synthetic-A-"+i+"-"+j,modelVersion:"synthetic",sourceCorpusSha256},
    B:{correctContinuation:true,wronglyRevisedTrueClaim:false,elapsedMs:70000,learningMs:0,humanInterventions:1,modelCalls:1,
      receiptId:"synthetic-B-"+i+"-"+j,modelVersion:"synthetic",sourceCorpusSha256},
    C:{correctContinuation:false,wronglyRevisedTrueClaim:true,elapsedMs:120000,learningMs:0,humanInterventions:4,modelCalls:3,
      receiptId:"synthetic-C-"+i+"-"+j,modelVersion:"synthetic",sourceCorpusSha256}
   }};
   for(const arm of ["A","B","C"]){
    const v=record.arms[arm];
    v.reviewLogComplete=true;
    v.reviewSegments=[{targetConclusionId:j<3?dependent:unrelated,
      elapsedMs:arm==="A"?15000:arm==="B"?10000:20000,learningMs:0,
      receiptId:"synthetic-review-"+arm+"-"+i+"-"+j}];
    v.handoffCorrectSubstantiveIds=j<3&&arm==="B"?[dependent]:[];
    if(arm==="B")v.deferrals=[];
   }
   observations.records.push(record);
  }
  protocol.cases.push(c);
 }
 const raw=JSON.stringify(protocol),hash=digest(raw);
 observations.protocolSha256=hash;
 return {protocol,observations,hash};
}
test("synthetic six-case pilot/2 gives case/event metrics and matches production graph",()=>{
 const {protocol,observations,hash}=fixture();
 const result=evaluateData(protocol,observations,hash);
 assert.equal(result.design.cases,6);
 assert.equal(result.design.events,30);
 assert.equal(result.design.dualAnnotatedCases,2);
 assert.deepEqual(result.affected,{tp:18,fp:0,fn:0,recall:1,precision:1,criticalMisses:0});
 assert.equal(result.necessaryEdges.coverage,1);
 assert.equal(result.events.length,30);
 assert.deepEqual(result.events.find(x=>x.kind==="wording_only").predictedAffectedIds,[]);
 assert.deepEqual(result.events.find(x=>x.kind==="unrelated").predictedAffectedIds,[]);
 assert.equal(result.caseSummary.nonSlowerCases,6);
 assert.equal(result.screeningOnly,true);
 assert.equal(result.screeningPassed,true);
});
test("rejects user-supplied B prediction, even if it exactly matches truth",()=>{
 const {protocol,observations,hash}=fixture();
 observations.records[0].arms.B.predictedAffectedIds=protocol.cases[0].events[0].goldAffectedIds;
 assert.throws(()=>evaluateData(protocol,observations,hash),/B 的预测集合只能/);
});
test("rejects unexecuted template and unmatched frozen protocol digest",()=>{
 const {protocol,observations,hash}=fixture();
 observations.status="NOT_EXECUTED";
 assert.throws(()=>evaluateData(protocol,observations,hash),/未执行/);
 observations.status="EXECUTED";
 assert.throws(()=>evaluateData(protocol,observations,"f".repeat(64)),/SHA 不匹配/);
});
test("rejects insufficient cases, missing dual rater, and incomplete three-arm rows",()=>{
 const {protocol,observations,hash}=fixture();
 protocol.cases.pop();
 assert.throws(()=>evaluateData(protocol,observations,hash),/至少 6 个/);
 const a=fixture();
 a.protocol.cases[1].independentAnnotations=[];
 assert.throws(()=>evaluateData(a.protocol,a.observations,a.hash),/独立双人标注/);
 const b=fixture();
 delete b.observations.records[0].arms.C;
 assert.throws(()=>evaluateData(b.protocol,b.observations,b.hash),/三臂执行记录|A\/B\/C/);
});
test("actual impacted ids cannot be replaced by gold labels",()=>{
 const {protocol,observations,hash}=fixture();
 protocol.cases[0].events[0].goldAffectedIds=[];
 protocol.cases[0].events[0].goldMateriality={};
 protocol.cases[0].events[0].goldCriticalIds=[];
 protocol.cases[0].events[0].critical=false;
 observations.records[0].arms.B.handoffCorrectSubstantiveIds=[];
 const result=evaluateData(protocol,observations,hash);
 assert.equal(result.affected.fp,1);
 assert.equal(result.affected.tp,17);
 assert.equal(result.events[0].predictedAffectedIds[0],protocol.cases[0].goldNecessaryEdgePairs[0][1]);
});
test("cluster comparisons use independent cases, not thirty independent trials",()=>{
 const {protocol,observations,hash}=fixture();
 const result=evaluateData(protocol,observations,hash);
 assert.equal(result.cases.length,6);
 assert.equal(result.caseSummary.meanAccuracyDeltaBvsA,1);
 assert.equal(result.caseSummary.clusterIntervals.deltaBvsA.method.includes("case-cluster"),true);
 assert.equal(result.caseSummary.medianBvsAGain,0.3);
});

test("learning overhead is included in screening and separately disclosed",()=>{
 const {protocol,observations,hash}=fixture();
 observations.records[0].arms.B.learningMs=50000;
 const result=evaluateData(protocol,observations,hash);
 assert.equal(result.cases[0].gainBvsA,0.2);
 assert.equal(result.cases[0].gainBvsAExcludingLearning,0.3);
 assert.equal(result.caseSummary.medianBvsAGainExcludingLearning,0.3);
 delete observations.records[0].arms.B.learningMs;
 assert.throws(()=>evaluateData(protocol,observations,hash),/学习成本/);
});

test("independent annotation receipts and adjudication must precede freeze",()=>{
 const missing=fixture();
 delete missing.protocol.cases[0].independentAnnotations[0].annotationSha256;
 assert.throws(()=>evaluateData(missing.protocol,missing.observations,missing.hash),/原始收据哈希/);
 const unresolved=fixture();
 delete unresolved.protocol.cases[0].adjudication.resolutionSha256;
 assert.throws(()=>evaluateData(unresolved.protocol,unresolved.observations,unresolved.hash),/分歧裁定哈希/);
 const late=fixture();
 late.protocol.cases[0].adjudication.resolvedAt="2026-10-25T09:00:00Z";
 assert.throws(()=>evaluateData(late.protocol,late.observations,late.hash),/分歧裁定哈希/);
 const duplicate=fixture();
 duplicate.protocol.cases[0].independentAnnotations[1].annotationSha256=
  duplicate.protocol.cases[0].independentAnnotations[0].annotationSha256;
 assert.throws(()=>evaluateData(duplicate.protocol,duplicate.observations,duplicate.hash),/原始收据哈希/);
});
test("alternative impact path must not mask a direct necessary-edge review",()=>{
 const {protocol,observations,hash}=fixture();
 const c=protocol.cases[0],e=c.events[0],mid="con_aa00000001",target=e.goldAffectedIds[0];
 e.frozenState=structuredClone(e.frozenState);
 e.frozenState.conclusions[mid]={
   id:mid,projectId:c.projectId,currentVersionId:"ver_"+mid,status:"adopted"};
 e.frozenState.projects[c.projectId].research.edges.push(
   {id:"dep_altfirst0001",active:true,revision:1,projectId:c.projectId,
    upstreamConclusionId:e.rootConclusionId,downstreamConclusionId:mid,type:"necessary"},
   {id:"dep_altlast0001",active:true,revision:1,projectId:c.projectId,
    upstreamConclusionId:mid,downstreamConclusionId:target,type:"necessary"}
 );
 const result=evaluateData(protocol,observations,hash);
 const row=result.events[0];
 assert.ok(row.predictedAffectedIds.includes(mid));
 assert.ok(row.predictedAffectedIds.includes(target));
 assert.ok(row.tiered.mustReviewIds.includes(target),
   "the alternate indirect route cannot hide the direct necessary dependency");
 assert.equal(row.tiered.criticalMissedIds.length,0);
});
test("tier rule is byte-pinned and does not use materiality gold as priority input",()=>{
 const {protocol,observations,hash}=fixture();
 protocol.tierRuleSha256="f".repeat(64);
 assert.throws(()=>evaluateData(protocol,observations,hash),/分层规则版本或 SHA/);
 const good=fixture();
 assert.equal(evaluateData(good.protocol,good.observations,good.hash).tiered.eligibleForPilot,true);
 good.protocol.cases[0].events[0].goldMateriality[good.protocol.cases[0].events[0].goldAffectedIds[0]]="non_substantive";
 good.protocol.cases[0].events[0].goldCriticalIds=[];
 good.protocol.cases[0].events[0].critical=false;
 good.observations.records[0].arms.B.handoffCorrectSubstantiveIds=[];
 const result=evaluateData(good.protocol,good.observations,good.hash);
 assert.equal(result.events[0].tiered.mustReviewCount,1,"gold label cannot rewrite frozen graph prediction");
 const oracle=fixture();
 oracle.protocol.cases[0].events[0].kind="wording_only";
 oracle.protocol.cases[0].events[0].carryForwardConfirmed=false;
 const noPeek=evaluateData(oracle.protocol,oracle.observations,oracle.hash);
 assert.equal(noPeek.events[0].tiered.mustReviewCount,1,
   "a different gold scenario label must not alter priority when observed change is the same");
 assert.equal(result.events[0].tiered.substantiveGoldCount,0);
});
test("two-hop substantive critical miss falls back to flat while keeping all impact paths",()=>{
 const {protocol,observations,hash}=fixture();
 const c=protocol.cases[0],e=c.events[0],mid="con_mid00000001",target=e.goldAffectedIds[0];
 e.frozenState=structuredClone(e.frozenState);
 e.frozenState.conclusions[mid]={id:mid,projectId:c.projectId,currentVersionId:"ver_"+mid,status:"adopted"};
 e.frozenState.projects[c.projectId].research.edges=[
  {id:"dep_parent00001",active:true,revision:1,projectId:c.projectId,upstreamConclusionId:e.rootConclusionId,downstreamConclusionId:mid,type:"necessary"},
  {id:"dep_child00001",active:true,revision:1,projectId:c.projectId,upstreamConclusionId:mid,downstreamConclusionId:target,type:"necessary"}
 ];
 const result=evaluateData(protocol,observations,hash);
 const event=result.events[0];
 assert.equal(event.tiered.flatCount,2);
 assert.equal(event.tiered.mustReviewCount,1);
 assert.ok(event.tiered.beforeUseIds.includes(target));
 assert.ok(event.tiered.criticalMissedIds.includes(target));
 assert.ok(result.tiered.criticalMisses>0);
 assert.equal(result.tiered.eligibleForPilot,false);
 assert.equal(result.tierLeakageRequiresFlatFallback,true);
});
test("review segment attribution, corrections and deferrals require auditable identities",()=>{
 const a=fixture();a.observations.records[0].arms.B.reviewSegments[0].elapsedMs=1e9;
 assert.throws(()=>evaluateData(a.protocol,a.observations,a.hash),/复核分段时间大于/);
 const b=fixture();b.observations.records[0].arms.B.handoffCorrectSubstantiveIds=["con_fabricated"];
 assert.throws(()=>evaluateData(b.protocol,b.observations,b.hash),/交接纠正目标必须属于/);
 const c=fixture();c.observations.records[0].arms.B.deferrals=[{
  triggerEventId:"event_0",targetConclusionId:c.protocol.cases[0].events[0].goldAffectedIds[0],
  targetVersionId:c.protocol.cases[0].events[0].frozenState.conclusions[c.protocol.cases[0].events[0].goldAffectedIds[0]].currentVersionId,
  reason:"下次决策前再核对",receiptId:"synthetic-deferral-001"}];
 const result=evaluateData(c.protocol,c.observations,c.hash);
 assert.equal(result.events[0].tiered.deferredIds.length,1);
 assert.equal(result.events[0].tiered.mustReviewCount,1,"explicit defer must not erase the safety priority");
 assert.equal(result.tiered.leakedDeferred,1);
 c.observations.records[0].arms.B.deferrals[0].reason="";
 assert.throws(()=>evaluateData(c.protocol,c.observations,c.hash),/暂不处理必须有事件身份/);
 c.observations.records[0].arms.B.deferrals[0].reason="理由已恢复";
 c.observations.records[0].arms.B.deferrals[0].targetVersionId="ver_wrong";
 assert.throws(()=>evaluateData(c.protocol,c.observations,c.hash),/暂不处理必须有事件身份/);
});
test("noise time excludes unknown learning allocation and is compared to A case by case",()=>{
 const a=fixture();const out=evaluateData(a.protocol,a.observations,a.hash);
 assert.equal(out.reviewNoise.B.noiseMs,6*2*10000);
 assert.equal(out.reviewNoise.A.noiseMs,6*2*15000);
 assert.equal(out.noiseShareReference,true);
 assert.equal(out.reviewNoise.B.substantiveHandoffCorrectRate,1);
 const b=fixture();b.observations.records[0].arms.B.learningMs=3000;
 const unknown=evaluateData(b.protocol,b.observations,b.hash);
 assert.equal(unknown.noiseShareReference,null,"unallocated learning must remain unknown");
 assert.equal(unknown.thresholds.nonSubstantiveReviewShareNotHigherThanA,false);
});
