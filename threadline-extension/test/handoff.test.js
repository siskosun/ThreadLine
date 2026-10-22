const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

async function exercise(initial,insertion,expected='LONG USER CONTINUATION',options={}){
  const banner={style:{},children:[],replaceChildren(){this.children=[];},
    appendChild(x){this.children.push(x);},remove(){this.removed=true;}};
  const editor={innerText:initial,textContent:options.textContent??initial,
    children:options.children??null,isContentEditable:true,focus(){},
    querySelectorAll(selector){
      if(selector==='p')return Array.from({length:options.paragraphs||0});
      if(selector==='br')return Array.from({length:options.breaks||0});
      return [];
    }};
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
      const inserted=insertion==='partial'?content.slice(0,40):content;
      editor.textContent=inserted;
      editor.innerText=options.structured?inserted.split('\n').join('\n\n'):inserted;
      if(options.structured)
        editor.children=inserted.split('\n').map(line=>({tagName:'P',innerText:line,textContent:line}));
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
test('ProseMirror empty trailing break is not mistaken for a user draft',async()=>{
 // Real empty composer: innerText is "\n", but textContent is empty and
 // there is a single placeholder paragraph/break.
 const result=await exercise('\n','exact','CONTINUATION',{textContent:'',paragraphs:1,breaks:1});
 assert.equal(result.editor.innerText,'CONTINUATION');
 assert.ok(result.outgoing.includes('HANDOFF_ACK'));
});
test('a newline text node or multi-paragraph blank draft is still protected',async()=>{
 const pasted=await exercise('\n','exact','CONTINUATION',{textContent:'\n',paragraphs:1,breaks:1});
 assert.equal(pasted.editor.innerText,'\n');
 assert.ok(!pasted.outgoing.includes('HANDOFF_ACK'));
 assert.match(pasted.banner.children[0].textContent,/不会覆盖/);
 const multiline=await exercise('\n','exact','CONTINUATION',{textContent:'',paragraphs:2,breaks:2});
 assert.equal(multiline.editor.innerText,'\n');
 assert.ok(!multiline.outgoing.includes('HANDOFF_ACK'));
 assert.match(multiline.banner.children[0].textContent,/不会覆盖/);
});
test('structural ProseMirror readback ignores visual blank lines between paragraphs',async()=>{
 // Real ProseMirror innerText inserts blank lines between top-level blocks;
 // the block texts joined by one newline are the editable document.
 const expected='第一行\n第二行\n第三行';
 const result=await exercise('\n','exact',expected,{
   textContent:'',paragraphs:1,breaks:1,
   children:[{tagName:'P',innerText:'',textContent:''}],
   structured:true
 });
 assert.equal(result.editor.innerText,'第一行\n\n第二行\n\n第三行');
 assert.ok(result.outgoing.includes('HANDOFF_ACK'));
});
