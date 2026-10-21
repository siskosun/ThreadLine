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
  assert.equal(r.parts.conversation.observed.userText,true);
  assert.equal(r.parts.conversation.observed.assistantText,true);
  assert.match(r.notes,/尚未确认角色归属/);
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
  assert.equal(r.parts.conversation.candidate,true);
  assert.equal(r.parts.conversation.observed.userText,false);
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
