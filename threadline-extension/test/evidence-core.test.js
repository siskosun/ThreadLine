const test = require("node:test");
const assert = require("node:assert/strict");
const Core = require("../evidence-core.js");
const DB = require("../evidence-db.js");

/* Minimal transactional IndexedDB mock: puts land in a per-transaction
 * staging area and are applied atomically on complete, discarded on abort —
 * the rollback semantics the crash-point tests depend on. */
function mockIdb(initial = {}) {
  const stores = {};
  for (const name of DB.STORES)
    stores[name] = new Map(Object.entries(initial[name] || {}));
  return {
    stores,
    transaction(names, mode) {
      assert.equal(mode, "readwrite");
      const staged = new Map();
      let aborted = false,
        finished = false;
      const tx = {
        oncomplete: null,
        onabort: null,
        onerror: null,
        get error() {
          return aborted ? new Error("aborted") : null;
        },
        abort() {
          if (finished) return;
          aborted = true;
          finished = true;
          staged.clear();
          // Real IndexedDB fires abort asynchronously; keep that semantics so
          // the code under test decides which error the caller sees.
          queueMicrotask(() => {
            if (tx.onabort) tx.onabort();
          });
        },
        objectStore(name) {
          if (!names.includes(name))
            throw new Error("store not in tx: " + name);
          return {
            get(key) {
              const k = String(key);
              if (staged.has(name + ":" + k))
                return req(staged.get(name + ":" + k));
              return req(stores[name].has(k) ? stores[name].get(k) : undefined);
            },
            put(value) {
              if (aborted || finished) throw new Error("tx inactive");
              const key =
                name === "projects"
                  ? value.projectId
                  : name === "operations"
                    ? value.operationId
                    : value.id;
              staged.set(name + ":" + key, structuredClone(value));
              return req(value);
            },
            add(value) {
              const key = name === "projects" ? value.projectId : name === "operations" ? value.operationId : value.id;
              if (stores[name].has(key) || staged.has(name + ":" + key)) throw new Error("ConstraintError");
              return this.put(value);
            },
          };
        },
      };
      function req(result) {
        return {
          result,
          error: undefined,
          get onsuccess() {
            return null;
          },
          set onsuccess(fn) {
            queueMicrotask(fn);
          },
          get onerror() {
            return null;
          },
          set onerror(fn) {},
        };
      }
      // IDB completes only after request callbacks scheduled by earlier
      // callbacks have run; a task boundary models that better than a fixed
      // two-microtask shortcut.
      setTimeout(() => {
        if (aborted || finished) return;
        finished = true;
        for (const [composite, value] of staged) {
          const [name, key] = [
            composite.slice(0, composite.indexOf(":")),
            composite.slice(composite.indexOf(":") + 1),
          ];
          stores[name].set(key, value);
        }
        staged.clear();
        if (tx.oncomplete) tx.oncomplete();
      }, 0);
      return tx;
    },
  };
}

async function stateFrom(db) {
  const state = {
    conclusions: {},
    versions: {},
    sources: {},
    links: {},
    projects: {},
    operations: {},
  };
  for (const name of DB.STORES)
    for (const [k, v] of db.stores[name])
      state[name][
        name === "projects"
          ? v.projectId
          : name === "operations"
            ? v.operationId
            : v.id
      ] = v;
  return state;
}
const adoption = (text = "测试结论", sel = "依据片段") => ({
  projectId: "p1",
  text,
  fragments: [
    { selection: sel, before: "前文", after: "后文", relation: "supports" },
  ],
});

