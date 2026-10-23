const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

function withFailedOpen(kind){
  const env={Promise,Error, module:{exports:{}},indexedDB:{
    open(){
      const req={error:null};
      queueMicrotask(()=>{
        if(kind==="blocked"){req.onblocked?.();return;}
        req.error=new Error("simulated disk failure");
        req.onerror?.();
      });
      return req;
    }
  }};
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../ff-db.js"),"utf8"),env);
  return env.module.exports;
}
function withMemoryDB(initial){
  const records=new Map(Object.entries(initial||{}));
  const env={Promise,Error,JSON,Number,structuredClone,module:{exports:{}},indexedDB:{
    open(){
      const req={error:null,result:null};
      queueMicrotask(()=>{
        req.result={
          close(){},onversionchange:null,
          transaction(_store,mode){
            let aborted=false, pending;
            const tx={error:null,oncomplete:null,onerror:null,onabort:null,
              abort(){
                if(aborted)return;
                aborted=true;
                queueMicrotask(()=>tx.onabort?.());
              },
              objectStore(){return store;}};
            const store={
              get(id){
                const request={result:undefined,error:null,onsuccess:null,onerror:null};
                queueMicrotask(()=>{request.result=structuredClone(records.get(id));request.onsuccess?.();});
                return request;
              },
              getAll(){
                const request={result:undefined,error:null,onsuccess:null,onerror:null};
                queueMicrotask(()=>{request.result=structuredClone([...records.values()]);request.onsuccess?.();});
                return request;
              },
              add(record){pending={type:"add",record};},
              put(record){pending={type:"put",record};}
            };
            queueMicrotask(()=>queueMicrotask(()=>{
              if(aborted)return;
              if(mode==="readwrite"&&pending)records.set(pending.record.id,structuredClone(pending.record));
              tx.oncomplete?.();
            }));
            return tx;
          }
        };
        req.onsuccess?.();
      });
      return req;
    }
  }};
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(__dirname,"../ff-db.js"),"utf8"),env);
  return {db:env.module.exports,records};
}
test("FF IndexedDB open failure is reported rather than claiming a persisted experiment",async()=>{
  const db=withFailedOpen("failed");
  await assert.rejects(db.create({id:"ff_test123",revision:0}),/simulated disk failure/);
  await assert.rejects(db.read("ff_test123"),/simulated disk failure/);
});
test("FF blocked database upgrade rejects rather than hanging or retrying writes",async()=>{
  const db=withFailedOpen("blocked");
  await assert.rejects(db.create({id:"ff_test123",revision:0}),/blocked/);
});
test("FF rejects non-transactional or invalid revision updates",async()=>{
  const db=withFailedOpen("failed");
  await assert.rejects(db.update("id",-1,()=>({})),/invalid expected revision/);
});


test("FF late success after an IndexedDB blocked event closes the abandoned handle",async()=>{
 let req, closeCount=0;
 const dbHandle={close(){closeCount++;},onversionchange:null};
 const env={Promise,Error,module:{exports:{}},indexedDB:{
   open(){req={error:null};queueMicrotask(()=>req.onblocked?.());return req;}
 }};
 vm.createContext(env);
 vm.runInContext(fs.readFileSync(path.join(__dirname,"../ff-db.js"),"utf8"),env);
 await assert.rejects(env.module.exports.read("id_123456"),/blocked/);
 // Chrome may unblock the original open after the caller has already received
 // its rejection; nobody else will own the eventual database connection.
 req.result=dbHandle;
 req.onsuccess?.();
 assert.equal(closeCount,1,"late successful IndexedDB handle must be closed");
});
test("FF aborts an upgrade that arrives after a blocked open was abandoned",async()=>{
 let req, abortCount=0;
 const env={Promise,Error,module:{exports:{}},indexedDB:{
   open(){req={error:null};queueMicrotask(()=>req.onblocked?.());return req;}
 }};
 vm.createContext(env);
 vm.runInContext(fs.readFileSync(path.join(__dirname,"../ff-db.js"),"utf8"),env);
 await assert.rejects(env.module.exports.read("id_123456"),/blocked/);
 req.transaction={abort(){abortCount++;}};
 req.result={objectStoreNames:{contains(){return true;}}};
 req.onupgradeneeded?.();
 assert.equal(abortCount,1,"an abandoned upgrade transaction must be aborted");
});
test("FF update rejects reducers that mutate frozen input before returning a clone",async()=>{
 const previous={id:"ff_test123",revision:0,frozen:{prompt:"original"},state:"pending"};
 const {db,records}=withMemoryDB({[previous.id]:previous});
 await assert.rejects(db.update(previous.id,0,current=>{
   current.frozen.prompt="tampered";
   return {...current,revision:1};
 }),/reducer must not mutate previous/);
 assert.equal(records.get(previous.id).frozen.prompt,"original");
});
test("FF update rejects reducers that reset the previous revision to bypass CAS",async()=>{
 const previous={id:"ff_test123",revision:3,frozen:{prompt:"original"},state:"pending"};
 const {db,records}=withMemoryDB({[previous.id]:previous});
 await assert.rejects(db.update(previous.id,0,current=>{
   current.revision=0;
   return {...current,revision:1};
 }),/reducer must not mutate previous/);
 assert.equal(records.get(previous.id).revision,3);
});
test("FF update rejects mutation plus returning previous disguised as an idempotent replay",async()=>{
 const previous={id:"ff_test123",revision:1,frozen:{prompt:"original"},state:"pending"};
 const {db,records}=withMemoryDB({[previous.id]:previous});
 await assert.rejects(db.update(previous.id,0,current=>{
   current.state="done";
   return current;
 }),/reducer must not mutate previous/);
 assert.equal(records.get(previous.id).state,"pending");
});
test("FF update accepts a normal immutable update and a pure stale idempotent replay",async()=>{
 const previous={id:"ff_test123",revision:0,frozen:{prompt:"original"},state:"pending"};
 const {db}=withMemoryDB({[previous.id]:previous});
 const updated=await db.update(previous.id,0,current=>({...current,revision:1,state:"done"}));
 assert.equal(updated.state,"done");
 const replay=await db.update(previous.id,0,current=>current);
 assert.equal(replay.revision,1);
 assert.equal(replay.state,"done");
});
