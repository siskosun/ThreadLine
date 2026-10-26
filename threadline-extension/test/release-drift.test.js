'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');
const {pathToFileURL} = require('node:url');

const ROOT = path.resolve(__dirname,'../..');
const SCRIPT = path.join(ROOT,'scripts/check-release-drift.mjs');

function git(cwd,...args){
  const p=spawnSync('git',args,{cwd,encoding:'utf8'});
  assert.equal(p.status,0,p.stderr||String(p.error));
  return p.stdout.trim();
}
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'threadline-release-guard-'));
  fs.mkdirSync(path.join(dir,'threadline-extension'),{recursive:true});
  git(dir,'init');
  fs.writeFileSync(path.join(dir,'threadline-extension/manifest.json'),
    JSON.stringify({version:'0.8.1'}));
  fs.writeFileSync(path.join(dir,'threadline-extension/background.js'),'// baseline\n');
  git(dir,'add','.');
  git(dir,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m','tag base');
  git(dir,'tag','v0.8.1');
  return dir;
}
function commit(dir,msg){
  git(dir,'add','.');
  git(dir,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','-m',msg);
}
function check(dir,...flags){
  return spawnSync(process.execPath,[SCRIPT,'v0.8.1',...flags],{cwd:dir,encoding:'utf8'});
}
test('release guard rejects same-version source changes and passes a new version',()=>{
  const dir=fixture();
  try{
    fs.writeFileSync(path.join(dir,'threadline-extension/background.js'),'// actual change\n');
    commit(dir,'change source');
    let result=check(dir);
    assert.notEqual(result.status,0,'a green verify cannot silently republish stale 0.8.1');
    assert.match(result.stderr,/without increasing manifest.version/);
    const advisory=check(dir,'--advisory');
    assert.equal(advisory.status,0,advisory.stderr);
    assert.match(advisory.stderr,/::warning::Release drift:.*without increasing manifest.version/);
    result=check(dir,'--publish');
    assert.notEqual(result.status,0,'owner-publish cannot use the advisory escape hatch');
    assert.match(result.stderr,/::error::Release guard:.*without increasing manifest.version/);
    fs.writeFileSync(path.join(dir,'threadline-extension/manifest.json'),
      JSON.stringify({version:'0.8.2'}));
    commit(dir,'bump version with source');
    result=check(dir);
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/v0\.8\.1 -> v0\.8\.2/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('docs-only push stays green but publish requires a changed version',()=>{
  const dir=fixture();
  try{
    fs.writeFileSync(path.join(dir,'README.md'),'docs change\n');
    commit(dir,'docs only');
    let result=check(dir);
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/Release audit clean/);
    result=check(dir,'--publish');
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/No extension changes to publish/);
    result=check(dir,'--advisory');
    assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/Release audit clean/);
    result=check(dir,'--bogus');
    assert.notEqual(result.status,0,'unknown flags must not silently bypass release validation');
    fs.writeFileSync(path.join(dir,'threadline-extension/manifest.json'),
      JSON.stringify({version:'0.7.9'}));
    commit(dir,'downgrade manifest');
    result=check(dir);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/without increasing manifest.version/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('release guard uses an explicit published tag, not an arbitrary branch claim',async()=>{
  const {evaluateReleaseDrift}=await import(pathToFileURL(SCRIPT).href);
  assert.throws(()=>evaluateReleaseDrift({latestTag:'v0.8.2',previousVersion:'0.8.1',
    currentVersion:'0.8.3',changedFiles:['threadline-extension/x.js']}),/disagree/);
  assert.throws(()=>evaluateReleaseDrift({latestTag:'v0.8.1',previousVersion:'0.8.1',
    currentVersion:'0.8.1',changedFiles:['threadline-extension/x.js']}),/without increasing/);
  assert.equal(evaluateReleaseDrift({latestTag:'v0.8.1',previousVersion:'0.8.1',
    currentVersion:'0.8.1',changedFiles:[]}).clean,true);
  assert.throws(()=>evaluateReleaseDrift({latestTag:'v0.8.1',previousVersion:'0.8.1',
    currentVersion:'0.8.1',changedFiles:[],forPublish:true}),/No extension changes to publish/);
  assert.throws(()=>evaluateReleaseDrift({latestTag:'v0.8.1',previousVersion:'0.8.1',
    currentVersion:'0.8.2',changedFiles:[]}),/Manifest version changed/);
  assert.throws(()=>evaluateReleaseDrift({latestTag:'v0.8.1',previousVersion:'0.8.1',
    currentVersion:'0.8.2',changedFiles:['docs/PLAN.md']}),/Unscoped path/);
});
test('test-count floor is tied to manifest version and above deprecated 94 baseline',()=>{
  const floors=JSON.parse(fs.readFileSync(path.join(ROOT,'scripts/test-floors.json'),'utf8'));
  const current=JSON.parse(fs.readFileSync(path.join(ROOT,'threadline-extension/manifest.json'),'utf8')).version;
  assert.ok(Number.isInteger(floors[current]) && floors[current]>=220);
  const versions=Object.keys(floors).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
  for(let i=1;i<versions.length;i++)
    assert.ok(floors[versions[i]]>=floors[versions[i-1]],'floor may only stay or increase');
});