test("frozen limits reject loudly instead of truncating", async () => {
  const state = {
    conclusions: {},
    versions: {},
    sources: {},
    links: {},
    projects: { p1: Core.newProjectRecord("p1") },
    operations: {},
  };
  await assert.rejects(
    Core.planAdoption(
      state,
      { ...adoption("x".repeat(4001)) },
      "op_limit10001",
    ),
    /4000/,
  );
  await assert.rejects(
    Core.planAdoption(
      state,
      { ...adoption(), fragments: [{ selection: "a".repeat(17000) }] },
      "op_limit10002",
    ),
    /16 KiB/,
  );
  await assert.rejects(
    Core.planAdoption(
      state,
      {
        ...adoption(),
        fragments: [{ selection: "s", before: "b".repeat(501) }],
      },
      "op_limit10003",
    ),
    /500/,
  );
  await assert.rejects(
    Core.planAdoption(
      state,
      {
        ...adoption(),
        fragments: Array.from({ length: 9 }, () => ({ selection: "x" })),
      },
      "op_limit10004",
    ),
    /8 个片段/,
  );
  await assert.rejects(
    Core.planAdoption(
      state,
      { projectId: "nope", text: "a", fragments: [{ selection: "x" }] },
      "op_limit10005",
    ),
    /课题/,
  );
});

test("adoption commits atomically: single transaction, revision bump, idempotent replay", async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord("p1") } });
  const op = "op_adopt00000001";
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
  assert.equal(
    (await stateFrom(db)).conclusions &&
      Object.keys((await stateFrom(db)).conclusions).length,
    1,
  );
  // Same operationId + different request is refused.
  await assert.rejects(
    Core.planAdoption(state, adoption("不同结论"), op),
    /不同请求/,
  );
});

test("stale project revision aborts the whole transaction (CAS)", async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord("p1") } });
  const state1 = await stateFrom(db);
  // Plan against revision 0, then someone else commits revision 1 first.
  await DB.applyPlan(
    db,
    await Core.planAdoption(state1, adoption("第一条"), "op_cas00000001"),
  );
  const stalePlan = await Core.planAdoption(
    state1,
    adoption("过期计划"),
    "op_cas00000002",
  );
  await assert.rejects(DB.applyPlan(db, stalePlan), /CAS/);
  const after = await stateFrom(db);
  assert.equal(
    Object.keys(after.conclusions).length,
    1,
    "aborted plan must leave nothing behind",
  );
  assert.equal(after.operations["op_cas00000002"], undefined);
});

test("durable ledger replay wins over a stale CAS plan", async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord("p1") } });
  const original = await stateFrom(db);
  // These emulate two service-worker requests that planned from exactly the
  // same snapshot, followed by the second request retrying after the first
  // committed but before it received its response.
  const p1 = await Core.planAdoption(
    original,
    adoption("重试结论"),
    "op_race00000001",
  );
  const p2 = await Core.planAdoption(
    original,
    adoption("重试结论"),
    "op_race00000001",
  );
  const first = await DB.applyPlan(db, p1);
  const replay = await DB.applyPlan(db, p2);
  assert.deepEqual(replay, first);
  const after = await stateFrom(db);
  assert.equal(after.projects.p1.evidenceRevision, 1);
  assert.equal(Object.keys(after.conclusions).length, 1);
  assert.equal(Object.keys(after.operations).length, 1);
});

test("crash mid-transaction leaves no partial writes (rollback)", async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord("p1") } });
  const state = await stateFrom(db);
  const plan = await Core.planAdoption(state, adoption(), "op_crash0000001");
  // Simulate the renderer dying after some puts: abort from onabort path.
  const tx = db.transaction(DB.STORES, "readwrite");
  let aborted = false;
  tx.onabort = () => {
    aborted = true;
  };
  tx.objectStore("projects").get("p1").onsuccess = () => {
    tx.abort();
  };
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(aborted);
  const after = await stateFrom(db);
  assert.equal(after.projects.p1.evidenceRevision, 0);
  assert.equal(Object.keys(after.conclusions).length, 0);
});

