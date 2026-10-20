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
