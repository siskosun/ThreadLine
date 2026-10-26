#!/usr/bin/env node
/**
 * ThreadLine pilot/2: preregistered three-arm feasibility SCREEN, not a proof.
 * B affected conclusions are recomputed with Research.impacts, not trusted from
 * user observations. Case (not event) is the uncertainty resampling unit.
 *
 * Usage: node scripts/evaluate-pilot2.mjs PROTOCOL.json OBSERVATIONS.json [OUT.json]
 */
import {readFileSync,writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";
import {createRequire} from "node:module";
import {classifyImpacts,TIER_RULE_ID} from "./pilot2-tier-rule.mjs";
const require=createRequire(import.meta.url);
const Research=require("../threadline-extension/research-core.js");
const sha256=raw=>createHash("sha256").update(raw).digest("hex");
const TIER_RULE_SHA=sha256(readFileSync(fileURLToPath(new URL("./pilot2-tier-rule.mjs",import.meta.url))));
const fail=reason=>{throw Error(reason);};
const unique=x=>Array.isArray(x)&&new Set(x).size===x.length;
const set=x=>new Set(x||[]);
const median=x=>{const a=[...x].sort((a,b)=>a-b);return a.length? (a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
const mean=x=>x.length?x.reduce((a,b)=>a+b,0)/x.length:null;
const score=(predict,gold)=>{
 const a=set(predict),b=set(gold);
 return {tp:[...a].filter(v=>b.has(v)).length,fp:[...a].filter(v=>!b.has(v)).length,fn:[...b].filter(v=>!a.has(v)).length};
};
const ratio=(a,b)=>b>0?a/b:null;
const validId=x=>typeof x==="string"&&/^[a-zA-Z0-9_-]{1,128}$/.test(x);
const ARM=["A","B","C"];
function validateProtocol(p) {
 if(p?.format!=="threadline-pilot2-protocol/1"||p.status!=="FROZEN"||!Array.isArray(p.cases)||p.cases.length<6)
  fail("协议必须在执行前冻结，包含至少 6 个研究案例");
 if(typeof p.freeze?.at!=="string"||!p.freeze?.commitSha||!p.freeze?.reviewedBy)
  fail("冻结缺少时间、Git commit 和预审人员；不能以结果反向更改真值");
 if(p.freeze.ruleFrozenBeforeScoring!==true || p.tierRuleId!==TIER_RULE_ID ||
    p.tierRuleSha256!==TIER_RULE_SHA)
  fail("分层规则版本或 SHA 不匹配，必须在真值评分之前冻结准确规则字节");
 const seenCases=new Set(),seenEvents=new Set();
 let total=0,dual=0,critical=0;
 for(const c of p.cases) {
  if(!validId(c.id)||seenCases.has(c.id)||!validId(c.projectId))fail("案例 ID/课题无效或重复");
  seenCases.add(c.id);
  if(!unique(c.order)||c.order.length!==3||ARM.some(x=>!c.order.includes(x)))fail("案例缺少三臂交叉顺序");
  if(!Array.isArray(c.events)||c.events.length<5)fail("每例至少预注册 5 次变化事件");
  if(!Array.isArray(c.goldNecessaryEdgePairs)||!unique(c.goldNecessaryEdgePairs.map(x=>x.join("=>"))))
   fail("必要边真值必须预先登记且不能重复");
  for(const pair of c.goldNecessaryEdgePairs)if(!Array.isArray(pair)||pair.length!==2||pair.some(x=>!validId(x)))fail("必要边真值格式无效");
  if(Array.isArray(c.independentAnnotations)&&c.independentAnnotations.length>=2&&c.independentAnnotations.every(a=>a?.independent===true&&validId(a.annotatorId)&&typeof a.submittedAt==="string")&&unique(c.independentAnnotations.map(a=>a.annotatorId))) dual++;
  for(const e of c.events) {
   const k=c.id+"/"+e.id;
   if(!validId(e.id)||seenEvents.has(k)||!validId(e.rootConclusionId)||!unique(e.goldAffectedIds)||!Array.isArray(e.goldAffectedIds))fail("变化事件/影响真值无效");
   seenEvents.add(k);
   if(!["premise_error","definition_change","source_lost","withdraw","wording_only","unrelated"].includes(e.kind))fail("变化类型无效");
   if(!e.frozenState?.projects?.[c.projectId]||!e.frozenState?.conclusions?.[e.rootConclusionId])fail("B 臂缺少事先冻结的真实图状态");
   if(typeof e.sourceCorpusSha256!=="string"||!/^[a-f0-9]{64}$/.test(e.sourceCorpusSha256))fail("每次变化必须预先冻结原始资料 SHA-256");
   if(e.goldAffectedIds.includes(e.rootConclusionId))fail("下游真值不能把变化根结论自身算作依赖影响");
   if(!e.goldMateriality||typeof e.goldMateriality!=="object"||Array.isArray(e.goldMateriality)||
      Object.keys(e.goldMateriality).length!==e.goldAffectedIds.length||
      e.goldAffectedIds.some(id=>!["substantive","non_substantive"].includes(e.goldMateriality[id]))||
      Object.keys(e.goldMateriality).some(id=>!e.goldAffectedIds.includes(id)))
      fail("G* 每一项目须在冻结前标注实质或非实质，不能给误报虚构真值标签");
   if(!Array.isArray(e.goldCriticalIds)||!unique(e.goldCriticalIds)||
      e.goldCriticalIds.some(id=>e.goldMateriality[id]!=="substantive")||
      (e.critical===true&&e.goldCriticalIds.length===0))
      fail("关键目标必须是实质 G* 的子集并在冻结前逐项登记");
   if(!["verified","missing","hash_mismatch","unknown"].includes(e.sourceSnapshotStatus))
      fail("缺少冻结的来源核验状态");
   if(e.sourceSnapshotStatus==="verified"&&
      !/^[a-f0-9]{64}$/.test(e.sourceSnapshotEvidenceSha256||""))
      fail("已验证来源须绑定独立快照哈希");
   if(e.handoffIncludedIds!==null&&(!Array.isArray(e.handoffIncludedIds)||
      !unique(e.handoffIncludedIds)||e.handoffIncludedIds.some(id=>e.frozenState.conclusions?.[id]?.projectId!==c.projectId)||
      !/^[a-f0-9]{64}$/.test(e.handoffScopeSha256||"")))
      fail("已核实的交接范围必须是带 SHA 的冻结结论 ID 列表");
   if(e.handoffIncludedIds===undefined)fail("交接范围缺失；未知必须显式记录 null");
   if(e.carryForwardConfirmed===true&&e.kind!=="wording_only")fail("仅措辞承接只能用于 wording_only 事件");
   if(e.critical===true)critical++;
   // Prevent sample construction that accidentally mixes different projects.
   for(const id of e.goldAffectedIds)if(e.frozenState.conclusions?.[id]?.projectId!==c.projectId)fail("真值下游结论不属于该案例");
   total++;
  }
 }
 if(total<30||dual<2)fail("筛选至少需要 30 个变化事件，以及至少 2 例独立双人标注");
 return {cases:p.cases.length,events:total,dualAnnotatedCases:dual,criticalEvents:critical};
}
function bootCaseInterval(rows,property,seed=20261025){
 if(rows.length<2)return null;
 let x=seed>>>0;
 const next=()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296;};
 const vals=[];
 for(let i=0;i<2000;i++) {
  const drawn=Array.from({length:rows.length},()=>rows[Math.floor(next()*rows.length)][property]);
  vals.push(mean(drawn));
 }
 vals.sort((a,b)=>a-b);
 return {lower:vals[49],upper:vals[1949],method:"2,000 fixed-seed case-cluster resamples; descriptive only"};
}
export function evaluateData(protocol,observations,protocolSha256){
 const design=validateProtocol(protocol);
 if(observations?.format!=="threadline-pilot2-observations/1"||observations.status!=="EXECUTED"||
    observations.protocolSha256!==protocolSha256||!/^[a-f0-9]{64}$/.test(protocolSha256))
  fail("观测包未执行、协议 SHA 不匹配或格式不合法；拒绝补填预测集合");
 if(!Array.isArray(observations.records)||observations.records.length!==design.events)
  fail("三臂执行记录必须完整覆盖冻结的每次变化；缺失不能静默排除");
 const byKey=new Map(),receiptIds=new Set();
 for(const item of observations.records) {
  const k=item.caseId+"/"+item.eventId;
  if(byKey.has(k)||!item.arms||Object.keys(item.arms).sort().join(",")!=="A,B,C")
   fail("重复事件或 A/B/C 观测臂不完整");
  const frozenEvent=protocol.cases.find(c=>c.id===item.caseId)?.events.find(e=>e.id===item.eventId);
  if(!frozenEvent)fail("出现冻结协议之外的变化事件");
  for(const arm of ARM) {
   const v=item.arms[arm];
   if(!v||typeof v.correctContinuation!=="boolean"||typeof v.wronglyRevisedTrueClaim!=="boolean"||
      !Number.isFinite(v.elapsedMs)||v.elapsedMs<=0||!Number.isFinite(v.learningMs)||v.learningMs<0||!Number.isSafeInteger(v.humanInterventions)||v.humanInterventions<0||
      !Number.isSafeInteger(v.modelCalls)||v.modelCalls<0||!v.receiptId||typeof v.receiptId!=="string"||
      typeof v.modelVersion!=="string"||!v.modelVersion||
      v.sourceCorpusSha256!==frozenEvent.sourceCorpusSha256)
    fail("三臂均须保留正确性、误改、操作耗时、学习成本、模型信息、原始资料 SHA 与独立收据");
   if(receiptIds.has(v.receiptId))fail("重复使用收据 ID：不同臂/事件必须有独立记录");
   receiptIds.add(v.receiptId);
   if(v.reviewLogComplete!==true || !Array.isArray(v.reviewSegments) ||
      v.reviewSegments.length>200 || !Array.isArray(v.handoffCorrectSubstantiveIds) ||
      !unique(v.handoffCorrectSubstantiveIds))
      fail("缺少完整复核操作日志或独立核对后的最终交接目标清单");
   const substantive=new Set(frozenEvent.goldAffectedIds.filter(id=>
      frozenEvent.goldMateriality[id]==="substantive"));
   if(v.handoffCorrectSubstantiveIds.some(id=>!substantive.has(id)))
      fail("交接纠正目标必须属于冻结的实质 G*，不能自行扩展真值");
   let reviewedMs=0,reviewLearningMs=0;
   for(const segment of v.reviewSegments){
    if(!segment||!validId(segment.targetConclusionId)||
       frozenEvent.frozenState.conclusions?.[segment.targetConclusionId]?.projectId!==
        protocol.cases.find(c=>c.id===item.caseId).projectId||
       !Number.isFinite(segment.elapsedMs)||segment.elapsedMs<=0||
       !Number.isFinite(segment.learningMs)||segment.learningMs<0||
       !segment.receiptId||typeof segment.receiptId!=="string"||
       receiptIds.has(segment.receiptId))
      fail("复核分段必须有可追溯目标、实际耗时、学习时间与独立收据");
    receiptIds.add(segment.receiptId);
    reviewedMs+=segment.elapsedMs;reviewLearningMs+=segment.learningMs;
   }
   if(reviewedMs>v.elapsedMs||reviewLearningMs>v.learningMs)
     fail("复核分段时间大于对应臂的实际记录，禁止重复统计");
   if(arm==="B"){
    if(!Array.isArray(v.deferrals)||v.deferrals.length>200||
       !unique(v.deferrals.map(d=>d.targetConclusionId)))
      fail("暂不处理必须逐事件逐目标登记，不得批量伪造或重复");
    for(const d of v.deferrals){
     if(d?.triggerEventId!==frozenEvent.id||
       frozenEvent.frozenState.conclusions?.[d.targetConclusionId]?.projectId!==
          protocol.cases.find(c=>c.id===item.caseId).projectId||
       typeof d.reason!=="string"||!d.reason.trim()||
       typeof d.receiptId!=="string"||!d.receiptId.trim()||
       receiptIds.has(d.receiptId))
       fail("暂不处理必须有事件身份、理由和独立人工操作收据");
     receiptIds.add(d.receiptId);
    }
   }
   if(arm==="B"&&Object.hasOwn(v,"predictedAffectedIds"))fail("B 的预测集合只能由 Research.impacts 实算，不允许填入");
  }
  const versions=ARM.map(arm=>item.arms[arm].modelVersion);
  if(versions.some(version=>version!==versions[0]))fail("同一事件三臂模型版本不同，不能直接作配对比较");
  byKey.set(k,item);
 }
 let edgesTP=0,edgesFN=0,edgesFP=0,TP=0,FP=0,FN=0,criticalMisses=0;
 let flatBurden=0,mustBurden=0,beforeBurden=0,deferredBurden=0;
 let goldSubstantive=0,mustSubstantive=0,tierCriticalMisses=0;
 let leakedBeforeUse=0,leakedDeferred=0;
 const events=[],cases=[];
 for(const c of protocol.cases) {
  let cTP=0,cFP=0,cFN=0,criticalCaseMisses=0;
  let cFlat=0,cMust=0,cBefore=0,cDeferred=0,cSubstantive=0,cMustSubstantive=0,cTierCritical=0,cLeakedBefore=0,cLeakedDeferred=0;
  const metrics=Object.fromEntries(ARM.map(a=>[a,{correct:[],wrongRevised:[],elapsed:[],learning:[],human:[],calls:[],
    reviewMs:0,reviewWithLearningMs:0,noiseMs:0,noiseWithLearningMs:0,
    allocatedLearningMs:0,correctedTargets:0,substantiveTargets:0}]));
  const registered=new Set();
  const research=c.events[0]?.frozenState?.projects?.[c.projectId]?.research;
  for(const edge of research?.edges||[])if(edge.active)registered.add(edge.upstreamConclusionId+"=>"+edge.downstreamConclusionId);
  const goldPairs=new Set(c.goldNecessaryEdgePairs.map(pair=>pair.join("=>")));
  edgesTP+=[...goldPairs].filter(x=>registered.has(x)).length;
  edgesFN+=[...goldPairs].filter(x=>!registered.has(x)).length;
  edgesFP+=[...registered].filter(x=>!goldPairs.has(x)).length;
  for(const e of c.events){
   const item=byKey.get(c.id+"/"+e.id);if(!item)fail("观测缺失或事件身份改变："+c.id+"/"+e.id);
   // The extension's actual Research.impacts is the only B prediction source.
   // S3 intentionally emits NO change event for a user-confirmed wording-only
   // carry-forward; other events use the production Research.impacts routine.
   const impactRows=e.carryForwardConfirmed===true?[]:
     Research.impacts(e.frozenState,c.projectId,[e.rootConclusionId]);
   const computed=impactRows.map(row=>row.conclusionId);
   const tiered=classifyImpacts(e,impactRows,c.projectId);
   const mustIds=tiered.filter(x=>x.tier==="must_review").map(x=>x.conclusionId);
   const beforeIds=tiered.filter(x=>x.tier==="before_use").map(x=>x.conclusionId);
   const deferredIds=item.arms.B.deferrals.map(x=>x.targetConclusionId);
   const substantive=e.goldAffectedIds.filter(id=>e.goldMateriality[id]==="substantive");
   const mustSet=new Set(mustIds);
   const beforeSet=new Set(beforeIds);
   const deferredSet=new Set(deferredIds);
   const criticalLeaks=e.goldCriticalIds.filter(id=>!mustSet.has(id));
   const substantivelyLeakedBefore=substantive.filter(id=>beforeSet.has(id));
   const substantivelyLeakedDeferred=substantive.filter(id=>deferredSet.has(id));
   const counts=score(computed,e.goldAffectedIds),missed=counts.fn>0&&e.critical===true;
   const mustCovered=substantive.filter(id=>mustSet.has(id)).length;
   cTP+=counts.tp;cFP+=counts.fp;cFN+=counts.fn;if(missed)criticalCaseMisses++;
   cFlat+=computed.length;cMust+=mustIds.length;cBefore+=beforeIds.length;
   cDeferred+=deferredIds.length;cSubstantive+=substantive.length;
   cMustSubstantive+=mustCovered;cTierCritical+=criticalLeaks.length;
   cLeakedBefore+=substantivelyLeakedBefore.length;cLeakedDeferred+=substantivelyLeakedDeferred.length;
   for(const arm of ARM){
    const v=item.arms[arm],m=metrics[arm];
    m.correct.push(Number(v.correctContinuation));m.wrongRevised.push(Number(v.wronglyRevisedTrueClaim));
    m.elapsed.push(v.elapsedMs);m.learning.push(v.learningMs);m.human.push(v.humanInterventions);m.calls.push(v.modelCalls);
    m.correctedTargets+=v.handoffCorrectSubstantiveIds.length;
    m.substantiveTargets+=substantive.length;
    for(const segment of v.reviewSegments){
     m.reviewMs+=segment.elapsedMs;m.reviewWithLearningMs+=segment.elapsedMs+segment.learningMs;
     m.allocatedLearningMs+=segment.learningMs;
     if(e.goldMateriality[segment.targetConclusionId]!=="substantive"){
      m.noiseMs+=segment.elapsedMs;m.noiseWithLearningMs+=segment.elapsedMs+segment.learningMs;
     }
    }
   }
   events.push({caseId:c.id,eventId:e.id,kind:e.kind,critical:e.critical===true,
     predictedAffectedIds:computed,goldAffectedIds:e.goldAffectedIds,goldMateriality:e.goldMateriality,
     ...counts,criticalMiss:missed,
     tiered:{mustReviewIds:mustIds,beforeUseIds:beforeIds,deferredIds,
       flatCount:computed.length,mustReviewCount:mustIds.length,beforeUseCount:beforeIds.length,
       substantiveGoldCount:substantive.length,mustReviewSubstantiveCount:mustCovered,
       criticalMissedIds:criticalLeaks,substantiveLeakedBeforeUseIds:substantivelyLeakedBefore,
       substantiveLeakedDeferredIds:substantivelyLeakedDeferred},
     arms:item.arms});
  }
  TP+=cTP;FP+=cFP;FN+=cFN;criticalMisses+=criticalCaseMisses;
  flatBurden+=cFlat;mustBurden+=cMust;beforeBurden+=cBefore;deferredBurden+=cDeferred;
  goldSubstantive+=cSubstantive;mustSubstantive+=cMustSubstantive;tierCriticalMisses+=cTierCritical;
  leakedBeforeUse+=cLeakedBefore;leakedDeferred+=cLeakedDeferred;
  const outcome=Object.fromEntries(ARM.map(a=>{
   const m=metrics[a];return [a,{correctRate:mean(m.correct),wrongRevisionRate:mean(m.wrongRevised),
     medianElapsedMs:median(m.elapsed),totalElapsedMs:m.elapsed.reduce((a,b)=>a+b,0),
      totalLearningMs:m.learning.reduce((a,b)=>a+b,0),
      totalWithLearningMs:m.elapsed.reduce((a,b)=>a+b,0)+m.learning.reduce((a,b)=>a+b,0),
      meanHumanInterventions:mean(m.human),
      meanModelCalls:mean(m.calls),
      reviewMs:m.reviewMs,reviewWithLearningMs:m.reviewWithLearningMs,
      noiseMs:m.noiseMs,noiseWithLearningMs:m.noiseWithLearningMs,
      unallocatedLearningMs:m.learning.reduce((a,b)=>a+b,0)-m.allocatedLearningMs,
      noiseShare:ratio(m.noiseMs,m.reviewMs),
      noiseShareWithLearning:ratio(m.noiseWithLearningMs,m.reviewWithLearningMs),
      substantiveHandoffCorrectRate:ratio(m.correctedTargets,m.substantiveTargets),
      substantiveHandoffCorrectCount:m.correctedTargets,
      substantiveGoldCount:m.substantiveTargets}];
  }));
  const gainA=ratio(outcome.A.totalWithLearningMs-outcome.B.totalWithLearningMs,outcome.A.totalWithLearningMs);
  const gainC=ratio(outcome.C.totalWithLearningMs-outcome.B.totalWithLearningMs,outcome.C.totalWithLearningMs);
  const gainAWithoutLearning=ratio(outcome.A.totalElapsedMs-outcome.B.totalElapsedMs,outcome.A.totalElapsedMs);
  const gainCWithoutLearning=ratio(outcome.C.totalElapsedMs-outcome.B.totalElapsedMs,outcome.C.totalElapsedMs);
  cases.push({id:c.id,events:c.events.length,tp:cTP,fp:cFP,fn:cFN,criticalMisses:criticalCaseMisses,
   tiered:{flatCount:cFlat,mustReviewCount:cMust,beforeUseCount:cBefore,deferredCount:cDeferred,
    burdenReduction:ratio(cFlat-cMust,cFlat),
    substantiveGoldCount:cSubstantive,mustRecall:ratio(cMustSubstantive,cSubstantive),
    criticalMisses:cTierCritical,leakedBeforeUse:cLeakedBefore,leakedDeferred:cLeakedDeferred},
   arms:outcome,gainBvsA:gainA,gainBvsC:gainC,
   gainBvsAExcludingLearning:gainAWithoutLearning,gainBvsCExcludingLearning:gainCWithoutLearning,
   accuracyDeltaBvsA:outcome.B.correctRate-outcome.A.correctRate,
   accuracyDeltaBvsC:outcome.B.correctRate-outcome.C.correctRate,
   correctedSubstantiveRateB:outcome.B.substantiveHandoffCorrectRate,
   noiseShareDiffBvsA:outcome.B.noiseShareWithLearning!==null&&
     outcome.A.noiseShareWithLearning!==null&&
     outcome.B.unallocatedLearningMs===0&&outcome.A.unallocatedLearningMs===0?
     outcome.B.noiseShareWithLearning-outcome.A.noiseShareWithLearning:null});
 }
 const total=TP+FP,totalGold=TP+FN,edgeGold=edgesTP+edgesFN;
 const recall=ratio(TP,totalGold),precision=ratio(TP,total),dependencyCoverage=ratio(edgesTP,edgeGold);
 const gain=median(cases.map(c=>c.gainBvsA).filter(x=>x!==null));
 const nonSlower=cases.filter(c=>c.gainBvsA!==null&&c.gainBvsA>=0).length;
 const tiers={ruleId:TIER_RULE_ID,ruleSha256:TIER_RULE_SHA,
  flatCount:flatBurden,mustReviewCount:mustBurden,beforeUseCount:beforeBurden,
  deferredCount:deferredBurden,burdenReduction:ratio(flatBurden-mustBurden,flatBurden),
  substantiveGoldCount:goldSubstantive,mustReviewSubstantiveCount:mustSubstantive,
  substantiveRecall:ratio(mustSubstantive,goldSubstantive),
  criticalMisses:tierCriticalMisses,leakedBeforeUse,leakedDeferred,
  eligibleForPilot:tierCriticalMisses===0&&ratio(mustSubstantive,goldSubstantive)!==null&&
    ratio(mustSubstantive,goldSubstantive)>=0.9};
 const reviewNoise=Object.fromEntries(ARM.map(arm=>{
  const rows=cases.map(c=>c.arms[arm]);
  const sum=key=>rows.reduce((total,row)=>total+row[key],0);
  const ms=sum("reviewMs"),msWith=sum("reviewWithLearningMs");
  const correct=sum("substantiveHandoffCorrectCount"),material=sum("substantiveGoldCount");
  return [arm,{reviewMs:ms,reviewWithLearningMs:msWith,
   noiseMs:sum("noiseMs"),noiseWithLearningMs:sum("noiseWithLearningMs"),
   unallocatedLearningMs:sum("unallocatedLearningMs"),
   noiseShare:ratio(sum("noiseMs"),ms),
   noiseShareWithLearning:ratio(sum("noiseWithLearningMs"),msWith),
   substantiveHandoffCorrectRate:ratio(correct,material),
   substantiveHandoffCorrectCount:correct,substantiveGoldCount:material}];
 }));
 // A/B noise comparison is not fully attributable if learning overhead was
 // not tied to inspected targets. Missing attribution is unknown, never zero.
 const pairedNoise=cases.map(c=>c.noiseShareDiffBvsA);
 const noiseShareReference=pairedNoise.every(v=>v!==null)?
   median(pairedNoise)<=0:null;
 const thresholds={
  dependencyCoverage:dependencyCoverage!==null&&dependencyCoverage>=0.9,
  impactRecall:recall!==null&&recall>=0.9,
  impactPrecision:precision!==null&&precision>=0.8,
  zeroCriticalMisses:criticalMisses===0,
  gainAtLeast15Percent:gain!==null&&gain>=0.15,
  nonSlowerAtLeastFourCases:nonSlower>=4,
  bCorrectContinuationBetterThanA:mean(cases.map(c=>c.accuracyDeltaBvsA))>0,
  tierNoCriticalMisses:tiers.criticalMisses===0,
  tierMustRecallAtLeast90Percent:tiers.substantiveRecall!==null&&tiers.substantiveRecall>=0.9,
  nonSubstantiveReviewShareNotHigherThanA:noiseShareReference===true
 };
 // These are PRE-REGISTERED investment screening thresholds, not confidence proof.
 return {format:"threadline-pilot2-feasibility-screen/1",design,screeningOnly:true,
  caveat:"Pilot/2 has clustered events and small independent case count. Passing screening does not establish population performance or causality.",
  protocolSha256,affected:{tp:TP,fp:FP,fn:FN,recall,precision,criticalMisses},
  necessaryEdges:{tp:edgesTP,fp:edgesFP,fn:edgesFN,coverage:dependencyCoverage},
  tiered:tiers,reviewNoise,noiseShareReference,
  ruleCaveat:"Unknown source or handoff provenance remains MUST. Deferred actions are not confirmations. Learning time not attributable to a review segment is reported separately and cannot be silently assigned to noise.",
  tierLeakageRequiresFlatFallback:!tiers.eligibleForPilot,
  caseSummary:{medianBvsAGain:gain,
    medianBvsAGainExcludingLearning:median(cases.map(c=>c.gainBvsAExcludingLearning).filter(x=>x!==null)),
    nonSlowerCases:nonSlower,totalCases:cases.length,
   meanAccuracyDeltaBvsA:mean(cases.map(c=>c.accuracyDeltaBvsA)),
   meanAccuracyDeltaBvsC:mean(cases.map(c=>c.accuracyDeltaBvsC)),
   clusterIntervals:{deltaBvsA:bootCaseInterval(cases,"accuracyDeltaBvsA"),
    deltaBvsC:bootCaseInterval(cases,"accuracyDeltaBvsC"),
    noiseShareDiffBvsA:bootCaseInterval(cases.filter(c=>c.noiseShareDiffBvsA!==null),"noiseShareDiffBvsA"),
    correctedSubstantiveRateB:bootCaseInterval(cases.filter(c=>c.correctedSubstantiveRateB!==null),"correctedSubstantiveRateB")},
   noiseReferencePairedCases:pairedNoise.filter(x=>x!==null).length},
  thresholds,screeningPassed:Object.values(thresholds).every(Boolean),cases,events};
}
async function main(){
 if(process.argv.length<4||process.argv.length>5)
  fail("用法：node scripts/evaluate-pilot2.mjs FROZEN_PROTOCOL.json EXECUTED_OBSERVATIONS.json [RESULT.json]");
 const raw=readFileSync(resolve(process.argv[2]));
 const result=evaluateData(JSON.parse(raw.toString("utf8")),
  JSON.parse(readFileSync(resolve(process.argv[3]),"utf8")),sha256(raw));
 const out=JSON.stringify(result,null,2)+"\n";
 if(process.argv[4])writeFileSync(resolve(process.argv[4]),out,{flag:"wx"});
 else process.stdout.write(out);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
 main().catch(e=>{process.stderr.write("PILOT2_REJECTED: "+e.message+"\n");process.exitCode=1;});