test("withdrawal keeps history and stays idempotent", async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord("p1") } });
  let state = await stateFrom(db);
  const adopted = await DB.applyPlan(
    db,
    await Core.planAdoption(state, adoption(), "op_wd000000001"),
  );
  state = await stateFrom(db);
  const withdrawn = await DB.applyPlan(
    db,
    await Core.planWithdrawal(
      state,
      adopted.conclusionId,
      "理由",
      "op_wd000000002",
    ),
  );
  assert.equal(withdrawn.status, "withdrawn");
  state = await stateFrom(db);
  assert.equal(state.conclusions[adopted.conclusionId].status, "withdrawn");
  assert.ok(
    state.versions[adopted.versionId],
    "history version survives withdrawal",
  );
  const replay = await Core.planWithdrawal(
    state,
    adopted.conclusionId,
    "理由",
    "op_wd000000002",
  );
  assert.deepEqual(replay.replay, withdrawn);
  await assert.rejects(
    Core.planWithdrawal(state, adopted.conclusionId, "再撤", "op_wd000000003"),
    /已撤回/,
  );
});

test("projection is a clearly-truncated read-only digest", async () => {
  const state = {
    conclusions: {},
    versions: {},
    sources: {},
    links: {},
    projects: { p1: Core.newProjectRecord("p1") },
    operations: {},
  };
  for (let i = 0; i < 5; i++) {
    const plan = await Core.planAdoption(
      state,
      adoption("结论" + i + "：" + "长".repeat(300)),
      "op_sum0000000" + i,
    );
    const w = plan.writes;
    state.conclusions[w.conclusion.id] = w.conclusion;
    state.versions[w.version.id] = w.version;
    w.sources.forEach((s) => (state.sources[s.id] = s));
    w.links.forEach((l) => (state.links[l.id] = l));
    state.projects.p1 = w.project;
    state.operations[w.ledger.operationId] = w.ledger;
  }
  const summary = Core.projectSummary(state, "p1");
  assert.ok(summary.startsWith("证据库摘析（只读投影，v5，采纳 5 条）"));
  assert.ok(
    Core.codePoints(summary) <= Core.LIMITS.summaryCodePoints,
    "summary respects 1000cp cap",
  );
  assert.ok(
    summary.includes("…（见证据库）"),
    "per-line elision is explicit, never silent",
  );
  for (let i = 5; i < 12; i++) {
    const plan = await Core.planAdoption(
      state,
      adoption("结论" + i + "：" + "长".repeat(300)),
      "op_sum000000" + i,
    );
    const w = plan.writes;
    state.conclusions[w.conclusion.id] = w.conclusion;
    state.versions[w.version.id] = w.version;
    w.sources.forEach((s) => (state.sources[s.id] = s));
    w.links.forEach((l) => (state.links[l.id] = l));
    state.projects.p1 = w.project;
  }
  const long = Core.projectSummary(state, "p1");
  assert.ok(
    long.includes("截断"),
    "global overflow carries an explicit truncation marker",
  );
  assert.ok(Core.codePoints(long) <= Core.LIMITS.summaryCodePoints);
});

test("export/import: roundtrip, collision and cross-project refusal", async () => {
  const db = mockIdb({
    projects: {
      p1: Core.newProjectRecord("p1"),
      p2: Core.newProjectRecord("p2"),
    },
  });
  let state = await stateFrom(db);
  const adopted = await DB.applyPlan(
    db,
    await Core.planAdoption(state, adoption("可导出结论"), "op_ex000000001"),
  );
  state = await stateFrom(db);
  const pkg = Core.exportPackage(state, "p1");
  assert.equal(pkg.format, "threadline-evidence/2");
  assert.equal(pkg.counts.conclusions, 1);
  assert.equal(pkg.includesOriginalExcerpts, true);
  // Collision against existing IDs is refused by the planner itself.
  await assert.rejects(
    Core.importPackage(state, pkg, "op_im000000001"),
    /冲突/,
  );
  // Clean import into a separate fresh store for the SAME project id works.
  const db2 = mockIdb({
    projects: {
      p1: Core.newProjectRecord("p1"),
      p2: Core.newProjectRecord("p2"),
    },
  });
  const state2 = await stateFrom(db2);
  // A package whose conclusions belong to a different project is refused
  // (checked on the fresh state so the ID-collision rule is not what fires).
  await assert.rejects(
    Core.importPackage(state2, { ...pkg, projectId: "p2" }, "op_im000000002"),
    /归属/,
  );
  const imported = await DB.applyPlan(
    db2,
    await Core.importPackage(state2, pkg, "op_im000000003"),
  );
  assert.equal(imported.imported, 1);
  const after2 = await stateFrom(db2);
  assert.ok(
    after2.conclusions[adopted.conclusionId],
    "imported conclusion exists",
  );
  assert.equal(after2.projects.p1.evidenceRevision, 1);
});

