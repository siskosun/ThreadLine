/* Pure authority-side evidence planning. No DOM, chrome or network calls. */
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
    summaryCodePoints: 1000,
  });
  const codePoints = (x) => Array.from(String(x)).length,
    bytes = (x) => encoder.encode(String(x)).length,
    now = () => Date.now();
  const isId = (x, p) =>
    typeof x === "string" && new RegExp("^" + p + "[a-z0-9_-]{8,64}$").test(x);
  const validProjectId = x => typeof x === "string" &&
    /^[a-zA-Z0-9_-]{1,128}$/.test(x) &&
    !["__proto__", "constructor", "prototype"].includes(x);
  function requireProjectId(x) {
    if (!validProjectId(x)) throw Error("课题 ID 无效或保留名称");
    return x;
  }
  const uuid = () =>
    (crypto.randomUUID ? crypto.randomUUID() : "0000000000000000")
      .replace(/-/g, "")
      .slice(0, 16);
  const stable = (x) =>
    Array.isArray(x)
      ? "[" + x.map(stable).join(",") + "]"
      : x && typeof x === "object"
        ? "{" +
          Object.keys(x)
            .sort()
            .map((k) => JSON.stringify(k) + ":" + stable(x[k]))
            .join(",") +
          "}"
        : JSON.stringify(x);
  async function hashText(x) {
    const d = await crypto.subtle.digest("SHA-256", encoder.encode(String(x)));
    return [...new Uint8Array(d)]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
  }
  const hashRequest = (x) => hashText(stable(x));
  function validateFragment(f) {
    if (!f || typeof f !== "object") throw Error("片段缺失");
    const {
      selection,
      before = "",
      after = "",
      relation = "cites",
      completeness = "unknown",
    } = f;
    if (typeof selection !== "string" || !selection.trim())
      throw Error("片段选区不能为空");
    if (typeof before !== "string" || typeof after !== "string") throw Error("片段上下文必须是文本");
    for (const field of ["kind", "captureRunId", "conversationId", "messageId", "url", "sourceLocalId", "sourceRole", "captureMode", "captureNotice"])
      if (f[field] != null && (typeof f[field] !== "string" || f[field].length > 2048))
        throw Error("来源身份字段无效：" + field);
    for (const field of ["capturedAt", "identityCapturedAt"])
      if (f[field] != null && (!Number.isSafeInteger(f[field]) || f[field] < 0))
        throw Error("来源时间无效");
    for (const field of ["sourceLength","selectionStart","selectionEnd"])
      if (f[field] != null && (!Number.isSafeInteger(f[field]) || f[field] < 0)) throw Error("来源范围无效");
    if (f.selectionStart != null && (f.selectionEnd !== f.selectionStart + f.selection.length || f.selectionEnd > f.sourceLength))
      throw Error("来源范围与选区不一致");
    for (const field of ["captureComplete","hasNonText"])
      if (f[field] != null && typeof f[field] !== "boolean") throw Error("来源完整性标志无效");
    if (codePoints(before) > 500 || codePoints(after) > 500)
      throw Error("片段上下文超过 500 code points");
    if (!["cites", "supports", "opposes", "background"].includes(relation))
      throw Error("未知片段关系: " + relation);
    if (!["complete", "partial", "unknown"].includes(completeness))
      throw Error("未知采集完整性");
    if (bytes(before + selection + after) > LIMITS.fragmentBytes)
      throw Error("单片段超过 16 KiB");
    return true;
  }
  function validateFragments(fs, { required = false } = {}) {
    if (!Array.isArray(fs)) throw Error("片段必须是数组");
    if (required && !fs.length) throw Error("采纳至少需要一个依据片段");
    if (fs.length > 8) throw Error("单条结论最多 8 个片段");
    let total = 0;
    for (const f of fs) {
      validateFragment(f);
      total += bytes((f.before || "") + f.selection + (f.after || ""));
    }
    if (total > LIMITS.fragmentsTotalBytes)
      throw Error("单条结论片段总量超过 64 KiB");
  }
  function validateAdoption(i) {
    if (!i || !validProjectId(i.projectId))
      throw Error("课题 ID 无效或缺失");
    if (typeof i.text !== "string" || !i.text.trim())
      throw Error("结论正文不能为空");
    if (codePoints(i.text) > 4000) throw Error("结论正文超过 4000 code points");
    if (i.conditions !== undefined && typeof i.conditions !== "string") throw Error("适用条件必须是文本");
    if(i.changeImpact!==undefined&&!["wording","substantive","conditions"].includes(i.changeImpact))throw Error("变更类型无效");
    validateFragments(i.fragments || [], { required: true });
  }
  function norm(f) {
    return {
      kind: f.kind || "capture",
      captureRunId: f.captureRunId || null,
      conversationId: f.conversationId || null,
      messageId: f.messageId || null,
      url: f.url || null,
      capturedAt: Object.hasOwn(f, "identityCapturedAt")
        ? f.identityCapturedAt
        : (f.capturedAt ?? null),
      before: f.before || "",
      selection: f.selection,
      after: f.after || "",
      relation: f.relation || "cites",
      completeness: f.completeness || "unknown",
      ...Object.fromEntries(["sourceLocalId","sourceRole","sourceLength","selectionStart","selectionEnd",
        "captureComplete","captureMode","captureNotice","hasNonText"].filter(k=>f[k]!==undefined).map(k=>[k,f[k]])),
    };
  }
  async function fingerprint(text, conditions, fragments) {
    return hashRequest({
      text,
      conditions: conditions || "",
      fragments: fragments
        .map(norm)
        .sort((a, b) => stable(a).localeCompare(stable(b))),
    });
  }
  function rows(s, p) {
    return Object.values(s.conclusions || {}).filter((x) => x.projectId === p);
  }
  function repairedProject(s, p, project) {
    return rows(s, p).length ? { ...project, takeover: true } : project;
  }
  function fragments(s, versionId) {
    return Object.values(s.links || {})
      .filter((l) => l.versionId === versionId)
      .map(
        (l) =>
          s.sources[l.sourceId] && {
            ...s.sources[l.sourceId],
            relation: l.relation,
          },
      )
      .filter(Boolean);
  }
  async function prior(s, kind, input, id) {
    if (!isId(id, "op_")) throw Error("操作 ID 无效");
    const r = s.operations && s.operations[id];
    if (!r) return null;
    if (r.schema !== 2 || typeof r.kind !== "string")
      throw Error("legacy-operation-check-required");
    if (
      r.kind !== kind ||
      r.requestHash !== (await hashRequest({ schema: 2, kind, input }))
    )
      throw Error("操作 ID 已用于不同请求，已拒绝");
    if(r.redacted)throw Error("旧操作所属数据已删除或替换，不能重放");
    return r.result;
  }
  async function ledger(kind, input, id, result) {
    if (!isId(id, "op_")) throw Error("操作 ID 无效");
    return {
      operationId: id,
      schema: 2,
      kind,
      requestHash: await hashRequest({ schema: 2, kind, input }),
      result,
      at: now(),
    };
  }
  async function records(fs, versionId, suffix = "") {
    const sources = [],
      links = [],
      at = now();
    for (let n = 0; n < fs.length; n++) {
      const f = norm(fs[n]),
        id = "src_" + uuid() + suffix + n;
      sources.push({
        ...f,
        id,
        identityCapturedAt: f.capturedAt,
        textHash: await hashText(f.before + f.selection + f.after),
        capturedAt: f.capturedAt ?? at,
      });
      links.push({
        id: "lnk_" + uuid() + suffix + n,
        versionId,
        sourceId: id,
        relation: f.relation,
      });
    }
    return { sources, links };
  }
  async function findDuplicateAdoption(s, projectId, input) {
    const wanted = await fingerprint(
      input.text,
      input.conditions || "",
      input.fragments || [],
    );
    for (const c of rows(s, projectId)) {
      if (c.status !== "adopted") continue;
      const v = s.versions[c.currentVersionId];
      if (
        v &&
        wanted ===
          (await fingerprint(v.text, v.conditions || "", fragments(s, v.id)))
      )
        return c;
    }
    return null;
  }
  async function planAdoption(s, i, operationId) {
    validateAdoption(i);
    const input = {
        projectId: i.projectId,
        text: i.text,
        conditions: i.conditions || "",
        fragments: (i.fragments || []).map(norm),
      },
      replay = await prior(s, "adopt", input, operationId);
    if (replay) return { replay };
    const project = s.projects && s.projects[i.projectId];
    if (!project) throw Error("课题不存在或未初始化");
    const dup = await findDuplicateAdoption(s, i.projectId, input);
    if (dup) {
      const result = {
        conclusionId: dup.id,
        versionId: dup.currentVersionId,
        revision: project.evidenceRevision,
        dedupe: true,
      };
      return {
        replay: null,
        result,
        expectedRevision: project.evidenceRevision,
        writes: {
          project: repairedProject(s, i.projectId, project),
          ledger: await ledger("adopt", input, operationId, result),
        },
      };
    }
    if (rows(s, i.projectId).length >= 200)
      throw Error("课题结论数达上限（200）");
    const at = now(),
      conclusionId = "con_" + uuid(),
      versionId = "ver_" + uuid(),
      first = !rows(s, i.projectId).length;
    const version = {
        id: versionId,
        conclusionId,
        text: input.text,
        conditions: input.conditions,
        sourceCount: input.fragments.length,
        changeType: "create",
        predecessorId: null,
        createdAt: at,
        creator: "user",
        adoptionFingerprint: await fingerprint(
          input.text,
          input.conditions,
          input.fragments,
        ),
      },
      conclusion = {
        id: conclusionId,
        projectId: i.projectId,
        currentVersionId: versionId,
        status: "adopted",
        createdAt: at,
        adoptedAt: at,
      },
      next = {
        ...repairedProject(s, i.projectId, project),
        evidenceRevision: project.evidenceRevision + 1,
        projectionTodo: true,
        ...(first
          ? {
              takeover: true,
              ...(typeof i.legacyDecision === "string" &&
              i.legacyDecision.trim()
                ? {
                    legacyNote: {
                      text: i.legacyDecision,
                      capturedAt: at,
                      verified: false,
                    },
                  }
                : {}),
            }
          : {}),
      },
      result = { conclusionId, versionId, revision: next.evidenceRevision };
    return {
      replay: null,
      result,
      expectedRevision: project.evidenceRevision,
      writes: {
        conclusion,
        version,
        ...(await records(input.fragments, versionId)),
        project: next,
        ledger: await ledger("adopt", input, operationId, result),
      },
    };
  }
  async function planAmendment(s, id, i, operationId) {
    if (!isId(id, "con_") || !i || typeof i.text !== "string" || !i.text.trim())
      throw Error("修订输入无效");
    if (codePoints(i.text) > 4000) throw Error("结论正文超过 4000 code points");
    if (i.conditions !== undefined && typeof i.conditions !== "string") throw Error("适用条件必须是文本");
    const hasFragments = i.fragments !== undefined,
      hasConditions = i.conditions !== undefined,
      raw = {
        conclusionId: id,
        text: i.text,
        conditions: hasConditions ? i.conditions || "" : null,
        fragments: hasFragments ? (i.fragments || []).map(norm) : null,
        conditionsOmitted: !hasConditions,
        fragmentsOmitted: !hasFragments,
        expectedVersionId: i.expectedVersionId ?? null,
        changeImpact: i.changeImpact||"substantive",
        carryForward: i.carryForward===true,
      },
      replay = await prior(s, "amend", raw, operationId);
    if (replay) return { replay };
    const c = s.conclusions[id],
      old = c && s.versions[c.currentVersionId],
      project = c && s.projects[c.projectId];
    if (!c || !old || !project) throw Error("权威记录缺失");
    if (i.expectedVersionId != null && i.expectedVersionId !== c.currentVersionId)
      throw Error("结论已在其他窗口修订，请刷新后核对；未覆盖当前版本");
    if (c.status === "withdrawn")
      throw Error("结论已撤回：请重新采纳而不是修订");
    if (hasFragments) validateFragments(i.fragments || []);
    const conditions = hasConditions
      ? i.conditions || ""
      : old.conditions || "";
    if(raw.changeImpact==="wording"&&(hasFragments||conditions!==(old.conditions||"")))throw Error("仅措辞不能改变适用条件或来源连接");
    if(raw.carryForward&&raw.changeImpact!=="wording")throw Error("只有明确的仅措辞修订可承接依赖确认");
    if (
      Object.values(s.versions).filter((v) => v.conclusionId === id).length >=
      50
    )
      throw Error("版本数达上限（50）");
    const versionId = "ver_" + uuid(),
      version = {
        id: versionId,
        conclusionId: id,
        text: i.text,
        conditions,
        sourceCount: hasFragments ? (i.fragments || []).length : fragments(s, old.id).length,
        changeType: "amend",
        changeImpact:raw.changeImpact,
        carryForward:raw.carryForward,
        predecessorId: old.id,
        createdAt: now(),
        creator: "user",
      };
    const r = hasFragments
        ? await records(i.fragments || [], versionId, "_a")
        : {
            sources: [],
            links: fragments(s, old.id).map((f, n) => ({
              id: "lnk_" + uuid() + "_r" + n,
              versionId,
              sourceId: f.id,
              relation: f.relation,
            })),
          },
      next = {
        ...repairedProject(s, c.projectId, project),
        evidenceRevision: project.evidenceRevision + 1,
        projectionTodo: true,
      },
      result = { conclusionId: id, versionId, revision: next.evidenceRevision };
    return {
      replay: null,
      result,
      expectedRevision: project.evidenceRevision,
      writes: {
        conclusion: { ...c, currentVersionId: versionId },
        version,
        ...r,
        project: next,
        ledger: await ledger("amend", raw, operationId, result),
      },
    };
  }
  async function planWithdrawal(s, id, reason, operationId) {
    if (!isId(id, "con_") || typeof reason !== "string")
      throw Error("撤回输入无效");
    const input = { conclusionId: id, reason },
      replay = await prior(s, "withdraw", input, operationId);
    if (replay) return { replay };
    const c = s.conclusions[id],
      project = c && s.projects[c.projectId];
    if (!c || !project) throw Error("结论不存在");
    if (c.status === "withdrawn") throw Error("结论已撤回");
    const next = {
        ...repairedProject(s, c.projectId, project),
        evidenceRevision: project.evidenceRevision + 1,
        projectionTodo: true,
      },
      result = {
        conclusionId: id,
        status: "withdrawn",
        revision: next.evidenceRevision,
      };
    return {
      replay: null,
      result,
      expectedRevision: project.evidenceRevision,
      writes: {
        conclusion: {
          ...c,
          status: "withdrawn",
          withdrawnAt: now(),
          withdrawalReason: reason,
        },
        project: next,
        ledger: await ledger("withdraw", input, operationId, result),
      },
    };
  }
  function projectSummary(s, p) {
    const rs = rows(s, p).sort(
        (a, b) => (b.adoptedAt || 0) - (a.adoptedAt || 0),
      ),
      prefix =
        "证据库摘析（只读投影，v" +
        (s.projects[p]?.evidenceRevision ?? 0) +
        "，采纳 " +
        rs.filter((x) => x.status === "adopted").length +
        " 条）：\n";
    let body = rs
      .map((c) => {
        const v = s.versions[c.currentVersionId];
        if (!v) return "";
        const x = Array.from(v.text);
        return (
          (c.status === "withdrawn" ? "[已撤回] " : "") +
          "结论 " +
          c.id.slice(0, 12) +
          "：" +
          x.slice(0, 120).join("") +
          (x.length > 120 ? "…（见证据库）" : "")
        );
      })
      .filter(Boolean)
      .join("\n");
    if (codePoints(prefix + body) > 1000)
      body =
        Array.from(body)
          .slice(0, 1000 - codePoints(prefix) - 20)
          .join("") + "\n…（截断：完整结论见证据库）";
    return prefix + body;
  }
  function exportPackage(s, p) {
    requireProjectId(p);
    const conclusions = rows(s, p).map((x) => ({ ...x })),
      ids = new Set(conclusions.map((x) => x.id)),
      versions = Object.values(s.versions)
        .filter((x) => ids.has(x.conclusionId))
        .map((x) => ({ ...x })),
      vIds = new Set(versions.map((x) => x.id)),
      links = Object.values(s.links)
        .filter((x) => vIds.has(x.versionId))
        .map((x) => ({ ...x })),
      srcIds = new Set(links.map((x) => x.sourceId)),
      sources = Object.values(s.sources)
        .filter((x) => srcIds.has(x.id))
        .map((x) => ({ ...x })),
      project = s.projects[p];
    if (!project) throw Error("课题不存在");
    const pkg = {
      format: project.research || project.handoffs ? "threadline-evidence/3" : "threadline-evidence/2",
      projectId: p,
      exportedAt: now(),
      includesOriginalExcerpts: true,
      project: {
        takeover: !!project.takeover || conclusions.length > 0,
        legacyNote: project.legacyNote ? { ...project.legacyNote } : null,
        legacyNoteUnavailable: !!project.legacyNoteUnavailable,
        ...(project.research ? {research:structuredClone(project.research)} : {}),
        ...(project.handoffs ? {handoffs:structuredClone(project.handoffs)} : {}),
      },
      counts: {
        conclusions: conclusions.length,
        versions: versions.length,
        sources: sources.length,
        links: links.length,
      },
      conclusions,
      versions,
      sources,
      links,
    };
    if (bytes(JSON.stringify(pkg)) > LIMITS.packageBytes)
      throw Error("导出包超过 20 MiB");
    return pkg;
  }
  function unique(rows, name) {
    const got = new Set();
    for (const x of rows) {
      if (!x || typeof x.id !== "string" || got.has(x.id))
        throw Error(name + " ID 无效或重复");
      got.add(x.id);
    }
  }
  async function validateExportPackage(pkg) {
    if (
      !pkg ||
      !["threadline-evidence/1", "threadline-evidence/2", "threadline-evidence/3"].includes(pkg.format)
    )
      throw Error("未知导出包格式");
    if (bytes(JSON.stringify(pkg)) > LIMITS.packageBytes)
      throw Error("导入包超过 20 MiB");
    for (const n of ["conclusions", "versions", "sources", "links"]) {
      if (!Array.isArray(pkg[n])) throw Error("导入包缺少 " + n);
      unique(pkg[n], n);
    }
    requireProjectId(pkg.projectId);
    if (
      !pkg.format.endsWith("/1") &&
      (!pkg.project ||
        (pkg.conclusions.length && pkg.project.takeover !== true) ||
        (pkg.project.legacyNote &&
          (!pkg.project.legacyNote ||
            typeof pkg.project.legacyNote.text !== "string" ||
            pkg.project.legacyNote.verified !== false)))
    )
      throw Error("课题元数据无效");
    const cs = new Map(pkg.conclusions.map((x) => [x.id, x])),
      vs = new Map(pkg.versions.map((x) => [x.id, x])),
      ss = new Map(pkg.sources.map((x) => [x.id, x]));
    if (pkg.conclusions.length > 200) throw Error("课题结论数达上限");
    for (const c of pkg.conclusions) {
      if (
        c.projectId !== pkg.projectId ||
        !isId(c.id, "con_") ||
        !["adopted", "withdrawn"].includes(c.status) ||
        !vs.has(c.currentVersionId) ||
        vs.get(c.currentVersionId).conclusionId !== c.id
      )
        throw Error("结论版本归属或状态无效");
    }
    for (const v of pkg.versions) {
      if (
        !isId(v.id, "ver_") ||
        !cs.has(v.conclusionId) ||
        typeof v.text !== "string" ||
        !v.text.trim() ||
        codePoints(v.text) > 4000 ||
        typeof v.conditions !== "string" ||
        !["create", "amend"].includes(v.changeType) ||
        typeof v.creator !== "string"
      )
        throw Error("版本无效");
      if (
        v.predecessorId &&
        (!vs.has(v.predecessorId) ||
          vs.get(v.predecessorId).conclusionId !== v.conclusionId)
      )
        throw Error("版本前驱无效");
    }
    for (const c of pkg.conclusions) {
      let n = c.currentVersionId,
        seen = new Set();
      while (n) {
        if (seen.has(n)) throw Error("版本前驱环");
        seen.add(n);
        n = vs.get(n).predecessorId || null;
      }
      const own = [...vs.values()].filter((v) => v.conclusionId === c.id);
      if (own.length > 50) throw Error("版本数达上限");
      if (seen.size !== own.length) throw Error("孤立版本拒绝");
    }
    for (const s of pkg.sources) {
      if (!isId(s.id, "src_")) throw Error("来源 ID 无效");
      validateFragment(s);
      if (
        s.textHash !==
        (await hashText((s.before || "") + s.selection + (s.after || "")))
      )
        throw Error("来源哈希无效");
    }
    const linkedSources = new Set();
    for (const l of pkg.links) {
      if (
        !isId(l.id, "lnk_") ||
        !vs.has(l.versionId) ||
        !ss.has(l.sourceId) ||
        !["cites", "supports", "opposes", "background"].includes(l.relation)
      )
        throw Error("来源链接无效");
      linkedSources.add(l.sourceId);
    }
    if (linkedSources.size !== ss.size) throw Error("孤立来源拒绝");
    for (const v of pkg.versions) {
      const fs = pkg.links
        .filter((l) => l.versionId === v.id)
        .map((l) => ss.get(l.sourceId));
      validateFragments(fs, { required: v.changeType === "create" });
      if (v.sourceCount !== undefined && (!Number.isSafeInteger(v.sourceCount) || v.sourceCount !== fs.length))
        throw Error("版本依据数量与快照不一致");
    }
    if (pkg.project?.research || pkg.project?.handoffs) {
      if(pkg.format!=="threadline-evidence/3")throw Error("研究历史需要 /3 备份格式，旧格式不能静默忽略");
      if(pkg.project.research) {
        const research=typeof module!=="undefined"&&module.exports?require("./research-core.js"):globalThis.ThreadLineResearchCore;
        const state={conclusions:Object.fromEntries(cs),versions:Object.fromEntries(vs),sources:Object.fromEntries(ss),
          links:Object.fromEntries(pkg.links.map(l=>[l.id,l])),projects:{[pkg.projectId]:pkg.project}};
        research.validateResearch(pkg.project.research,state,pkg.projectId);
        if((pkg.project.research.reviews||[]).length||
          (pkg.project.research.events||[]).some(e=>e.kind==="reviewCompleted"))
          throw Error("此备份包含 S4 复核历史；S3 独立版本不会降级覆盖，请使用完整版本恢复");
      }
      if(pkg.project.handoffs) {
        if(!Array.isArray(pkg.project.handoffs)||pkg.project.handoffs.length>100)throw Error("交接历史数量无效");
        const seen=new Set();
        for(const h of pkg.project.handoffs) {
          if(!isId(h.id,"dep_")||seen.has(h.id)||typeof h.text!=="string"||bytes(h.text)>128*1024||h.materialHash!==await hashText(h.text)||!Array.isArray(h.scope)||h.scopeHash!==await hashRequest(h.scope)||!Array.isArray(h.events)||h.events.length>100)throw Error("交接历史格式或哈希无效");
          seen.add(h.id);
          for(const row of h.scope)if(!cs.has(row.id)||vs.get(row.versionId)?.conclusionId!==row.id||!Array.isArray(row.sources)||row.sources.some(x=>!ss.has(x.id)||ss.get(x.id).textHash!==x.hash))throw Error("交接历史引用无效");
          for(const e of h.events)if(!isId(e.id,"dep_")||!["copied","human-read"].includes(e.event)||typeof e.text!=="string"||bytes(e.text)>128*1024||e.materialHash!==await hashText(e.text)||!Number.isSafeInteger(e.at))throw Error("交接事件无效");
        }
      }
    }
    return true;
  }
  async function importPackage(s, pkg, id) {
    await validateExportPackage(pkg);
    const cleanPkg = {
        ...pkg,
        versions: pkg.versions.map(({ adoptionFingerprint, ...v }) => v),
      },
      // The operation identity seals the complete user-supplied package.
      // Only the persisted records discard this untrusted derived cache.
      input = { pkg },
      replay = await prior(s, "import", input, id);
    if (replay) return { replay };
    if (!cleanPkg.conclusions.length) throw Error("空证据包没有可恢复的结论，未修改课题");
    const project = s.projects[cleanPkg.projectId];
    if (!project) throw Error("目标课题不存在");
    if (
      rows(s, cleanPkg.projectId).length + cleanPkg.conclusions.length >
      LIMITS.conclusionsPerProject
    )
      throw Error("课题结论数达上限（200）");
    for (const [n, xs] of Object.entries({
      conclusions: cleanPkg.conclusions,
      versions: cleanPkg.versions,
      sources: cleanPkg.sources,
      links: cleanPkg.links,
    }))
      for (const x of xs) if (s[n][x.id]) throw Error(n + " ID 冲突：" + x.id);
    const meta = !cleanPkg.format.endsWith("/1")
      ? cleanPkg.project || {}
      : { takeover: true, legacyNoteUnavailable: true };
    for(const field of ["research","handoffs"])if(meta[field]&&project[field]&&stable(meta[field])!==stable(project[field]))
      throw Error("研究历史冲突：请使用带预览的完整恢复，不能覆盖现有记录");
    if (
      meta.legacyNote &&
      project.legacyNote &&
      stable(meta.legacyNote) !== stable(project.legacyNote)
    )
      throw Error("legacy-note 冲突");
    const next = {
        ...project,
        evidenceRevision: project.evidenceRevision + 1,
        projectionTodo: true,
        takeover: true,
        legacyNote: project.legacyNote || meta.legacyNote || null,
        ...(meta.research ? {research:structuredClone(meta.research)} : {}),
        ...(meta.handoffs ? {handoffs:structuredClone(meta.handoffs)} : {}),
        ...(!project.legacyNote && !meta.legacyNote
          ? { legacyNoteUnavailable: true }
          : {}),
      },
      result = {
        imported: cleanPkg.conclusions.length,
        revision: next.evidenceRevision,
      };
    return {
      replay: null,
      result,
      expectedRevision: project.evidenceRevision,
      writes: {
        bulkConclusions: cleanPkg.conclusions,
        bulkVersions: cleanPkg.versions,
        bulkSources: cleanPkg.sources,
        bulkLinks: cleanPkg.links,
        project: next,
        ledger: await ledger("import", input, id, result),
      },
    };
  }
  const Core = {
    LIMITS,
    validProjectId,
    requireProjectId,
    codePoints,
    bytes,
    validateFragment,
    validateAdoption,
    planAdoption,
    planAmendment,
    planWithdrawal,
    findDuplicateAdoption,
    projectSummary,
    exportPackage,
    importPackage,
    validateExportPackage,
    hashText,
    hashRequest,
    uuid,
    newProjectRecord: (projectId) => ({
      projectId: requireProjectId(projectId),
      evidenceRevision: 0,
      projectionRevision: 0,
      projectionTodo: false,
      takeover: false,
      legacyNote: null,
    }),
  };
  if (typeof module !== "undefined" && module.exports) module.exports = Core;
  else globalThis.ThreadLineEvidenceCore = Core;
})();
