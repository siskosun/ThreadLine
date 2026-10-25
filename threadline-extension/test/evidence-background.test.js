const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {webcrypto} = require('node:crypto');
const Core = require('../core.js');
const BackupCore = require('../backup-core.js');
const TopicCore = require('../core.js');
const CaptureCore = require('../capture-core.js');
const EvidenceCore = require('../evidence-core.js');
const FFCore = require('../ff-core.js');

/* S1a background-level harness: real background.js in a vm with an
 * in-memory evidence DB implementing the evidence-db contract (authority
 * semantics of applyPlan/CAS are covered by evidence-core.test.js; here we
 * exercise the service-worker paths: projection, sealing, recovery). */
function system() {
  const session = new Map(), local = new Map(), events = {}, calls = [];
  const evidence = { conclusions: new Map(), versions: new Map(), sources: new Map(),
    links: new Map(), projects: new Map(), operations: new Map() };
  const state = () => ({ conclusions: Object.fromEntries(evidence.conclusions),
    versions: Object.fromEntries(evidence.versions), sources: Object.fromEntries(evidence.sources),
    links: Object.fromEntries(evidence.links), projects: Object.fromEntries(evidence.projects),
    operations: Object.fromEntries(evidence.operations) });
  const EvidenceDB = {
    async open() { return { name: 'mock' }; },
    async snapshot() { return state(); },
    async ensureProject(_db, projectId, C) {
      if (!evidence.projects.has(projectId))
        evidence.projects.set(projectId, C.newProjectRecord(projectId));
      return evidence.projects.get(projectId);
    },
    async applyPlan(_db, plan) {
      if (plan.replay) return plan.replay;
      const w = plan.writes;
      const project = evidence.projects.get(w.project.projectId);
      if (!project || project.evidenceRevision !== plan.expectedRevision)
        throw new Error('证据版本冲突（CAS）：请刷新后重试');
      if (w.conclusion) evidence.conclusions.set(w.conclusion.id, w.conclusion);
      if (w.version) evidence.versions.set(w.version.id, w.version);
      for (const s of w.sources || []) evidence.sources.set(s.id, s);
      for (const l of w.links || []) evidence.links.set(l.id, l);
      for (const c of w.bulkConclusions || []) evidence.conclusions.set(c.id, c);
      for (const v of w.bulkVersions || []) evidence.versions.set(v.id, v);
      for (const s of w.bulkSources || []) evidence.sources.set(s.id, s);
      for (const l of w.bulkLinks || []) evidence.links.set(l.id, l);
      evidence.projects.set(w.project.projectId, w.project);
      evidence.operations.set(w.ledger.operationId, w.ledger);
      return plan.result;
    },
    async clearProjectionTodo(_db, projectId, expectedRevision) {
      const project = evidence.projects.get(projectId);
      if (!project || project.evidenceRevision !== expectedRevision)
        return { cleared: false, stale: true };
      evidence.projects.set(projectId, { ...project,
        projectionRevision: expectedRevision, projectionTodo: false });
      return { cleared: true };
    }
  };
  const topicState = TopicCore.emptyState();
  topicState.projects.unshift({ id: 'p-taken', name: '接管课题', goal: '', decision: '旧的自由文本结论',
    stage: 'active', knowledgeVersion: 0, lastChange: null, history: [], createdAt: 1, updatedAt: 1, closedAt: null });
  topicState.projects.unshift({ id: 'p-free', name: '自由课题', goal: '', decision: '',
    stage: 'active', knowledgeVersion: 0, lastChange: null, history: [], createdAt: 1, updatedAt: 1, closedAt: null });
  const captureDB = { async putRun() {}, async getRun() { return null; }, async modifyRun() {},
    async putPage() {}, async pages() { return []; }, async resetPages() {}, async remove() {}, async cleanup() { return 0; } };
  const ffdb = { async create() {}, async createImported() {}, async read() { return null; },
    async list() { return []; }, async update() { throw new Error('unused'); } };
  let storageSetShouldFail = 0;
  const chrome = {
    runtime: { id: 'ev-bg-test', getURL: p => 'chrome-extension://ev-bg-test/' + p,
      onInstalled: { addListener() {} }, onStartup: { addListener(fn) { events.startup = fn; } },
      onMessage: { addListener(fn) { events.message = fn; } } },
    tabs: { onUpdated: { addListener() {} }, onRemoved: { addListener() {} },
      async get() { throw new Error('no tab'); }, async query() { return []; },
      async create() { return { id: 1 }; }, async update() { return {}; }, async sendMessage() { return { ok: true }; } },
    scripting: { async executeScript() {} },
    sidePanel: { setPanelBehavior: async () => {} },
    storage: {
      local: {
        async get(k) { return k == null ? Object.fromEntries(local) : { [k]: local.get(k) }; },
        async set(values) {
          if (storageSetShouldFail > 0) { storageSetShouldFail--; throw new Error('STORAGE_WRITE_FAILED'); }
          for (const [key, value] of Object.entries(values)) local.set(key, value);
        }
      },
      session: {
        async get(k) { return k == null ? Object.fromEntries(session) : { [k]: session.get(k) }; },
        async set(items) { for (const [k, v] of Object.entries(items)) session.set(k, v); },
        async remove(keys) { for (const k of [keys].flat()) session.delete(k); }
      }
    }
  };
  local.set('threadline_state_v1', structuredClone(topicState));
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), {
    importScripts() {}, ThreadLineCore: Core, ThreadLineBackup: BackupCore,
    ThreadLineCaptureCore: CaptureCore, ThreadLineCaptureDB: captureDB,
    ThreadLineFFCore: FFCore, ThreadLineFFDB: ffdb,
    ThreadLineEvidenceCore: EvidenceCore, ThreadLineEvidenceDB: EvidenceDB,
    chrome, crypto: webcrypto, console, Date, Promise, URL, TextEncoder, structuredClone
  });
  const panelSender = { id: 'ev-bg-test', url: 'chrome-extension://ev-bg-test/panel.html' };
  const evSender = { id: 'ev-bg-test', url: 'chrome-extension://ev-bg-test/evidence-prototype.html' };
  function message(payload, sender = evSender) {
    return new Promise((resolve, reject) => {
      events.message(payload, sender, reply => {
        if (reply && reply.ok) resolve(reply.data);
        else reject(new Error((reply && reply.error) || 'failed'));
      });
    });
  }
  return { message, panelSender, evSender, local, evidence, events, calls,
    failNextStorageWrites(n) { storageSetShouldFail = n; },
    readTopicState: () => local.get('threadline_state_v1'),
    storageSetShouldFailRef: () => storageSetShouldFail };
}