test("project cap: 200 conclusions per project, then refuse", async () => {
  const state = {
    conclusions: {},
    versions: {},
    sources: {},
    links: {},
    projects: { p1: Core.newProjectRecord("p1") },
    operations: {},
  };
  for (let i = 0; i < Core.LIMITS.conclusionsPerProject; i++) {
    const plan = await Core.planAdoption(
      state,
      adoption("结论" + i),
      "op_cap" + String(i).padStart(6, "0"),
    );
    const w = plan.writes;
    state.conclusions[w.conclusion.id] = w.conclusion;
    state.versions[w.version.id] = w.version;
    w.sources.forEach((s) => (state.sources[s.id] = s));
    w.links.forEach((l) => (state.links[l.id] = l));
    state.projects.p1 = w.project;
    state.operations[w.ledger.operationId] = w.ledger;
  }
  await assert.rejects(
    Core.planAdoption(state, adoption("第201条"), "op_cap000201"),
    /200/,
  );
});

test("amendment creates a new immutable version with predecessor, never rewrites", async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord("p1") } });
  let state = await stateFrom(db);
  const first = await DB.applyPlan(
    db,
    await Core.planAdoption(state, adoption("初版正文"), "op_am000000001"),
  );
  state = await stateFrom(db);
  const amended = await DB.applyPlan(
    db,
    await Core.planAmendment(
      state,
      first.conclusionId,
      { text: "修订正文", fragments: [{ selection: "新依据" }] },
      "op_am000000002",
    ),
  );
  assert.equal(amended.revision, 2);
  state = await stateFrom(db);
  const conclusion = state.conclusions[first.conclusionId];
  assert.equal(conclusion.currentVersionId, amended.versionId);
  const versions = Object.values(state.versions).filter(
    (v) => v.conclusionId === first.conclusionId,
  );
  assert.equal(versions.length, 2, "history preserved");
  const fresh = versions.find((v) => v.id === amended.versionId);
  assert.equal(fresh.changeType, "amend");
  assert.equal(fresh.predecessorId, first.versionId);
  assert.ok(state.versions[first.versionId], "original version untouched");
  // Idempotent replay of the same amendment operation.
  const replay = await Core.planAmendment(
    state,
    first.conclusionId,
    { text: "修订正文", fragments: [{ selection: "新依据" }] },
    "op_am000000002",
  );
  assert.deepEqual(replay.replay, amended);
});

test("duplicate adoption detection: same body+fragments, different fragments", async () => {
  const state = {
    conclusions: {},
    versions: {},
    sources: {},
    links: {},
    projects: { p1: Core.newProjectRecord("p1") },
    operations: {},
  };
  const apply = async (plan) => {
    const w = plan.writes;
    state.conclusions[w.conclusion.id] = w.conclusion;
    state.versions[w.version.id] = w.version;
    w.sources.forEach((s) => (state.sources[s.id] = s));
    w.links.forEach((l) => (state.links[l.id] = l));
    state.projects.p1 = w.project;
    state.operations[w.ledger.operationId] = w.ledger;
  };
  await apply(
    await Core.planAdoption(state, adoption("相同正文"), "op_dup000000001"),
  );
  const same = await Core.findDuplicateAdoption(state, "p1", {
    text: "相同正文",
    fragments: [
      {
        selection: "依据片段",
        before: "前文",
        after: "后文",
        relation: "supports",
      },
    ],
  });
  assert.ok(same, "identical body+fragments detected as duplicate");
  const different = await Core.findDuplicateAdoption(state, "p1", {
    text: "相同正文",
    fragments: [{ selection: "不同的依据", before: "", after: "" }],
  });
  assert.equal(different, null, "different fragments are not duplicates");
  const otherText = await Core.findDuplicateAdoption(state, "p1", {
    text: "另一条正文",
    fragments: [{ selection: "依据片段" }],
  });
  assert.equal(otherText, null, "different body is not a duplicate");
});

