'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

const ROOT=path.resolve(__dirname,'../..');
const MOD=path.join(ROOT,'scripts','check-plan.mjs');
const fixtureFiles=['docs/PLAN.md','AGENTS.md','docs/ff/DEVELOPMENT_PLAN.md','docs/ff/BLOCKED.md'];

async function checks(){return import(pathToFileURL(MOD).href);}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'threadline-rebuild-plan-'));
  for(const name of fixtureFiles){
    const source=path.join(ROOT,name);
    fs.mkdirSync(path.dirname(path.join(dir,name)),{recursive:true});
    fs.copyFileSync(source,path.join(dir,name));
  }
  return dir;
}
function withFixture(fn){const dir=fixture();try{return fn(dir);}finally{fs.rmSync(dir,{recursive:true,force:true});}}
function edit(dir,file,modify){
  const target=path.join(dir,file);
  fs.writeFileSync(target,modify(fs.readFileSync(target,'utf8')),'utf8');
}
function rowChange(source,id,fn){
  return source.split('\n').map(line=>line.startsWith('| '+id+' |')?fn(line):line).join('\n');
}
function mock(body){return {ok:true,status:200,json:async()=>body};}

test('canonical rebuild plan contains ten new tasks and carries no old done states',async()=>{
  const {validatePlan}=await checks();
  const actual=validatePlan(ROOT);
  assert.equal(actual.tasks.length,10);
  assert.deepEqual(actual.tasks.map(x=>x.id),[
    'UPSTREAM-BASE','CAPTURE-CORE','LOCAL-ARCHIVE','LIVE-ASSET-CACHE','HANDOFF-COMPILE',
    'HANDOFF-INJECT','UX-REBUILD','INTEGRITY-VALIDATION','REAL-EDGE-E2E','BETA-RELEASE'
  ]);
  assert.deepEqual(actual.tasks.map(x=>x.status),Array(10).fill('planned'));
  assert.equal(actual.done.length,0);
});

test('missing/duplicate markers and required rebuild tasks are rejected',async()=>{
  const {validatePlan}=await checks();
  withFixture(dir=>{
    edit(dir,'docs/PLAN.md',s=>s.replace('<!-- PLAN_TASKS_START -->','<!-- VANISHED -->'));
    assert.throws(()=>validatePlan(dir),/markers/);
  });
  withFixture(dir=>{
    edit(dir,'docs/PLAN.md',s=>s.replace(/^\| CAPTURE-CORE \|[^\r\n]*(?:\r?\n|$)/m,''));
    assert.throws(()=>validatePlan(dir),/required task IDs/);
  });
  withFixture(dir=>{
    edit(dir,'docs/PLAN.md',s=>s.replace('<!-- PLAN_TASKS_START -->','<!-- PLAN_TASKS_START -->\n<!-- PLAN_TASKS_START -->'));
    assert.throws(()=>validatePlan(dir),/markers/);
  });
});

test('a task cannot advance while its hard dependencies are incomplete',async()=>{
  const {validatePlan}=await checks();
  withFixture(dir=>{
    edit(dir,'docs/PLAN.md',s=>rowChange(s,'CAPTURE-CORE',
      line=>line.replace(' | planned | ',' | in_progress | ')));
    assert.throws(()=>validatePlan(dir),/dependency is not done/);
  });
});

test('in_review requires a real PR and blocked requires a concrete explanation',async()=>{
  const {validatePlan}=await checks();
  withFixture(dir=>{
    edit(dir,'docs/PLAN.md',s=>rowChange(s,'UPSTREAM-BASE',
      line=>line.replace(' | planned | ',' | in_review | ')));
    assert.throws(()=>validatePlan(dir),/in_review needs real PR reference/);
  });
  withFixture(dir=>{
    edit(dir,'docs/PLAN.md',s=>rowChange(s,'UPSTREAM-BASE',
      line=>line.replace(' | planned | ',' | blocked | ').replace(' | - | no |',' | docs/ff/BLOCKED.md | no |')));
    assert.throws(()=>validatePlan(dir),/blocked task not explained/);
  });
});

test('done without canonical evidence JSON is rejected',async()=>{
  const {validatePlan}=await checks();
  withFixture(dir=>{
    edit(dir,'docs/PLAN.md',s=>rowChange(s,'UPSTREAM-BASE',
      line=>line.replace(' | planned | ',' | done | ').replace(' | - | no |',' | docs/ff/evidence/UPSTREAM-BASE.json | no |')));
    assert.throws(()=>validatePlan(dir),/missing evidence file/);
  });
});

