const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

async function exercise(initial,insertion,expected='LONG USER CONTINUATION'){
  const banner={style:{},children:[],replaceChildren(){this.children=[];},
    appendChild(x){this.children.push(x);},remove(){this.removed=true;}};
  const editor={innerText:initial,isContentEditable:true,focus(){}};
  const outgoing=[];
  const doc={
    body:{appendChild(){}},
    querySelector(s){
      if(s==='#tl-handoff-banner')return banner.created?banner:null;
      if(s.startsWith('#prompt-textarea,'))return editor;
      return null;
    },
    createElement(tag){
      if(tag==='div'&&!banner.created){banner.created=true;return banner;}
      return {style:{},textContent:'',appendChild(){},onclick:null};
    },
    execCommand(_op,_ui,content){
      editor.innerText=insertion==='partial'?content.slice(0,40):content;
      return true;
    }
  };
  const env={
    document:doc,navigator:{clipboard:{writeText:async()=>{}}},
    HTMLTextAreaElement:function(){},InputEvent:class {},
    chrome:{runtime:{
      id:'extension',
      lastError:null,
      onMessage:{addListener(){}},
      sendMessage(payload,callback){
        outgoing.push(payload.type);
        callback(payload.type==='HANDOFF_GET'
          ? {ok:true,data:{text:expected}} : {ok:true,data:{ok:true}});
      }
    }},
    setInterval(){return 1;},clearInterval(){},setTimeout(){},
    console,Promise
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','handoff.js'),'utf8'),env);
  await new Promise(setImmediate);
  return {editor,outgoing,banner};
}
test('ACK only for exact full continuation draft, no prefix-only success',async()=>{
 const ok=await exercise('','exact');
 assert.equal(ok.editor.innerText,'LONG USER CONTINUATION');
 assert.ok(ok.outgoing.includes('HANDOFF_ACK'));
 const damaged=await exercise('','partial','x'.repeat(100));
 assert.equal(damaged.editor.innerText.length,40);
 assert.ok(!damaged.outgoing.includes('HANDOFF_ACK'));
 assert.match(damaged.banner.children[0].textContent,/不完整或与原文不一致/);
});
test('pre-existing whitespace-only draft remains untouched and unacknowledged',async()=>{
 const result=await exercise('    ','exact');
 assert.equal(result.editor.innerText,'    ');
 assert.ok(!result.outgoing.includes('HANDOFF_ACK'));
 assert.match(result.banner.children[0].textContent,/不会覆盖/);
});
