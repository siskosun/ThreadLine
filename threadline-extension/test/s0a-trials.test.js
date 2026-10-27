const test=require("node:test");
const assert=require("node:assert/strict");
const P=require("../s0a-trials.js");

function rows(){
  return P.TYPES.map((caseType,i)=>({
    caseNumber:i+1,caseType,operatorCode:"P01",
    nonDesigner:i<4,assisted:false,taskConfirmed:true,
    elapsedMs:10000+i*500,outcome:"committed"
  }));
}
test("S0a human protocol explicitly separates 6 direct and 6 correction/missing tasks",()=>{
  assert.deepEqual([...P.TYPES].reduce((a,x)=>(a[x]=(a[x]||0)+1,a),{}),
    {direct:6,correct:3,missing_source:3});
  assert.equal(P.summarize([]).gate,"INCOMPLETE");
  assert.equal(P.summarize([]).thresholdsMet,false);
});
test("human metrics are only eligible for independent review, never automatically accepted",()=>{
  const s=P.summarize(rows());
  assert.equal(s.complete,true);
  assert.equal(s.eligibleCommitted,12);
  assert.equal(s.unassisted,12);
  assert.equal(s.nonDesignerOperations,4);
  assert.equal(s.medianMs,12750);
  assert.equal(s.p90Ms,15000);
  assert.equal(s.thresholdsMet,true);
  assert.equal(s.gate,"HUMAN_REVIEW_REQUIRED");
  assert.ok(!Object.prototype.hasOwnProperty.call(s,"passed"));
});
test("automatic, duplicate, fabricated and incomplete observations cannot pass as human",()=>{
  let r=rows();r[0].outcome="synthetic_write";assert.equal(P.summarize(r).thresholdsMet,false);
  r=rows();r[0].taskConfirmed=false;assert.equal(P.summarize(r).thresholdsMet,false);
  r=rows();r[0].operatorCode="";assert.equal(P.summarize(r).thresholdsMet,false);
  r=rows();r[1].caseNumber=1;assert.equal(P.summarize(r).caseIntegrity,false);
  r=rows();r[0].caseType="direct";r[6].caseType="direct";assert.equal(P.summarize(r).caseIntegrity,false);
  r=rows();r.pop();assert.equal(P.summarize(r).gate,"INCOMPLETE");
});
test("help and non-designer coverage are separate requirements",()=>{
  let r=rows();r[0].assisted=true;assert.equal(P.summarize(r).thresholdsMet,true);
  r[1].assisted=true;assert.equal(P.summarize(r).thresholdsMet,false);
  r=rows();r[3].nonDesigner=false;assert.equal(P.summarize(r).thresholdsMet,false);
  r=rows();r[0].elapsedMs=90000;
  assert.equal(P.summarize(r).thresholdsMet,true,
    "one outlier does not move nearest-rank P90 in 12 observations");
  r[1].elapsedMs=90000;
  assert.equal(P.summarize(r).thresholdsMet,false,
    "two outliers do move the 11th order statistic above 60 seconds");
  r=rows();r[0].elapsedMs=NaN;assert.equal(P.summarize(r).thresholdsMet,false);
});
test("timing statistics exclude unknown attempts without silently treating unknown as success",()=>{
  const r=rows();r[6].outcome="unknown";r[6].elapsedMs=5000;
  const s=P.summarize(r);
  assert.equal(s.complete,true);
  assert.equal(s.eligibleCommitted,11);
  assert.equal(s.thresholdsMet,false);
  assert.equal(s.gate,"HUMAN_REVIEW_REQUIRED");
});