const adoption = (projectId, text) => ({ type: 'EV_ADOPT', projectId, text,
  fragments: [{ selection: '依据片段', before: '前文', after: '后文' }],
  operationId: 'op_s1a_' + Math.random().toString(16).slice(2, 10) });

test('first adoption takes over, captures legacy note, projects summary to storage', async () => {
  const s = system();
  await s.message({ type: 'EV_ENSURE', projectId: 'p-taken' });
  await s.message(adoption('p-taken', '第一条证据结论'));
  await new Promise(r => setImmediate(r)); // let fire-and-forget projection run
  const project = s.evidence.projects.get('p-taken');
  assert.equal(project.takeover, true, 'first adoption seals the project');
  assert.equal(project.legacyNote.text, '旧的自由文本结论', 'legacy decision preserved verbatim');
  assert.equal(project.legacyNote.verified, false, 'legacy note is explicitly unverified');
  const projection = s.local.get('tl_evidence_summary_p-taken');
  assert.ok(projection, 'chrome.storage projection written');
  assert.equal(projection.evidenceRevision, 1);
  assert.ok(projection.summary.includes('第一条证据结论'));
  assert.equal(project.projectionTodo, false, 'todo cleared after successful projection');
  assert.equal(project.projectionRevision, 1);
});

test('sealed project: decision edits refused at message level, other fields still editable', async () => {
  const s = system();
  await s.message({ type: 'EV_ENSURE', projectId: 'p-taken' });
  await s.message(adoption('p-taken', '证据结论'));
  await s.message({ type: 'EV_ENSURE', projectId: 'p-free' });
  // taken-over project: decision patch refused
  await assert.rejects(s.message({ type: 'MUTATE', action: { type: 'updateProject',
    projectId: 'p-taken', patch: { decision: '绕过封口' } } }, s.panelSender), /证据库接管/);
  // same project: goal edits still allowed
  const ok = await s.message({ type: 'MUTATE', action: { type: 'updateProject',
    projectId: 'p-taken', patch: { goal: '新目标' } } }, s.panelSender);
  assert.ok(ok);
  // untaken project: decision edits still work
  const free = await s.message({ type: 'MUTATE', action: { type: 'updateProject',
    projectId: 'p-free', patch: { decision: '自由编辑' } } }, s.panelSender);
  assert.ok(free);
});

