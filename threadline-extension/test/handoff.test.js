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
      const original=insertion==='partial'?content.slice(0,40):content;
      const inserted=options.transformInserted?options.transformInserted(original):original;
      editor.textContent=inserted;
      editor.innerText=options.structured?inserted.split('\n').join('\n\n'):inserted;
      if(options.structured)
        editor.children=inserted.split('\n').map(line=>({tagName:'P',innerText:line,textContent:line}));
      return true;
    }
  };
  const env={
    document:doc,location:{href:options.url||'https://chatgpt.com/'},
    URL,TextEncoder,navigator:{clipboard:{writeText:async()=>{}}},
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

test('handoff refuses Project, Temporary, saved chat, unknown query and foreign pages',async()=>{
 for(const url of [
  'https://chatgpt.com/?temporary-chat=true',
  'https://chatgpt.com/g/g-p-test-project',
  'https://chatgpt.com/c/abc-123',
  'https://chatgpt.com/?unreviewed=1',
  'https://example.com/'
 ]){
  const result=await exercise('','exact','NEVER INSERT',{url});
  assert.equal(result.editor.innerText,'',url);
  assert.ok(!result.outgoing.includes('HANDOFF_GET'),url);
  assert.ok(!result.outgoing.includes('HANDOFF_ACK'),url);
  assert.match(result.banner.children[0].textContent,/已停止预填/,url);
 }
});
test('CRLF-only normalization stays unacknowledged and gets a diagnostic',async()=>{
 const original='第一行\r\n第二行\r\n第三行';
 const result=await exercise('','exact',original,{
  transformInserted:s=>s.replace(/\r\n?/g,'\n')
 });
 assert.ok(!result.outgoing.includes('HANDOFF_ACK'));
 assert.match(result.banner.children[0].textContent,/仅换行符编码发生变化/);
});
test('extra blank lines in a code fence are not canonicalized or ACKed',async()=>{
 const fence=String.fromCharCode(96).repeat(3);
 const original='第一行\r\n'+fence+'\r\nconst a=1\r\n'+fence+'\r\n\r\n最后一行';
 const result=await exercise('\n','exact',original,{
  textContent:'',paragraphs:1,breaks:1,structured:true,
  transformInserted:s=>s.replace(/\r\n?/g,'\n').replace(fence+'\n\n',fence+'\n\n\n')
 });
 assert.ok(!result.outgoing.includes('HANDOFF_ACK'));
 assert.match(result.banner.children[0].textContent,/不能忽略的文本差异/);
 assert.match(result.banner.children[0].textContent,/未确认成功/);
});
