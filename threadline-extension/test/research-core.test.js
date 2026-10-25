const test = require("node:test");
const assert = require("node:assert/strict");
const Research = require("../research-core.js");

function state() {
  const conclusions = {}, versions = {}, projects = { p1: {}, p2: {} };
  for (const [id, projectId] of [["con_aaaaaaaa", "p1"], ["con_bbbbbbbb", "p1"], ["con_cccccccc", "p1"], ["con_dddddddd", "p1"], ["con_eeeeeeee", "p2"]]) {
    const versionId = "ver_" + id.slice(4);
    conclusions[id] = { id, projectId, status: "adopted", currentVersionId: versionId };
    versions[versionId] = { id: versionId, conclusionId: id, text: id };
  }
  return { conclusions, versions, projects };
}
let sequence = 0;
function opts() { return { id: () => "dep_" + (++sequence).toString().padStart(8, "0"), at: sequence + 10 }; }
function add(s, upstreamConclusionId, downstreamConclusionId) {
  const result = Research.update(s, "p1", {
    kind: "addDependency", upstreamConclusionId, downstreamConclusionId,
    upstreamVersionId: s.conclusions[upstreamConclusionId].currentVersionId,
    downstreamVersionId: s.conclusions[downstreamConclusionId].currentVersionId,
    scopeManifestHash: "scope-" + sequence, reason: "initially confirmed",
  }, opts());
  s.projects.p1.research = result.research;
  return result.result.edgeId;
}
function confirm(s, edgeId) {
  const edge = s.projects.p1.research.edges.find(e => e.id === edgeId);
  const result = Research.update(s, "p1", {
    kind: "confirmDependency", edgeId,
    upstreamVersionId: s.conclusions[edge.upstreamConclusionId].currentVersionId,
    downstreamVersionId: s.conclusions[edge.downstreamConclusionId].currentVersionId,
    scopeManifestHash: "scope-confirm", reason: "reviewed",
  }, opts());
  s.projects.p1.research = result.research;
}

