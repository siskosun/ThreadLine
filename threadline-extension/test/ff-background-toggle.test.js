const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const Core = require('../ff-core.js');

function runtime() {
  const state = new Map(), records = new Map(), handlers={};
  const key='tl_ff_enabled_v1', sender={
    id:'ff-test-extension',url:'chrome-extension://ff-test-extension/ff.html'
  };
  let disableHold=null, reads=0;
  const chrome={
    runtime:{id:sender.id,getURL:p=>'chrome-extension://ff-test-extension/'+p,
      onInstalled:{addListener(){}},onStartup:{addListener(){}},
      onMessage:{addListener(fn){handlers.message=fn;}}},
    tabs:{onUpdated:{addListener(){}},onRemoved:{addListener(){}}},
    sidePanel:{setPanelBehavior:async()=>{}},
    storage:{
      local:{
        async get(k){reads++;return {[k]:state.get(k)};},
        async set(payload) {
          if(payload[key]===false && disableHold){
            disableHold.started();await disableHold.gate;
            disableHold=null;
          }
          for(const [k,v] of Object.entries(payload))state.set(k,v);
        }
      },
      session:{get:async()=>({}),set:async()=>{},remove:async()=>{}}
    }
  };
  const FFDB={
    async create(row){if(records.has(row.id))throw new Error('duplicate');records.set(row.id,row);},
    async read(id){return records.get(id)||null;},
    async list(){return [...records.values()];},
    async update(id,revision,reducer) {
      const before=records.get(id);
      if(!before)throw new Error('missing record');
      const after=reducer(before);
      if(after!==before){
        assert.equal(before.revision,revision);
        records.set(id,after);
      }
      return after;
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../background.js'),'utf8'),{
    importScripts(){},ThreadLineFFCore:Core,ThreadLineFFDB:FFDB,chrome,
    crypto:webcrypto,URL,TextEncoder,structuredClone,Promise,Date,console
  });
  function message(payload){
    return new Promise((resolve,reject)=>{
      handlers.message(payload,sender,reply=>{
        if(reply?.ok)resolve(reply.data);
        else reject(new Error(reply?.error||'message failed'));
      });
    });
  }
  function pauseDisable(){
    let started,release;
    const entered=new Promise(r=>started=r);
    const gate=new Promise(r=>release=r);
    disableHold={started,gate};
    return {entered,release};
  }
  async function queuedWhileEnabled(promiseFactory){
    const hold=pauseDisable();
    const off=message({type:'FF_SET_ENABLED',enabled:false,ack:'local-only-no-send'});
    await hold.entered;
    const oldReads=reads;
    const op=promiseFactory();
    op.catch(()=>{}); // Attach a rejection handler before releasing the queued write.
    // The request has checked the prior on-state and is waiting for
    // the serialize queue. This catches an off-check done only BEFORE enqueue.
    for(let i=0;i<60 && reads===oldReads;i++)
      await new Promise(resolve=>setImmediate(resolve));
    assert.ok(reads>oldReads,'operation must enter its admission check');
    hold.release();
    await off;
    return {op};
  }
  return {message,records,queuedWhileEnabled};
}

test('turning FF off before queued CREATE commits must reject the stale operation',async()=>{
 const env=runtime();
 await env.message({type:'FF_SET_ENABLED',enabled:true,ack:'local-only-no-send'});
 const {op}=await env.queuedWhileEnabled(()=>env.message({
   type:'FF_CREATE',operationId:'off_race001',w0:'W',p:'P'
 }));
 await assert.rejects(op,/disabled/);
 assert.equal(env.records.size,0,'off must not allow new experiment');
});

test('turning FF off before queued RECORD commits must reject the stale operation',async()=>{
 const env=runtime();
 await env.message({type:'FF_SET_ENABLED',enabled:true,ack:'local-only-no-send'});
 const first=await env.message({type:'FF_CREATE',operationId:'off_seed001',w0:'W',p:'P'});
 const {op}=await env.queuedWhileEnabled(()=>env.message({
   type:'FF_RECORD',experimentId:first.id,branch:'A',expectedRevision:0,
   operationId:'off_race002',attemptId:'att_race002',status:'pending',phase:'created'
 }));
 await assert.rejects(op,/disabled/);
 assert.equal(env.records.get(first.id).revision,0);
});
