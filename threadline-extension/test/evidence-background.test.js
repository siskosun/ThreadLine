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
      if (!project || project.evidenceRevision !== w.project.evidenceRevision - 1)
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
        projectionRevision: project.projectionRevision + 1, projectionTodo: false });
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
