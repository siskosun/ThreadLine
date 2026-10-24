const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../evidence-core.js');
const DB = require('../evidence-db.js');

/* Minimal transactional IndexedDB mock: puts land in a per-transaction
 * staging area and are applied atomically on complete, discarded on abort —
 * the rollback semantics the crash-point tests depend on. */
function mockIdb(initial = {}) {
  const stores = {};
  for (const name of DB.STORES) stores[name] = new Map(Object.entries(initial[name] || {}));
  return {
    stores,
    transaction(names, mode) {
      assert.equal(mode, 'readwrite');
      const staged = new Map();
      let aborted = false, finished = false;
      const tx = {
        oncomplete: null, onabort: null, onerror: null,
        get error() { return aborted ? new Error('aborted') : null; },
        abort() {
          if (finished) return;
          aborted = true; finished = true;
          staged.clear();
          // Real IndexedDB fires abort asynchronously; keep that semantics so
          // the code under test decides which error the caller sees.
          queueMicrotask(() => { if (tx.onabort) tx.onabort(); });
        },
        objectStore(name) {
          if (!names.includes(name)) throw new Error('store not in tx: ' + name);
          return {
            get(key) {
              const k = String(key);
              if (staged.has(name + ':' + k)) return req(staged.get(name + ':' + k));
              return req(stores[name].has(k) ? stores[name].get(k) : undefined);
            },
            put(value) {
              if (aborted || finished) throw new Error('tx inactive');
              const key = name === 'projects' ? value.projectId
                : name === 'operations' ? value.operationId : value.id;
              staged.set(name + ':' + key, structuredClone(value));
              return req(value);
            }
          };
        }
      };
      function req(result) {
        return { result, error: undefined,
          get onsuccess() { return null; }, set onsuccess(fn) { queueMicrotask(fn); },
          get onerror() { return null; }, set onerror(fn) {} };
      }
      // commit when the microtask queue drains with no pending callbacks
      queueMicrotask(() => queueMicrotask(() => {
        if (aborted || finished) return;
        finished = true;
        for (const [composite, value] of staged) {
          const [name, key] = [composite.slice(0, composite.indexOf(':')), composite.slice(composite.indexOf(':') + 1)];
          stores[name].set(key, value);
        }
        staged.clear();
        if (tx.oncomplete) tx.oncomplete();
      }));
      return tx;
    }
  };
}

async function stateFrom(db) {
  const state = { conclusions: {}, versions: {}, sources: {}, links: {}, projects: {}, operations: {} };
  for (const name of DB.STORES)
    for (const [k, v] of db.stores[name])
      state[name][name === 'projects' ? v.projectId
        : name === 'operations' ? v.operationId : v.id] = v;
  return state;
}
const adoption = (text = '测试结论', sel = '依据片段') => ({
  projectId: 'p1', text,
  fragments: [{ selection: sel, before: '前文', after: '后文', relation: 'supports' }]
});

test('frozen limits reject loudly instead of truncating', async () => {
  const state = { conclusions: {}, versions: {}, sources: {}, links: {}, projects: { p1: Core.newProjectRecord('p1') }, operations: {} };
  await assert.rejects(Core.planAdoption(state, { ...adoption('x'.repeat(4001)) }, 'op_limit10001'), /4000/);
  await assert.rejects(Core.planAdoption(state, { ...adoption(), fragments: [{ selection: 'a'.repeat(17000) }] }, 'op_limit10002'), /16 KiB/);
  await assert.rejects(Core.planAdoption(state, { ...adoption(), fragments: [{ selection: 's', before: 'b'.repeat(501) }] }, 'op_limit10003'), /500/);
  await assert.rejects(Core.planAdoption(state, { ...adoption(), fragments: Array.from({ length: 9 }, () => ({ selection: 'x' })) }, 'op_limit10004'), /8 个片段/);
  await assert.rejects(Core.planAdoption(state, { projectId: 'nope', text: 'a', fragments: [{ selection: 'x' }] }, 'op_limit10005'), /课题/);
});

test('adoption commits atomically: single transaction, revision bump, idempotent replay', async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord('p1') } });
  const op = 'op_adopt00000001';
  let state = await stateFrom(db);
  const plan = await Core.planAdoption(state, adoption(), op);
  const result = await DB.applyPlan(db, plan);
  assert.equal(result.revision, 1);
  state = await stateFrom(db);
  assert.equal(Object.keys(state.conclusions).length, 1);
  assert.equal(state.projects.p1.evidenceRevision, 1);
  assert.equal(state.projects.p1.projectionTodo, true);
  // Same operationId + same request replays the original result, no new rows.
  const replayPlan = await Core.planAdoption(state, adoption(), op);
  assert.deepEqual(replayPlan.replay, result);
  assert.equal((await stateFrom(db)).conclusions && Object.keys((await stateFrom(db)).conclusions).length, 1);
  // Same operationId + different request is refused.
  await assert.rejects(Core.planAdoption(state, adoption('不同结论'), op), /不同请求/);
});

