const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../capture-core.js');
test('accepts standard and project-hosted ChatGPT conversation URLs',()=>{
  assert.equal(C.conversationId('https://chatgpt.com/c/AbC-12'),'abc-12');
  assert.equal(C.conversationId('https://chatgpt.com/g/g-p-123/c/ABC-12?model=some'),'abc-12');
  assert.equal(C.conversationId('https://evil.com/c/ABC-12'),'');
  assert.equal(C.conversationId('https://chatgpt.com/share/ABC-12'),'');
});
test('assembles chronological pages newest-first, preserves order within page and deduplicates IDs',()=>{
  const pages=[
    {pageIndex:0,chunkIndex:0,messages:[{id:'u3',role:'user',content:'三'},{id:'a3',role:'assistant',content:'三回答'}]},
    {pageIndex:1,chunkIndex:0,messages:[{id:'u1',role:'user',content:'一'},{id:'a1',role:'assistant',content:'一回答'}]},
    {pageIndex:0,chunkIndex:1,messages:[{id:'a3',role:'assistant',content:'重复三回答'},{id:'u4',role:'user',content:'四'}]},
  ];
  assert.deepEqual(C.assemble(pages).map(m=>m.id),['u1','a1','u3','a3','u4']);
});
test('does not label partial capture as complete',()=>{
  const messages=[{id:'u1',role:'user',content:'请帮我比较回归预测方法与其他算法的差别，并给出检查步骤'},{id:'a1',role:'assistant',content:'结论：回测证据尚未完全确认。下一步建议运行时间前推验证。'}];
  const b=C.digest(messages,{title:'预测研究',complete:false,url:'https://chatgpt.com/c/abc'});
  assert.equal(b.captureComplete,false);
  assert.match(b.warning,/不完整|遗漏/);
  assert.match(C.handoff(b),/不完整/);
});
test('extracts candidate conclusions and follow-ups, exposes source message indices',()=>{
  const m=[
    {id:'1',role:'user',content:'研究历史模型预测短期波动的准确性，区分已验证结论与待办事项。'},
    {id:'2',role:'assistant',content:'结论：回测误差在2024年有所改善。\n但仍需验证2026年之外的稳定性。\n下一步建议按年份分层运行回测并记录误差区间。'},
    {id:'3',role:'user',content:'继续'},
    {id:'4',role:'assistant',content:'已完成第一轮验证，但数据不足以判断长期稳定性。\n接下来优先检查跨年份泛化能力。'},
  ];
  const b=C.digest(m,{title:'模型研究',complete:true});
  assert.ok(b.conclusions.length>=1);
  assert.ok(b.next.length>=1);
  assert.ok(b.pending.length>=1);
  assert.ok(b.conclusions[0].source>=2);
  assert.equal(C.mapModel(b).length,4);
  assert.match(C.handoff(b),/历史回答中出现的结论候选/);
});
test('long analyses explicitly mark omitted messages and preserve at least beginning/end',()=>{
  const msgs=[];for(let i=0;i<120;i++)msgs.push({role:i%2?'assistant':'user',content:`第${i}条：${'非常长的研究记录。'.repeat(100)}`});
  const b=C.digest(msgs,{title:'历史课题'});
  const prompt=C.analysisPrompt(msgs,b,5200);
  assert.ok(prompt.included<msgs.length);
  assert.ok(prompt.omitted>0);
  assert.match(prompt.text,/未送入 AI/);
  assert.match(prompt.text,/严禁杜撰/);
});
