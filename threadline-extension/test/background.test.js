const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function bootstrap(){
  const files=path.join(__dirname,'..');
  const local={},session={};
  const listeners={};
  const tabs=[
   {id:1,url:'https://chatgpt.com/c/alpha',title:'A · 验证',active:true,windowId:5},
   {id:2,url:'https://chatgpt.com/c/beta',title:'B · 审核',active:false,windowId:5}
  ];
  function get(area,key){
    if(key===null)return {...area};
    if(typeof key==='string')return {[key]:area[key]};
    return {};
  }
  const chrome={
   runtime:{id:'unit-ext',getURL:path=>'chrome-extension://unit-ext/'+path,onInstalled:{addListener:fn=>{listeners.install=fn}},onStartup:{addListener:fn=>listeners.start=fn},onMessage:{addListener:fn=>listeners.message=fn}},
   sidePanel:{setPanelBehavior:async()=>{}},
   storage:{
    local:{get:async key=>get(local,key),set:async v=>Object.assign(local,v)},
    session:{get:async key=>get(session,key),set:async v=>Object.assign(session,v),remove:async k=>{delete session[k]}}
   },
   tabs:{query:async({active})=>active?tabs.filter(t=>t.active):tabs,onUpdated:{addListener:()=>{}},onRemoved:{addListener:fn=>listeners.removed=fn}}
  };
  const env={chrome,structuredClone,URL,Date,Promise,crypto:globalThis.crypto,setTimeout,clearTimeout,importScripts:()=>{}};
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(files,'core.js'),'utf8'),env);
  vm.runInContext(fs.readFileSync(path.join(files,'backup-core.js'),'utf8'),env);
  vm.runInContext(fs.readFileSync(path.join(files,'background.js'),'utf8'),env);
  const panel={url:'chrome-extension://id/panel.html'};
  const sender=id=>typeof id==='object'?id:id?{tab:tabs.find(t=>t.id===id),id:'unit-ext',url:tabs.find(t=>t.id===id)?.url}:panel;
  async function send(msg,id){
   return new Promise(resolve=>{
    const done=listeners.message(msg,sender(id),resolve);
    assert.equal(done,true);
   });
  }
  return {send,tabs,local,session};
}
test('two open ChatGPT tabs see same closure immediately',async()=>{
 const t=bootstrap();
 const created=await t.send({type:'MUTATE',action:{type:'createProject',name:'统一研究',chat:{key:'chat:alpha',title:'A',url:'https://chatgpt.com/c/alpha'}}});
 assert.equal(created.ok,true);
 const pid=created.data.result.projectId;
 assert.equal((await t.send({type:'MUTATE',action:{type:'linkChat',projectId:pid,key:'chat:beta',title:'B',url:'https://chatgpt.com/c/beta'}})).ok,true);
 const before=await t.send({type:'PAGE_CONTEXT',href:'https://chatgpt.com/c/beta'},2);
 assert.equal(before.data.project.stage,'active');
 await t.send({type:'MUTATE',action:{type:'updateProject',projectId:pid,patch:{stage:'closed',decision:'验收结束'}}});
 const a=await t.send({type:'PAGE_CONTEXT',href:'https://chatgpt.com/c/alpha'},1);
 const b=await t.send({type:'PAGE_CONTEXT',href:'https://chatgpt.com/c/beta'},2);
 assert.equal(a.data.project.stage,'closed');
 assert.equal(b.data.project.stage,'closed');
 assert.equal(b.data.project.decision,'验收结束');
});
test('content-script sender cannot mutate shared project status',async()=>{
 const t=bootstrap();
 const r=await t.send({type:'MUTATE',action:{type:'createProject',name:'Injection'}} ,1);
 assert.equal(r.ok,false);
 assert.match(r.error,/只能在扩展面板/);
 const state=(await t.send({type:'SNAPSHOT'})).data.state;
 assert.equal(state.projects.length,0);
});
test('concurrent actions are serialized; no lost update',async()=>{
 const t=bootstrap();
 const created=await t.send({type:'MUTATE',action:{type:'createProject',name:'Topic'}});
 const pid=created.data.result.projectId;
 const results=await Promise.all([
  t.send({type:'MUTATE',action:{type:'linkChat',projectId:pid,key:'chat:alpha',title:'A',url:'https://chatgpt.com/c/alpha'}}),
  t.send({type:'MUTATE',action:{type:'linkChat',projectId:pid,key:'chat:beta',title:'B',url:'https://chatgpt.com/c/beta'}})
 ]);
 assert.ok(results.every(r=>r.ok));
 const state=(await t.send({type:'SNAPSHOT'})).data.state;
 assert.equal(Object.keys(state.chats).length,2);
 assert.equal(state.revision,3);
});
test('assign pending chat and remap after ChatGPT updates URL',async()=>{
 const t=bootstrap();
 t.tabs[0].url='https://chatgpt.com/';
 const created=await t.send({type:'MUTATE',action:{type:'createProject',name:'Unassigned',chat:{key:'tab:1',title:'新对话',url:t.tabs[0].url}}});
 assert.equal(created.ok,true);
 t.tabs[0].url='https://chatgpt.com/c/real-123';
 const observed=await t.send({type:'OBSERVE',href:t.tabs[0].url,title:'真实对话',streaming:true},1);
 assert.equal(observed.ok,true);
 assert.equal(observed.data.chat.title,'真实对话');
 const state=(await t.send({type:'SNAPSHOT'})).data.state;
 assert.equal(state.chats['tab:1'],undefined);
 assert.equal(state.chats['chat:real-123'].projectId,created.data.result.projectId);
});
test('a page can acknowledge only its own ChatGPT conversation, not another branch',async()=>{
 const t=bootstrap();
 const created=await t.send({type:'MUTATE',action:{type:'createProject',name:'Topic',chat:{key:'chat:alpha',title:'A',url:t.tabs[0].url}}});
 const id=created.data.result.projectId;
 await t.send({type:'MUTATE',action:{type:'linkChat',key:'chat:beta',projectId:id,title:'B',url:t.tabs[1].url}});
 await t.send({type:'MUTATE',action:{type:'updateProject',projectId:id,sourceKey:'chat:alpha',patch:{decision:'已验证新结论'}}});
 const forged=await t.send({type:'ACK_PAGE',href:t.tabs[0].url},2);
 assert.equal(forged.ok,false);
 assert.match(forged.error,/来源对话已改变/);
 const untouched=(await t.send({type:'PAGE_CONTEXT',href:t.tabs[1].url},2)).data;
 assert.equal(untouched.chat.seenVersion,0);
 const good=await t.send({type:'ACK_PAGE',href:t.tabs[1].url},2);
 assert.equal(good.ok,true);
 assert.equal(good.data.chat.seenVersion,1);
 assert.equal((await t.send({type:'PAGE_CONTEXT',href:t.tabs[1].url},2)).data.chat.seenVersion,1);
});

