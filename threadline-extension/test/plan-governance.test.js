'use strict';
// Negative controls: plan completion claims must fail without real evidence.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {pathToFileURL} = require('node:url');

const ROOT = path.resolve(__dirname, '../..');
const MOD = path.join(ROOT, 'scripts', 'check-plan.mjs');
const fixtureFiles = [
  'docs/PLAN.md','AGENTS.md','docs/ff/DEVELOPMENT_PLAN.md','docs/ff/BLOCKED.md',
  // Canonical done evidence must travel with PLAN fixtures once a task is done,
  // together with every test file its test_cases reference.
  'docs/ff/evidence/R-REUSE.json',
  'docs/ff/evidence/P1-CORE.json',
  'docs/ff/evidence/Z0-BASE.json',
  'docs/ff/evidence/Z0-LIVE.json',
  'threadline-extension/test/ff-core.test.js',
  'threadline-extension/test/ff-db.test.js',
  'threadline-extension/test/ff-background-toggle.test.js',
  'threadline-extension/test/check-syntax-portable.test.js',
  'threadline-extension/test/extension-e2e.py'
];

async function checks() { return import(pathToFileURL(MOD).href); }
function fixture() {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'threadline-plan-'));
  for(const name of fixtureFiles){
    const source=path.join(ROOT,name);
    if(!fs.existsSync(source)) continue;
    fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});
    fs.copyFileSync(source,path.join(dir,name));
  }
  return dir;
}
function withFixture(fn){
  const dir=fixture();
  try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
function edit(dir,file,modify){
  const target=path.join(dir,file);
  fs.writeFileSync(target,modify(fs.readFileSync(target,'utf8')),'utf8');
}
function rowChange(source,id,fn){
  return source.split('\n').map(line=>line.startsWith('| '+id+' |')?fn(line):line).join('\n');
}
function mock(body){return {ok:true,status:200,json:async()=>body};}

test('canonical plan contains all required tasks and no unverified done claims', async()=>{
  const {validatePlan}=await checks();
  const actual=validatePlan(ROOT);
  assert.equal(actual.tasks.length,8);
  // Done claims must stay limited to tasks with real merged-PR evidence JSONs.
  assert.deepEqual(actual.done.map(x=>x.task.id).sort(),['P1-CORE','R-REUSE','Z0-BASE','Z0-LIVE']);
  // First-phase execution tasks stay gated until their own evidence lands.
  assert.equal(actual.tasks.find(x=>x.id==='P2-FORK').status,'planned');
  assert.equal(actual.tasks.find(x=>x.id==='P3-REPORT').status,'planned');
  assert.notEqual(actual.tasks.find(x=>x.id==='BETA-RELEASE').status,'done');
  assert.notEqual(actual.tasks.find(x=>x.id==='P2-FORK').status,'done');
});

test('missing/duplicate plan markers and missing tasks are rejected',async()=>{
  const {validatePlan}=await checks();
  withFixture(dir=>{
    edit(dir,'docs/PLAN.md',s=>s.replace('<!-- PLAN_TASKS_START -->','<!-- VANISHED -->'));
    assert.throws(()=>validatePlan(dir),/markers/);
  });
  withFixture(dir=>{
    edit(dir,'docs/PLAN.md',s=>s.replace(/^\| P2-FORK \|[^\r\n]*(?:\r?\n|$)/m,''));
    assert.throws(()=>validatePlan(dir),/required task IDs/);
  });
});

test('a task cannot advance while its hard dependencies are incomplete',async()=>{
  const {validatePlan}=await checks();
  withFixture(dir=>{
    // P3-REPORT still depends on P2-FORK, which is planned.
    edit(dir,'docs/PLAN.md',s=>rowChange(s,'P3-REPORT',
      line=>line.replace(' | planned | ',' | in_review | ').replace(' | - | yes |',' | PR#99 | yes |')));
    assert.throws(()=>validatePlan(dir),/dependency is not done/);
  });
});

test('marking done without an evidence JSON fails, even if the agent says it passed',async()=>{
  const {validatePlan}=await checks();
  withFixture(dir=>{
    // P1-CORE is done with a canonical JSON; removing the JSON must fail validation.
    fs.rmSync(path.join(dir,'docs/ff/evidence/P1-CORE.json'),{force:true});
    assert.throws(()=>validatePlan(dir),/missing evidence file/);
  });
  withFixture(dir=>{
    fs.rmSync(path.join(dir,'docs/ff/evidence/R-REUSE.json'),{force:true});
    assert.throws(()=>validatePlan(dir),/missing evidence file/);
  });
});

test('blocked tasks require a concrete blocker and legacy plan must redirect',async()=>{
  const {validatePlan}=await checks();
  withFixture(dir=>{
    // Manufacture a blocked task, then remove its explanation: must fail.
    edit(dir,'docs/PLAN.md',s=>rowChange(s,'P2-FORK',
      line=>line.replace(' | planned | ',' | blocked | ').replace(' | - | yes |',' | docs/ff/BLOCKED.md | yes |')));
    edit(dir,'docs/ff/BLOCKED.md',s=>s.replaceAll('P2-FORK','not-on-list'));
    assert.throws(()=>validatePlan(dir),/blocked task not explained/);
  });
  withFixture(dir=>{
    edit(dir,'docs/ff/DEVELOPMENT_PLAN.md',()=>('old full plan '.repeat(200)));
    assert.throws(()=>validatePlan(dir),/historical DEVELOPMENT_PLAN/);
  });
});

test('remote verification rejects a PR claim with no actual merge',async()=>{
  const {checkGithubEvidence}=await checks();
  const task={id:'R-REUSE',status:'done',manual:'no'};
  const evidence={schema:1,task_id:task.id,pr_number:2,merge_commit:'a'.repeat(40),test_cases:[]};
  const fetchImpl=async()=>mock({merged_at:null,base:{ref:'main'}});
  await assert.rejects(
    ()=>checkGithubEvidence({tasks:[task],done:[{task,evidence}]},
      {repo:'siskosun/ThreadLine',token:'test',fetchImpl}),
    /PR not merged into main/
  );
});

test('manual signoff must be the owner comment for the correct task and PR HEAD',async()=>{
  const {checkGithubEvidence}=await checks();
  const sha='a'.repeat(40),head='b'.repeat(40),task={id:'Z0-LIVE',status:'done',manual:'yes'};
  const evidence={pr_number:2,merge_commit:sha,manual:{comment_id:5,accepted_head_sha:head,scope:'real signed-in browser test'}};
  const route=async url=>{
    if(url.endsWith('/pulls/2'))return mock({merged_at:'2026-10-21',base:{ref:'main'},merge_commit_sha:sha,head:{sha:head}});
    if(url.includes('/check-runs?'))return mock({check_runs:[{name:'verify',conclusion:'success',app:{slug:'github-actions'}}]});
    return mock({user:{login:'untrusted'},issue_url:'https://api.github.com/repos/siskosun/ThreadLine/issues/2',
      body:'MANUAL_ACCEPT Z0-LIVE '+head});
  };
  await assert.rejects(
    ()=>checkGithubEvidence({tasks:[task],done:[{task,evidence}]},
      {repo:'siskosun/ThreadLine',token:'test',fetchImpl:route}),
    /manual acceptance must be from repository owner/
  );
});

test('remote signoff succeeds only with merged PR, green check and exact owner acceptance',async()=>{
  const {checkGithubEvidence}=await checks();
  const sha='a'.repeat(40),head='b'.repeat(40),task={id:'Z0-LIVE',status:'done',manual:'yes'};
  const evidence={pr_number:2,merge_commit:sha,manual:{comment_id:5,accepted_head_sha:head,scope:'real signed-in browser test'}};
  const route=async url=>{
    if(url.endsWith('/pulls/2'))return mock({merged_at:'2026-10-21',base:{ref:'main'},merge_commit_sha:sha,head:{sha:head}});
    if(url.includes('/check-runs?'))return mock({check_runs:[{name:'verify',conclusion:'success',app:{slug:'github-actions'}}]});
    return mock({user:{login:'siskosun'},issue_url:'https://api.github.com/repos/siskosun/ThreadLine/issues/2',
      body:'MANUAL_ACCEPT Z0-LIVE '+head});
  };
  const out=await checkGithubEvidence({tasks:[task],done:[{task,evidence}]},
    {repo:'siskosun/ThreadLine',token:'test',fetchImpl:route});
  assert.equal(out.done,1);
});

test('an already-merged PR may remain in_review until independent evidence and signoff',async()=>{
  const {checkGithubEvidence}=await checks();
  const task={id:'R-REUSE',status:'in_review',manual:'no',evidence:'PR#2'};
  const fetchImpl=async()=>mock({state:'closed',merged_at:'2026-10-21T12:00:00Z',base:{ref:'main'}});
  const result=await checkGithubEvidence({tasks:[task],done:[]},{repo:'siskosun/ThreadLine',token:'test',fetchImpl});
  assert.equal(result.reviewPrs,1);
});

test('closed PR without merge is not acceptable review evidence',async()=>{
  const {checkGithubEvidence}=await checks();
  const task={id:'R-REUSE',status:'in_review',manual:'no',evidence:'PR#2'};
  const fetchImpl=async()=>mock({state:'closed',merged_at:null,base:{ref:'main'}});
  await assert.rejects(
    ()=>checkGithubEvidence({tasks:[task],done:[]},{repo:'siskosun/ThreadLine',token:'test',fetchImpl}),
    /in_review PR must exist on main or be merged/
  );
});