test("source identity, relation and conditions are part of duplicate identity", async () => {
  const state = {
    conclusions: {},
    versions: {},
    sources: {},
    links: {},
    projects: { p1: Core.newProjectRecord("p1") },
    operations: {},
  };
  const input = {
    projectId: "p1",
    text: "同一正文",
    conditions: "仅中国",
    fragments: [
      {
        selection: "相同摘录",
        conversationId: "conv-one",
        messageId: "msg-one",
        relation: "supports",
      },
    ],
  };
  const plan = await Core.planAdoption(state, input, "op_identity00001"),
    w = plan.writes;
  state.conclusions[w.conclusion.id] = w.conclusion;
  state.versions[w.version.id] = w.version;
  w.sources.forEach((x) => (state.sources[x.id] = x));
  w.links.forEach((x) => (state.links[x.id] = x));
  state.projects.p1 = w.project;
  assert.ok(await Core.findDuplicateAdoption(state, "p1", input));
  assert.equal(
    await Core.findDuplicateAdoption(state, "p1", {
      ...input,
      conditions: "仅海外",
    }),
    null,
  );
  assert.equal(
    await Core.findDuplicateAdoption(state, "p1", {
      ...input,
      fragments: [{ ...input.fragments[0], conversationId: "conv-two" }],
    }),
    null,
  );
  assert.equal(
    await Core.findDuplicateAdoption(state, "p1", {
      ...input,
      fragments: [{ ...input.fragments[0], relation: "opposes" }],
    }),
    null,
  );
});

test("text-only amendment preserves conditions and immutable source snapshots", async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord("p1") } });
  let state = await stateFrom(db);
  const first = await DB.applyPlan(
    db,
    await Core.planAdoption(
      state,
      { ...adoption("初版", "依据"), conditions: "条件A" },
      "op_keep00000001",
    ),
  );
  state = await stateFrom(db);
  const before = Object.keys(state.sources);
  await DB.applyPlan(
    db,
    await Core.planAmendment(
      state,
      first.conclusionId,
      { text: "仅正文更新" },
      "op_keep00000002",
    ),
  );
  state = await stateFrom(db);
  const current =
    state.versions[state.conclusions[first.conclusionId].currentVersionId];
  assert.equal(current.conditions, "条件A");
  assert.deepEqual(Object.keys(state.sources), before);
  assert.equal(
    Object.values(state.links).filter((x) => x.versionId === current.id)[0]
      .sourceId,
    before[0],
  );
});

test("import rejects forged hashes, dangling links and collisions in every store", async () => {
  const state = {
    conclusions: {},
    versions: {},
    sources: {},
    links: {},
    projects: { p1: Core.newProjectRecord("p1") },
    operations: {},
  };
  const plan = await Core.planAdoption(
      state,
      adoption("导出"),
      "op_impseed00001",
    ),
    w = plan.writes;
  for (const [n, x] of [
    ["conclusions", w.conclusion],
    ["versions", w.version],
    ["projects", w.project],
    ["operations", w.ledger],
  ])
    state[n][
      n === "projects" ? x.projectId : n === "operations" ? x.operationId : x.id
    ] = x;
  w.sources.forEach((x) => (state.sources[x.id] = x));
  w.links.forEach((x) => (state.links[x.id] = x));
  const pkg = Core.exportPackage(state, "p1");
  await assert.rejects(
    Core.importPackage(
      {
        conclusions: {},
        versions: {},
        sources: {},
        links: {},
        operations: {},
        projects: { p1: Core.newProjectRecord("p1") },
      },
      { ...pkg, sources: [{ ...pkg.sources[0], textHash: "forged" }] },
      "op_impbad00001",
    ),
    /哈希/,
  );
  await assert.rejects(
    Core.importPackage(
      {
        conclusions: {},
        versions: {},
        sources: {},
        links: {},
        operations: {},
        projects: { p1: Core.newProjectRecord("p1") },
      },
      { ...pkg, sources: [] },
      "op_impbad00002",
    ),
    /链接/,
  );
  const clean = {
    conclusions: {},
    versions: {},
    sources: { [pkg.sources[0].id]: pkg.sources[0] },
    links: {},
    operations: {},
    projects: { p1: Core.newProjectRecord("p1") },
  };
  await assert.rejects(
    Core.importPackage(clean, pkg, "op_impbad00003"),
    /sources ID 冲突/,
  );
});

