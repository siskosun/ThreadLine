const test=require("node:test");
const assert=require("node:assert/strict");
const Surface=require("../library-surface.js");

function fakeApi({failUpdate=false,failSet=false}={}){
  const store={},events=[],openTabs=[];let nextId=41;
  const api={
    runtime:{getURL(path){return "chrome-extension://scope-test/"+path;}},
    storage:{session:{
      async set(value){events.push("store");if(failSet)throw Error("storage blocked");Object.assign(store,value);},
      async get(key){
        events.push("get:"+key);
        const keys=Array.isArray(key)?key:[key];
        return Object.fromEntries(keys.map(k=>[k,store[k]]));
      },
      async remove(key){
        events.push("remove");
        for(const k of Array.isArray(key)?key:[key])delete store[k];
      }
    }},
    tabs:{
      async query({windowId,url}={}){
        return openTabs.filter(t=>t.windowId===windowId&&t.url===url);
      },
      async create(options){
        events.push("create:"+options.url);
        const tab={id:nextId++,windowId:options.windowId??5,url:options.url};
        openTabs.push(tab);return tab;
      },
      async update(id,options){
        events.push("navigate:"+id);
        if(failUpdate)throw Error("navigation blocked");
        const tab=openTabs.find(t=>t.id===id);assert.ok(tab);
        if(options.url!==undefined){
          assert.equal(options.url,"chrome-extension://scope-test/panel.html");
          tab.url=options.url;
        }
        assert.equal(options.active,true);return tab;
      },
      async remove(id){events.push("close:"+id);
        const i=openTabs.findIndex(t=>t.id===id);if(i>=0)openTabs.splice(i,1);
      },
      async reload(id){events.push("reload:"+id);
        if(failUpdate)throw Error("navigation blocked");
      }
    },
    windows:{async update(id,opts){events.push("focus:"+id);assert.equal(opts.focused,true);}}
  };
  return {api,store,events,openTabs};
}
test("UI-D1 source and target are handed to one exact tab before navigation",async()=>{
  const fake=fakeApi(),now=100000;
  await Surface.open({viewProjectId:"tp_projectA",sourceTabId:4,sourceChatKey:"chat:original-a",
    query:"目标结论",filter:"withdrawn"},fake.api,now);
  assert.equal(fake.events[0],"create:about:blank");
  assert.equal(fake.events[1],"store");
  assert.equal(fake.events[2],"navigate:41");
  const token=Surface.key(41);
  assert.equal(fake.store[token].viewProjectId,"tp_projectA");
  assert.equal(fake.store[token].sourceChatKey,"chat:original-a");
  assert.equal(fake.store[token].query,"目标结论");
  assert.equal(fake.store[token].filter,"withdrawn");
  assert.ok(!JSON.stringify(fake.store).includes("https://"));
  const item=await Surface.consume(41,fake.api,now+300);
  assert.equal(item.viewProjectId,"tp_projectA");
  assert.equal(item.sourceTabId,4);
  assert.equal(await Surface.consume(41,fake.api,now+301),null,"intent is strictly one-shot");
});
test("UI-D1 reuses same-window library tab without resetting view, even while first intent pending",async()=>{
  const fake=fakeApi(),now=100000;
  const first=await Surface.open({viewProjectId:"tp_A",windowId:5},fake.api,now);
  assert.equal(first.reused,false);
  const pending=await Surface.open({viewProjectId:"tp_B",windowId:5},fake.api,now+10);
  assert.deepEqual(pending,{tabId:first.tabId,reused:true});
  assert.equal(fake.events.filter(e=>e.startsWith("create:")).length,1);
  assert.equal(fake.store[Surface.key(first.tabId)].viewProjectId,"tp_A");
  assert.ok(fake.events.includes("focus:5"));
  await Surface.consume(first.tabId,fake.api,now+20);
  await Surface.registerOpen(fake.openTabs[0],fake.api);
  const reopened=await Surface.open({viewProjectId:"tp_B",windowId:5},fake.api,now+30);
  assert.equal(reopened.reused,true);
  assert.equal(fake.events.filter(e=>e.startsWith("create:")).length,1);
  assert.ok(fake.store[Surface.openKey(first.tabId)]);
  const newWindow=await Surface.open({viewProjectId:"tp_B",windowId:6},fake.api,now+40);
  assert.equal(newWindow.reused,false);
  assert.equal(fake.openTabs.filter(t=>t.windowId===6).length,1);
});
test("UI-D1 ignores direct panel tabs not actually registered as library",async()=>{
  const fake=fakeApi(),url=fake.api.runtime.getURL("panel.html");
  fake.openTabs.push({id:9,windowId:5,url});
  assert.equal(await Surface.findOpen(fake.api,5),null);
  assert.equal(Surface.validOpen({schema:1,tabId:9,windowId:6},fake.openTabs[0]),false);
  const created=await Surface.open({windowId:5},fake.api,200);
  assert.equal(created.reused,false);
  assert.equal(created.tabId,41);
});
test("UI-D1 intent cannot be consumed by another tab or after deadline",async()=>{
  const fake=fakeApi(),now=100000;
  await Surface.open({viewProjectId:"tp_A"},fake.api,now);
  assert.equal(await Surface.consume(42,fake.api,now+20),null);
  assert.ok(fake.store[Surface.key(41)],"another tab must not erase the intended tab's token");
  assert.equal(await Surface.consume(41,fake.api,now+Surface.TTL_MS+1),null);
  assert.equal(fake.store[Surface.key(41)],undefined);
});
test("UI-D1 forged and cross-tab intents fail closed",()=>{
  const base={schema:1,tabId:9,viewProjectId:"tp_A",sourceTabId:3,
    sourceChatKey:"chat:one",filter:"active",query:"test",createdAt:100};
  for(const patch of [{tabId:10},{schema:2},{viewProjectId:"a\nunsafe"},
    {sourceTabId:3,sourceChatKey:null},{sourceTabId:null,sourceChatKey:"chat:one"},
    {sourceTabId:0},{sourceChatKey:"bad\u0001id"},
    {filter:"invalid"},{query:"forbidden\nquery"},{query:"x".repeat(161)}]){
    assert.equal(Surface.validIntent({...base,...patch},9,150),false,JSON.stringify(patch));
  }
  assert.equal(Surface.validIntent(base,9,99),false);
  assert.equal(Surface.validIntent(base,9,100+Surface.TTL_MS+1),false);
  assert.equal(Surface.validIntent(base,9,150),true);
});
test("UI-D1 invalid inputs create no tabs and navigate nowhere",async()=>{
  for(const args of [{sourceTabId:7}, {sourceChatKey:"chat:one"},
    {sourceTabId:7,sourceChatKey:"bad\nkey"}, {viewProjectId:"bad\u0000project"},
    {query:"x".repeat(161)},{filter:"invalid"}]){
    const fake=fakeApi();
    await assert.rejects(()=>Surface.open(args,fake.api,200),/无效/);
    assert.deepEqual(fake.events,[]);
  }
});
function memoryStorage(){
 const map=new Map();
 return {getItem:key=>map.get(key)??null,setItem:(key,value)=>map.set(key,value),
   removeItem:key=>map.delete(key),has:key=>map.has(key)};
}
test("UI-D1 keeps reload view within the original tab and rejects cloned/corrupt state",()=>{
 const mem=memoryStorage(),view={viewProjectId:"tp_A",topicProjectId:"tp_B",
   sourceTabId:7,sourceChatKey:"chat:stable-a",workspace:"evidence",
   filter:"active",query:"检索限定词"};
 const saved=Surface.saveView(41,view,mem);
 assert.deepEqual(Surface.loadView(41,mem),saved);
 assert.equal(Surface.loadView(42,mem),null,"a duplicated tab must not inherit prior tab identity");
 assert.equal(mem.has(Surface.RELOAD_KEY),false,"reject stale tab state");
 Surface.saveView(41,view,mem);
 assert.equal(Surface.loadView(41,mem).query,"检索限定词");
 const bad=JSON.parse(mem.getItem(Surface.RELOAD_KEY));
 bad.filter="unsupported";
 mem.setItem(Surface.RELOAD_KEY,JSON.stringify(bad));
 assert.equal(Surface.loadView(41,mem),null);
 assert.equal(mem.has(Surface.RELOAD_KEY),false);
});
test("UI-D1 never persists invalid reading state or arbitrary page text",()=>{
 const mem=memoryStorage(),view={viewProjectId:null,topicProjectId:null,
   sourceTabId:null,sourceChatKey:null,workspace:"switch",filter:"all",query:""};
 Surface.saveView(8,view,mem);
 assert.equal(Surface.loadView(8,mem).workspace,"switch");
 for(const change of [{workspace:"research"},{query:"a\nsource"},
   {viewProjectId:"bad\u0001id"},{query:"x".repeat(161)},
   {sourceTabId:7,sourceChatKey:null}]){
   assert.throws(()=>Surface.saveView(8,{...view,...change},mem),/无效/);
 }
 assert.equal(Surface.loadView(8,mem).workspace,"switch","invalid write preserves prior view");
});
test("UI-D1 will not bind a transient tab key as source conversation",async()=>{
 const fake=fakeApi();
 await assert.rejects(()=>Surface.open({
   viewProjectId:"tp_A",sourceTabId:7,sourceChatKey:"tab:7"
 },fake.api,200),/无效/);
 assert.deepEqual(fake.events,[]);
});
test("UI-D1 interrupted navigation removes temporary intent and blank tab",async()=>{
  for(const scenario of [{failUpdate:true},{failSet:true}]){
    const fake=fakeApi(scenario);
    await assert.rejects(()=>Surface.open({viewProjectId:"tp_A"},fake.api,200));
    assert.equal(Object.keys(fake.store).length,0);
    assert.ok(fake.events.includes("close:41"));
    assert.ok(fake.events.includes("remove"));
  }
});

