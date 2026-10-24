const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const Core=require('../core.js'),CaptureCore=require('../capture-core.js');
const ID='source-test-extension',PANEL=`chrome-extension://${ID}/panel.html`;
const ORIGIN=`chrome-extension://${ID}`,DOC='00000000-0000-4000-8000-000000000001';
const panel=(patch={})=>({id:ID,url:PANEL,origin:ORIGIN,frameId:0,documentId:DOC,...patch});
const context=(patch={})=>({contextType:'SIDE_PANEL',documentId:DOC,documentUrl:PANEL,
 documentOrigin:ORIGIN,frameId:0,tabId:-1,...patch});
function system(options={}){
 const calls=[],session={},local={},listeners={};
 const runtime={id:ID,getURL:p=>`chrome-extension://${ID}/${p}`,
  onInstalled:{addListener(){}},onStartup:{addListener(){}},
  onMessage:{addListener:fn=>listeners.message=fn},
  async getContexts(filter){calls.push(['contexts',filter]);
   if(options.queryError)throw Error('PRIVATE ERROR https://private.invalid/token');
   if(options.queryPending)return new Promise(()=>{});
   return options.contexts||[];
  }};
 if(options.noContexts)delete runtime.getContexts;
 const area=store=>({async get(k){return k===null?{...store}:{[k]:store[k]};},
  async set(values){calls.push(['store']);Object.assign(store,values);},async remove(k){delete store[k];}});
 const chrome={runtime,storage:{local:area(local),session:area(session)},
  tabs:{onUpdated:{addListener(){}},onRemoved:{addListener(){}},async query(){return[];},
   async create(arg){calls.push(['create',arg]);return{id:84,windowId:4};},async sendMessage(){calls.push(['send']);}},
  sidePanel:{async setPanelBehavior(){},async close(){calls.push(['close']);}},
  scripting:{async executeScript(){calls.push(['inject']);}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','background.js'),'utf8'),{
  importScripts(){},chrome,ThreadLineCore:Core,ThreadLineCaptureCore:CaptureCore,
  crypto:globalThis.crypto,URL,Date,Promise,setTimeout,clearTimeout,console
 });
 const send=(sender,payload={type:'NEW_CHAT',handoff:'FICTIONAL SOURCE TEST',windowId:4})=>
  new Promise(resolve=>listeners.message(payload,sender,resolve));
 return{send,calls,session,local};
}
function noEffects(s){
 assert.equal(s.calls.filter(c=>c[0]!=='contexts').length,0,'denial must precede every side effect');
 assert.deepEqual(s.session,{});assert.deepEqual(s.local,{});
}
test('own side panel without sender.tab and exact full panel tab remain authorized',async()=>{
 for(const sender of [panel(),panel({tab:{id:9,url:PANEL}}),panel({tab:{id:9}})]){
  const s=system();const r=await s.send(sender);
  assert.equal(r.ok,true);assert.equal(s.calls.filter(c=>c[0]==='create').length,1);
  assert.equal(s.calls.filter(c=>c[0]==='contexts').length,0);
 }
});
test('no-tab is not a grant: unknown, content page, other extension and background are denied',async()=>{
 for(const sender of [{},{url:PANEL},panel({id:'other-extension'}),
  panel({url:'https://chatgpt.com/'}),panel({url:`${ORIGIN}/background.js`}),
  panel({url:PANEL+'?x=1'}),panel({url:PANEL+'#fragment'})]){
  const s=system();const r=await s.send(sender);
  assert.equal(r.ok,false,JSON.stringify(sender));noEffects(s);
 }
});
test('opaque/foreign origin and non-top frame cannot act as the panel',async()=>{
 for(const patch of [{origin:'null'},{origin:'https://chatgpt.com'},{frameId:2}]){
  const s=system();assert.equal((await s.send(panel(patch))).ok,false);noEffects(s);
 }
});
test('container URL conflict requires independent live document attestation',async()=>{
 for(const record of [context(),context({contextType:'TAB',tabId:9})]){
  const s=system({contexts:[record]});
  const r=await s.send(panel({tab:{id:9,url:'https://chatgpt.com/'}}));
  assert.equal(r.ok,true,'browser-attested own panel is not the ambient ChatGPT container');
  const filter=s.calls.find(c=>c[0]==='contexts')?.[1];
  assert.deepEqual(Array.from(filter.documentIds),[DOC]);
  assert.deepEqual(Array.from(filter.documentUrls),[PANEL]);
  assert.equal(s.calls.filter(c=>c[0]==='create').length,1);
 }
});
test('unknown or stale document, wrong context/page/origin/frame/tab all fail closed',async()=>{
 const bad=[[],[context({documentId:'stale'})],[context({documentUrl:PANEL+'?other=1'})],
  [context({documentOrigin:'https://chatgpt.com'})],[context({frameId:3})],
  [context({contextType:'BACKGROUND'})],[context({contextType:'TAB',tabId:22})],
  [context(),context()]];
 for(const contexts of bad){
  const s=system({contexts});const r=await s.send(panel({tab:{id:9,url:'https://chatgpt.com/'}}));
  assert.equal(r.ok,false);noEffects(s);
 }
});
test('context API unavailable, throwing or missing sender document fails closed',async()=>{
 for(const options of [{noContexts:true},{queryError:true}]){
  const s=system(options);const r=await s.send(panel({tab:{id:9,url:'https://chatgpt.com/'}}));
  assert.equal(r.ok,false);assert.ok(!JSON.stringify(r).includes('PRIVATE ERROR'));
  assert.ok(!JSON.stringify(r).includes('://'));noEffects(s);
 }
 const s=system({contexts:[context()]});
 assert.equal((await s.send(panel({documentId:undefined,tab:{id:9,url:'https://chatgpt.com/'}}))).ok,false);
 noEffects(s);
});
test('context lookup deadline denies without writes or automatic replay',async()=>{
 const s=system({queryPending:true});
 const r=await s.send(panel({tab:{id:9,url:'https://chatgpt.com/'}}));
 assert.equal(r.ok,false);assert.equal(r.sourceCheck.contextStatus,'timeout');noEffects(s);
 assert.equal(s.calls.length,1);
});
test('attestation cannot rescue a wrong ID, wrong sender URL, opaque origin or child frame',async()=>{
 for(const patch of [{id:'other-extension'},{url:'https://chatgpt.com/'},{origin:'null'},{frameId:2}]){
  const s=system({contexts:[context()]});
  assert.equal((await s.send(panel({...patch,tab:{id:9,url:'https://chatgpt.com/'}}))).ok,false);
  assert.equal(s.calls.length,0);noEffects(s);
 }
});
test('denial reports bounded boolean/reason diagnostics, never URLs, IDs or API errors',async()=>{
 const s=system();const r=await s.send(panel({tab:{id:9,url:'https://private.invalid/secret'}}));
 assert.equal(r.ok,false);assert.equal(r.code,'PANEL_SOURCE_REJECTED');
 assert.equal(r.sourceCheck.idMatches,true);assert.equal(r.sourceCheck.urlMatches,true);
 assert.equal(r.sourceCheck.hasTab,true);assert.equal(r.sourceCheck.tabUrlMatches,false);
 const json=JSON.stringify(r);
 assert.ok(!json.includes('://'));assert.ok(!json.includes(ID));assert.ok(!json.includes(DOC));
 assert.ok(!json.includes('secret'));noEffects(s);
});
test('payload source fields never substitute for the real MessageSender',async()=>{
 const s=system({contexts:[context()]});
 const r=await s.send({}, {type:'NEW_CHAT',handoff:'FAKE',sender:panel(),url:PANEL,id:ID,documentId:DOC});
 assert.equal(r.ok,false);noEffects(s);
});
test('every privileged panel operation rejects an unauthenticated no-tab source',async()=>{
 for(const type of ['NEW_CHAT','CAPTURE_START','WEB_ORGANIZE','BACKUP_EXPORT','BACKUP_IMPORT',
  'BACKUP_SNAPSHOTS','BACKUP_ROLLBACK','HEALTH_CHECK','SNAPSHOT','MUTATE']){
  const s=system();const r=await s.send({}, {type});
  assert.equal(r.ok,false,type);assert.equal(r.code,'PANEL_SOURCE_REJECTED',type);noEffects(s);
 }
});
