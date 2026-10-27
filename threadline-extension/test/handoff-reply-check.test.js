const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

// A synthetic page-only test. No authenticated ChatGPT, no Send.
async function inspect(roles,{stop=false,broken=false}={}){
  let notice=null, insertionCalls=0;
  const host={style:{},children:[],isConnected:false,replaceChildren(){this.children=[];},
    appendChild(el){this.children.push(el);},remove(){this.isConnected=false;}};
  const editor={innerText:'',textContent:'',isContentEditable:true,children:[],childNodes:[],
    focus(){doc.activeElement=editor;},closest(){return form;},
    contains(el){return el===editor;},
    querySelectorAll(){return [];}};
  const form={contains:el=>el===editor,querySelectorAll(){return [];}};
  const doc={documentElement:{},activeElement:null,
    body:{appendChild(el){el.isConnected=true;}},
    querySelector(s){
      if(s==='#tl-handoff-banner')return host.isConnected?host:null;
      if(s.startsWith('#prompt-textarea,'))return editor;
      return stop && s.includes('stop-button')?{}:null;
    },
    querySelectorAll(){
      if(broken)throw new Error('DOM unavailable');
      return roles.map(([role,body])=>({
        innerText:body,getAttribute:name=>name==='data-message-author-role'?role:null
      }));
    },
    createElement(tag){
      if(tag==='div'&&!notice){notice=host;return host;}
      return {style:{},textContent:'',type:'',title:'',onclick:null,appendChild(){}};
    },
    execCommand(_cmd,_show,text){insertionCalls++;editor.innerText=text;editor.textContent=text;return true;}
  };
  const outgoing=[];
  const env={document:doc,location:{href:'https://chatgpt.com/'},URL,TextEncoder,
    navigator:{clipboard:{writeText:async()=>{}}},
    MutationObserver:class {observe(){}disconnect(){}},
    getSelection:()=>({rangeCount:1,isCollapsed:true,anchorNode:editor,focusNode:editor}),
    HTMLTextAreaElement:function(){},InputEvent:class {},
    chrome:{runtime:{id:'test',lastError:null,onMessage:{addListener(){}},
      sendMessage(payload,callback){
        outgoing.push(payload.type);
        callback({ok:true,data:payload.type==='HANDOFF_GET'
          ?{text:'SYNTHETIC PROMPT',autoAttempted:false}
          :payload.type==='HANDOFF_BEGIN'?{autoFill:true}:{}});
      }}},
    setInterval(){return 1;},clearInterval(){},setTimeout(){},Promise,console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','handoff.js'),'utf8'),env);
  await new Promise(setImmediate);
  const button=host.children.find(el=>el.textContent==='检查回答状态');
  assert.ok(button,'successful exact prefill exposes an opt-in check');
  button.onclick();
  const message=host.children[0].textContent;
  return {message,outgoing,insertionCalls,host};
}
test('message visible but no assistant answer does not infer server fault',async()=>{
  const r=await inspect([['user','SYNTHETIC PROMPT']]);
  assert.match(r.message,/未识别到助手正文/);
  assert.match(r.message,/不等于已证明服务端故障/);
  assert.equal(r.insertionCalls,1);
  assert.deepEqual(r.outgoing,['HANDOFF_GET','HANDOFF_BEGIN','HANDOFF_ACK']);
});
test('a prior assistant message is not mistaken for an answer to latest user',async()=>{
  const r=await inspect([['user','old'],['assistant','old reply'],['user','new']]);
  assert.match(r.message,/未识别到助手正文/);
});
test('visible response text is not treated as a finished verified answer',async()=>{
  const r=await inspect([['user','new'],['assistant','partial']]);
  assert.match(r.message,/无法据此确认回复完整/);
});
test('visible stop control only indicates possible generation',async()=>{
  const r=await inspect([['user','new']],{stop:true});
  assert.match(r.message,/可能仍在生成/);
});
test('no rendered user message or broken DOM remains unknown',async()=>{
  assert.match((await inspect([])).message,/未识别到用户消息/);
  assert.match((await inspect([],{broken:true})).message,/页面结构无法核实/);
});
