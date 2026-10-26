/* Evidence lifecycle planning.  Deletion is deliberately a tombstone plus a
 * single authority transaction; chrome.storage cleanup is an outer, resumable
 * concern owned by the background worker. */
(() => {
  "use strict";
  const Core = typeof require === "function"
    ? require("./evidence-core.js")
    : globalThis.ThreadLineEvidenceCore;
  if (!Core) throw new Error("ThreadLineEvidenceCore is required");

  const stable = (value) => Array.isArray(value)
    ? "[" + value.map(stable).join(",") + "]"
    : value && typeof value === "object"
      ? "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + stable(value[key])).join(",") + "}"
      : JSON.stringify(value);
  const isOperationId = value => typeof value === "string" && /^op_[a-z0-9_-]{8,64}$/.test(value);
  const clone = value => structuredClone(value);
  const records = (state, projectId) => Object.values(state.conclusions || {})
    .filter(conclusion => conclusion.projectId === projectId);

  async function requestHash(kind, input) {
    return Core.hashRequest({ schema: 2, kind, input });
  }
  async function prior(state, kind, input, operationId) {
    if (!isOperationId(operationId)) throw new Error("操作 ID 无效");
    const found = state.operations && state.operations[operationId];
    if (!found) return null;
    if (found.schema !== 2 || found.kind !== kind ||
        found.requestHash !== await requestHash(kind, input))
      throw new Error("操作 ID 已用于不同请求，已拒绝");
    return clone(found.result);
  }
  async function ledger(kind, input, operationId, result, projectId) {
    return {
      operationId,
      schema: 2,
      kind,
      projectId,
      requestHash: await requestHash(kind, input),
      result: clone(result),
      at: Date.now(),
    };
  }
  function expectProject(state, projectId) {
    Core.requireProjectId(projectId);
    return state.projects && Object.hasOwn(state.projects, projectId)
      ? state.projects[projectId] : undefined;
  }
  function deleteIds(state, projectId) {
    const conclusions = records(state, projectId), conclusionIds = new Set(conclusions.map(x => x.id));
    const versions = Object.values(state.versions || {}).filter(x => conclusionIds.has(x.conclusionId));
    const versionIds = new Set(versions.map(x => x.id));
    const links = Object.values(state.links || {}).filter(x => versionIds.has(x.versionId));
    const linkIds = new Set(links.map(x => x.id));
    const sourceIds = new Set(links.map(x => x.sourceId));
    const retainedSourceIds = new Set(Object.values(state.links || {})
      .filter(link => !linkIds.has(link.id)).map(link => link.sourceId));
    return {
      conclusions: conclusions.map(x => x.id),
      versions: versions.map(x => x.id),
      links: links.map(x => x.id),
      sources: [...sourceIds].filter(id => !retainedSourceIds.has(id)),
    };
  }
  async function planDelete(state, projectId, operationId, expectedRevision) {
    const project = expectProject(state, projectId);
    if (!project) throw new Error("课题不存在");
    const input = { projectId, expectedRevision: expectedRevision ?? null };
    const replay = await prior(state, "delete", input, operationId);
    if (replay) return { replay };
    if (project.deleted) throw new Error("课题证据已删除：请使用明确恢复流程");
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
        expectedRevision !== project.evidenceRevision)
      throw new Error("删除预览已过期，请刷新后重新确认");
    const revision = project.evidenceRevision + 1;
    const result = { projectId, deleted: true, revision };
    return {
      replay: null,
      result,
      expectedRevision,
      writes: {
        redactedOperations: redactOperations(state,projectId),
        deleteIds: deleteIds(state, projectId),
        project: {
          projectId,
          evidenceRevision: revision,
          projectionRevision: revision,
          projectionTodo: false,
          takeover: true,
          deleted: true,
          cleanupPending: true,
          deletedAt: Date.now(),
          legacyNote: null,
        },
        ledger: await ledger("delete", input, operationId, result, projectId),
      },
    };
  }
  function redactOperations(state,projectId) {
    return Object.values(state.operations||{}).filter(o=>o.projectId===projectId||state.conclusions[o.result?.conclusionId]?.projectId===projectId)
      .map(o=>({operationId:o.operationId,schema:o.schema,kind:o.kind,projectId,requestHash:o.requestHash,at:o.at,redacted:true,result:{projectId,redacted:true}}));
  }
  function validatePackageProject(pkg) {
    if (!pkg) throw new Error("证据包缺失");
    Core.requireProjectId(pkg.projectId);
    if (!pkg.conclusions.length) throw new Error("空证据包没有可恢复的结论");
  }
  function incomingIds(pkg) {
    return {
      conclusions: new Set(pkg.conclusions.map(x => x.id)),
      versions: new Set(pkg.versions.map(x => x.id)),
      links: new Set(pkg.links.map(x => x.id)),
      sources: new Set(pkg.sources.map(x => x.id)),
    };
  }
  function rejectForeignCollisions(state, pkg, projectId, replacing) {
    const removed = replacing ? deleteIds(state, projectId) :
      { conclusions: [], versions: [], links: [], sources: [] };
    const removedByStore = Object.fromEntries(Object.entries(removed).map(([key, ids]) => [key, new Set(ids)]));
    const incoming = incomingIds(pkg);
    for (const store of ["conclusions", "versions", "links", "sources"])
      for (const id of incoming[store])
        if (state[store]?.[id] && !removedByStore[store].has(id))
          throw new Error(store + " ID 与其他课题冲突：" + id);
    return removed;
  }
  async function planRestore(state, pkg, operationId, options = {}) {
    await Core.validateExportPackage(pkg);
    validatePackageProject(pkg);
    const expectedRevision = options.expectedRevision ?? null;
    const minimumRevision = options.minimumRevision ?? 0;
    const replace = options.replace === true;
    if (!Number.isSafeInteger(minimumRevision) || minimumRevision < 0)
      throw new Error("恢复最低修订无效");
    const input = { pkg: clone(pkg), expectedRevision, minimumRevision, replace };
    const replay = await prior(state, "restore", input, operationId);
    if (replay) return { replay };
    const existing = expectProject(state, pkg.projectId);
    if (existing && !replace) throw new Error("目标课题已存在；请先选择替换恢复");
    if (!existing && expectedRevision !== null)
      throw new Error("恢复预览已过期：目标课题不存在");
    if (existing && (!Number.isSafeInteger(expectedRevision) || expectedRevision !== existing.evidenceRevision))
      throw new Error("恢复预览已过期，请刷新后重新确认");
    const removed = rejectForeignCollisions(state, pkg, pkg.projectId, !!existing);
    const revision = Math.max(existing?.evidenceRevision || 0, minimumRevision) + 1;
    const meta = pkg.format !== "threadline-evidence/1" ? pkg.project : null;
    const project = {
      projectId: pkg.projectId,
      evidenceRevision: revision,
      projectionRevision: 0,
      projectionTodo: true,
      takeover: true,
      deleted: false,
      cleanupPending: false,
      legacyNote: meta?.legacyNote ? clone(meta.legacyNote) : null,
      ...(!meta?.legacyNote || meta?.legacyNoteUnavailable ? { legacyNoteUnavailable: true } : {}),
      ...(meta?.research ? {research:clone(meta.research)} : {}),
      ...(meta?.handoffs ? {handoffs:clone(meta.handoffs)} : {}),
    };
    const result = { projectId: pkg.projectId, restored: pkg.conclusions.length, revision, replaced: !!existing };
    return {
      replay: null,
      result,
      expectedRevision,
      writes: {
        ...(existing ? { deleteIds: removed,redactedOperations:redactOperations(state,pkg.projectId) } : {}),
        bulkConclusions: pkg.conclusions.map(clone),
        bulkVersions: pkg.versions.map(({ adoptionFingerprint, ...version }) => clone(version)),
        bulkSources: pkg.sources.map(clone),
        bulkLinks: pkg.links.map(clone),
        project,
        ledger: await ledger("restore", input, operationId, result, pkg.projectId),
      },
    };
  }
  const Lifecycle = { planDelete, planRestore, deleteIds, stable };
  if (typeof module !== "undefined" && module.exports) module.exports = Lifecycle;
  else globalThis.ThreadLineEvidenceLifecycle = Lifecycle;
})();
