const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function env(){
 const root=path.resolve(__dirname,'..');let listener;const local={},session={};
 const get=(store,key)=>key===null?{...store}:{[key]:store[key]};
 const chrome={
 runtime:{id:'backup-test',getURL:p=>'chrome-extension://backup-test/'+p,onMessage:{addListener(fn){listener=fn}},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
 sidePanel:{setPanelBehavior:async()=>{}},
 tabs:{query:async()=>[],onUpdated:{addListener(){}},onRemoved:{addListener(){}}},
 storage:{local:{get:async key=>get(local,key),set:async val=>Object.assign(local,val)},
 session:{get:async key=>get(session,key),set:async val=>Object.assign(session,val),remove:async key=>{for(const k of Array.isArray(key)?key:[key])delete session[k];}}}
 };
 const sandbox={chrome,URL,Date,Promise,structuredClone,crypto:globalThis.crypto,console,importScripts:()=>{}};
 vm.createContext(sandbox);
 for(const file of ['core.js','backup-core.js','background.js'])vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox);
 const send=input=>new Promise(resolve=>listener(input,{id:'backup-test',url:'chrome-extension://backup-test/panel.html'},resolve));
 return {send,local,session};
}
test('export/import restores project and preserves previous state snapshot',async()=>{
 const ctx=env(),created=await ctx.send({type:'MUTATE',action:{type:'createProject',name:'A'}});assert.equal(created.ok,true);
 const id=created.data.result.projectId;
 const exported=await ctx.send({type:'BACKUP_EXPORT'});
 assert.equal(exported.ok,true);assert.equal(exported.data.state.schema,2);
 await ctx.send({type:'MUTATE',action:{type:'updateProject',projectId:id,patch:{decision:'Updated'}}});
 const restored=await ctx.send({type:'BACKUP_IMPORT',json:JSON.stringify(exported.data)});
 assert.equal(restored.ok,true);
 const state=(await ctx.send({type:'SNAPSHOT'})).data.state;
 assert.equal(state.projects[0].decision,'');
 const snapshots=(await ctx.send({type:'BACKUP_SNAPSHOTS'})).data;
 assert.ok(snapshots.some(s=>s.reason==='restoreImport'));
});
test('stale expectedRevision rejects overwritten project updates',async()=>{
 const ctx=env(),r=await ctx.send({type:'MUTATE',action:{type:'createProject',name:'A'}}),id=r.data.result.projectId;
 const conflicting=await ctx.send({type:'MUTATE',action:{type:'updateProject',expectedRevision:0,projectId:id,patch:{decision:'danger'}}});
 assert.equal(conflicting.ok,false);assert.match(conflicting.error,/其他窗口更新/);
});
test('rollback restores old state and retains redo snapshot',async()=>{
 const ctx=env(),r=await ctx.send({type:'MUTATE',action:{type:'createProject',name:'A'}}),id=r.data.result.projectId;
 await ctx.send({type:'MUTATE',action:{type:'updateProject',projectId:id,patch:{decision:'new'}}});
 const list=(await ctx.send({type:'BACKUP_SNAPSHOTS'})).data;
 const rollback=await ctx.send({type:'BACKUP_ROLLBACK',index:list.at(-1).index});
 assert.equal(rollback.ok,true);
 const state=(await ctx.send({type:'SNAPSHOT'})).data.state;
 assert.equal(state.projects[0].decision,'');
});
test('reject broken record without resetting previously saved projects',async()=>{
 const ctx=env();await ctx.send({type:'MUTATE',action:{type:'createProject',name:'Safe'}});
 const attempted=await ctx.send({type:'BACKUP_IMPORT',json:'{"schema":2,"state":{}}'});
 assert.equal(attempted.ok,false);
 assert.equal((await ctx.send({type:'SNAPSHOT'})).data.state.projects[0].name,'Safe');
});