const CAP="cap_00000000-0000-4000-8000-000000000001";
test("UI-D3 does not open a map without an explicit validated capture run",async()=>{
 for(const candidate of ["cap_foo","cap_00000000-0000-4000-8000-000000000001\n",
  "tab:6",null]){
  const fake=fakeApi();
  await assert.rejects(()=>Surface.open({workspace:"map",mapRunId:candidate,windowId:5},
    fake.api,500),/无效/);
  assert.equal(fake.openTabs.length,0);
  assert.deepEqual(fake.events,[]);
 }
 const fake=fakeApi();
 const valid=await Surface.open({workspace:"map",mapRunId:CAP,windowId:5,
  sourceTabId:3,sourceChatKey:"chat:stable-a"},fake.api,500);
 assert.equal(valid.reused,false);
 const intent=await Surface.consume(valid.tabId,fake.api,501);
 assert.equal(intent.mapRunId,CAP);
 assert.equal(intent.workspace,"map");
 assert.equal(intent.sourceChatKey,"chat:stable-a");
 assert.equal(intent.viewProjectId,null);
});
test("UI-D3 explicit map navigation reloads exactly one registered same-window library and never duplicates",async()=>{
 const fake=fakeApi(),now=500;
 const first=await Surface.open({viewProjectId:"tp_A",windowId:5},fake.api,now);
 await Surface.consume(first.tabId,fake.api,now+1);
 await Surface.registerOpen(fake.openTabs[0],fake.api);
 const newMap=await Surface.open({workspace:"map",mapRunId:CAP,windowId:5},fake.api,now+2);
 assert.equal(newMap.reused,true);
 assert.equal(newMap.navigated,true);
 assert.deepEqual(fake.events.filter(e=>e.startsWith("reload:")),["reload:"+first.tabId]);
 assert.equal(fake.openTabs.filter(t=>t.windowId===5).length,1);
 const intent=await Surface.consume(first.tabId,fake.api,now+3);
 assert.equal(intent.workspace,"map");
 assert.equal(intent.mapRunId,CAP);
 assert.equal(await Surface.consume(first.tabId,fake.api,now+4),null);
 const regular=await Surface.open({viewProjectId:"tp_B",windowId:5},fake.api,now+5);
 assert.equal(regular.reused,true);
 assert.equal(fake.events.filter(e=>e.startsWith("reload:")).length,1,
   "ordinary library return must not reset map or search");
});
test("UI-D3 reload failure removes unconsumed map intent but preserves old library tab",async()=>{
 const fake=fakeApi({failUpdate:true});
 fake.openTabs.push({id:88,windowId:5,url:fake.api.runtime.getURL("panel.html")});
 await Surface.registerOpen(fake.openTabs[0],fake.api);
 await assert.rejects(()=>Surface.open({workspace:"map",mapRunId:CAP,windowId:5},
   fake.api,500),/navigation blocked/);
 assert.equal(fake.store[Surface.key(88)],undefined);
 assert.equal(fake.openTabs.length,1);
});
test("UI-D3 map reading state is exact-tab scoped and cannot become another browser's work target",()=>{
 const mem=memoryStorage();
 const record={viewProjectId:"tp_A",topicProjectId:"tp_A",
   sourceTabId:null,sourceChatKey:null,workspace:"map",
   filter:"all",query:"",mapRunId:CAP};
 Surface.saveView(41,record,mem);
 assert.equal(Surface.loadView(41,mem).mapRunId,CAP);
 assert.equal(Surface.loadView(42,mem),null);
 assert.equal(Surface.loadView(41,mem),null,
   "attempted cloned-tab read invalidates the one-tab reload slot");
 Surface.saveView(41,record,mem);
 assert.throws(()=>Surface.saveView(41,{...record,mapRunId:"cap_invalid"},mem),/无效/);
 assert.equal(Surface.loadView(41,mem).mapRunId,CAP,
   "invalid write leaves the legitimate current tab's state untouched");
});