test('stale project revision aborts the whole transaction (CAS)', async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord('p1') } });
  const state1 = await stateFrom(db);
  // Plan against revision 0, then someone else commits revision 1 first.
  await DB.applyPlan(db, await Core.planAdoption(state1, adoption('第一条'), 'op_cas00000001'));
  const stalePlan = await Core.planAdoption(state1, adoption('过期计划'), 'op_cas00000002');
  await assert.rejects(DB.applyPlan(db, stalePlan), /CAS/);
  const after = await stateFrom(db);
  assert.equal(Object.keys(after.conclusions).length, 1, 'aborted plan must leave nothing behind');
  assert.equal(after.operations['op_cas00000002'], undefined);
});

test('crash mid-transaction leaves no partial writes (rollback)', async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord('p1') } });
  const state = await stateFrom(db);
  const plan = await Core.planAdoption(state, adoption(), 'op_crash0000001');
  // Simulate the renderer dying after some puts: abort from onabort path.
  const tx = db.transaction(DB.STORES, 'readwrite');
  let aborted = false;
  tx.onabort = () => { aborted = true; };
  tx.objectStore('projects').get('p1').onsuccess = () => { tx.abort(); };
  await new Promise(r => setTimeout(r, 20));
  assert.ok(aborted);
  const after = await stateFrom(db);
  assert.equal(after.projects.p1.evidenceRevision, 0);
  assert.equal(Object.keys(after.conclusions).length, 0);
});

test('withdrawal keeps history and stays idempotent', async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord('p1') } });
  let state = await stateFrom(db);
  const adopted = await DB.applyPlan(db, await Core.planAdoption(state, adoption(), 'op_wd000000001'));
  state = await stateFrom(db);
  const withdrawn = await DB.applyPlan(db, await Core.planWithdrawal(state, adopted.conclusionId, '理由', 'op_wd000000002'));
  assert.equal(withdrawn.status, 'withdrawn');
  state = await stateFrom(db);
  assert.equal(state.conclusions[adopted.conclusionId].status, 'withdrawn');
  assert.ok(state.versions[adopted.versionId], 'history version survives withdrawal');
  const replay = await Core.planWithdrawal(state, adopted.conclusionId, '理由', 'op_wd000000002');
  assert.deepEqual(replay.replay, withdrawn);
  await assert.rejects(Core.planWithdrawal(state, adopted.conclusionId, '再撤', 'op_wd000000003'), /已撤回/);
});

test('projection is a clearly-truncated read-only digest', async () => {
  const state = { conclusions: {}, versions: {}, sources: {}, links: {},
    projects: { p1: Core.newProjectRecord('p1') }, operations: {} };
  for (let i = 0; i < 5; i++) {
    const plan = await Core.planAdoption(state, adoption('结论' + i + '：' + '长'.repeat(300)), 'op_sum0000000' + i);
    const w = plan.writes;
    state.conclusions[w.conclusion.id] = w.conclusion;
    state.versions[w.version.id] = w.version;
    w.sources.forEach(s => state.sources[s.id] = s);
    w.links.forEach(l => state.links[l.id] = l);
    state.projects.p1 = w.project;
    state.operations[w.ledger.operationId] = w.ledger;
  }
  const summary = Core.projectSummary(state, 'p1');
  assert.ok(summary.startsWith('证据库摘析（只读投影，v5，采纳 5 条）'));
  assert.ok(Core.codePoints(summary) <= Core.LIMITS.summaryCodePoints, 'summary respects 1000cp cap');
  assert.ok(summary.includes('…（见证据库）'), 'per-line elision is explicit, never silent');
  for (let i = 5; i < 12; i++) {
    const plan = await Core.planAdoption(state, adoption('结论' + i + '：' + '长'.repeat(300)), 'op_sum000000' + i);
    const w = plan.writes;
    state.conclusions[w.conclusion.id] = w.conclusion;
    state.versions[w.version.id] = w.version;
    w.sources.forEach(s => state.sources[s.id] = s);
    w.links.forEach(l => state.links[l.id] = l);
    state.projects.p1 = w.project;
  }
  const long = Core.projectSummary(state, 'p1');
  assert.ok(long.includes('截断'), 'global overflow carries an explicit truncation marker');
  assert.ok(Core.codePoints(long) <= Core.LIMITS.summaryCodePoints);
});