test('legacy plan remains a short pointer to the new canonical plan',async()=>{
  const {validatePlan}=await checks();
  withFixture(dir=>{
    edit(dir,'docs/ff/DEVELOPMENT_PLAN.md',()=>('old full plan '.repeat(200)));
    assert.throws(()=>validatePlan(dir),/historical DEVELOPMENT_PLAN/);
  });
});

test('remote verification rejects a PR claim with no actual merge',async()=>{
  const {checkGithubEvidence}=await checks();
  const task={id:'UPSTREAM-BASE',status:'done',manual:'no'};
  const evidence={schema:1,task_id:task.id,pr_number:2,merge_commit:'a'.repeat(40),test_cases:[{file:'threadline-extension/test/capture-core.test.js',name:'active branch rejects a broken parent chain'}]};
  const fetchImpl=async()=>mock({merged_at:null,base:{ref:'main'}});
  await assert.rejects(
    ()=>checkGithubEvidence({tasks:[task],done:[{task,evidence}]},{repo:'siskosun/ThreadLine',token:'test',fetchImpl}),
    /PR not merged into main/
  );
});

test('manual signoff must be the owner comment for the correct task and PR HEAD',async()=>{
  const {checkGithubEvidence}=await checks();
  const sha='a'.repeat(40),head='b'.repeat(40),task={id:'REAL-EDGE-E2E',status:'done',manual:'yes'};
  const evidence={pr_number:2,merge_commit:sha,manual:{comment_id:5,accepted_head_sha:head,scope:'real signed-in browser test'},test_cases:[{file:'threadline-extension/test/capture-core.test.js',name:'active branch rejects a broken parent chain'}]};
  const route=async url=>{
    if(url.endsWith('/pulls/2'))return mock({merged_at:'2026-10-21',base:{ref:'main'},merge_commit_sha:sha,head:{sha:head}});
    if(url.includes('/check-runs?'))return mock({check_runs:[{name:'verify',conclusion:'success',app:{slug:'github-actions'}}]});
    return mock({user:{login:'untrusted'},issue_url:'https://api.github.com/repos/siskosun/ThreadLine/issues/2',body:'MANUAL_ACCEPT REAL-EDGE-E2E '+head});
  };
  await assert.rejects(
    ()=>checkGithubEvidence({tasks:[task],done:[{task,evidence}]},{repo:'siskosun/ThreadLine',token:'test',fetchImpl:route}),
    /manual acceptance must be from repository owner/
  );
});

test('remote signoff succeeds only with merged PR, green check and exact owner acceptance',async()=>{
  const {checkGithubEvidence}=await checks();
  const sha='a'.repeat(40),head='b'.repeat(40),task={id:'REAL-EDGE-E2E',status:'done',manual:'yes'};
  const evidence={pr_number:2,merge_commit:sha,manual:{comment_id:5,accepted_head_sha:head,scope:'real signed-in browser test'},test_cases:[{file:'threadline-extension/test/capture-core.test.js',name:'active branch rejects a broken parent chain'}]};
  const route=async url=>{
    if(url.endsWith('/pulls/2'))return mock({merged_at:'2026-10-21',base:{ref:'main'},merge_commit_sha:sha,head:{sha:head}});
    if(url.includes('/check-runs?'))return mock({check_runs:[{name:'verify',conclusion:'success',app:{slug:'github-actions'}}]});
    return mock({user:{login:'siskosun'},issue_url:'https://api.github.com/repos/siskosun/ThreadLine/issues/2',body:'MANUAL_ACCEPT REAL-EDGE-E2E '+head});
  };
  const out=await checkGithubEvidence({tasks:[task],done:[{task,evidence}]},{repo:'siskosun/ThreadLine',token:'test',fetchImpl:route});
  assert.equal(out.done,1);
});

test('an in_review PR must target main and exist on GitHub',async()=>{
  const {checkGithubEvidence}=await checks();
  const task={id:'UPSTREAM-BASE',status:'in_review',manual:'no',evidence:'PR#77'};
  const fetchImpl=async()=>mock({base:{ref:'other'},state:'open',merged_at:null});
  await assert.rejects(
    ()=>checkGithubEvidence({tasks:[task],done:[]},{repo:'siskosun/ThreadLine',token:'test',fetchImpl}),
    /in_review PR must exist on main/
  );
});