test('extension-owned panel tab is trusted without permitting arbitrary tab mutation',async()=>{
 const t=bootstrap();
 const panelURL='chrome-extension://unit-ext/panel.html';
 const legit={id:'unit-ext',url:panelURL,tab:{id:100,url:panelURL}};
 const created=await t.send({type:'MUTATE',action:{type:'createProject',name:'From panel tab'}},legit);
 assert.equal(created.ok,true);
 const snapshot=await t.send({type:'SNAPSHOT'},legit);
 assert.equal(snapshot.ok,true);
 assert.equal(snapshot.data.state.projects.length,1);
 const attacks=[
  {id:'unit-ext',url:'https://chatgpt.com/c/alpha',tab:{id:1,url:'https://chatgpt.com/c/alpha'}},
  {id:'wrong-id',url:panelURL,tab:{id:100,url:panelURL}},
  {id:'unit-ext',url:panelURL,tab:{id:100,url:'https://chatgpt.com/c/alpha'}}
 ];
 for(const attack of attacks){
  assert.equal((await t.send({type:'SNAPSHOT'},attack)).ok,false);
  assert.equal((await t.send({type:'MUTATE',action:{type:'createProject',name:'FORGED'}},attack)).ok,false);
 }
 assert.equal((await t.send({type:'SNAPSHOT'},legit)).data.state.projects.length,1);
});
