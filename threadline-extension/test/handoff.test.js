const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

async function exercise(initial,insertion,expected='LONG USER CONTINUATION',options={}){
  const observers=new Set();
  const mutate=()=>queueMicrotask(()=>{
    for(const observer of [...observers])observer.callback();
  });
  const banner={style:{},children:[],replaceChildren(){this.children=[];},
    isConnected:false,
    appendChild(x){this.children.push(x);},remove(){this.isConnected=false;mutate();}};
  const editor={innerText:initial,textContent:options.textContent??initial,
    children:options.children??null,childNodes:options.childNodes??null,
    isContentEditable:true,focus(){doc.activeElement=options.redirectFocus?otherDraft:editor;options.onFocus?.(nodes);},
    contains:node=>node===editor,
    closest(){return options.noForm?null:form;},
    querySelectorAll(selector){
      if(selector==='p')return Array.from({length:options.paragraphs||0});
      if(selector==='br')return Array.from({length:options.breaks||0});
      return [];
    }};
  const nodes=[...(options.composerNodes||[])];
  const otherDraft={textContent:'USER DRAFT'};
  const form={contains:el=>el===editor,querySelectorAll:()=>nodes};
  const outgoing=[];
  let insertions=0;
  const doc={
    documentElement:{},
    body:{appendChild(node){node.isConnected=true;mutate();}},
    querySelector(s){
      if(s==='#tl-handoff-banner')return banner.isConnected?banner:null;
      if(s.startsWith('#prompt-textarea,'))return editor;
      return null;
    },
    createElement(tag){
      if(tag==='div'&&!banner.created){banner.created=true;return banner;}
      return {style:{},textContent:'',appendChild(){},onclick:null};
    },
    execCommand(_op,_ui,content){
      insertions++;
      if(options.redirectFocus){otherDraft.textContent=content;return true;}
      const original=insertion==='partial'?content.slice(0,40):content;
      const inserted=options.transformInserted?options.transformInserted(original):original;
      editor.textContent=inserted;
      editor.innerText=options.structured?inserted.split('\n').join('\n\n'):inserted;
      if(options.structured)
        editor.children=(options.mapBlocks||((blocks)=>blocks))(
          inserted.split('\n').map(line=>line
          ? {tagName:'P',innerText:line,textContent:line}
          : {tagName:'P',innerText:'\n',textContent:'',
             childNodes:[{nodeType:1,tagName:'BR'}]}));
      return true;
    }
  };
  const env={
    document:doc,location:{href:options.url||'https://chatgpt.com/'},
    URL,TextEncoder,navigator:{clipboard:{writeText:options.copyText|| (async()=>{})}},
    MutationObserver:class {
      constructor(callback){this.callback=callback;}
      observe(){observers.add(this);}
      disconnect(){observers.delete(this);}
    },
    getSelection:()=>({rangeCount:1,isCollapsed:true,anchorNode:editor,focusNode:editor}),
    HTMLTextAreaElement:function(){},InputEvent:class {},
    chrome:{runtime:{
      id:'extension',
      lastError:null,
      onMessage:{addListener(){}},
      sendMessage(payload,callback){
        outgoing.push(payload.type);
        if(payload.type==='HANDOFF_BEGIN')options.onBegin?.(nodes);
        callback(payload.type==='HANDOFF_GET'
          ? {ok:true,data:{text:expected,autoAttempted:options.alreadyAttempted===true}} :
          payload.type==='HANDOFF_BEGIN'
          ? {ok:true,data:{autoFill:options.beginAllowed!==false}} :
          {ok:true,data:{ok:true}});
      }
    }},
    setInterval(){return 1;},clearInterval(){},setTimeout(){},
    console,Promise
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'..','handoff.js'),'utf8'),env);
  await new Promise(setImmediate);
  return {editor,outgoing,banner,get insertions(){return insertions;},otherDraft,observers,doc};
}

test('removed unknown-state banner recovers without another handoff operation',async()=>{
 const result=await exercise('','exact','NO REPLAY',{alreadyAttempted:true});
 const originalChildren=[...result.banner.children];
 result.banner.remove();
 await new Promise(setImmediate);
 assert.equal(result.banner.isConnected,true,'external page removal must not lose the recovery warning');
 assert.deepEqual(result.banner.children,originalChildren,'restore the same controls, not a new operation');
 assert.match(result.banner.children[0].textContent,/停止自动重试/);
 assert.equal(result.editor.innerText,'');
 assert.equal(result.insertions,0);
 assert.deepEqual(result.outgoing,['HANDOFF_GET']);
});

test('explicitly dismissed banner stays dismissed after unrelated page mutations',async()=>{
 const result=await exercise('','exact','NO REPLAY',{alreadyAttempted:true});
 result.banner.children.find(x=>x.textContent==='关闭提示').onclick();
 result.doc.body.appendChild({});
 await new Promise(setImmediate);
 assert.equal(result.banner.isConnected,false);
 assert.equal(result.observers.size,0,'dismissal must disconnect the recovery observer');
 assert.deepEqual(result.outgoing,['HANDOFF_GET']);
 assert.equal(result.insertions,0);
});

