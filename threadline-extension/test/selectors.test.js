const test=require('node:test'),assert=require('node:assert/strict');const Selector=require('../selectors.js');
test('canary is read-only and only checks declared selectors',()=>{
 let called=[];const doc={querySelector(s){called.push(s);return s==='#prompt-textarea'?{}:null;}};
 const r=Selector.probe(doc,'https://chatgpt.com/c/abc');
 assert.equal(r.status,'basic_ready');assert.equal(r.operations.archive,'unverified');
 assert.ok(called.includes('#prompt-textarea'));
});
test('no composer reports degraded without guessing login state',()=>{
 const doc={querySelector(){return null;}};
 assert.equal(Selector.probe(doc,'https://chatgpt.com').status,'degraded');
});
test('origin reject unrelated tabs',()=>{
 assert.throws(()=>Selector.probe({},'https://github.com/siskosun/ThreadLine'),/只支持/);
});

test('read-only canary detects a plain submit button only in the recognized composer form',()=>{
  const goodButton={type:'submit'};
  const composer={closest(selector){assert.equal(selector,'form');return {querySelector(s){return s==='button[type="submit"]'?goodButton:null;}};}};
  const doc={querySelector(s){
    if(s==='div.ProseMirror[contenteditable="true"]')return composer;
    if(s==='main div.whitespace-pre-wrap')return {textContent:'probe user text'};
    if(s==='main p')return {textContent:'probe assistant text'};
    return null;
  }};
  const r=Selector.probe(doc,'https://chatgpt.com/c/example');
  assert.equal(r.parts.composer.available,true);
  assert.equal(r.parts.sendButton.available,true);
  assert.equal(r.parts.sendButton.method,'recognized_composer_form');
  assert.equal(r.parts.conversation.available,false);
  assert.equal(r.parts.conversation.candidate,true);
  assert.equal(r.parts.conversation.observed.whitespacePreWrap,true);
  assert.equal(r.parts.conversation.roleVerified,false);
  assert.equal(r.parts.conversation.observed.paragraph,true);
  assert.match(r.notes,/无法判定用户消息/);
});
test('unrelated submit buttons and generic main prose must not be counted as verified conversation controls',()=>{
  const doc={querySelector(s){
    if(s==='#prompt-textarea')return {closest(){return null;}};
    if(s==='form button[type="submit"]')return {};
    if(s==='main p')return {};
    return null;
  }};
  const r=Selector.probe(doc,'https://chatgpt.com/');
  assert.equal(r.parts.sendButton.available,false);
  assert.equal(r.parts.conversation.available,false);
  assert.equal(r.parts.conversation.candidate,undefined);
});
test('hidden stop controls never count as active generation',()=>{
  const Page=require('../vendor/shadow-helpers.js');
  const doc=button=>({querySelector(){return button;},defaultView:{getComputedStyle(){return {display:'block',visibility:'visible'};}}});
  assert.equal(Page.isStreaming(doc(null)),false);
  assert.equal(Page.isStreaming(doc({hidden:true})),false);
  assert.equal(Page.isStreaming(doc({hidden:false,getAttribute:()=>null,closest:()=>null,getClientRects:()=>[]})),false);
  assert.equal(Page.isStreaming(doc({hidden:false,getAttribute:()=>null,closest:()=>null,getClientRects:()=>[{x:1}]})),true);
  const invisible={hidden:false,getAttribute:()=>null,closest:()=>null,getClientRects:()=>[{x:1}]};
  const hiddenDoc={querySelector(){return invisible;},defaultView:{getComputedStyle(){return {display:'none',visibility:'visible'};}}};
  assert.equal(Page.isStreaming(hiddenDoc),false);
});


