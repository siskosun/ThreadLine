// Synthetic acceptance probes. Expected defects are observations, never acceptance PASS.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const root = path.resolve(process.argv[2]);
const file = path.join(root, 'threadline-extension/test/evidence-background.test.js');
const raw = fs.readFileSync(file, 'utf8');
const system = new Function('require', '__dirname', raw.slice(0, raw.indexOf("test('first adoption")) + '\nreturn system;')(createRequire(file), path.dirname(file));
const Core = require(path.join(root, 'threadline-extension/evidence-core.js'));
const DB = require(path.join(root, 'threadline-extension/evidence-db.js'));
const Backup = require(path.join(root, 'threadline-extension/backup-core.js'));
const Topic = require(path.join(root, 'threadline-extension/core.js'));
const empty = () => ({ conclusions: {}, versions: {}, sources: {}, links: {}, operations: {}, projects: { p: Core.newProjectRecord('p') } });
function apply(s, p) {
  const w = p.writes;
  for (const [store, field, key] of [['conclusions','conclusion','id'], ['versions','version','id'], ['operations','ledger','operationId'], ['projects','project','projectId']])
    if(w[field]) s[store][w[field][key]] = w[field];
  for(const store of ['sources','links']) for(const row of w[store] || []) s[store][row.id] = row;
}
const adopted = () => ({ type:'EV_ADOPT', projectId:'p-taken', text:'synthetic conclusion', fragments:[{selection:'synthetic excerpt'}], operationId:'op_audit_initial1' });
(async () => {
  const results = {};
  const s = empty();
  const input = { projectId:'p', text:'claim', conditions:'only condition A', legacyDecision:'legacy note', fragments:[{selection:'excerpt',kind:'manual',conversationId:'conv-a',messageId:'message-a',captureRunId:'run-a',url:'https://example.invalid/a',capturedAt:123}] };
  apply(s, await Core.planAdoption(s, input, 'op_audit_plan001'));
  // Actual DB.snapshot transformation, with asynchronous getAll requests only.
  const fakeDb = { transaction() { return { objectStore(name) { return { getAll() {
    const req = {}; queueMicrotask(() => { req.result = Object.values(s[name]); req.onsuccess(); }); return req;
  } }; } }; } };
  const snapshot = await DB.snapshot(fakeDb);
  const retry = await Core.planAdoption(snapshot, {...input,text:'changed claim'}, 'op_audit_plan001');
  results.ledger = { keys:Object.keys(snapshot.operations), reusedIdWithDifferentBodyAccepted:!!retry.writes };
  assert.deepEqual(results.ledger.keys, ['undefined']);
  const duplicate = await Core.findDuplicateAdoption(s,'p',{...input,conditions:'different condition',fragments:[{...input.fragments[0],conversationId:'conv-b',messageId:'message-b',relation:'opposes'}]});
  results.sourceDedupe = { differentSourceAndConditionMerged:!!duplicate };
  assert.ok(duplicate);
  const c = Object.values(s.conclusions)[0];
  const f = input.fragments[0];
  const amendment = await Core.planAmendment(s,c.id,{text:'amended',fragments:[{selection:f.selection,conversationId:f.conversationId,messageId:f.messageId}]},'op_audit_amend01');
  results.amendMetadata = {conditions:amendment.writes.version.conditions,source:amendment.writes.sources.map(({kind,captureRunId,url,capturedAt})=>({kind,captureRunId,url,capturedAt}))};
  const pkg = Core.exportPackage(s,'p');
  const restored = await Core.importPackage(empty(),pkg,'op_audit_restore1');
  results.restore = {takeover:restored.writes.project.takeover,legacyNote:restored.writes.project.legacyNote};
  assert.equal(results.restore.takeover,false);
  const collision = structuredClone(pkg);
  const oldCon=collision.conclusions[0].id, oldVer=collision.versions[0].id;
  collision.conclusions[0].id='con_audit_new0001'; collision.conclusions[0].currentVersionId='ver_audit_new0001';
  collision.versions[0].id='ver_audit_new0001'; collision.versions[0].conclusionId='con_audit_new0001';
  collision.links[0].id='lnk_audit_new0001'; collision.links[0].versionId='ver_audit_new0001';
  collision.sources[0].selection='replaced excerpt'; collision.sources[0].textHash='invalid';
  const overwriting = await Core.importPackage(s,collision,'op_audit_import01');
  results.importCollision={existingSourceId:pkg.sources[0].id,overwrittenSourceId:overwriting.writes.bulkSources[0].id,invalidHashAccepted:overwriting.writes.bulkSources[0].textHash==='invalid'};
  const dangling=structuredClone(collision); dangling.sources=[];
  results.importDangling={accepted:!!(await Core.importPackage(s,dangling,'op_audit_import02')).writes};
  const bg=system(); await bg.message(adopted()); await new Promise(r=>setImmediate(r));
  results.projection={legacyDecision:bg.readTopicState().projects.find(p=>p.id==='p-taken').decision,knowledgeVersion:bg.readTopicState().projects.find(p=>p.id==='p-taken').knowledgeVersion};
  try { await bg.message({type:'MUTATE',action:{type:'updateProject',projectId:'p-taken',patch:{name:'new name',goal:'new goal',decision:results.projection.legacyDecision}}},bg.panelSender); results.topicEditRejected=false; }
  catch(e) {results.topicEditRejected=true;}
  const orphan=system(); await orphan.message(adopted()); await orphan.message({type:'MUTATE',action:{type:'deleteProject',projectId:'p-taken'}},orphan.panelSender);
  results.deletion={topicPresent:orphan.readTopicState().projects.some(p=>p.id==='p-taken'),retainedSources:orphan.evidence.sources.size};
  const backup=system(); await backup.message(adopted());
  await backup.message({type:'BACKUP_IMPORT',json:JSON.stringify(Backup.create(Topic.emptyState()))},backup.panelSender);
  results.legacyRestore={topicPresent:backup.readTopicState().projects.some(p=>p.id==='p-taken'),retainedSources:backup.evidence.sources.size};
  const missing=system(); await missing.message(adopted()); await new Promise(r=>setImmediate(r));
  for(const map of Object.values(missing.evidence)) map.clear();
  const listing=await missing.message({type:'EV_LIST',projectId:'p-taken'});
  await missing.message({type:'MUTATE',action:{type:'updateProject',projectId:'p-taken',patch:{decision:'rewrite after authority loss'}}},missing.panelSender);
  results.missingAuthority={projectionStillPresent:missing.local.has('tl_evidence_summary_p-taken'),returnedEmptySuccess:listing.rows.length===0,legacyEditAccepted:true};
  assert.ok(results.topicEditRejected && results.missingAuthority.returnedEmptySuccess);
  console.log(JSON.stringify({baseline:'f43fd072eb6f85dc78bddcc9853899c103293b73',scope:'Synthetic pure modules, actual DB snapshot transformation, existing background VM harness. Not real ChatGPT acceptance.',results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