test('old backups and rollbacks cannot overwrite a sealed decision', async () => {
  const s = system();
  const backup = await s.message({ type: 'BACKUP_EXPORT' }, s.panelSender); // pre-takeover snapshot
  await s.message({ type: 'EV_ENSURE', projectId: 'p-taken' });
  await s.message(adoption('p-taken', '证据结论'));
  await assert.rejects(s.message({ type: 'BACKUP_IMPORT', json: JSON.stringify(backup) }, s.panelSender), /证据库接管/);
  await assert.rejects(s.message({ type: 'BACKUP_ROLLBACK', index: 0 }, s.panelSender), /证据库接管|快照/);
});

test('projection failure keeps the durable todo; reads retry idempotently; startup recovers', async () => {
  const s = system();
  await s.message({ type: 'EV_ENSURE', projectId: 'p-taken' });
  s.failNextStorageWrites(1); // projection write fails after the commit
  await s.message(adoption('p-taken', '提交成功但投影失败'));
  const project = s.evidence.projects.get('p-taken');
  assert.equal(project.evidenceRevision, 1, 'authority commit succeeded');
  assert.equal(project.projectionTodo, true, 'todo stays durable on projection failure');
  assert.equal(s.local.get('tl_evidence_summary_p-taken'), undefined, 'no stale projection');
  // A read retries the projection opportunistically.
  await s.message({ type: 'EV_SUMMARY', projectId: 'p-taken' });
  await new Promise(r => setTimeout(r, 30));
  assert.ok(s.local.get('tl_evidence_summary_p-taken'), 'projection retried on read');
  // Startup recovery drains remaining todos.
  s.evidence.projects.set('p-taken', { ...s.evidence.projects.get('p-taken'), projectionTodo: true });
  await s.events.startup();
  await new Promise(r => setTimeout(r, 30));
  assert.equal(s.evidence.projects.get('p-taken').projectionTodo, false, 'startup drains pending todos');
});

test('withdrawal still projects; replay of a failed projection never double-bumps', async () => {
  const s = system();
  await s.message({ type: 'EV_ENSURE', projectId: 'p-taken' });
  const adopted = await s.message(adoption('p-taken', '将被撤回'));
  await new Promise(r => setImmediate(r));
  await s.message({ type: 'EV_WITHDRAW', conclusionId: adopted.conclusionId,
    reason: '测试撤回', operationId: 'op_s1a_wd_' + Math.random().toString(16).slice(2, 8) });
  await new Promise(r => setImmediate(r));
  const projection = s.local.get('tl_evidence_summary_p-taken');
  assert.ok(projection.summary.includes('[已撤回]'), 'withdrawal visible in projection');
  assert.equal(projection.evidenceRevision, 2);
  const project = s.evidence.projects.get('p-taken');
  assert.equal(project.legacyNote.text, '旧的自由文本结论', 'takeover note survives withdrawal (no un-seal)');
});

