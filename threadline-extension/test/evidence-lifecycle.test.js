const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../evidence-core.js");
const Lifecycle = require("../evidence-lifecycle.js");
const DB = require("../evidence-db.js");

async function state(shared = true) {
  const source = { id: "src_aaaaaaaa", selection: "依据", before: "前", after: "后", relation: "cites", completeness: "complete", kind: "manual", capturedAt: 1 };
  source.textHash = await Core.hashText("前依据后");
  const project = { ...Core.newProjectRecord("p_target"), takeover: true, evidenceRevision: 5 };
  return {
    projects: { p_target: project, p_other: { ...Core.newProjectRecord("p_other"), takeover: true, evidenceRevision: 2 } },
    conclusions: {
      con_aaaaaaaa: { id: "con_aaaaaaaa", projectId: "p_target", currentVersionId: "ver_aaaaaaaa", status: "adopted", adoptedAt: 1 },
      con_bbbbbbbb: { id: "con_bbbbbbbb", projectId: "p_other", currentVersionId: "ver_bbbbbbbb", status: "adopted", adoptedAt: 2 },
    },
    versions: {
      ver_aaaaaaaa: { id: "ver_aaaaaaaa", conclusionId: "con_aaaaaaaa", text: "目标结论", conditions: "", sourceCount: 1, changeType: "create", predecessorId: null, createdAt: 1, creator: "user" },
      ver_bbbbbbbb: { id: "ver_bbbbbbbb", conclusionId: "con_bbbbbbbb", text: "其他结论", conditions: "", sourceCount: 1, changeType: "create", predecessorId: null, createdAt: 2, creator: "user" },
    },
    sources: { src_aaaaaaaa: source,
      ...(shared ? {} : { src_bbbbbbbb: { ...source, id: "src_bbbbbbbb", selection: "其他依据" } }) },
    links: {
      lnk_aaaaaaaa: { id: "lnk_aaaaaaaa", versionId: "ver_aaaaaaaa", sourceId: "src_aaaaaaaa", relation: "cites" },
      lnk_bbbbbbbb: { id: "lnk_bbbbbbbb", versionId: "ver_bbbbbbbb", sourceId: shared ? "src_aaaaaaaa" : "src_bbbbbbbb", relation: "cites" },
    },
    operations: {},
  };
}
function clone(value) { return structuredClone(value); }
function fakeDb(initial) {
  const maps = {};
  for (const store of DB.STORES) maps[store] = new Map(Object.entries(initial[store] || {}));
  return {
    maps,
    transaction(names) {
      const writes = new Map(), deletes = new Set(); let done = false, aborted = false;
      const keyOf = (name, value) => name === "projects" ? value.projectId : name === "operations" ? value.operationId : value.id;
      const get = (name, key) => deletes.has(name + ":" + key) ? undefined : writes.get(name + ":" + key) || maps[name].get(key);
      const req = value => ({ result: value, set onsuccess(fn) { queueMicrotask(fn); }, set onerror(_) {} });
      const tx = {
        oncomplete: null, onabort: null, onerror: null,
        get error() { return aborted ? new Error("aborted") : null; },
        abort() { if (done) return; aborted = done = true; queueMicrotask(() => tx.onabort && tx.onabort()); },
        objectStore(name) { return {
          get(key) { return req(get(name, String(key))); },
          put(value) { writes.set(name + ":" + keyOf(name, value), clone(value)); return req(value); },
          add(value) { const key = keyOf(name, value); if (get(name, key)) throw Error("ConstraintError"); return this.put(value); },
          delete(key) { deletes.add(name + ":" + key); return req(undefined); },
        }; },
      };
      setTimeout(() => { if (done) return; done = true; for (const item of deletes) { const [name,key] = item.split(":"); maps[name].delete(key); } for (const [item,value] of writes) { const [name,key] = item.split(":"); maps[name].set(key,value); } tx.oncomplete && tx.oncomplete(); }, 0);
      return tx;
    },
  };
}

