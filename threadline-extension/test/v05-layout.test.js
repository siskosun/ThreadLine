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
 assert.ok(capture.includes('confirm(`确定将亲自核对后的结论发布'));
 assert.ok(capture.includes('sourceKey:key,patch:{decision,goal:brief.aim||project.goal}'));
 assert.ok(!capture.includes('patch:{stage:"closed"'));
});
test('stale branch reminder stays nonblocking, unlike explicit closure',()=>{
 assert.ok(content.includes('课题状态已更新'));
 assert.ok(content.includes('当前仅提醒，不会拦截发送'));
 assert.ok(content.includes('ACK_PAGE'));
 const fn=content.slice(content.indexOf('  function guarded()'), content.indexOf('  function paint()'));
 assert.ok(!fn.includes('stale'));
});
