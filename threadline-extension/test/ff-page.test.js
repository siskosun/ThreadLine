const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const F=require('../ff-core.js');
const source=fs.readFileSync(path.join(__dirname,'../ff-page.js'),'utf8');

async function page(options={}){
 const model=options.model||{records:new Map(),storage:new Map(),creates:[]};
 const nodes=new Map();
 const element=()=>({value:'',textContent:'',dataset:{},disabled:false,hidden:false,checked:false,
   handlers:{},children:[],attributes:{},setAttribute(k,v){this.attributes[k]=v;},addEventListener(type,fn){this.handlers[type]=fn;},
   replaceChildren(){this.children=[];},appendChild(child){this.children.push(child);}});
 const $=id=>{if(!nodes.has(id))nodes.set(id,element());return nodes.get(id);};
 let armed=false;
 const chrome={runtime:{getManifest:()=>({version:'0.8.0-test'}),sendMessage(payload,cb){
   (async()=>{
     if(payload.type==='FF_STATUS')return {enabled:true};
     if(payload.type==='FF_CREATE'){
       model.creates.push(payload.operationId);
       const id='ff_'+payload.operationId;
       if(!model.records.has(id)){
         const record=F.newExperiment(await F.freeze(payload.w0,payload.p),id);
         record.createOperationId=payload.operationId;
         model.records.set(id,record);
       }
       await options.holdCreate;
       armed=true;
       return {id};
     }
     if(payload.type===options.failAfterCreate&&armed){
       armed=false;options.failAfterCreate=null;
       throw new Error('SIMULATED_DISPLAY_FAILURE');
     }
     if(payload.type==='FF_LIST')return [...model.records.values()];
     if(payload.type==='FF_READ')return model.records.get(payload.id);
     throw new Error('unexpected message');
   })().then(data=>cb({ok:true,data}),error=>cb({ok:false,error:error.message}));
 }}};
 vm.runInNewContext(source,{document:{getElementById:$,createElement:element,querySelectorAll:()=>[]},
   sessionStorage:{getItem:k=>model.storage.get(k)??null,setItem:(k,v)=>model.storage.set(k,v),
     removeItem:k=>model.storage.delete(k)},chrome,ThreadLineFFCore:F,crypto:webcrypto,setTimeout:()=>0,clearTimeout(){}});
 await new Promise(resolve=>setImmediate(resolve));
 return {model,$,fill(){for(const [id,value] of [['ff-w0','fictional W'],['ff-p','fictional P']]){
   $(id).value=value;$(id).handlers.input();}},
   submit:()=>$('ff-create').handlers.submit({preventDefault(){}})};
}

for(const failedType of ['FF_LIST','FF_READ'])for(const reload of [false,true])
 test(`FF ${failedType} failure after committed ACK keeps manual retry idempotent (reload=${reload})`,async()=>{
   let ui=await page({failAfterCreate:failedType});ui.fill();await ui.submit();
   assert.match(ui.$('ff-notice').textContent,/SIMULATED_DISPLAY_FAILURE/);
   assert.equal(ui.model.records.size,1);
   const oldId=ui.model.creates[0];
   if(reload){ui=await page({model:ui.model});ui.fill();}
   await ui.submit();
   assert.equal(ui.model.records.size,1,'retry of a display error must not create another experiment');
   assert.deepEqual(ui.model.creates,[oldId,oldId]);
   assert.equal(ui.model.storage.size,0,'clear the recovery lease after result display succeeds');
 });

test('FF a fully displayed success ends the intent and permits an explicit second create',async()=>{
 const ui=await page();ui.fill();await ui.submit();await ui.submit();
 assert.equal(ui.model.records.size,2);
 assert.notEqual(ui.model.creates[0],ui.model.creates[1]);
});

test('FF input events cannot reopen submit while a create is in flight',async()=>{
 let release;const holdCreate=new Promise(resolve=>release=resolve);
 const ui=await page({holdCreate});ui.fill();const first=ui.submit();
 while(!ui.model.creates.length)await new Promise(resolve=>setImmediate(resolve));
 let second;
 try{
   ui.fill();
   assert.equal(ui.$('ff-save').disabled,true);
   second=ui.submit();
   await new Promise(resolve=>setImmediate(resolve));
   assert.equal(ui.model.creates.length,1);
 }finally{release();await first;await second;}
});

test('launch without a selected experiment explains instead of silently doing nothing',async()=>{
  const ui=await page();
  const btn=ui.$('ff-launch');
  await btn.handlers.click({target:btn,preventDefault(){}});
  assert.match(ui.$('ff-notice').textContent,/请先在下方/);
});
