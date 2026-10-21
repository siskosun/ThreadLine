/* Independent IndexedDB storage. All writes must be routed through background.js. */
const ThreadLineFFDB=(()=>{
"use strict";
const NAME="threadline_ff_v1";
function open(){return new Promise((resolve,reject)=>{
 const req=indexedDB.open(NAME,1);
 req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains("experiments"))db.createObjectStore("experiments",{keyPath:"id"});};
 req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
});}
async function read(id){const db=await open();try{return await new Promise((resolve,reject)=>{
 const tx=db.transaction("experiments","readonly"),req=tx.objectStore("experiments").get(id);
 req.onsuccess=()=>resolve(req.result??null);req.onerror=()=>reject(req.error);
});}finally{db.close();}}
async function write(id,expectedRevision,update){
 const db=await open();
 try{return await new Promise((resolve,reject)=>{
  const tx=db.transaction("experiments","readwrite"),os=tx.objectStore("experiments");
  let value;
  const req=os.get(id);
  req.onsuccess=()=>{
   try{
    const prev=req.result??null;
    if((prev?.revision??null)!==expectedRevision)throw new Error("stale revision");
    value=update(prev);
    if(!value||value.id!==id||!Number.isSafeInteger(value.revision)||value.revision!==(prev?.revision??-1)+1)throw new Error("invalid revision");
    os.put(value);
   }catch(e){tx.abort();reject(e);}
  };
  req.onerror=()=>{tx.abort();reject(req.error);};
  tx.oncomplete=()=>resolve(value);
  tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error("transaction aborted"));
 });}finally{db.close();}}
return {NAME,read,write};
})();
if(typeof globalThis!=="undefined")globalThis.ThreadLineFFDB=ThreadLineFFDB;
if(typeof module!=="undefined")module.exports=ThreadLineFFDB;