test('S1b: duplicate adoption replays instead of creating a twin; amendment works end to end', async () => {
  const s = system();
  await s.message({ type: 'EV_ENSURE', projectId: 'p-taken' });
  const first = await s.message(adoption('p-taken', '逐条采纳的正文'));
  const twin = await s.message(adoption('p-taken', '逐条采纳的正文'));
  assert.equal(twin.dedupe, true, 'duplicate flagged');
  assert.equal(twin.conclusionId, first.conclusionId, 'same conclusion replayed');
  const project = s.evidence.projects.get('p-taken');
  const count = [...s.evidence.conclusions.values()].filter(c => c.projectId === 'p-taken').length;
  assert.equal(count, 1, 'no twin created');
  const amended = await s.message({ type: 'EV_AMEND', conclusionId: first.conclusionId,
    text: '修订后的正文', fragments: [{ selection: '修订依据' }],
    operationId: 'op_s1b_amend_0001' });
  assert.equal(amended.versionId.length > 4, true);
  const versions = [...s.evidence.versions.values()].filter(v => v.conclusionId === first.conclusionId);
  assert.equal(versions.length, 2, 'amendment keeps history');
  await new Promise(r => setImmediate(r));
  const projection = s.local.get('tl_evidence_summary_p-taken');
  assert.ok(projection.summary.includes('修订后的正文'), 'projection reflects the amendment');
});

test('EV_LOCATE degrades to fragment-only when the conversation tab is not open', async () => {
  const s = system();
  const result = await s.message({ type: 'EV_LOCATE', conversationId: 'conv-1234',
    messageId: 'm1', role: 'user', contentPrefix: '前缀' });
  assert.equal(result.located, false);
  assert.equal(result.reason, 'conversation-not-open');
  assert.equal(result.url, 'https://chatgpt.com/c/conv-1234');
  await assert.rejects(s.message({ type: 'EV_LOCATE' }), /缺少会话 ID/);
});

test('authority revisions notify old branches exactly once, including identical summary text', async () => {
  const s = system();
  await s.message({type:'MUTATE',action:{type:'linkChat',projectId:'p-taken',key:'chat:old-branch',title:'Old',url:'https://chatgpt.com/c/old-branch'}},s.panelSender);
  const first = await s.message(adoption('p-taken','原结论'));
  let topic=s.readTopicState().projects.find(p=>p.id==='p-taken');
  assert.equal(topic.knowledgeVersion,1);
  assert.match(topic.decision,/原结论/);
  assert.equal(s.readTopicState().chats['chat:old-branch'].seenVersion,0);
  const request={type:'EV_AMEND',conclusionId:first.conclusionId,text:'更正结论',operationId:'op_replay_amend001'};
  const once=await s.message(request),twice=await s.message(request);
  assert.equal(twice.versionId,once.versionId);
  await s.message({type:'EV_SUMMARY',projectId:'p-taken'});
  s.evidence.projects.get('p-taken').projectionTodo=true; // crash after storage set, before clearing IDB todo
  await s.message({type:'EV_LIST',projectId:'p-taken'});
  topic=s.readTopicState().projects.find(p=>p.id==='p-taken');
  assert.equal(topic.knowledgeVersion,2);
  assert.equal(topic.evidenceProjectionRevision,2);
  assert.equal(topic.history.length,2);
  assert.equal(s.evidence.projects.get('p-taken').projectionRevision,2);
  await s.message({type:'EV_AMEND',conclusionId:first.conclusionId,text:'更正结论',conditions:'新适用条件',operationId:'op_condition001'});
  assert.equal(s.readTopicState().projects.find(p=>p.id==='p-taken').knowledgeVersion,3);
});

