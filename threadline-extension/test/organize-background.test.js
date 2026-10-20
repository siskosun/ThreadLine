const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Core=require('../core.js'),CaptureCore=require('../capture-core.js'),OrgCore=require('../organize-core.js');
function setup(options={}){
 const runs=new Map(),records=[],callbacks={},session=new Map(),local=new Map();
 const tabMap=new Map([[7,{id:7,status:'complete',url:'https://chatgpt.com/c/source-123',windowId:3,title:'来源对话'}]]);
 const run={id:'cap_1',tabId:7,conversationId:'source-123',status:'done',url:'https://chatgpt.com/c/source-123'};runs.set(run.id,run);
 const db={async getRun(id){return runs.get(id)},async modifyRun(id,patch){const row={...runs.get(id),...patch};runs.set(id,row);return row}};
 const chrome={runtime:{onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(fn){callbacks.message=fn}}},
  tabs:{onUpdated:{addListener(){}},onRemoved:{addListener(){}},async get(id){const t=tabMap.get(id);if(!t)throw Error('missing tab');return {...t}},
   async query(){return[]},async create(options){const newTab={id:84,status:'complete',url:'https://chatgpt.com/',windowId:3};tabMap.set(84,newTab);records.push(['create',options]);return newTab},
   async sendMessage(id,msg){records.push(['send',id,msg.type]);if(msg.type==='TL_ORG_CREATE'){const helper=tabMap.get(id);helper.url='https://chatgpt.com/g/g-p-999/project';if(options.createLosesResponse)throw Error('connection dropped on SPA navigation');return{ok:true,data:{status:'created',name:msg.name,id:'g-p-999',url:helper.url}};}
     if(msg.type==='TL_ORG_MOVE'){if(options.moveFails)throw Error('project menu missing');tabMap.get(7).url='https://chatgpt.com/g/g-p-999/c/source-123';return{ok:true,data:{status:'moved'}};}
     if(msg.type==='TL_ORG_ARCHIVE'){tabMap.get(7).url='https://chatgpt.com/';return{ok:true,data:{status:'archived'}};}
     return {ok:true};},async remove(id){records.push(['remove',id]);tabMap.delete(id)}},
  scripting:{async executeScript(arg){records.push(['script',arg.target.tabId]);}},sidePanel:{setPanelBehavior:async()=>{}},storage:{local:{async get(k){return{[k]:local.get(k)}},async set(o){for(const [k,v]of Object.entries(o))local.set(k,v)}},session:{async get(k){return{[k]:session.get(k)}},async set(o){for(const [k,v]of Object.entries(o))session.set(k,v)},async remove(k){for(const key of Array.isArray(k)?k:[k])session.delete(key)}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','background.js'),'utf8'),{importScripts:()=>{},ThreadLineCore:Core,ThreadLineCaptureCore:CaptureCore,ThreadLineCaptureDB:db,ThreadLineOrganizeCore:OrgCore,chrome,crypto:globalThis.crypto,console,Date,Promise,URL,setTimeout,clearTimeout});
 const message=(input,sender={})=>new Promise((resolve,reject)=>{callbacks.message(input,sender,r=>r.ok?resolve(r.data):reject(Error(r.error)))});
 return {message,runs,records,tabMap};
}
test('create project and move exact source chat, close helper after success',async()=>{
 const x=setup(),result=await x.message({type:'WEB_ORGANIZE',action:'create_and_move',runId:'cap_1',tabId:7,name:'研究归档项目'});
 assert.equal(result.status,'moved');assert.equal(x.runs.get('cap_1').remoteProject.id,'g-p-999');
 assert.equal(x.records.filter(r=>r[0]==='send'&&r[2]==='TL_ORG_CREATE').length,1);
 assert.ok(x.records.some(r=>r[0]==='remove'&&r[1]===84));
});
test('move failure stores project and retries move without duplicate project creation',async()=>{
 const x=setup({moveFails:true});let first=await x.message({type:'WEB_ORGANIZE',action:'create_and_move',runId:'cap_1',tabId:7,name:'研究归档项目'});
 assert.equal(first.status,'created_not_moved');
 let second=await x.message({type:'WEB_ORGANIZE',action:'create_and_move',runId:'cap_1',tabId:7,name:'研究归档项目'});
 assert.equal(second.status,'created_not_moved');
 assert.equal(x.records.filter(r=>r[0]==='send'&&r[2]==='TL_ORG_CREATE').length,1);
});
test('a project navigation can be verified even if content-script response disappears',async()=>{
 const x=setup({createLosesResponse:true});
 const result=await x.message({type:'WEB_ORGANIZE',action:'create_and_move',runId:'cap_1',tabId:7,name:'研究归档项目'});
 assert.equal(result.status,'moved');assert.equal(result.id,'g-p-999');
});
test('cannot archive or move when source tab is not exact captured conversation',async()=>{
 const x=setup();x.tabMap.get(7).url='https://chatgpt.com/c/other-123';
 await assert.rejects(x.message({type:'WEB_ORGANIZE',action:'archive',runId:'cap_1',tabId:7}),/已切换/);
 assert.equal(x.records.length,0);
});
test('archive only original tab, retain captured report',async()=>{
 const x=setup();const r=await x.message({type:'WEB_ORGANIZE',action:'archive',runId:'cap_1',tabId:7});
 assert.equal(r.status,'archived');assert.ok(x.runs.get('cap_1'));assert.equal(x.runs.get('cap_1').archiveWeb.status,'archived');
});
test('content page cannot invoke privileged actions',async()=>{
 const x=setup();await assert.rejects(x.message({type:'WEB_ORGANIZE',action:'archive',runId:'cap_1',tabId:7},{tab:x.tabMap.get(7)}),/只有研线面板/);
});