test("stable edges reject cycles and reactivation starts a new confirmation epoch", () => {
  const s = state(), a = "con_aaaaaaaa", b = "con_bbbbbbbb", c = "con_cccccccc";
  const edgeId = add(s, a, b); add(s, b, c);
  assert.throws(() => add(s, c, a), /环/);
  assert.throws(() => add(s, a, "con_eeeeeeee"), /同一课题/);
  s.projects.p1.research = Research.update(s, "p1", { kind: "removeDependency", edgeId, reason: "no longer needed" }, opts()).research;
  assert.equal(add(s, a, b), edgeId);
  const edge = s.projects.p1.research.edges.find(e => e.id === edgeId);
  assert.equal(edge.revision, 3);
  assert.equal(Research.inspect(s, "p1").edges.find(e => e.id === edgeId).status, "confirmed");
});
test("changed conclusion or withdrawal never lets a prior confirmation silence the edge", () => {
  const s = state(), a = "con_aaaaaaaa", b = "con_bbbbbbbb", edgeId = add(s, a, b);
  s.versions.ver_new = { id: "ver_new", conclusionId: b, text: "new" };
  s.conclusions[b].currentVersionId = "ver_new";
  assert.match(Research.inspect(s, "p1").edges[0].reason, /下游版本/);
  assert.throws(() => Research.update(s, "p1", { kind: "confirmDependency", edgeId, upstreamVersionId: "ver_aaaaaaaa", downstreamVersionId: "ver_bbbbbbbb", scopeManifestHash: "h", reason: "stale" }, opts()), /版本已变化/);
  s.conclusions[a].status = "withdrawn";
  assert.match(Research.inspect(s, "p1").edges[0].reason, /上游已撤回/);
});
test("diamond impacts retain every branch cause for a tail without exponential paths", () => {
  const s = state(), a = "con_aaaaaaaa", b = "con_bbbbbbbb", c = "con_cccccccc", d = "con_dddddddd";
  add(s, a, b); add(s, a, c); add(s, b, d); add(s, c, d);
  s.conclusions.con_ffffffff = {id:"con_ffffffff",projectId:"p1",status:"adopted",currentVersionId:"ver_ffffffff"};
  s.versions.ver_ffffffff = {id:"ver_ffffffff",conclusionId:"con_ffffffff",text:"tail"};
  add(s, d, "con_ffffffff");
  const impact = Research.impacts(s, "p1", [a]);
  assert.deepEqual(impact.map(x => x.conclusionId), [b, c, d, "con_ffffffff"]);
  const tail = impact.at(-1).causes[0];
  assert.equal(tail.rootConclusionId, a);
  assert.equal(tail.contributingEdgeIds.length, 5);
});
test("recorded change is idempotent and never removes prior impacts", () => {
  const s = state(), a = "con_aaaaaaaa", b = "con_bbbbbbbb";
  add(s, a, b);
  s.versions.ver_amended = { id: "ver_amended", conclusionId: a, text: "amended" };
  s.conclusions[a].currentVersionId = "ver_amended";
  const first = Research.recordChange(s, "p1", { triggerEventId: "evt_aaaaaaaa", conclusionId: a, fromVersion: "ver_aaaaaaaa", toVersion: "ver_amended", kind: "amend" }, opts());
  s.projects.p1.research = first.research;
  const replay = Research.recordChange(s, "p1", { triggerEventId: "evt_aaaaaaaa", conclusionId: a, fromVersion: "ver_aaaaaaaa", toVersion: "ver_amended", kind: "amend" }, opts());
  assert.equal(replay.result.replay, true);
  assert.equal(s.projects.p1.research.events.filter(e => e.kind === "change").length, 1);
});
test("prepared review preserves immutable scope; any incoming or source change makes all pairs stale", () => {
  const s = state(), a = "con_aaaaaaaa", b = "con_bbbbbbbb", edgeId = add(s, a, b);
  s.sources = {src_abcdefgh:{id:"src_abcdefgh",textHash:"a".repeat(64)}};
  const prepared = Research.prepareReview(s, "p1", { targetConclusionId: b, targetVersionId: "ver_bbbbbbbb", scopeManifestHash: "scope-review", sourceSnapshots: [{ id: "src_abcdefgh", hash: "a".repeat(64) }], blindMaterials: [{ kind: "source", id: "src_abcdefgh" }] }, opts());
  s.projects.p1.research = prepared.research;
  s.sources.src_abcdefgh.textHash = "b".repeat(64);
  const completed = Research.completeReview(s, "p1", { reviewId: prepared.result.reviewId, outcome: "keep", reason: "reviewed old scope" }, opts());
  assert.equal(completed.result.stale, true);
  assert.deepEqual(completed.result.edgesToConfirm, []);
  assert.equal(completed.research.reviews[0].completions.length, 1);
  assert.equal(completed.research.reviews[0].targetVersionId, "ver_bbbbbbbb");
  assert.equal(edgeId, completed.research.reviews[0].incoming[0].edgeId);
});
test("validator rejects forged confirmation ownership and duplicate record IDs", () => {
  const s = state(), edgeId = add(s, "con_aaaaaaaa", "con_bbbbbbbb");
  confirm(s, edgeId);
  assert.equal(Research.validateResearch(s.projects.p1.research, s, "p1"), true);
  const bad = structuredClone(s.projects.p1.research);
  bad.confirmations[0].confirmedForDownstreamVersion = "ver_eeeeeeee";
  assert.throws(() => Research.validateResearch(bad, s, "p1"), /确认/);
  const duplicate = structuredClone(s.projects.p1.research);
  duplicate.events[0].id = duplicate.edges[0].id;
  assert.throws(() => Research.validateResearch(duplicate, s, "p1"), /重复/);
});
test("validator rejects forged review and event references", () => {
  const s = state(), edgeId = add(s, "con_aaaaaaaa", "con_bbbbbbbb");
  s.sources = {src_abcdefgh:{id:"src_abcdefgh",textHash:"a".repeat(64)}};
  const prepared = Research.prepareReview(s, "p1", {targetConclusionId:"con_bbbbbbbb",targetVersionId:"ver_bbbbbbbb",scopeManifestHash:"scope",sourceSnapshots:[{id:"src_abcdefgh",hash:"a".repeat(64)}],blindMaterials:[]}, opts());
  s.projects.p1.research = prepared.research;
  assert.equal(Research.validateResearch(s.projects.p1.research, s, "p1"), true);
  const badReview = structuredClone(s.projects.p1.research);
  badReview.reviews[0].incoming[0].upstreamVersionId = "ver_eeeeeeee";
  assert.throws(() => Research.validateResearch(badReview, s, "p1"), /复核依赖/);
  const badEvent = structuredClone(s.projects.p1.research);
  badEvent.events.find(x => x.edgeId === edgeId).edgeId = "dep_missing0001";
  assert.throws(() => Research.validateResearch(badEvent, s, "p1"), /事件引用/);
});