test('delete, clearClosed and old restore omitting a taken project refuse without changing data', async () => {
  const s=system(); await s.message(adoption('p-taken','保留证据'));
  await s.message({type:'MUTATE',action:{type:'updateProject',projectId:'p-taken',patch:{stage:'closed'}}},s.panelSender);
  const before=structuredClone(s.readTopicState());
  for(const action of [{type:'deleteProject',projectId:'p-taken'},{type:'clearClosed'}])
    await assert.rejects(s.message({type:'MUTATE',action},s.panelSender),/证据库接管/);
  const empty=BackupCore.create(TopicCore.emptyState());
  await assert.rejects(s.message({type:'BACKUP_IMPORT',json:JSON.stringify(empty)},s.panelSender),/证据库接管/);
  assert.deepEqual(JSON.parse(JSON.stringify(s.readTopicState())),before);
  assert.equal(s.evidence.sources.size,1);
});

test('authority loss never becomes a successful empty result or unseals legacy editing', async () => {
  const s=system(); await s.message(adoption('p-taken','不能消失'));
  const before=structuredClone(s.readTopicState());
  for(const map of Object.values(s.evidence)) map.clear();
  for(const type of ['EV_LIST','EV_SUMMARY','EV_ENSURE','EV_EXPORT'])
    await assert.rejects(s.message({type,projectId:'p-taken'}),/权威库缺失/);
  await assert.rejects(s.message({type:'MUTATE',action:{type:'updateProject',projectId:'p-taken',patch:{decision:'伪造新结论'}}},s.panelSender),/权威库缺失/);
  await assert.rejects(s.message({type:'SNAPSHOT'},s.panelSender),/权威库缺失/);
  assert.deepEqual(JSON.parse(JSON.stringify(s.readTopicState())),before);
});

test('list uses the current version pointer and text-only amendments retain original source metadata', async () => {
  const s=system();
  const first=await s.message({...adoption('p-taken','原文'),conditions:'仅 A 样本',fragments:[{selection:'原始依据',kind:'manual',capturedAt:123,captureRunId:'run-original',url:'https://example.invalid/original',conversationId:'original',messageId:'message-original'}]});
  const source=structuredClone([...s.evidence.sources.values()][0]);
  const amended=await s.message({type:'EV_AMEND',conclusionId:first.conclusionId,text:'修订正文',operationId:'op_metadata_amend1'});
  s.evidence.versions.get(first.versionId).createdAt=Date.now()+100000;
  const listing=await s.message({type:'EV_LIST',projectId:'p-taken'});
  assert.equal(listing.rows[0].current.id,amended.versionId);
  assert.equal(listing.rows[0].current.conditions,'仅 A 样本');
  assert.equal(listing.rows[0].fragments[0].id,source.id);
  assert.deepEqual([...s.evidence.sources.values()][0],source);
});

test('empty evidence restore is refused before takeover or projection changes', async () => {
  const s=system();
  await s.message({type:'EV_ENSURE',projectId:'p-free'});
  const pkg=await s.message({type:'EV_EXPORT',projectId:'p-free'});
  const before=structuredClone(s.readTopicState());
  for (const type of ['EV_IMPORT_PREVIEW','EV_IMPORT'])
    await assert.rejects(s.message({type,pkg,operationId:'op_emptyimport001'}),/空证据包/);
  assert.equal(s.evidence.projects.get('p-free').takeover,false);
  assert.equal(s.evidence.projects.get('p-free').evidenceRevision,0);
  assert.deepEqual(JSON.parse(JSON.stringify(s.readTopicState())),before);
  assert.ok(await s.message({type:'SNAPSHOT'},s.panelSender));
});

test('missing evidence links cannot silently become an evidence-free adopted conclusion', async () => {
  for(const loss of ['all','current']) {
    const s=system(); const first=await s.message(adoption('p-taken','有依据的初版'));
    const amended=await s.message({type:'EV_AMEND',conclusionId:first.conclusionId,text:'有依据的修订',operationId:'op_linkloss0001'});
    for(const [id,link] of s.evidence.links)
      if(loss==='all' || link.versionId===amended.versionId) s.evidence.links.delete(id);
    for(const type of ['EV_LIST','EV_EXPORT','EV_SUMMARY'])
      await assert.rejects(s.message({type,projectId:'p-taken'}),/版本依据链接/);
  }
});