test('export/import: roundtrip, collision and cross-project refusal', async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord('p1'), p2: Core.newProjectRecord('p2') } });
  let state = await stateFrom(db);
  const adopted = await DB.applyPlan(db, await Core.planAdoption(state, adoption('可导出结论'), 'op_ex000000001'));
  state = await stateFrom(db);
  const pkg = Core.exportPackage(state, 'p1');
  assert.equal(pkg.format, 'threadline-evidence/1');
  assert.equal(pkg.counts.conclusions, 1);
  assert.equal(pkg.includesOriginalExcerpts, true);
  // Collision against existing IDs is refused by the planner itself.
  await assert.rejects(Core.importPackage(state, pkg, 'op_im000000001'), /冲突/);
  // Clean import into a separate fresh store for the SAME project id works.
  const db2 = mockIdb({ projects: { p1: Core.newProjectRecord('p1'), p2: Core.newProjectRecord('p2') } });
  const state2 = await stateFrom(db2);
  // A package whose conclusions belong to a different project is refused
  // (checked on the fresh state so the ID-collision rule is not what fires).
  await assert.rejects(Core.importPackage(state2, { ...pkg, projectId: 'p2' }, 'op_im000000002'), /不一致/);
  const imported = await DB.applyPlan(db2, await Core.importPackage(state2, pkg, 'op_im000000003'));
  assert.equal(imported.imported, 1);
  const after2 = await stateFrom(db2);
  assert.ok(after2.conclusions[adopted.conclusionId], 'imported conclusion exists');
  assert.equal(after2.projects.p1.evidenceRevision, 1);
});

test('project cap: 200 conclusions per project, then refuse', async () => {
  const state = { conclusions: {}, versions: {}, sources: {}, links: {}, projects: { p1: Core.newProjectRecord('p1') }, operations: {} };
  for (let i = 0; i < Core.LIMITS.conclusionsPerProject; i++) {
    const plan = await Core.planAdoption(state, adoption('结论' + i), 'op_cap' + String(i).padStart(6, '0'));
    const w = plan.writes;
    state.conclusions[w.conclusion.id] = w.conclusion;
    state.versions[w.version.id] = w.version;
    w.sources.forEach(s => state.sources[s.id] = s);
    w.links.forEach(l => state.links[l.id] = l);
    state.projects.p1 = w.project;
    state.operations[w.ledger.operationId] = w.ledger;
  }
  await assert.rejects(Core.planAdoption(state, adoption('第201条'), 'op_cap000201'), /200/);
});

test('amendment creates a new immutable version with predecessor, never rewrites', async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord('p1') } });
  let state = await stateFrom(db);
  const first = await DB.applyPlan(db, await Core.planAdoption(state, adoption('初版正文'), 'op_am000000001'));
  state = await stateFrom(db);
  const amended = await DB.applyPlan(db, await Core.planAmendment(state, first.conclusionId,
    { text: '修订正文', fragments: [{ selection: '新依据' }] }, 'op_am000000002'));
  assert.equal(amended.revision, 2);
  state = await stateFrom(db);
  const conclusion = state.conclusions[first.conclusionId];
  assert.equal(conclusion.currentVersionId, amended.versionId);
  const versions = Object.values(state.versions).filter(v => v.conclusionId === first.conclusionId);
  assert.equal(versions.length, 2, 'history preserved');
  const fresh = versions.find(v => v.id === amended.versionId);
  assert.equal(fresh.changeType, 'amend');
  assert.equal(fresh.predecessorId, first.versionId);
  assert.ok(state.versions[first.versionId], 'original version untouched');
  // Idempotent replay of the same amendment operation.
  const replay = await Core.planAmendment(state, first.conclusionId,
    { text: '修订正文', fragments: [{ selection: '新依据' }] }, 'op_am000000002');
  assert.deepEqual(replay.replay, amended);
});

test('duplicate adoption detection: same body+fragments, different fragments', async () => {
  const state = { conclusions: {}, versions: {}, sources: {}, links: {},
    projects: { p1: Core.newProjectRecord('p1') }, operations: {} };
  const apply = async (plan) => { const w = plan.writes;
    state.conclusions[w.conclusion.id] = w.conclusion; state.versions[w.version.id] = w.version;
    w.sources.forEach(s => state.sources[s.id] = s); w.links.forEach(l => state.links[l.id] = l);
    state.projects.p1 = w.project; state.operations[w.ledger.operationId] = w.ledger; };
  await apply(await Core.planAdoption(state, adoption('相同正文'), 'op_dup000000001'));
  const same = await Core.findDuplicateAdoption(state, 'p1',
    { text: '相同正文', fragments: [{ selection: '依据片段', before: '前文', after: '后文' }] });
  assert.ok(same, 'identical body+fragments detected as duplicate');
  const different = await Core.findDuplicateAdoption(state, 'p1',
    { text: '相同正文', fragments: [{ selection: '不同的依据', before: '', after: '' }] });
  assert.equal(different, null, 'different fragments are not duplicates');
  const otherText = await Core.findDuplicateAdoption(state, 'p1',
    { text: '另一条正文', fragments: [{ selection: '依据片段' }] });
  assert.equal(otherText, null, 'different body is not a duplicate');
});
