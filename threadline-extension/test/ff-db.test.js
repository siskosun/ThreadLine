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