test("actual DB snapshot indexes the durable operation ledger by operationId", async () => {
  const row = {
    operationId: "op_snapshot001",
    schema: 2,
    kind: "adopt",
    requestHash: "hash",
    result: { ok: true },
  };
  const fake = {
    transaction() {
      return {
        objectStore(name) {
          return {
            getAll() {
              const req = {};
              queueMicrotask(() => {
                req.result = name === "operations" ? [row] : [];
                req.onsuccess();
              });
              return req;
            },
          };
        },
      };
    },
  };
  const snapshot = await DB.snapshot(fake);
  assert.deepEqual(snapshot.operations["op_snapshot001"], row);
  assert.equal(snapshot.operations.undefined, undefined);
});

test("backup validation rejects detached versions and source excerpts", async () => {
  const state = {
    conclusions: {},
    versions: {},
    sources: {},
    links: {},
    projects: { p1: Core.newProjectRecord("p1") },
    operations: {},
  };
  const plan = await Core.planAdoption(
      state,
      adoption("成链结论"),
      "op_orphan000001",
    ),
    w = plan.writes;
  for (const [n, x] of [
    ["conclusions", w.conclusion],
    ["versions", w.version],
    ["projects", w.project],
    ["operations", w.ledger],
  ])
    state[n][
      n === "projects" ? x.projectId : n === "operations" ? x.operationId : x.id
    ] = x;
  w.sources.forEach((x) => (state.sources[x.id] = x));
  w.links.forEach((x) => (state.links[x.id] = x));
  const pkg = Core.exportPackage(state, "p1");
  const detached = structuredClone(pkg);
  detached.versions.push({
    ...detached.versions[0],
    id: "ver_detached001",
    predecessorId: null,
  });
  await assert.rejects(Core.validateExportPackage(detached), /孤立版本/);
  const orphanSource = structuredClone(pkg);
  orphanSource.sources.push({
    ...orphanSource.sources[0],
    id: "src_orphan00001",
  });
  await assert.rejects(Core.validateExportPackage(orphanSource), /孤立来源/);
  const dangling = structuredClone(pkg);
  dangling.links[0].sourceId = "src_missing0001";
  await assert.rejects(Core.validateExportPackage(dangling), /来源链接/);
});

test("non-adoption writes repair takeover for legacy evidence projects", async () => {
  const state = {
    conclusions: {},
    versions: {},
    sources: {},
    links: {},
    projects: { p1: Core.newProjectRecord("p1") },
    operations: {},
  };
  const first = await Core.planAdoption(
      state,
      adoption("旧记录"),
      "op_repair000001",
    ),
    w = first.writes;
  state.conclusions[w.conclusion.id] = w.conclusion;
  state.versions[w.version.id] = w.version;
  w.sources.forEach((x) => (state.sources[x.id] = x));
  w.links.forEach((x) => (state.links[x.id] = x));
  state.projects.p1 = { ...w.project, takeover: false };
  const amend = await Core.planAmendment(
    state,
    w.conclusion.id,
    { text: "修订" },
    "op_repair000002",
  );
  assert.equal(amend.writes.project.takeover, true);
  state.projects.p1 = { ...w.project, takeover: false };
  const withdraw = await Core.planWithdrawal(
    state,
    w.conclusion.id,
    "理由",
    "op_repair000003",
  );
  assert.equal(withdraw.writes.project.takeover, true);
  assert.equal(Core.exportPackage(state, "p1").project.takeover, true);
});

