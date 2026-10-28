const {test}=require('node:test');const assert=require('node:assert/strict');
const A=require('../ai-core.js');
const C=require('../capture-core.js');
function sample(overrides={}){return {version:1,title:'模型回测',objective:'验证短期预测',findings:[{text:'训练期模型略优',sources:[2,'M4',999,'M2']}],completed:[{text:'已完成基准回测',sources:[2]}],pending:[{text:'历史独立样本不足',sources:[4]}],next:[{text:'运行留出集检验',sources:[6]}],superseded:[{text:'旧模型结论已作废',sources:[3]}],closure:{recommendation:'active',reason:'证据仍不足'},...overrides};}
function msgs(n=10){return Array.from({length:n},(_,i)=>({role:i%2?'assistant':'user',content:`第${i+1}条研究内容：这是完整的研究记录${'结果尚未充分验证。'.repeat(8)}`}));}
test('valid JSON and markdown-fenced imports',()=>{const obj=A.normalize('```json\n'+JSON.stringify(sample())+'\n```',10);assert.equal(obj.version,1);assert.equal(obj.findings[0].sources.join(','),'2,4');});
test('enforces structure and disallows hallucinated message references',()=>{assert.deepEqual(A.normalize(sample({next:[{text:'后续',sources:[0,-1,'M999',2]}]}),8).next[0].sources,[2]);assert.throws(()=>A.normalize('{bad}',8),/JSON/);assert.throws(()=>A.normalize({version:2,objective:'x'},8),/版本/);assert.throws(()=>A.normalize({...sample(),pending:'oops'},8),/必须是数组/);});
test('keeps no-evidence items visibly unattested',()=>{const o=A.normalize(sample({findings:[{text:'证据不详',sources:['M999']}]}),8);assert.deepEqual(o.findings[0].sources,[]);const rules=C.digest(msgs(),{title:'初始',complete:false});const b=A.toBrief(o,rules,'manual');assert.match(A.mapGroups(b)[1].items[0],/无可核对消息/);});
test('accepts empty optional sections without fabricating conclusions',()=>{const r=A.normalize({version:1,objective:'预测目标'},4);assert.equal(r.findings.length,0);assert.equal(r.closure.recommendation,'unknown');});
test('unknown closure recommendation is rejected to unknown',()=>{const r=A.normalize(sample({closure:{recommendation:'finalized',reason:'很长的判断'}}),10);assert.equal(r.closure.recommendation,'unknown');});
test('segment coverage preserves all messages in correct chronology',()=>{const m=msgs(28);const s=A.segment(m,{maxChars:1200});assert.ok(s.chunks.length>2);assert.ok(s.chunks[0].includes('M1'));assert.ok(s.chunks.at(-1).includes('M28'));assert.equal(s.nonemptyCount,28);});
test('long messages are split with same evidence ID instead of truncated',()=>{const content='长段文字'.repeat(1600);const r=A.segment([{role:'assistant',content}],{maxChars:1200});assert.ok(r.chunks.length>1);assert.equal(r.chunks.map(x=>x.replace(/^\[M1 助手\]\n/,'').replace(/\n\[同一消息节选\]$/,'')).join(''),content);assert.ok(r.chunks.every(x=>x.includes('M1')));});
test('single message over 250k chars retains its ending rather than silent truncation',()=>{const big='x'.repeat(260000)+'终止哨兵';const chunks=A.segment([{role:'user',content:big}],{maxChars:10500,maxSegments:50}).chunks;assert.ok(chunks.length>22);assert.ok(chunks.at(-1).includes('终止哨兵'));});
test('too-long input fails explicitly rather than silently truncating',()=>{assert.throws(()=>A.segment(msgs(80),{maxChars:1200,maxSegments:2}),/超过|太长/);});
test('counts merging rounds correctly',()=>{assert.equal(A.mergeRounds(1),0);assert.equal(A.mergeRounds(4),1);assert.equal(A.mergeRounds(5),3);assert.equal(A.mergeRounds(18),8);});
test('hierarchical pipeline extracts every chunk and preserves current state',async()=>{const m=msgs(20);const seg=A.segment(m,{maxChars:1200});let calls=0, lastProgress;
 const fake=async ({instructions,prompt})=>{calls++;assert.match(instructions,/不可信/);if(prompt.startsWith('这是完整研究'))assert.match(prompt, /M\d+/);return JSON.stringify(sample({findings:[{text:'测试结论',sources:[2,19,500]}]}));};
 const output=await A.analyze(m,{maxChars:1200,request:fake,progress:x=>lastProgress=x,complete:false});assert.equal(output.coverage.chunks,seg.chunks.length);assert.equal(output.coverage.requests,calls);assert.equal(calls,seg.chunks.length+A.mergeRounds(seg.chunks.length));assert.equal(lastProgress.step,calls);assert.deepEqual(output.report.findings[0].sources,[2,19]);assert.equal(output.coverage.complete,false);
});
test('explicit cancellation prevents further AI requests',async()=>{const ac=new AbortController();let calls=0;await assert.rejects(()=>A.analyze(msgs(20),{maxChars:1200,signal:ac.signal,request:async()=>{calls++;ac.abort();return JSON.stringify(sample());}}),/取消/);assert.equal(calls,1);});
test('request failure propagates without manufacturing success',async()=>{await assert.rejects(()=>A.analyze(msgs(2),{request:async()=>{throw new Error('network down');}}),/network down/);});
test('AI brief never mutates authoritative closed project state',()=>{const rules=C.digest(msgs(),{title:'实际标题',projectName:'玩吧预测',projectStage:'closed',projectDecision:'已经收口',complete:true});const b=A.toBrief(sample({closure:{recommendation:'active',reason:'模型猜测还要研究'}}),rules);assert.equal(b.projectStage,'closed');assert.equal(b.projectDecision,'已经收口');assert.equal(b.closureAdvice.recommendation,'active');assert.match(C.handoff(b),/已收口/);});
test('manual ChatGPT prompt includes M ids and warns about missing middle history',()=>{const m=msgs(120);const b=C.digest(m,{title:'大课题'});const p=A.importPrompt(m,b,6000);assert.match(p.text,/M\d+ 用户/);assert.ok(p.omitted>0);assert.match(p.text,/未送入 AI/);});
test('JSON result cannot insert HTML into node structure',()=>{const report=A.normalize(sample({findings:[{text:'<script>alert(1)</script>',sources:[1]}]}),8);const brief=A.toBrief(report,C.digest(msgs(8),{title:'x'}));assert.equal(brief.conclusions[0].text,'<script>alert(1)</script>');assert.ok(A.mapGroups(brief)[1].items.length);});