test("delete keeps a source shared by another project and leaves a text-free tombstone", async () => {
  const before = await state();
  const plan = await Lifecycle.planDelete(before, "p_target", "op_delete00001", 5);
  assert.deepEqual(plan.writes.deleteIds.sources, []);
  assert.deepEqual(plan.writes.deleteIds.conclusions, ["con_aaaaaaaa"]);
  assert.equal(plan.writes.project.deleted, true);
  assert.equal(plan.writes.project.cleanupPending, true);
  assert.equal(JSON.stringify(plan.writes.project).includes("目标结论"), false);
  assert.equal(plan.writes.ledger.projectId, "p_target");
});

test("delete operation retries exactly and rejects a stale preview", async () => {
  const before = await state();
  const first = await Lifecycle.planDelete(before, "p_target", "op_delete00002", 5);
  const after = clone(before); after.operations[first.writes.ledger.operationId] = first.writes.ledger;
  const replay = await Lifecycle.planDelete(after, "p_target", "op_delete00002", 5);
  assert.deepEqual(replay.replay, first.result);
  await assert.rejects(Lifecycle.planDelete(before, "p_target", "op_delete00003", 4), /过期/);
  await assert.rejects(Lifecycle.planDelete(after, "p_target", "op_delete00002", 4), /不同请求/);
});

test("restore rejects corrupt, empty, foreign collision and stale replacement before writes", async () => {
  const before = await state(false), pkg = Core.exportPackage(before, "p_target");
  const corrupt = clone(pkg); corrupt.sources[0].textHash = "forged";
  await assert.rejects(Lifecycle.planRestore(before, corrupt, "op_restore0001", { expectedRevision: 5, replace: true }), /哈希/);
  const empty = clone(pkg); empty.conclusions = []; empty.versions = []; empty.sources = []; empty.links = [];
  await assert.rejects(Lifecycle.planRestore(before, empty, "op_restore0002", { expectedRevision: 5, replace: true }), /空证据包/);
  const collision = clone(pkg); collision.sources[0].id = "src_bbbbbbbb"; collision.links[0].sourceId = "src_bbbbbbbb";
  await assert.rejects(Lifecycle.planRestore(before, collision, "op_restore0003", { expectedRevision: 5, replace: true }), /其他课题冲突/);
  await assert.rejects(Lifecycle.planRestore(before, pkg, "op_restore0004", { expectedRevision: 4, replace: true }), /过期/);
});

test("restore replaces a project atomically and revision exceeds an old projection marker", async () => {
  const before = await state(false), pkg = Core.exportPackage(before, "p_target"), plan =
    await Lifecycle.planRestore(before, pkg, "op_restore0005", { expectedRevision: 5, minimumRevision: 17, replace: true });
  assert.equal(plan.writes.project.evidenceRevision, 18);
  assert.equal(plan.writes.project.deleted, false);
  const db = fakeDb(before);
  await DB.applyPlan(db, plan);
  assert.equal(db.maps.projects.get("p_target").evidenceRevision, 18);
  assert.equal(db.maps.conclusions.has("con_aaaaaaaa"), true);
  assert.equal(db.maps.sources.get("src_aaaaaaaa").selection, "依据");
  assert.equal(db.maps.operations.get("op_restore0005").kind, "restore");
});

test("restore of an absent project uses null CAS and cannot overwrite another project", async () => {
  const before = await state(false), pkg = Core.exportPackage(before, "p_target");
  const absent = clone(before);
  delete absent.conclusions.con_aaaaaaaa;
  delete absent.versions.ver_aaaaaaaa;
  delete absent.links.lnk_aaaaaaaa;
  delete absent.sources.src_aaaaaaaa;
  delete absent.projects.p_target;
  const plan = await Lifecycle.planRestore(absent, pkg, "op_restore0006", { expectedRevision: null, minimumRevision: 4, replace: false });
  assert.equal(plan.expectedRevision, null);
  assert.equal(plan.writes.project.evidenceRevision, 5);
});
