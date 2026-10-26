const test = require("node:test");
const assert = require("node:assert/strict");
const UI = require("../evidence-maintenance-ui.js");

test("old evidence-only packages become explicit wrapper fallbacks", () => {
  const evidence = { format: "threadline-evidence/1", projectId: "p1" };
  const backup = UI.normalizeBackup(evidence);
  assert.equal(backup.legacyEvidenceOnly, true);
  assert.equal(backup.evidence, evidence);
  assert.throws(() => UI.normalizeBackup({ format: "unknown" }), /证据备份/);
});

test("backup file limit rejects before its text reader is called", async () => {
  let read = false;
  await assert.rejects(UI.parseBackupFile({ size: UI.MAX_PACKAGE_BYTES + 1, async text() { read = true; return "{}"; } }), /20 MiB/);
  assert.equal(read, false);
  await assert.rejects(UI.parseBackupFile({ size: 2, async text() { return "{"; } }), /JSON/);
});

test("valid wrapped backup parses and counts use validated response fields", async () => {
  const wrapped = { format: "threadline-project-backup/1", topic: { id: "p1" }, evidence: { format: "threadline-evidence/2", projectId: "p1" } };
  const got = await UI.parseBackupFile({ size: JSON.stringify(wrapped).length, async text() { return JSON.stringify(wrapped); } });
  assert.equal(got.topic.id, "p1");
  assert.deepEqual(UI.countsOf({ conclusions: 2, versions: 3, sources: 4, links: 5 }), { conclusions: 2, versions: 3, sources: 4, links: 5 });
  assert.deepEqual(UI.countsOf({ conclusions: "forged" }), { conclusions: 0, versions: 0, sources: 0, links: 0 });
});

test("maintenance UI has no normal snapshot dependency and keeps explicit commit boundaries", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "evidence-maintenance-ui.js"), "utf8");
  assert.equal(source.includes('type: "SNAPSHOT"'), false);
  for (const type of ["EV_PROJECTS", "EV_BACKUP", "EV_DELETE_PREVIEW", "EV_DELETE_COMMIT", "EV_RESTORE_PREVIEW", "EV_RESTORE_COMMIT", "EV_DIAGNOSTIC_EXPORT"])
    assert.ok(source.includes(type), type);
  assert.ok(source.includes("不会自动重试"));
  assert.ok(source.includes("包含对话原文片段"));
});