test('JSON import prompt excludes summary and Mermaid instructions while readable summary stays intact',()=>{
  const m=msgs(12), b=C.digest(m,{title:'独立研究'});
  const material=C.analysisMaterial(m,b,12000);
  const readable=C.analysisPrompt(m,b,12000);
  const structured=A.importPrompt(m,b,12000);
  assert.match(readable.text,/Mermaid mindmap/);
  assert.match(readable.text,/请分析下面这项 ChatGPT 研究的对话记录/);
  assert.ok(readable.text.endsWith(material.text));
  assert.doesNotMatch(material.text,/Mermaid mindmap|第一行写/);
  assert.match(structured.text,/严格只输出可解析 JSON/);
  assert.match(structured.text,/\[M\d+ (用户|助手)\]/);
  assert.doesNotMatch(structured.text,/Mermaid mindmap|第一行写|请分析下面这项 ChatGPT 研究的对话记录/);
});
test('manual import accepts one labelled JSON block in a prose-wrapped reply',()=>{
  const payload=JSON.stringify(sample());
  const text='以下为结构化结果：\n\n```json\n'+payload+'\n```\n\n请核对来源编号。';
  const output=A.normalize(text,10);
  assert.equal(output.version,1);
  assert.equal(output.objective,'验证短期预测');
});
test('paste failure distinguishes empty text, narrative summary and malformed JSON',()=>{
  assert.throws(()=>A.normalize('   ',10),/粘贴内容为空/);
  assert.throws(()=>A.normalize('## 研究目标\n这是总结。\n```mermaid\nmindmap\n```',10),/文字摘要或思维导图/);
  assert.throws(()=>A.normalize('{"version":1,"objective":"研究",}',10),/JSON 语法错误/);
  assert.throws(()=>A.normalize('{"version":1',10),/JSON 语法错误/);
});
test('multiple JSON blocks are rejected rather than selecting a sample',()=>{
  const payload=JSON.stringify(sample());
  const input='示例：\n```json\n'+payload+'\n```\n结果：\n```json\n'+payload+'\n```';
  assert.throws(()=>A.normalize(input,10),/多个 JSON 代码块/);
});
test('manual import still rejects wrong schema even with valid syntax',()=>{
  assert.throws(()=>A.normalize('{"version":2,"objective":"更新"}',10),/版本不受支持/);
  assert.throws(()=>A.normalize('{"version":1,"objective":"更新","pending":"not-array"}',10),/字段 pending 必须是数组/);
});
