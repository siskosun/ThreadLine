/* ThreadLine evidence core (S0a prototype, plan §十一).
 * Pure logic only: no IndexedDB, no chrome.*, no DOM. The single-writer
 * service worker in background.js owns all persistence; this module builds
 * and validates the records an adoption/withdrawal touches so the whole
 * change commits inside ONE readwrite transaction (evidence-db.js).
 *
 * Frozen first-phase defaults (plan §十一.6; product limits, not browser
 * quota guarantees — verify via probes before S1a, changes need a reason):
 *  - conclusion body: <= 4000 Unicode code points
 *  - per fragment: selection + <=500cp before + <=500cp after, <= 16 KiB UTF-8
 *  - per conclusion: <= 8 fragments, <= 64 KiB total
 *  - per project: <= 200 stable conclusions, <= 50 versions each
 *  - import/export package: <= 20 MiB UTF-8 JSON; visible budget 100 MiB
 */
(() => {
  "use strict";
  const encoder = new TextEncoder();
  const LIMITS = Object.freeze({
    conclusionCodePoints: 4000,
    fragmentContextCodePoints: 500,
    fragmentBytes: 16 * 1024,
    fragmentsPerConclusion: 8,
    fragmentsTotalBytes: 64 * 1024,
    conclusionsPerProject: 200,
    versionsPerConclusion: 50,
    packageBytes: 20 * 1024 * 1024,
    summaryCodePoints: 1000
  });
  const codePoints = s => Array.from(s).length;
  const bytes = s => encoder.encode(s).length;
  const isId = (s, prefix) => typeof s === "string" &&
    new RegExp("^" + prefix + "[a-z0-9_-]{8,64}$").test(s);
  const now = () => Date.now();
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
    : "0000-0000").replace(/-/g, "").slice(0, 16);

  /* ---------- fragment & conclusion validation (fail loud, never truncate) */

  function validateFragment(fragment) {
    if (!fragment || typeof fragment !== "object") throw new Error("片段缺失");
    const { selection, before = "", after = "", relation = "cites", completeness } = fragment;
    if (typeof selection !== "string" || !selection.trim()) throw new Error("片段选区不能为空");
    if (codePoints(before) > LIMITS.fragmentContextCodePoints ||
        codePoints(after) > LIMITS.fragmentContextCodePoints)
      throw new Error("片段上下文超过 500 code points：请缩小选区或显式调整");
    if (!["cites", "supports", "opposes", "background"].includes(relation))
      throw new Error("未知片段关系: " + relation);
    if (!["complete", "partial", "unknown"].includes(completeness || "unknown"))
      throw new Error("未知采集完整性");
    const total = bytes(before + selection + after);
    if (total > LIMITS.fragmentBytes)
      throw new Error("单片段超过 16 KiB：请缩小选区或显式调整");
    return true;
  }

  function validateAdoption(input) {
    if (!input || typeof input !== "object") throw new Error("采纳输入缺失");
    if (typeof input.projectId !== "string" || !input.projectId)
      throw new Error("缺少课题 ID");
    if (typeof input.text !== "string" || !input.text.trim())
      throw new Error("结论正文不能为空");
    if (codePoints(input.text) > LIMITS.conclusionCodePoints)
      throw new Error("结论正文超过 4000 code points");
    const fragments = input.fragments || [];
    if (fragments.length === 0) throw new Error("采纳至少需要一个依据片段");
    if (fragments.length > LIMITS.fragmentsPerConclusion)
      throw new Error("单条结论最多 8 个片段");
    let total = 0;
    for (const f of fragments) { validateFragment(f); total += bytes(f.selection); }
    if (total > LIMITS.fragmentsTotalBytes)
      throw new Error("单条结论片段总量超过 64 KiB");
    return true;
  }

  /* ---------- adoption plan: everything ONE transaction must write ----------
   * Applied by evidence-db.js inside a single readwrite transaction:
   *  - operations ledger row first (idempotency + request digest)
   *  - conclusion, version, sources, links
   *  - project evidenceRevision CAS bump + projection todo
   * Any failure before oncomplete rolls the whole change back.
   */

  async function planAdoption(state, input, operationId) {
    validateAdoption(input);
    if (!isId(operationId, "op_")) throw new Error("操作 ID 无效");
    const requestHash = await hashRequest(input);
    const prior = state.operations[operationId];
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new Error("操作 ID 已用于不同请求，已拒绝");
      return { replay: prior.result };
    }
    const project = state.projects[input.projectId];
    if (!project) throw new Error("课题不存在或未初始化");
    const conclusions = Object.values(state.conclusions)
      .filter(c => c.projectId === input.projectId && c.status === "adopted");
    if (conclusions.length >= LIMITS.conclusionsPerProject)
      throw new Error("课题结论数达上限（200）：请导出或清理后再采纳");
    // First adoption takes the project over: the legacy decision text is
    // preserved verbatim as an unverified legacy-note (plan §十一.6-5) and
    // the legacy edit path is sealed from then on, even after full withdrawal.
    const firstAdoption = Object.keys(state.conclusions)
      .every(id => state.conclusions[id].projectId !== input.projectId);
    const conclusionId = "con_" + uuid();
    const versionId = "ver_" + uuid();
    const at = now();
    const conclusion = {
      id: conclusionId, projectId: input.projectId,
      currentVersionId: versionId, status: "adopted",
      createdAt: at, adoptedAt: at
    };
    const version = {
      id: versionId, conclusionId, text: input.text,
      conditions: input.conditions || "", changeType: "create",
      predecessorId: null, createdAt: at, creator: "user"
    };
    const sources = [], links = [];
    // Hash BEFORE building records: hashing is async and must finish before
    // the transaction opens (plan §十一.6); records must stay structured-cloneable.
    for (let i = 0; i < (input.fragments || []).length; i++) {
      const f = input.fragments[i];
      const sourceId = "src_" + uuid() + "_" + i;
      const textHash = await hashText((f.before || "") + f.selection + (f.after || ""));
      sources.push({
        id: sourceId, kind: f.kind || "capture",
        captureRunId: f.captureRunId || null, conversationId: f.conversationId || null,
        messageId: f.messageId || null, url: f.url || null,
        before: f.before || "", selection: f.selection, after: f.after || "",
        textHash,
        capturedAt: f.capturedAt || at,
        completeness: f.completeness || "unknown"
      });
      links.push({ id: "lnk_" + uuid() + "_" + i, versionId, sourceId,
        relation: f.relation || "cites" });
    }
    const result = { conclusionId, versionId, revision: project.evidenceRevision + 1 };
    return {
      replay: null, result, writes: {
        conclusion, version, sources, links,
          project: {
          ...project,
          evidenceRevision: project.evidenceRevision + 1,
          projectionRevision: project.projectionRevision,
          projectionTodo: true,
          ...(firstAdoption ? {
            takeover: true,
            ...(typeof input.legacyDecision === "string" && input.legacyDecision.trim() ? {
              legacyNote: { text: input.legacyDecision, capturedAt: now(), verified: false }
            } : {})
          } : {})
        },
        ledger: { operationId, requestHash, result, at }
      }
    };
  }

  async function planWithdrawal(state, conclusionId, reason, operationId) {
    if (!isId(conclusionId, "con_")) throw new Error("结论 ID 无效");
    if (!isId(operationId, "op_")) throw new Error("操作 ID 无效");
    if (typeof reason !== "string") throw new Error("撤回需要理由");
    const input = { conclusionId, reason };
    const requestHash = await hashRequest(input);
    const prior = state.operations[operationId];
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new Error("操作 ID 已用于不同请求，已拒绝");
      return { replay: prior.result };
    }
    const conclusion = state.conclusions[conclusionId];
    if (!conclusion) throw new Error("结论不存在");
    if (conclusion.status === "withdrawn") throw new Error("结论已撤回");
    const project = state.projects[conclusion.projectId];
    if (!project) throw new Error("课题记录缺失");
    const at = now();
    const withdrawn = { ...conclusion, status: "withdrawn", withdrawnAt: at, withdrawalReason: reason };
    const result = { conclusionId, status: "withdrawn", revision: project.evidenceRevision + 1 };
    return {
      replay: null, result, writes: {
        conclusion: withdrawn,
        project: {
          ...project,
          evidenceRevision: project.evidenceRevision + 1,
          projectionTodo: true
        },
        ledger: { operationId, requestHash, result, at }
      }
    };
  }

  /* ---------- projection: summary derived ONLY from committed records -----
   * The legacy decision field becomes a read-only, clearly-truncated digest.
   * Full conclusions are read from the evidence store, never from here.
   */

  function projectSummary(state, projectId) {
    const rows = Object.values(state.conclusions)
      .filter(c => c.projectId === projectId)
      .sort((a, b) => (b.adoptedAt || 0) - (a.adoptedAt || 0));
    const lines = [];
    for (const c of rows) {
      const version = state.versions[c.currentVersionId];
      if (!version) continue;
      const mark = c.status === "withdrawn" ? "[已撤回] " : "";
      const head = mark + "结论 " + c.id.slice(0, 12) + "：";
      const chars = Array.from(version.text);
      const shown = chars.slice(0, 120).join("");
      lines.push(head + shown + (chars.length > 120 ? "…（见证据库）" : ""));
    }
    const adopted = rows.filter(c => c.status === "adopted").length;
    const prefix = "证据库摘析（只读投影，v" + (state.projects[projectId]?.evidenceRevision ?? 0) +
      "，采纳 " + adopted + " 条）：\n";
    let body = lines.join("\n");
    if (codePoints(prefix + body) > LIMITS.summaryCodePoints) {
      body = Array.from(body).slice(0, LIMITS.summaryCodePoints - codePoints(prefix) - 20).join("") +
        "\n…（截断：完整结论见证据库视图）";
    }
    return prefix + body;
  }

  /* ---------- import/export package (byte-capped, self-describing) -------- */

  function exportPackage(state, projectId) {
    const conclusions = Object.values(state.conclusions)
      .filter(c => c.projectId === projectId);
    const versions = [], sources = [], links = [];
    for (const c of conclusions)
      for (const v of Object.values(state.versions))
        if (v.conclusionId === c.id) {
          versions.push(v);
          for (const l of Object.values(state.links))
            if (l.versionId === v.id) {
              links.push(l);
              if (!sources.some(s => s.id === l.sourceId)) {
                const src = state.sources[l.sourceId];
                if (src) sources.push(src);
              }
            }
        }
    const pkg = {
      format: "threadline-evidence/1", projectId, exportedAt: now(),
      includesOriginalExcerpts: true,
      counts: { conclusions: conclusions.length, versions: versions.length, sources: sources.length },
      conclusions, versions, sources, links
    };
    const size = bytes(JSON.stringify(pkg));
    if (size > LIMITS.packageBytes)
      throw new Error("导出包超过 20 MiB：请按课题拆分导出（当前 " + size + " 字节）");
    return pkg;
  }

  async function importPackage(state, pkg, operationId) {
    if (!pkg || pkg.format !== "threadline-evidence/1")
      throw new Error("未知导出包格式");
    if (bytes(JSON.stringify(pkg)) > LIMITS.packageBytes)
      throw new Error("导入包超过 20 MiB");
    if (!state.projects[pkg.projectId]) throw new Error("目标课题不存在");
    const collisions = (pkg.conclusions || []).filter(c => state.conclusions[c.id]);
    if (collisions.length) throw new Error("结论 ID 冲突：" + collisions.map(c => c.id).join(", "));
    const foreign = (pkg.conclusions || []).filter(c => c.projectId !== pkg.projectId);
    if (foreign.length) throw new Error("包内结论归属课题与目标课题不一致：" + foreign.map(c => c.id).join(", "));
    for (const v of pkg.versions || []) {
      const owned = state.conclusions[v.conclusionId];
      if (owned && owned.projectId !== pkg.projectId)
        throw new Error("跨课题引用拒绝：" + v.conclusionId);
      const count = Object.values(state.versions)
        .filter(x => x.conclusionId === v.conclusionId).length;
      if (count >= LIMITS.versionsPerConclusion)
        throw new Error("版本数达上限：" + v.conclusionId);
    }
    const requestHash = await hashRequest({ import: pkg.projectId, at: pkg.exportedAt });
    const prior = state.operations[operationId];
    const result = { imported: pkg.conclusions.length };
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new Error("操作 ID 已用于不同请求，已拒绝");
      return { replay: prior.result };
    }
    return {
      replay: null, result,
      writes: {
        bulkConclusions: pkg.conclusions || [], bulkVersions: pkg.versions || [],
        bulkSources: pkg.sources || [], bulkLinks: pkg.links || [],
        project: {
          ...state.projects[pkg.projectId],
          evidenceRevision: state.projects[pkg.projectId].evidenceRevision + 1,
          projectionTodo: true
        },
        ledger: { operationId, requestHash, result, at: now() }
      }
    };
  }

  function hashRequest(input) {
    return hashText(JSON.stringify(input));
  }
  async function hashText(text) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("");
  }

  const Core = {
    LIMITS, codePoints, bytes,
    validateFragment, validateAdoption, validateWithdrawalInput: () => {},
    planAdoption, planWithdrawal, projectSummary,
    exportPackage, importPackage, hashText, hashRequest, uuid,
    newProjectRecord: projectId => ({
      projectId, evidenceRevision: 0, projectionRevision: 0, projectionTodo: false,
      takeover: false, legacyNote: null
    })
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  else (globalThis.ThreadLineEvidenceCore = Core);
})();