test('copy completion cannot resurrect an explicitly dismissed notice',async()=>{
 let finishCopy;
 const result=await exercise('','exact','NO REPLAY',{
   alreadyAttempted:true,copyText:()=>new Promise(resolve=>{finishCopy=resolve;})
 });
 const copying=result.banner.children.find(x=>x.textContent==='复制接续提示').onclick();
 result.banner.children.find(x=>x.textContent==='关闭提示').onclick();
 finishCopy();
 await copying;
 await new Promise(setImmediate);
 assert.equal(result.banner.isConnected,false);
 assert.equal(result.observers.size,0);
 assert.deepEqual(result.outgoing,['HANDOFF_GET']);
});

test('restoration targets the current body after a page replaces it',async()=>{
 const result=await exercise('','exact','NO REPLAY',{alreadyAttempted:true});
 let attached=null;
 result.doc.body={appendChild(node){attached=node;node.isConnected=true;}};
 result.banner.remove();
 await new Promise(setImmediate);
 assert.equal(attached,result.banner);
 assert.equal(result.insertions,0);
 assert.deepEqual(result.outgoing,['HANDOFF_GET']);
});

test('banner restoration is capped at three removals and never retries a handoff',async()=>{
 const result=await exercise('','exact','NO REPLAY',{alreadyAttempted:true});
 for(let i=0;i<3;i++){
   result.banner.remove();
   await new Promise(setImmediate);
   assert.equal(result.banner.isConnected,true,`restoration ${i+1}`);
 }
 result.banner.remove();
 await new Promise(setImmediate);
 assert.equal(result.banner.isConnected,false,'do not fight an indefinitely removing page');
 assert.equal(result.observers.size,0);
 assert.deepEqual(result.outgoing,['HANDOFF_GET']);
 assert.equal(result.insertions,0);
});

test('an exact-success banner can recover without repeated insertion or ACK',async()=>{
 const result=await exercise('','exact','EXACT ONCE');
 result.banner.remove();
 await new Promise(setImmediate);
 assert.equal(result.banner.isConnected,true);
 assert.equal(result.editor.innerText,'EXACT ONCE');
 assert.equal(result.insertions,1);
 assert.deepEqual(result.outgoing,['HANDOFF_GET','HANDOFF_BEGIN','HANDOFF_ACK']);
});
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


test('one ProseMirror trailing BR is an empty paragraph, not an extra newline',async()=>{
 const result=await exercise('\n','exact','A\n\nB',{
   textContent:'',paragraphs:1,breaks:1,structured:true
 });
 assert.equal(result.editor.children.length,3);
 assert.equal(result.editor.children[1].innerText,'\n');
 assert.equal(result.editor.children[1].textContent,'');
 assert.ok(result.outgoing.includes('HANDOFF_ACK'),
   'A + empty P + B must round-trip as A LF LF B');
 assert.match(result.banner.children[0].textContent,/逐字核对/);
});
test('a real additional blank paragraph remains a real difference, never ACKs',async()=>{
 const expected='A\n\nB';
 const result=await exercise('\n','exact',expected,{
   textContent:'',paragraphs:1,breaks:1,structured:true,
   transformInserted:s=>s.replace('A\n\nB','A\n\n\nB')
 });
 assert.equal(result.editor.children.length,4);
 assert.ok(!result.outgoing.includes('HANDOFF_ACK'));
 assert.match(result.banner.children[0].textContent,/未确认成功/);
});
test('a non-placeholder P with a BR must not be erased by structural readback',async()=>{
 const expected='A\n\nB';
 const result=await exercise('\n','exact',expected,{
   textContent:'',paragraphs:1,breaks:1,structured:true,
   mapBlocks:blocks=>blocks.map((block,index)=> index===1
     ? {tagName:'P',innerText:'\n',textContent:'',
        childNodes:[{nodeType:1,tagName:'BR'},{nodeType:1,tagName:'BR'}]}
     : block)
 });
 assert.ok(!result.outgoing.includes('HANDOFF_ACK'),
   'two BR nodes are not a lone placeholder and must stay unverified');
});

