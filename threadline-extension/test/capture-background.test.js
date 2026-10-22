const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Core=require('../core.js'),CaptureCore=require('../capture-core.js');
function system(){
  const runs=new Map(),pages=new Map(),local=new Map(),session=new Map(),events={},calls=[];
  const db={async putRun(r){runs.set(r.id,r)},async getRun(id){return runs.get(id)},async modifyRun(id,p){let r=runs.get(id);runs.set(id,{...r,...p});return runs.get(id)},async putPage(p){pages.set(`${p.id}_${p.pageIndex}_${p.chunkIndex}`,p)},async resetPages(id){for(const k of pages.keys())if(k.startsWith(`${id}_`))pages.delete(k)}};
  const chrome={
    runtime:{onInstalled:{addListener(){}},onStartup:{addListener(){}},onMessage:{addListener(fn){events.message=fn}}},
    tabs:{onUpdated:{addListener(fn){events.tabUpdated=fn}},onRemoved:{addListener(fn){events.tabRemoved=fn}},async get(id){return{id,url:'https://chatgpt.com/g/g-p-123/c/source-123',title:'研究源对话',windowId:4}},async query(){return[]},async sendMessage(tabId,msg){calls.push(['send',tabId,msg]);return{ok:true}},async create(options){calls.push(['newtab',options]);return{id:84,windowId:4}}},
    scripting:{async executeScript(args){calls.push(['inject',args])}},
    sidePanel:{setPanelBehavior:async()=>{},async close(args){calls.push(['close',args])}},
    storage:{local:{async get(k){return{[k]:local.get(k)}},async set(values){for(const [k,v]of Object.entries(values))local.set(k,v)}},session:{async get(k){if(k==null)return Object.fromEntries(session);return{[k]:session.get(k)}},async set(items){for(const[k,v]of Object.entries(items))session.set(k,v)},async remove(keys){for(const k of [keys].flat())session.delete(k)}}}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','background.js'),'utf8'),{importScripts:()=>{},ThreadLineCore:Core,ThreadLineCaptureCore:CaptureCore,ThreadLineCaptureDB:db,chrome,crypto:globalThis.crypto,console,Date,Promise,URL});
  function message(payload,sender={}){return new Promise((resolve,reject)=>{events.message(payload,sender,reply=>{if(reply.ok)resolve(reply.data);else reject(new Error(reply.error));});});}
  return{message,runs,pages,calls,session,local};
}
test('selected-tab capture starts, only original tab can provide chunks, then completes',async()=>{
  const s=system(),{id}=await s.message({type:'CAPTURE_START',tabId:7});
  assert.match(id,/^cap_/);assert.equal(s.runs.get(id).status,'capturing');
  assert.equal(s.calls.filter(c=>c[0]==='inject').length,2);
  await assert.rejects(s.message({type:'CAPTURE_PAGE',id,pageIndex:0,chunkIndex:0,messages:[]},{tab:{id:8,url:'https://chatgpt.com/c/source-123'}}),/源标签页|任务/);
  await s.message({type:'CAPTURE_PAGE',id,pageIndex:0,chunkIndex:0,messages:[{id:'1',role:'user',content:'hello'}]},{tab:{id:7,url:'https://chatgpt.com/g/g-p-123/c/source-123'}});
  await s.message({type:'CAPTURE_END',id,complete:true,mode:'paginated',pageCount:1,count:1},{tab:{id:7,url:'https://chatgpt.com/c/source-123'}});
  assert.equal(s.runs.get(id).status,'done');assert.equal(s.runs.get(id).complete,true);assert.equal(s.pages.size,1);
});
test('new chat is created in same window, draft retained locally, sidepanel close requested',async()=>{
  const s=system();const r=await s.message({type:'NEW_CHAT',handoff:'研究目标：继续检查',windowId:4});
  assert.equal(r.tabId,84);assert.ok(s.session.get('tl_handoff_84').text.includes('继续检查'));
  assert.ok(s.calls.some(c=>c[0]==='close' && c[1].windowId===4));
  const sender={url:'https://chatgpt.com/',tab:{id:84,url:'https://chatgpt.com/'}};
  const draft=await s.message({type:'HANDOFF_GET'},sender);
  assert.match(draft.text,/继续检查/);
  assert.equal(draft.autoAttempted,false);
  const [a,b]=await Promise.all([
    s.message({type:'HANDOFF_BEGIN'},sender),
    s.message({type:'HANDOFF_BEGIN'},sender)
  ]);
  assert.equal([a.autoFill,b.autoFill].filter(Boolean).length,1,
    'only one of two overlapping inserts may reserve a draft');
  assert.equal((await s.message({type:'HANDOFF_GET'},sender)).autoAttempted,true);
  await s.message({type:'HANDOFF_ACK'},sender);
  assert.equal(s.session.has('tl_handoff_84'),false);
});

test('handoff reservation refuses redirected and foreign documents',async()=>{
 const s=system();
 await s.message({type:'NEW_CHAT',handoff:'TEST INTENT',windowId:4});
 for(const url of [
   'https://chatgpt.com/c/saved',
   'https://chatgpt.com/?temporary-chat=true',
   'https://chatgpt.com/g/g-p-project',
   'https://example.com/'
 ]){
   const sender={url,tab:{id:84,url}};
   await assert.rejects(s.message({type:'HANDOFF_BEGIN'},sender),
      /plain new ChatGPT/);
 }
 assert.equal(s.session.get('tl_handoff_84').attemptedAt,undefined,
   'rejected documents must not consume the pending draft');
});
test('missing reservation cannot be acknowledged',async()=>{
 const s=system();
 await s.message({type:'NEW_CHAT',handoff:'TEST INTENT',windowId:4});
 const sender={url:'https://chatgpt.com/',tab:{id:84,url:'https://chatgpt.com/'}};
 await assert.rejects(s.message({type:'HANDOFF_ACK'},sender),/no reserved/);
 assert.equal(s.session.get('tl_handoff_84').text,'TEST INTENT');
});
