const assert=require('node:assert/strict');
const test=require('node:test');
const {pathToFileURL}=require('node:url');

const evaluator=import(pathToFileURL(require('node:path').resolve(__dirname,'../../scripts/evaluate-dependencies.mjs')).href);
const edge=(upstreamConclusionId,downstreamConclusionId)=>({upstreamConclusionId,downstreamConclusionId});
function fixture(){
  return {protocolVersion:'threadline-s2-pilot/1',cases:[{id:'case_one',conclusionIds:['con_alpha001','con_bravo001','con_charlie1'],truthEdges:[edge('con_alpha001','con_bravo001'),edge('con_bravo001','con_charlie1')],criticalTruthEdges:[edge('con_alpha001','con_bravo001')],enteredEdges:[edge('con_alpha001','con_bravo001')],events:[{id:'changed-1',changedIds:['con_alpha001'],truthAffected:['con_bravo001','con_charlie1'],criticalAffected:['con_bravo001']}],operationLog:[{kind:'registration',startMs:0,endMs:10,baselineMs:10},{kind:'review',startMs:10,endMs:20,baselineMs:10},{kind:'continuation',startMs:20,endMs:30,baselineMs:20,correct:true}]}]};
}
test('predictions are derived from entered edges and change when the entered graph changes',async()=>{
  const {evaluate}=await evaluator,partial=evaluate(fixture());
  assert.deepEqual(partial.cases[0].impacts[0].predictedAffected,['con_bravo001']);
  assert.deepEqual(partial.cases[0].impacts[0].fn,['con_charlie1']);
  const complete=fixture();complete.cases[0].enteredEdges.push(edge('con_bravo001','con_charlie1'));
  const result=evaluate(complete);
  assert.deepEqual(result.cases[0].impacts[0].predictedAffected,['con_bravo001','con_charlie1']);
  assert.equal(result.metrics.impactRecall,1);
});
test('a supplied prediction cannot forge an impact result',async()=>{
  const {evaluate}=await evaluator,forged=fixture();
  forged.cases[0].events[0].predictedAffected=['con_bravo001','con_charlie1'];
  assert.throws(()=>evaluate(forged),/predictedAffected is forbidden/);
});
test('empty denominators are null and malformed graph truth is rejected',async()=>{
  const {evaluate}=await evaluator,empty=fixture();
  empty.cases[0].truthEdges=[];empty.cases[0].criticalTruthEdges=[];empty.cases[0].enteredEdges=[];empty.cases[0].events[0].truthAffected=[];empty.cases[0].events[0].criticalAffected=[];
  const result=evaluate(empty);
  assert.equal(result.metrics.registrationCompleteness,null);
  assert.equal(result.metrics.impactRecall,null);
  assert.equal(result.metrics.impactPrecision,null);
  const cyclic=fixture();cyclic.cases[0].truthEdges=[edge('con_alpha001','con_bravo001'),edge('con_bravo001','con_alpha001')];cyclic.cases[0].enteredEdges=[...cyclic.cases[0].truthEdges];
  assert.throws(()=>evaluate(cyclic),/依赖存在环/);
  const badCritical=fixture();badCritical.cases[0].events[0].criticalAffected=['con_alpha001'];
  assert.throws(()=>evaluate(badCritical),/subset of truthAffected/);
});