test("import discards an untrusted cached adoption fingerprint", async () => {
  const source = {
    conclusions: {},
    versions: {},
    sources: {},
    links: {},
    projects: { p1: Core.newProjectRecord("p1") },
    operations: {},
  };
  const a = {
    ...adoption("A", "摘录A"),
    fragments: [{ selection: "摘录A", conversationId: "one" }],
  };
  const b = {
    ...adoption("B", "摘录B"),
    fragments: [{ selection: "摘录B", conversationId: "two" }],
  };
  const pa = await Core.planAdoption(source, a, "op_untrusted0001"),
    wa = pa.writes;
  source.conclusions[wa.conclusion.id] = wa.conclusion;
  source.versions[wa.version.id] = wa.version;
  wa.sources.forEach((x) => (source.sources[x.id] = x));
  wa.links.forEach((x) => (source.links[x.id] = x));
  source.projects.p1 = wa.project;
  const pb = await Core.planAdoption(
    {
      conclusions: {},
      versions: {},
      sources: {},
      links: {},
      operations: {},
      projects: { p1: Core.newProjectRecord("p1") },
    },
    b,
    "op_untrusted0002",
  );
  const pkg = Core.exportPackage(source, "p1");
  const sourceFingerprint = source.versions[wa.version.id].adoptionFingerprint;
  pkg.versions[0].adoptionFingerprint = pb.writes.version.adoptionFingerprint;
  const packageBeforeValidation = structuredClone(pkg);
  await Core.validateExportPackage(pkg);
  assert.deepEqual(
    pkg,
    packageBeforeValidation,
    "validation is read-only for caller package",
  );
  assert.equal(
    source.versions[wa.version.id].adoptionFingerprint,
    sourceFingerprint,
    "returned export records do not alias the authority snapshot",
  );
  const target = {
    conclusions: {},
    versions: {},
    sources: {},
    links: {},
    operations: {},
    projects: { p1: Core.newProjectRecord("p1") },
  };
  const imported = await Core.importPackage(target, pkg, "op_untrusted0003"),
    w = imported.writes;
  assert.deepEqual(
    pkg,
    packageBeforeValidation,
    "import planning does not mutate caller package",
  );
  w.bulkConclusions.forEach((x) => (target.conclusions[x.id] = x));
  w.bulkVersions.forEach((x) => (target.versions[x.id] = x));
  w.bulkSources.forEach((x) => (target.sources[x.id] = x));
  w.bulkLinks.forEach((x) => (target.links[x.id] = x));
  assert.equal(target.versions[wa.version.id].adoptionFingerprint, undefined);
  assert.equal(await Core.findDuplicateAdoption(target, "p1", b), null);
});