test('an empty new-chat greeting in whitespace-pre-wrap must never count as user text',()=>{
  const doc={querySelector(selector){
    if(selector==='#prompt-textarea')return {closest(){return null;}};
    if(selector==='main div.whitespace-pre-wrap')return {textContent:'我能帮你做些什么'};
    return null;
  }};
  const r=Selector.probe(doc,'https://chatgpt.com/');
  assert.equal(r.parts.conversation.available,false);
  assert.equal(r.parts.conversation.candidate,undefined);
});
test('unattributed welcome and user bubbles inside /c/ remain unverified even if a probe text appears',()=>{
  const doc={querySelector(selector){
    if(selector==='#prompt-textarea')return {closest(){return null;}};
    if(selector==='main div.whitespace-pre-wrap')return {textContent:'我能帮你做些什么'};
    if(selector==='main p')return {textContent:'收到 S2-A'};
    return null;
  }};
  const r=Selector.probe(doc,'https://chatgpt.com/c/abc-123');
  assert.equal(r.parts.conversation.available,false);
  assert.equal(r.parts.conversation.roleVerified,false);
  assert.equal(r.parts.conversation.origin,'unattributed_dom');
  assert.equal(r.parts.conversation.candidate,true);
  assert.match(r.notes,/欢迎语/);
});

test('page classification allows only plain chats and fails closed for project, temporary and unknown',()=>{
  assert.equal(Selector.pageType('https://chatgpt.com/'),'plain_chat');
  assert.equal(Selector.pageType('https://chatgpt.com/c/abc-123'),'plain_chat');
  assert.equal(Selector.pageType('https://chatgpt.com/c/ABC-123/'),'plain_chat');
  assert.equal(Selector.pageType('https://chatgpt.com/?model=auto'),'plain_chat');
  assert.equal(Selector.pageType('https://chatgpt.com/?temporary-chat=false'),'plain_chat');
  assert.equal(Selector.pageType('https://chatgpt.com/g/g-p-abc/c/abc-123'),'project_chat');
  assert.equal(Selector.pageType('https://chatgpt.com/g/g-p-abc/project'),'project_chat');
  assert.equal(Selector.pageType('https://chatgpt.com/?temporary-chat=true'),'temporary_chat');
  assert.equal(Selector.pageType('https://chatgpt.com/?temporary_chat=true'),'temporary_chat');
  assert.equal(Selector.pageType('https://chatgpt.com/?temporary-chat=1'),'unknown');
  assert.equal(Selector.pageType('https://chatgpt.com/?foo=bar'),'unknown');
  assert.equal(Selector.pageType('https://chatgpt.com/share/abc'),'unknown');
  assert.equal(Selector.pageType('https://chatgpt.com/gpts'),'unknown');
  assert.equal(Selector.pageType('https://chatgpt.com/c/'),'unknown');
  assert.equal(Selector.pageType('not a url'),'unknown');
  for (const url of ['https://chatgpt.com/','https://chatgpt.com/c/abc-123']) {
    assert.deepEqual(Selector.forkEligibility(url).allowed,true,url);
  }
  for (const url of ['https://chatgpt.com/g/g-p-abc/c/abc-123',
    'https://chatgpt.com/?temporary-chat=true','https://chatgpt.com/?foo=bar',
    'https://chatgpt.com/share/abc','not a url']) {
    assert.equal(Selector.forkEligibility(url).allowed,false,url);
  }
});

test('probe exposes Fork eligibility and fails closed in the displayed notes',()=>{
  const doc={querySelector(selector){
    if(selector==='#prompt-textarea')return {closest(){return null;}};
    return null;
  }};
  const plain=Selector.probe(doc,'https://chatgpt.com/c/abc-123');
  assert.equal(plain.pageType,'plain_chat');
  assert.equal(plain.forkAllowed,true);
  assert.match(plain.notes,/页面类型：普通聊天；Fork 允许/);
  for (const [url,type] of [
    ['https://chatgpt.com/g/g-p-abc/c/abc-123','project_chat'],
    ['https://chatgpt.com/?temporary-chat=true','temporary_chat'],
    ['https://chatgpt.com/?foo=bar','unknown']
  ]) {
    const r=Selector.probe(doc,url);
    assert.equal(r.pageType,type,url);
    assert.equal(r.forkAllowed,false,url);
    assert.match(r.notes,/Fork 拒绝/,url);
    assert.match(r.notes,/不能进入 Fork/,url);
  }
});
