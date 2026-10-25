const test=require('node:test');
const assert=require('node:assert/strict');
const Source=require('../evidence-source.js');
test('source selection resolves unique paste and rejects ambiguous, forged and partial identities',()=>{
  const run={id:'run-local',complete:true},message={id:'message-exact',role:'assistant',content:'before unique after'};
  const pasted=Source.fragment(run,message,{selection:'unique',selectionStart:null});
  assert.equal(pasted.selectionStart,7);assert.equal(pasted.completeness,'partial');assert.equal(pasted.messageId,'message-exact');
  assert.throws(()=>Source.fragment(run,{...message,content:'same same'},{selection:'same'}),/多次/);
  assert.throws(()=>Source.fragment(run,message,{selection:'absent',selectionStart:0}),/不一致/);
  assert.equal(Source.fragment(run,{...message,id:'0:page-3'},{selection:message.content}).messageId,null);
  assert.equal(Source.fragment(run,{...message,hasNonText:true},{selection:message.content}).completeness,'partial');
  assert.equal(Source.fragment(run,message,{selection:message.content}).completeness,'complete');
});