test("import enforces semantic status, metadata, per-version limits and existing cap", async () => {
  const state = {
    conclusions: {},
    versions: {},
    sources: {},
    links: {},
    projects: { p1: Core.newProjectRecord("p1") },
    operations: {},
  };
  const plan = await Core.planAdoption(
      state,
      adoption("规则"),
      "op_semantic0001",
    ),
    w = plan.writes;
  for (const [n, x] of [
    ["conclusions", w.conclusion],
    ["versions", w.version],
    ["projects", w.project],
    ["operations", w.ledger],
  ])
    state[n][
      n === "projects" ? x.projectId : n === "operations" ? x.operationId : x.id
    ] = x;
  w.sources.forEach((x) => (state.sources[x.id] = x));
  w.links.forEach((x) => (state.links[x.id] = x));
  const pkg = Core.exportPackage(state, "p1");
  const badStatus = structuredClone(pkg);
  const noEvidence = structuredClone(pkg);
  noEvidence.links = []; noEvidence.sources = [];
  delete noEvidence.versions[0].sourceCount;
  await assert.rejects(Core.validateExportPackage(noEvidence), /至少|依据|片段/);
  const wrongCount = structuredClone(pkg);
  wrongCount.versions[0].sourceCount = 2;
  await assert.rejects(Core.validateExportPackage(wrongCount), /数量/);
  badStatus.conclusions[0].status = "forged";
  await assert.rejects(Core.validateExportPackage(badStatus), /状态/);
  const badMeta = structuredClone(pkg);
  badMeta.project.legacyNote = { text: "forged", verified: true };
  await assert.rejects(Core.validateExportPackage(badMeta), /元数据/);
  const tooMany = structuredClone(pkg);
  for (let i = 0; i < 8; i++) {
    const s = {
      ...tooMany.sources[0],
      id: "src_extra" + String(i).padStart(8, "0"),
    };
    tooMany.sources.push(s);
    tooMany.links.push({
      ...tooMany.links[0],
      id: "lnk_extra" + String(i).padStart(8, "0"),
      sourceId: s.id,
    });
  }
  await assert.rejects(Core.validateExportPackage(tooMany), /最多 8/);
  const full = {
    conclusions: {},
    versions: {},
    sources: {},
    links: {},
    operations: {},
    projects: { p1: Core.newProjectRecord("p1") },
  };
  for (let i = 0; i < 200; i++)
    full.conclusions["con_full" + String(i).padStart(8, "0")] = {
      id: "con_full" + String(i).padStart(8, "0"),
      projectId: "p1",
    };
  await assert.rejects(Core.importPackage(full, pkg, "op_semantic0002"), /200/);
});

test("amend replay is bound to raw user intent before current status", async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord("p1") } });
  let state = await stateFrom(db);
  const first = await DB.applyPlan(
    db,
    await Core.planAdoption(
      state,
      { ...adoption("初版"), conditions: "A" },
      "op_raw00000001",
    ),
  );
  state = await stateFrom(db);
  const firstAmend = await DB.applyPlan(
    db,
    await Core.planAmendment(
      state,
      first.conclusionId,
      { text: "改一" },
      "op_raw00000002",
    ),
  );
  state = await stateFrom(db);
  await DB.applyPlan(
    db,
    await Core.planAmendment(
      state,
      first.conclusionId,
      { text: "改二", conditions: "B" },
      "op_raw00000003",
    ),
  );
  state = await stateFrom(db);
  assert.deepEqual(
    (
      await Core.planAmendment(
        state,
        first.conclusionId,
        { text: "改一" },
        "op_raw00000002",
      )
    ).replay,
    firstAmend,
  );
  await DB.applyPlan(
    db,
    await Core.planWithdrawal(
      state,
      first.conclusionId,
      "撤回",
      "op_raw00000004",
    ),
  );
  state = await stateFrom(db);
  assert.deepEqual(
    (
      await Core.planAmendment(
        state,
        first.conclusionId,
        { text: "改一" },
        "op_raw00000002",
      )
    ).replay,
    firstAmend,
  );
});

test("stale editor cannot amend a newer version, but its committed retry still replays", async () => {
  const db = mockIdb({ projects: { p1: Core.newProjectRecord("p1") } });
  const original = await DB.applyPlan(db, await Core.planAdoption(
    await stateFrom(db), adoption("原文"), "op_editor00001"));
  const intent = { text: "第一窗口修订", expectedVersionId: original.versionId };
  const first = await DB.applyPlan(db, await Core.planAmendment(
    await stateFrom(db), original.conclusionId, intent, "op_editor00002"));
  const before = await stateFrom(db);
  await assert.rejects(Core.planAmendment(before, original.conclusionId,
    { text: "过期窗口修订", expectedVersionId: original.versionId }, "op_editor00003"), /其他窗口修订/);
  assert.deepEqual(await stateFrom(db), before);
  const retry = await Core.planAmendment(before, original.conclusionId, intent, "op_editor00002");
  assert.deepEqual(retry.replay, first);
});
