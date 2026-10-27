const test=require("node:test");
const assert=require("node:assert/strict");
const Surface=require("../library-surface.js");

function fakeApi({failUpdate=false,failSet=false}={}){
  const store={},events=[];let nextId=41;
  const api={
    runtime:{getURL(path){return "chrome-extension://scope-test/"+path;}},
    storage:{session:{
      async set(value){events.push("store");if(failSet)throw Error("storage blocked");Object.assign(store,value);},
      async get(key){events.push("get:"+key);return {[key]:store[key]};},
      async remove(key){events.push("remove");delete store[key];}
    }},
    tabs:{
      async create(options){events.push("create:"+options.url);return{id:nextId++};},
      async update(id,options){events.push("navigate:"+id);if(failUpdate)throw Error("navigation blocked");assert.equal(options.url,"chrome-extension://scope-test/panel.html");assert.equal(options.active,true);},
      async remove(id){events.push("close:"+id);}
    }
  };
  return {api,store,events};
}
test("UI-D1 source and target are handed to one exact tab before navigation",async()=>{
  const fake=fakeApi(),now=100000;
  await Surface.open({viewProjectId:"tp_projectA",sourceTabId:4,sourceChatKey:"chat:original-A"},fake.api,now);
  assert.equal(fake.events[0],"create:about:blank");
  assert.equal(fake.events[1],"store");
  assert.equal(fake.events[2],"navigate:41");
  const token=Surface.key(41);
  assert.equal(fake.store[token].viewProjectId,"tp_projectA");
  assert.equal(fake.store[token].sourceChatKey,"chat:original-A");
  assert.ok(!JSON.stringify(fake.store).includes("https://"));
  const item=await Surface.consume(41,fake.api,now+300);
  assert.equal(item.viewProjectId,"tp_projectA");
  assert.equal(item.sourceTabId,4);
  assert.equal(await Surface.consume(41,fake.api,now+301),null,"intent is strictly one-shot");
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
    sourceChatKey:"chat:one",createdAt:100};
  for(const patch of [{tabId:10},{schema:2},{viewProjectId:"a\nunsafe"},
    {sourceTabId:3,sourceChatKey:null},{sourceTabId:null,sourceChatKey:"chat:one"},
    {sourceTabId:0},{sourceChatKey:"bad\u0001id"}]){
    assert.equal(Surface.validIntent({...base,...patch},9,150),false,JSON.stringify(patch));
  }
  assert.equal(Surface.validIntent(base,9,99),false);
  assert.equal(Surface.validIntent(base,9,100+Surface.TTL_MS+1),false);
  assert.equal(Surface.validIntent(base,9,150),true);
});
test("UI-D1 invalid inputs create no tabs and navigate nowhere",async()=>{
  for(const args of [{sourceTabId:7}, {sourceChatKey:"chat:one"},
    {sourceTabId:7,sourceChatKey:"bad\nkey"}, {viewProjectId:"bad\u0000project"}]){
    const fake=fakeApi();
    await assert.rejects(()=>Surface.open(args,fake.api,200),/无效/);
    assert.deepEqual(fake.events,[]);
  }
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
