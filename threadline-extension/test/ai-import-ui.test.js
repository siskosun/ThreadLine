const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const AI=require('../ai-core.js');
const Capture=require('../capture-core.js');

async function launch({denyClipboard=true}={}){
  const elements=new Map(), sent=[];
  let startup=null, writes=0, clipboardReads=0;
  const details={open:false};
  const doc={activeElement:null,readyState:'loading',
    getElementById(id){
      if(!elements.has(id))elements.set(id,makeElement(id));
      return elements.get(id);
    },
    createElement(tag){return makeElement(tag);},
    addEventListener(name,fn){if(name==='DOMContentLoaded')startup=fn;}
  };
  function makeElement(id){
    const handlers={};
    const el={id,handlers,value:'',hidden:false,disabled:false,
      textContent:'',dataset:{},style:{},children:[],
      classList:{add(){},remove(){},toggle(){}},
      addEventListener(event,handler){handlers[event]=handler;},
      appendChild(child){this.children.push(child);return child;},
      replaceChildren(...items){this.children=[...items];},
      focus(){doc.activeElement=this;},
      closest(selector){return id==='ai-json' && selector==='details'?details:null;},
      querySelector(){return null;},
      scrollIntoView(){}
    };
    return el;
  }
  const run={id:'synthetic-run',status:'done',complete:true,
    pageCount:1,messageCount:2,title:'Fictional research',
    conversationId:'fictional-123',tabId:42,
    url:'https://chatgpt.com/c/fictional-123'};
  const pages=[{pageIndex:0,chunkIndex:0,messages:[
    {id:'first',role:'user',content:'如何分析虚构数据中一个未验证的假说？'},
    {id:'second',role:'assistant',content:'目前只有初步观察，需要进一步验证。'}
  ]}];
  const DB={async cleanup(){},async getRun(id){assert.equal(id,run.id);return run;},
    async pages(id){assert.equal(id,run.id);return pages;},
    async modifyRun(id,changes){assert.equal(id,run.id);writes++;Object.assign(run,changes);return run;}};
  const chrome={
    runtime:{lastError:null,sendMessage(payload,callback){
      sent.push(payload);
      callback({ok:true,data:payload.type==='SNAPSHOT'
        ?{state:{projects:[],chats:{}}}:{id:'new-chat'}});
    }},
    tabs:{query:async()=>[],onCreated:{addListener(){}},onRemoved:{addListener(){}},
      onUpdated:{addListener(){}}},
    storage:{local:{get:async()=>({tl_last_capture_id:run.id}),set:async()=>{}}},
    windows:{getCurrent:async()=>({id:5})}
  };
  const navigator={clipboard:{
    async readText(){clipboardReads++;if(denyClipboard)throw new Error('Read permission denied');return '{"version":1,"objective":"synthetic"}';},
    async writeText(){}
  }};
  const env={document,chrome,navigator,ThreadLineAI:AI,ThreadLineCaptureCore:Capture,
    ThreadLineCaptureDB:DB,ThreadLineResearchMap:{draw(){}},
    ThreadLineOrganizeCore:{projectName:()=>''},
    confirm:()=>true,setInterval:()=>1,setTimeout:()=>1,clearInterval:()=>{},
    URL,Date,Math,Promise,AbortController,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','capture-ui.js'),'utf8'),env);
  assert.equal(typeof startup,'function');
  await startup();
  return {get:id=>doc.getElementById(id),click:async id=>{
    const handler=doc.getElementById(id).handlers.click;
    assert.equal(typeof handler,'function',`missing click handler: ${id}`);
    return handler();
  },sent,details,doc,get writes(){return writes;},
    get clipboardReads(){return clipboardReads;},run};
}

test('denied clipboard read expands manual paste and keeps the user draft',async()=>{
  const h=await launch();
  h.get('ai-json').value='UNSENT USER DRAFT';
  await h.click('ai-import-clipboard');
  assert.equal(h.details.open,true);
  assert.equal(h.doc.activeElement,h.get('ai-json'));
  assert.equal(h.get('ai-json').value,'UNSENT USER DRAFT');
  assert.match(h.get('ai-status').textContent,/按 Ctrl\+V/);
  assert.equal(h.writes,0);
  assert.equal(h.clipboardReads,1);
});

test('narrative manual paste is rejected without changing the run',async()=>{
  const h=await launch();
  h.get('ai-json').value='## 研究目标\n研究发现仍待核实。\n```mermaid\nmindmap\n```';
  await h.click('ai-import-manual');
  assert.match(h.get('ai-status').textContent,/文字摘要或思维导图/);
  assert.equal(h.writes,0);
  assert.equal(h.run.aiReport,undefined);
});

test('manual JSON paste updates only the captured local AI report',async()=>{
  const h=await launch();
  h.get('ai-json').value='```json\n'+JSON.stringify({
    version:1,title:'Fictional research',objective:'synthetic verification',
    findings:[{text:'unverified candidate',sources:[2]}],closure:{recommendation:'unknown',reason:''}
  })+'\n```';
  await h.click('ai-import-manual');
  assert.equal(h.writes,1);
  assert.equal(h.run.aiReport.findings[0].sources[0],2);
  assert.equal(h.run.aiProvider,'manual');
  assert.match(h.get('ai-status').textContent,/导入成功/);
});

test('importable JSON chat creates a manual draft; narrative path remains separate',async()=>{
  const h=await launch();
  await h.click('ai-open-json');
  const json=h.sent.filter(m=>m.type==='NEW_CHAT');
  assert.equal(json.length,1);
  assert.equal(json[0].projectId,'');
  assert.match(json[0].handoff,/严格只输出可解析 JSON/);
  assert.doesNotMatch(json[0].handoff,/Mermaid mindmap|第一行写/);
  assert.equal(h.clipboardReads,0);
  assert.equal(h.writes,0);
  const other=await launch();
  await other.click('report-ai');
  const narrative=other.sent.filter(m=>m.type==='NEW_CHAT');
  assert.equal(narrative.length,1);
  assert.match(narrative[0].handoff,/Mermaid mindmap/);
});
