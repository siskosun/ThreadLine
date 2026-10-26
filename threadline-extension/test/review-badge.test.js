'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Core=require('../core.js'),CaptureCore=require('../capture-core.js');
const worker=fs.readFileSync(path.join(__dirname,'..','background.js'),'utf8');
const STORE_KEY='threadline_state_v1';
function system(saved=Core.emptyState()){
  const events={},calls=[],storage={[STORE_KEY]:saved};
  const chrome={
    runtime:{id:'review-badge-test',getURL:p=>'chrome-extension://review-badge-test/'+p,
      onInstalled:{addListener(fn){events.installed=fn}},
      onStartup:{addListener(fn){events.startup=fn}},
      onMessage:{addListener(fn){events.message=fn}}},
    storage:{
      local:{async get(key){return {[key]:storage[key]};},
        async set(v){Object.assign(storage,v);}},
      session:{async get(){return{};},async set(){},async remove(){}},
      onChanged:{addListener(fn){events.changed=fn}}
    },
    action:{
      async setBadgeText(v){calls.push(['badge',v.text]);},
      async setBadgeBackgroundColor(v){calls.push(['color',v.color]);},
      async setTitle(v){calls.push(['title',v.title]);}
    },
    sidePanel:{async setPanelBehavior(){}},
    tabs:{onUpdated:{addListener(){}},onRemoved:{addListener(){}},
      async get(){return null;},async query(){return[];}},
    scripting:{async executeScript(){}}
  };
  vm.runInNewContext(worker,{
    importScripts(){},ThreadLineCore:Core,ThreadLineCaptureCore:CaptureCore,
    chrome,crypto:globalThis.crypto,URL,Date,Promise,setTimeout,clearTimeout,console
  },{filename:'background.js'});
  return{events,calls,storage,
    change(state,area='local',key=STORE_KEY){
      storage[STORE_KEY]=state;
      events.changed({[key]:{newValue:state}},area);
    },
    get badge(){return calls.filter(c=>c[0]==='badge').at(-1)?.[1];},
    get title(){return calls.filter(c=>c[0]==='title').at(-1)?.[1];}
  };
}
async function badge(s,value){
  for(let i=0;i<60;i++){
    if(s.badge===value)return;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(s.badge,value,'review badge must converge to the latest topic state');
}
function topicState(){
  let state=Core.apply(Core.emptyState(),{type:'createProject',name:'Synthetic review badge'}).state;
  const projectId=state.projects[0].id;
  for(const name of ['alpha','beta']){
    state=Core.apply(state,{type:'linkChat',key:'chat:'+name,
      projectId,title:name,url:'https://chatgpt.com/c/'+name}).state;
  }
  return{state,projectId};
}
test('toolbar badge counts only linked conversations with unreviewed topic revisions',async()=>{
  const {state,projectId}=topicState(),s=system(state);
  s.events.installed();
  await badge(s,'');
  const changed=Core.apply(state,{type:'updateProject',projectId,
    sourceKey:'chat:alpha',patch:{decision:'synthetic conclusion'}}).state;
  s.change(changed);await badge(s,'1');
  assert.match(s.title,/1 条关联对话待核对/);
  // Non-state storage changes and unrelated session events never alter badge.
  const writes=s.calls.filter(x=>x[0]==='badge').length;
  s.events.changed({unrelated:{newValue:'x'}},'local');
  s.events.changed({[STORE_KEY]:{newValue:state}},'session');
  await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(s.calls.filter(x=>x[0]==='badge').length,writes);
  const acknowledged=Core.apply(changed,{type:'acknowledgeProject',key:'chat:beta'}).state;
  s.change(acknowledged);
  await badge(s,'');
  assert.equal(s.title,'打开研线课题面板');
});
test('worker startup rebuilds review count from persisted state and ignores a missing project',async()=>{
  const {state,projectId}=topicState();
  let next=Core.apply(state,{type:'updateProject',projectId,
    patch:{goal:'Latest synthetic goal'}}).state;
  const s=system(next);
  s.events.startup();
  await badge(s,'2');
  // Rapid successive updates must end at the latest durable state.
  next=Core.apply(next,{type:'acknowledgeProject',key:'chat:alpha'}).state;
  s.change(next);
  const clean=Core.apply(next,{type:'acknowledgeProject',key:'chat:beta'}).state;
  s.change(clean);
  await badge(s,'');
});