test('non-text image inside an otherwise visually empty composer is owned by the user',async()=>{
 const picture={nodeType:1,tagName:'IMG',childNodes:[]};
 const paragraph={nodeType:1,tagName:'P',childNodes:[picture]};
 const result=await exercise('\n','exact','SHOULD NEVER INSERT',{
   textContent:'',paragraphs:1,breaks:0,childNodes:[paragraph]
 });
 assert.equal(result.editor.innerText,'\n','image attachment not overwritten');
 assert.ok(!result.outgoing.includes('HANDOFF_ACK'));
 assert.match(result.banner.children[0].textContent,/不会覆盖/);
});
test('noneditable inline attachment chip is never considered a blank placeholder',async()=>{
 const chip={nodeType:1,tagName:'SPAN',childNodes:[],contentEditable:'false'};
 const paragraph={nodeType:1,tagName:'P',childNodes:[chip]};
 const result=await exercise('\n','exact','SHOULD NEVER INSERT',{
   textContent:'',paragraphs:1,breaks:0,childNodes:[paragraph]
 });
 assert.equal(result.editor.innerText,'\n');
 assert.ok(!result.outgoing.includes('HANDOFF_ACK'));
 assert.match(result.banner.children[0].textContent,/不会覆盖/);
});
test('sole empty ProseMirror paragraph with placeholder BR is safe to fill',async()=>{
 const br={nodeType:1,tagName:'BR',childNodes:[]};
 const p={nodeType:1,tagName:'P',childNodes:[br]};
 const result=await exercise('\n','exact','VALID DRAFT',{
   textContent:'',paragraphs:1,breaks:1,childNodes:[p]
 });
 assert.ok(result.outgoing.includes('HANDOFF_ACK'));
});

test('an already attempted handoff never re-inserts automatically on reload',async()=>{
 const result=await exercise('','exact','NO REPLAY',{alreadyAttempted:true});
 assert.equal(result.editor.innerText,'');
 assert.ok(!result.outgoing.includes('HANDOFF_BEGIN'));
 assert.ok(!result.outgoing.includes('HANDOFF_ACK'));
 assert.match(result.banner.children[0].textContent,/停止自动重试/);
});
test('a denied reservation must not insert or acknowledge a draft',async()=>{
 const result=await exercise('','exact','NO REPLAY',{beginAllowed:false});
 assert.equal(result.editor.innerText,'');
 assert.ok(result.outgoing.includes('HANDOFF_BEGIN'));
 assert.ok(!result.outgoing.includes('HANDOFF_ACK'));
 assert.match(result.banner.children[0].textContent,/停止自动重试/);
});

function fixtureNode(tagName,attrs={},files){
 return {tagName,files,getAttribute:name=>attrs[name]??null};
}
function protectedDraft(result,begin=false){
 assert.equal(result.insertions,0,'must not invoke the insertion command');
 assert.equal(result.editor.innerText,'','attachment draft must remain untouched');
 assert.equal(result.outgoing.includes('HANDOFF_BEGIN'),begin,'reservation boundary');
 assert.ok(!result.outgoing.includes('HANDOFF_ACK'),'occupied draft must never ACK');
}
test('external native attachment remove control protects the entire form',async()=>{
 protectedDraft(await exercise('','exact','MUST NOT INSERT',{composerNodes:[
  fixtureNode('BUTTON',{'aria-label':'移除 fictional-test.txt'})
 ]}));
});
test('external previews, file identifiers and removal controls prohibit prefill',async()=>{
 for(const node of [fixtureNode('IMG'),fixtureNode('DIV',{'data-testid':'file-preview'}),
  fixtureNode('DIV',{'data-file-id':'fictional'}),
  fixtureNode('BUTTON',{'aria-label':'Remove attachment fictional.txt'}),
  fixtureNode('DIV',{'contenteditable':'false'}),fixtureNode('DIV',{role:'progressbar'}),
  fixtureNode('INPUT',{type:'file'},[{name:'fictional.txt'}])]){
  protectedDraft(await exercise('','exact','MUST NOT INSERT',{composerNodes:[node]}));
 }
});
test('ordinary upload controls without selected files permit prefill',async()=>{
 const result=await exercise('','exact','SAFE',{composerNodes:[
  fixtureNode('INPUT',{type:'file',hidden:''},[]),
  fixtureNode('BUTTON',{'aria-label':'Upload files','data-testid':'upload-file-button'})
  ,fixtureNode('BUTTON',{'data-testid':'profile-button'})
 ]});
 assert.equal(result.editor.innerText,'SAFE');
 assert.ok(result.outgoing.includes('HANDOFF_ACK'));
});
test('attachment arriving during reservation or focus blocks the final insertion',async()=>{
 for(const hook of ['onBegin','onFocus']){
  protectedDraft(await exercise('','exact','MUST NOT INSERT',{
   [hook]:nodes=>nodes.push(fixtureNode('BUTTON',{'aria-label':'Remove fictional.txt'}))
  }),true);
 }
});
test('missing form or unreadable selected-file state fails closed',async()=>{
 protectedDraft(await exercise('','exact','MUST NOT INSERT',{noForm:true}));
 protectedDraft(await exercise('','exact','MUST NOT INSERT',{
  composerNodes:[fixtureNode('INPUT',{type:'file'})]
 }));
});
test('redirected focus never invokes document-wide insertion into another draft',async()=>{
 const result=await exercise('','exact','MUST NOT INSERT',{redirectFocus:true});
 protectedDraft(result,true);
 assert.equal(result.otherDraft.textContent,'USER DRAFT');
});
