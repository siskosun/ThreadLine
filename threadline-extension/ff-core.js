/* Fork Beta contract: pure data logic only; no tab, send, or network operations. */
const ThreadLineFFCore = (() => {
  "use strict";
  const MAX_BYTES = 24000, RULE = "canonicalization-v1";
  const STATES = Object.freeze(["pending", "done", "failed", "unknown"]);
  const PHASES = Object.freeze(["created", "draft_ready", "awaiting_send", "generating", "capturing"]);
  // Attested signal kinds, not arbitrary values or caller-defined objects.
  const END_SIGNALS = Object.freeze(["generation", "stable", "final"]);
  const CHECKS = Object.freeze(["memory", "referenceHistory", "customInstructions", "model",
    "thinkingEffort", "tools", "project"]);
  const encoder = new TextEncoder();
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const canonical = value => value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const compare = value => canonical(value).replace(/\u00a0/g, " ").trim();
  const byteLength = value => encoder.encode(value).byteLength;
  // TextEncoder silently replaces lone UTF-16 surrogates with U+FFFD.
  // Without validation, different frozen strings could share raw-byte hashes.
  function wellFormed(value) {
    for (let i=0;i<value.length;i++) {
      const n=value.charCodeAt(i);
      if (n>=0xD800 && n<=0xDBFF) {
        const after=value.charCodeAt(++i);
        if (!(after>=0xDC00 && after<=0xDFFF)) return false;
      } else if (n>=0xDC00 && n<=0xDFFF) return false;
    }
    return true;
  }

  function validId(value) {
    assert(typeof value === "string" && /^[a-zA-Z0-9_-]{6,100}$/.test(value), "invalid ID");
    return value;
  }
  function plain(value) {
    assert(value !== null && typeof value === "object" && !Array.isArray(value), "invalid object");
    return value;
  }
  async function hash(value) {
    assert(typeof value === "string", "hash input must be text");
    assert(wellFormed(value), "ill-formed Unicode cannot be hashed");
    const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(value));
    return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, "0")).join("");
  }
  async function fingerprints(value) {
    assert(typeof value === "string", "fingerprint input must be text");
    assert(wellFormed(value), "ill-formed Unicode cannot be fingerprinted");
    const [raw, frozen, comparison] = await Promise.all([
      hash(value), hash(canonical(value)), hash(compare(value))
    ]);
    return {raw, frozen, compare:comparison, rule:RULE};
  }
  function formatText(w0, p) {
    return "【共同材料 W₀】\n" + w0 + "\n\n【任务指令 P】\n" + p;
  }
  async function freeze(w0, p) {
    assert(typeof w0 === "string" && typeof p === "string" && p.trim().length > 0,
      "W0 and non-empty task instructions are required");
    assert(wellFormed(w0) && wellFormed(p), "ill-formed Unicode cannot be frozen");
    const text = formatText(w0, p), bytes = byteLength(text);
    assert(bytes <= MAX_BYTES, "frozen input exceeds 24000 UTF-8 bytes");
    const [w0Hashes, pHashes, textHashes] = await Promise.all([
      fingerprints(w0), fingerprints(p), fingerprints(text)
    ]);
    return Object.freeze({
      w0, p, text, bytes, rule:RULE,
      w0Hashes:Object.freeze(w0Hashes), pHashes:Object.freeze(pHashes),
      textHashes:Object.freeze(textHashes), frozenAt:Date.now()
    });
  }
  async function verifyFrozen(record) {
    plain(record);
    assert(record.rule === RULE && Number.isSafeInteger(record.frozenAt), "invalid frozen record");
    assert(typeof record.w0 === "string" && typeof record.p === "string" &&
      record.p.trim().length > 0 && record.text === formatText(record.w0, record.p),
      "frozen text changed");
    assert(record.bytes === byteLength(record.text) && record.bytes <= MAX_BYTES,
      "frozen byte count changed");
    const expected = await Promise.all([
      fingerprints(record.w0), fingerprints(record.p), fingerprints(record.text)
    ]);
    for (const [stored, computed] of [[record.w0Hashes, expected[0]],
      [record.pHashes, expected[1]], [record.textHashes, expected[2]]]) {
      for (const key of ["raw", "frozen", "compare", "rule"])
        assert(stored && stored[key] === computed[key], "frozen hash mismatch");
    }
    return true;
  }
  async function classify(expected, observed, options={}) {
    assert(typeof expected === "string", "expected text must be a string");
    if (!wellFormed(expected)) throw new Error("ill-formed expected Unicode");
    if (!options.trusted || !options.complete || typeof observed !== "string" || !wellFormed(observed))
      return {level:"unverified", rule:RULE};
    const [a, b] = await Promise.all([fingerprints(expected), fingerprints(observed)]);
    const level = expected === observed ? "exact" :
      (a.frozen === b.frozen || a.compare === b.compare) ? "canonical_equivalent" : "differs";
    return {level, rule:RULE, expected:a, observed:b};
  }
  const BRANCH_LABELS = Object.freeze(["A", "B", "C", "D"]);
  const MAX_BRANCHES = 4;
  function newExperiment(frozen, experimentId, branchCount = 2) {
    validId(experimentId);
    assert(Number.isSafeInteger(branchCount) && branchCount >= 2 && branchCount <= MAX_BRANCHES,
      "branch count must be 2.." + MAX_BRANCHES);
    assert(frozen && frozen.rule === RULE && typeof frozen.text === "string", "missing frozen input");
    const make = label => ({
      id:experimentId + "_" + label, label, revision:0, status:"pending", phase:"created",
      attempts:[], history:[],
      isolation:{checks:Object.fromEntries(CHECKS.map(name => [name, "unknown"])), confirmedAt:null}
    });
    const branches = Object.fromEntries(
      BRANCH_LABELS.slice(0, branchCount).map(label => [label, make(label)]));
    return {id:experimentId, revision:0, branchCount, frozen:structuredClone(frozen),
      createdAt:Date.now(), branches, decision:null};
  }
  // Stable representation makes an operation ID safe to replay after a worker restart.
  function sortedJSON(value) {
    if (Array.isArray(value)) return "[" + value.map(sortedJSON).join(",") + "]";
    if (value && typeof value === "object")
      return "{" + Object.keys(value).sort().map(key =>
        JSON.stringify(key) + ":" + sortedJSON(value[key])).join(",") + "}";
    return JSON.stringify(value);
  }
  function operationSignature(event) {
    const {branch, expectedRevision, operationId, attemptId, status, phase,
      evidence={}, reason="", manualNewAttempt=false} = event;
    return sortedJSON({branch, expectedRevision, operationId, attemptId, status,
      phase, evidence, reason, manualNewAttempt});
  }
  function advance(exp, event) {
    plain(exp); plain(event);
    assert(exp.branches && exp.branches[event.branch] &&
      BRANCH_LABELS.slice(0, exp.branchCount || 2).includes(event.branch),
      "invalid branch");
    const {branch, expectedRevision, operationId, attemptId, status, phase,
      evidence={}, reason="", manualNewAttempt=false} = event;
    validId(operationId); validId(attemptId);
    assert(STATES.includes(status) && PHASES.includes(phase), "invalid state");
    assert(typeof reason === "string" && reason.length <= 400, "invalid reason");
    plain(evidence);
    const signature = operationSignature(event);
    assert(signature.length <= 250000, "operation evidence exceeds limit");
    const already = Object.values(exp.branches).flatMap(b => b.history)
      .find(entry => entry.operationId === operationId);
    if (already) {
      assert(already.signature === signature, "operation ID reused for different content");
      return exp; // Stable, byte-for-byte idempotent no-op, even with a stale revision.
    }
    assert(Number.isSafeInteger(expectedRevision) && expectedRevision === exp.revision,
      "stale revision");
    const currentBranch = exp.branches[branch], prior = currentBranch.attempts.find(a => a.id === attemptId);
    const boundSession = prior?.evidence?.sessionId;
    for (const session of [boundSession, evidence.sessionId])
      if (session !== undefined)
        assert(typeof session === "string" && session.length >= 4, "invalid session identity");
    assert(boundSession === undefined || evidence.sessionId === undefined ||
      boundSession === evidence.sessionId, "attempt session identity cannot change");
    if (evidence.tabId !== undefined)
      assert(Number.isSafeInteger(evidence.tabId) && evidence.tabId >= 0, "invalid tab binding");
    if (evidence.conversationId !== undefined)
      assert(typeof evidence.conversationId === "string" &&
        /^[a-z0-9-]{8,80}$/i.test(evidence.conversationId), "invalid conversation identity");
    if (evidence.inputLevel !== undefined)
      assert(["exact", "canonical_equivalent", "unverified", "differs"].includes(evidence.inputLevel),
        "invalid input level");
    if (evidence.prefill !== undefined)
      assert(["exact_ack", "reacked"].includes(evidence.prefill), "invalid prefill provenance");
    if (evidence.assistantBytes !== undefined)
      assert(Number.isSafeInteger(evidence.assistantBytes) && evidence.assistantBytes >= 0,
        "invalid reply size");
    // Evidence updates may omit identity, but may never erase a binding and
    // then replace it in a later event. Keep the existing serialized shape.
    const nextEvidence = boundSession === undefined ? evidence : {...evidence,sessionId:boundSession};
    for (const [otherLabel, otherBranch] of Object.entries(exp.branches)) {
      if (otherLabel === branch) continue;
      assert(!otherBranch.attempts.some(a => a.id === attemptId),
        "attempt ID already belongs to another branch");
    }
    const terminal = currentBranch.status !== "pending";
    if (terminal) {
      assert(manualNewAttempt === true && ["failed", "unknown"].includes(currentBranch.status) &&
        status === "pending" && phase === "created" && !prior,
        "terminal state cannot be replaced without explicit new attempt");
    } else {
      assert(!manualNewAttempt, "manual retry requires terminal failed/unknown state");
      // A pending branch can have only one active attempt. Starting a new ID
      // before the current attempt becomes failed/unknown would let late
      // events from either ID overwrite the branch's single status.
      const active = currentBranch.attempts.at(-1);
      if (active) assert(prior === active && active.status === "pending",
        "another active attempt is already pending");
      assert(!prior || prior.status === "pending", "terminal attempt immutable");
      if (prior) assert(PHASES.indexOf(phase) >= PHASES.indexOf(prior.phase),
        "attempt phase cannot move backwards");
    }
    if (status === "done") {
      assert(phase === "capturing" && ["exact", "canonical_equivalent"].includes(evidence.inputLevel),
        "input unverified");
      assert(typeof nextEvidence.sessionId === "string" && nextEvidence.sessionId.length >= 4,
        "missing session identity");
      assert(evidence.taskCount === 1 && evidence.captureComplete === true &&
        typeof evidence.reply === "string" && evidence.reply.length > 0,
        "response incomplete");
      assert(Array.isArray(evidence.endSignals) &&
        Array.from(evidence.endSignals).every(signal => typeof signal === "string" && END_SIGNALS.includes(signal)) &&
        new Set(evidence.endSignals).size >= 2,
        "insufficient completion signals");
      assert(evidence.persisted === true, "response not persisted");
      for (const [otherLabel, otherBranch] of Object.entries(exp.branches)) {
        if (otherLabel === branch) continue;
        assert(!otherBranch.attempts.some(a => a.evidence?.sessionId === nextEvidence.sessionId),
          "same session assigned to both branches");
      }
    }
    const now = Date.now(), next = structuredClone(exp), b = next.branches[branch];
    const found = b.attempts.find(a => a.id === attemptId);
    if (found) {
      Object.assign(found, {status, phase, updatedAt:now, evidence:structuredClone(nextEvidence)});
    } else {
      b.attempts.push({id:attemptId, status, phase, createdAt:now,
        updatedAt:now, evidence:structuredClone(nextEvidence)});
    }
    b.status = status;
    b.phase = phase;
    b.revision++;
    b.history.push({operationId, attemptId, status, phase, reason, at:now, signature});
    next.revision++;
    return next;
  }
  // ---------- P3: blind X/Y comparison, verdict and self-contained export ----------
  const PREFERENCES = Object.freeze(["X", "Y", "tie", "inconclusive"]);
  function comparableSide(branch) {
    const attempt = branch.attempts.at(-1);
    return branch.status === "done" && attempt &&
      ["exact", "canonical_equivalent"].includes(attempt.evidence?.inputLevel) &&
      attempt.evidence?.captureComplete === true &&
      typeof attempt.evidence?.reply === "string" && attempt.evidence.reply.length > 0 &&
      typeof attempt.evidence?.sessionId === "string";
  }
  function eligibleForComparison(exp) {
    plain(exp);
    const labels = Object.keys(exp.branches || {});
    if (labels.length < 2) return false;
    const sessions = new Set();
    for (const label of labels) {
      if (!comparableSide(exp.branches[label])) return false;
      const s = exp.branches[label].attempts.at(-1).evidence.sessionId;
      if (sessions.has(s)) return false;
      sessions.add(s);
    }
    return true;
  }
  async function mappingFromSeed(branchLabels, seed) {
    const digest = await hash("threadline-xy:" + seed);
    let shuffled;
    if (branchLabels.length === 2) {
      // K=2 keeps the exact phase-1 derivation so recorded mappings recompute.
      shuffled = parseInt(digest[0], 16) % 2 === 0
        ? [branchLabels[0], branchLabels[1]]
        : [branchLabels[1], branchLabels[0]];
    } else {
      shuffled = [...branchLabels];
      for (let i = shuffled.length - 1, bi = 0; i > 0; i--, bi++) {
        const j = parseInt(digest[bi % digest.length], 16) % (i + 1);
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
    }
    const outLabels = branchLabels.length === 2
      ? ["X", "Y"] : shuffled.map((_, i) => String(i + 1));
    const mapping = {};
    shuffled.forEach((branch, i) => { mapping[outLabels[i]] = branch; });
    return {mapping};
  }
  async function assignMapping(exp, seed) {
    plain(exp);
    assert(exp.decision === null || exp.decision === undefined, "mapping already assigned");
    assert(eligibleForComparison(exp), "both branches must be done with verified input and captures");
    assert(typeof seed === "string" && seed.length >= 10, "comparison seed required");
    // The mapping is a pure function of the recorded seed, so the export can
    // be independently recomputed without trusting this call.
    const {mapping} = await mappingFromSeed(Object.keys(exp.branches), seed);
    return Object.freeze({seed, assignedAt:Date.now(),
      mapping:Object.freeze(mapping), verdict:null});
  }
  function recordVerdict(decision, verdict) {
    plain(decision);
    assert(decision.mapping, "no comparison mapping assigned yet");
    assert(decision.verdict === null || decision.verdict === undefined,
      "verdict already recorded");
    plain(verdict);
    const validPreferences = [...Object.keys(decision.mapping), "tie", "inconclusive"];
    assert(validPreferences.includes(verdict.preference), "invalid preference");
    assert(typeof verdict.criteria === "string" && verdict.criteria.trim().length > 0 &&
      verdict.criteria.length <= 400, "criteria required");
    assert(typeof verdict.confidence === "string" &&
      ["low", "medium", "high"].includes(verdict.confidence), "invalid confidence");
    const notes = verdict.notes === undefined ? "" : verdict.notes;
    assert(typeof notes === "string" && notes.length <= 4000, "invalid notes");
    return Object.freeze({preference:verdict.preference, criteria:verdict.criteria.trim(),
      confidence:verdict.confidence, notes, decidedAt:Date.now()});
  }
  const SAME_SOURCE_NOTE = "同源采样：同一模型多分支一致不等于独立事实证据；偏好裁决不等于事实核验。";
  function exportSnapshot(exp) {
    plain(exp);
    // Self-contained and credential-free by construction: only experiment
    // state, hashes, attempts, capture replies and the user verdict.
    return {
      schema:1, kind:"threadline-fork-experiment", exportedAt:Date.now(),
      experiment:{id:exp.id, revision:exp.revision, createdAt:exp.createdAt,
        createOperationId:exp.createOperationId},
      frozen:{w0:exp.frozen.w0, p:exp.frozen.p, text:exp.frozen.text,
        bytes:exp.frozen.bytes, rule:exp.frozen.rule,
        w0Hashes:exp.frozen.w0Hashes, pHashes:exp.frozen.pHashes,
        textHashes:exp.frozen.textHashes, frozenAt:exp.frozen.frozenAt},
      branches:Object.fromEntries(Object.keys(exp.branches).map(label => [label,
        structuredClone(exp.branches[label])])),
      branchCount:exp.branchCount || Object.keys(exp.branches).length,
      decision:exp.decision ? {...exp.decision} : null,
      sampling:{classification:"same-source-sampling",independentFactualEvidence:false,note:SAME_SOURCE_NOTE}};
  }
  // ---------- P4: hidden judge calibration and validated JSON import ----------
  // Expected answers live in this private map and are never exposed through
  // CALIBRATION_ITEMS; only judgeCalibration surfaces them in the result.
  const CALIBRATION_EXPECTED = Object.freeze({"cal-econ-0001":1, "cal-logic-0001":1});
  const CALIBRATION_ITEMS = Object.freeze([
    Object.freeze({
      id:"cal-econ-0001",
      material:"虚构材料：活动 A 转化率 3.2%，活动 B 转化率 4.1%，其余条件相同。",
      question:"哪条线路转化率更高？",
      options:["活动 A", "活动 B", "无法判断"]}),
    Object.freeze({
      id:"cal-logic-0001",
      material:"虚构材料：所有已执行的测试用例通过，但仅覆盖了 10% 的代码路径。",
      question:"这一结论是否成立：系统已得到完全验证？",
      options:["成立", "不成立", "无法判断"]})
  ]);
  function judgeCalibration(responses) {
    assert(Array.isArray(responses) && responses.length === CALIBRATION_ITEMS.length,
      "respond to every calibration item");
    const per = CALIBRATION_ITEMS.map(item => {
      const r = responses.find(x => x && x.id === item.id);
      assert(r, "missing calibration response");
      assert(Number.isSafeInteger(r.choice) && r.choice >= 0 &&
        r.choice < item.options.length, "invalid calibration choice");
      const expected = CALIBRATION_EXPECTED[item.id];
      return {id:item.id, correct:r.choice === expected,
        expected:item.options[expected]};
    });
    const score = per.filter(x => x.correct).length;
    return {per, score, total:CALIBRATION_ITEMS.length,
      pass:score === CALIBRATION_ITEMS.length};
  }
  async function validateImport(snapshot) {
    plain(snapshot);
    assert(snapshot.schema === 1 && snapshot.kind === "threadline-fork-experiment",
      "unknown snapshot kind");
    // Legacy archives omit this display-only field. If present it cannot claim
    // multi-branch consistency is independent evidence; re-export always seals
    // the canonical caveat without trusting imported presentation metadata.
    if(Object.prototype.hasOwnProperty.call(snapshot,"sampling")) {
      plain(snapshot.sampling);
      assert(snapshot.sampling.classification==="same-source-sampling" &&
        snapshot.sampling.independentFactualEvidence===false &&
        snapshot.sampling.note===SAME_SOURCE_NOTE,
        "invalid same-source sampling annotation");
    }
    const frozen = snapshot.frozen;
    assert(frozen && typeof frozen === "object", "missing frozen input");
    await verifyFrozen(frozen);
    assert(snapshot.experiment && typeof snapshot.experiment.id === "string" &&
      /^[a-zA-Z0-9_-]{6,120}$/.test(snapshot.experiment.id), "invalid experiment identity");
    assert(Number.isSafeInteger(snapshot.experiment.revision) &&
      snapshot.experiment.revision >= 0, "invalid experiment revision");
    const branchEntries = Object.entries(snapshot.branches || {});
    assert(branchEntries.length >= 2 && branchEntries.length <= MAX_BRANCHES,
      "invalid branch count");
    for (const [label, branch] of branchEntries) {
      assert(BRANCH_LABELS.includes(label), "invalid branch label");
      plain(branch);
      assert(STATES.includes(branch.status) && PHASES.includes(branch.phase),
        "invalid branch state");
      assert(Number.isSafeInteger(branch.revision), "invalid branch revision");
      assert(Array.isArray(branch.history) && Array.isArray(branch.attempts),
        "imported branches must carry history and attempts");
      assert(branch.isolation && typeof branch.isolation === "object",
        "imported branches must carry isolation checks");
      for (const a of branch.attempts) {
        validId(a.id);
        assert(STATES.includes(a.status) && PHASES.includes(a.phase), "invalid attempt state");
        plain(a.evidence || {});
        if (a.status === "done") {
          // A snapshot may not claim done without the full completion evidence.
          const ev = a.evidence || {};
          assert(["exact", "canonical_equivalent"].includes(ev.inputLevel),
            "done attempt input unverified");
          assert(typeof ev.sessionId === "string" && ev.sessionId.length >= 4,
            "done attempt missing session identity");
          assert(ev.captureComplete === true && typeof ev.reply === "string" &&
            ev.reply.length > 0, "done attempt response incomplete");
          assert(Array.isArray(ev.endSignals) &&
            new Set(ev.endSignals).size >= 2, "done attempt signals insufficient");
          assert(ev.persisted === true && ev.taskCount === 1,
            "done attempt not persisted");
        }
      }
    }
    let decision = null;
    if (snapshot.decision) {
      plain(snapshot.decision);
      assert(typeof snapshot.decision.seed === "string", "invalid decision seed");
      const {mapping} = await mappingFromSeed(Object.keys(snapshot.branches),
        snapshot.decision.seed);
      assert(JSON.stringify(snapshot.decision.mapping) === JSON.stringify(mapping),
        "decision mapping does not match the recorded seed");
      if (snapshot.decision.verdict !== null && snapshot.decision.verdict !== undefined) {
        // Already-recorded verdicts are validated structurally, never re-recorded.
        const v = snapshot.decision.verdict;
        assert([...Object.keys(mapping), "tie", "inconclusive"].includes(v.preference),
          "invalid imported preference");
        assert(typeof v.criteria === "string" && v.criteria.length > 0 &&
          v.criteria.length <= 400, "invalid imported criteria");
        assert(["low", "medium", "high"].includes(v.confidence), "invalid imported confidence");
        assert(Number.isSafeInteger(v.decidedAt), "invalid decidedAt");
      }
      decision = {...snapshot.decision};
    }
    return {id:snapshot.experiment.id, revision:snapshot.experiment.revision,
      branchCount:branchEntries.length, frozen:structuredClone(frozen),
      branches:structuredClone(snapshot.branches), decision};
  }
  return {MAX_BYTES, RULE, STATES, PHASES, CHECKS, PREFERENCES, BRANCH_LABELS, MAX_BRANCHES,
    canonical, compare, byteLength,
    hash, wellFormed, fingerprints, formatText, freeze, verifyFrozen, classify, newExperiment, advance,
    eligibleForComparison, assignMapping, recordVerdict, exportSnapshot,
    judgeCalibration, CALIBRATION_ITEMS, validateImport};
})();
if (typeof globalThis !== "undefined") globalThis.ThreadLineFFCore = ThreadLineFFCore;
if (typeof module !== "undefined") module.exports = ThreadLineFFCore;
