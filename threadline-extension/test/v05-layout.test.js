const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const base=require('node:path').join(__dirname,'..');
const html=fs.readFileSync(require('node:path').join(base,'panel.html'),'utf8');
const panel=fs.readFileSync(require('node:path').join(base,'panel.js'),'utf8');
const content=fs.readFileSync(require('node:path').join(base,'content.js'),'utf8');
test('switching is the first/default panel; report kept in secondary pane',()=>{
 const find=s=>html.indexOf(s);
 assert.ok(find('id="workspace-switch"')<find('id="workspace-research"'));
 assert.ok(find('id="quick-list"')<find('id="capture-section"'));
 assert.ok(html.includes('id="workspace-research" class="workspace-pane" role="tabpanel" aria-labelledby="nav-research" hidden'));
 assert.ok(panel.includes('let workspace = "switch"'));
 assert.ok(panel.includes('renderQuickBranches()'));
 assert.ok(panel.includes('data-action="quick-open-chat"'));
});
test('AI report promotion uses explicit human approval, not closure automation',()=>{
 const capture=fs.readFileSync(require('node:path').join(base,'capture-ui.js'),'utf8');
 assert.ok(html.includes('id="report-promote-state"'));
 assert.ok(capture.includes('function promoteAnalysisToProject'));
 assert.ok(html.includes('id="promote-review-check"'));
 assert.ok(capture.includes('ThreadLineEvidenceAdoption.open'));
 assert.ok(capture.includes('EV_ADOPT_CAPTURE'));
 assert.ok(!capture.includes('patch:{decision}'));
 const dialog=fs.readFileSync(require('node:path').join(base,'evidence-adoption-ui.js'),'utf8');
 assert.ok(dialog.includes('确认采纳'));
 assert.ok(dialog.includes('selectionStart'));
 assert.ok(!capture.includes('patch:{stage:"closed"'));
});
test('stale branch reminder stays nonblocking, unlike explicit closure',()=>{
 assert.ok(content.includes('课题状态已更新'));
 assert.ok(content.includes('当前仅提醒，不会拦截发送'));
 assert.ok(content.includes('ACK_PAGE'));
 const fn=content.slice(content.indexOf('  function guarded()'), content.indexOf('  function paint()'));
 assert.ok(!fn.includes('stale'));
});
test('legacy backup copy states its actual scope and exclusions',()=>{
 assert.ok(html.includes('不包含已采纳结论与证据、Fork 实验或临时采集全文'));
 assert.ok(html.includes('检查并替换本地课题与关联'));
 assert.ok(!html.includes('检查并导入（覆盖当前课题）'));
 assert.ok(panel.includes('替换当前所有本地课题与对话关联'));
});
test('empty evidence next action preserves any existing legacy note',()=>{
 const start=panel.indexOf('if(data.project?.legacyNote?.text)');
 const end=panel.indexOf('for (const row of data.rows)',start);
 assert.ok(start>=0&&end>start);
 const segment=panel.slice(start,end);
 assert.ok(segment.includes('holder.append(createEvidenceNext("open-research","打开研究整理"))'));
});
