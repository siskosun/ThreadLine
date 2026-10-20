/* IndexedDB capture storage. Text never leaves this browser profile except when a user explicitly sends it to ChatGPT. */
const ThreadLineCaptureDB = (()=>{
  const DB_NAME="threadline_v2_capture", VERSION=1;
  function open(){return new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,VERSION);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains("runs"))db.createObjectStore("runs",{keyPath:"id"});if(!db.objectStoreNames.contains("pages")){const p=db.createObjectStore("pages",{keyPath:["id","pageIndex","chunkIndex"]});p.createIndex("by_run","id",{unique:false});}};
    req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);
  });}
  async function transaction(store,mode,fn){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);let req;try{req=fn(tx.objectStore(store));}catch(e){tx.abort();reject(e);return;}tx.oncomplete=()=>resolve(req?.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error("存储操作中断"));});}finally{db.close();}}
  const getRun=id=>transaction("runs","readonly",os=>os.get(id));
  const putRun=run=>transaction("runs","readwrite",os=>os.put(run));
  const putPage=page=>transaction("pages","readwrite",os=>os.put(page));
  async function modifyRun(id,patch){const row=await getRun(id);if(!row)return null;const next={...row,...patch,updatedAt:Date.now()};await putRun(next);return next;}
  async function pages(id){const db=await open();try{return await new Promise((resolve,reject)=>{const tx=db.transaction("pages","readonly"),idx=tx.objectStore("pages").index("by_run"),req=idx.getAll(IDBKeyRange.only(id));req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}finally{db.close();}}
  async function resetPages(id){const db=await open();try{await new Promise((resolve,reject)=>{const tx=db.transaction("pages","readwrite"),index=tx.objectStore("pages").index("by_run"),cursor=index.openCursor(IDBKeyRange.only(id));cursor.onsuccess=()=>{const c=cursor.result;if(c){c.delete();c.continue();}};tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
  async function remove(id){const db=await open();try{await new Promise((resolve,reject)=>{const tx=db.transaction(["pages","runs"],"readwrite"),index=tx.objectStore("pages").index("by_run");const cursor=index.openCursor(IDBKeyRange.only(id));cursor.onsuccess=()=>{const c=cursor.result;if(c){c.delete();c.continue();}};tx.objectStore("runs").delete(id);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}finally{db.close();}}
  async function cleanup(maxAge=3*86400000){const db=await open();let old=[];try{old=await new Promise((resolve,reject)=>{const req=db.transaction("runs","readonly").objectStore("runs").getAll();req.onsuccess=()=>resolve((req.result||[]).filter(r=>Date.now()-r.createdAt>maxAge).map(r=>r.id));req.onerror=()=>reject(req.error);});}finally{db.close();}for(const id of old)await remove(id);return old.length;}
  return {getRun,putRun,putPage,modifyRun,pages,resetPages,remove,cleanup};
})();
if(typeof globalThis!=="undefined")globalThis.ThreadLineCaptureDB=ThreadLineCaptureDB;
