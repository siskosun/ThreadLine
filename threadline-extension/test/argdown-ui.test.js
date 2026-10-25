const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const UI = require("../argdown-ui.js");

test("Argdown UI classifies only support-like relations as confirmable", () => {
  assert.equal(UI.relationKind("support"), "support");
  assert.equal(UI.relationKind("attack"), "oppose");
  assert.equal(UI.relationKind("contrary"), "oppose");
  assert.equal(UI.relationKind("unknown"), "other");
  assert.equal(UI.sameId("con_abcdefgh", { conclusion: { id: "con_abcdefgh" } }), true);
});

test("Argdown UI remains local, preview-first, and sends CAS dependency commands only", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "argdown-ui.js"), "utf8");
  for (const type of ["EV_PROJECTS", "EV_RESEARCH_LIST", "EV_RESEARCH_COMMAND"]) assert.match(source, new RegExp(type));
  assert.match(source, /expectedRevision: data\.project\.evidenceRevision/);
  assert.match(source, /operationId: operationId\(\)/);
  assert.match(source, /kind: "addDependency"/);
  assert.match(source, /必要前提/);
  assert.match(source, /不会自动采纳结论/);
  assert.match(source, /kind !== "support"/);
  assert.match(source, /超过 200 KiB/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /sendMessage\([^\n]*EV_RESEARCH_COMMAND[^\n]*\{[^\n]*kind:\s*"addDependency"/);
});
