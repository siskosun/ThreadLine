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
  function newExperiment(frozen, experimentId) {
    validId(experimentId);
    assert(frozen && frozen.rule === RULE && typeof frozen.text === "string", "missing frozen input");
    const make = label => ({
      id:experimentId + "_" + label, label, revision:0, status:"pending", phase:"created",
      attempts:[], history:[],
      isolation:{checks:Object.fromEntries(CHECKS.map(name => [name, "unknown"])), confirmedAt:null}
    });
    return {id:experimentId, revision:0, frozen:structuredClone(frozen),
      createdAt:Date.now(), branches:{A:make("A"), B:make("B")}, decision:null};
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
    assert(["A", "B"].includes(event.branch) && exp.branches && exp.branches[event.branch],
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
    const counterpart = exp.branches[branch === "A" ? "B" : "A"];
    assert(!counterpart.attempts.some(a => a.id === attemptId),
      "attempt ID already belongs to another branch");
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
      const other = exp.branches[branch === "A" ? "B" : "A"];
      assert(!other.attempts.some(a => a.evidence?.sessionId === nextEvidence.sessionId),
        "same session assigned to both branches");
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
    return comparableSide(exp.branches.A) && comparableSide(exp.branches.B) &&
      exp.branches.A.attempts.at(-1).evidence.sessionId !==
        exp.branches.B.attempts.at(-1).evidence.sessionId;
  }
  async function assignMapping(exp, seed) {
    plain(exp);
    assert(exp.decision === null || exp.decision === undefined, "mapping already assigned");
    assert(eligibleForComparison(exp), "both branches must be done with verified input and captures");
    assert(typeof seed === "string" && seed.length >= 10, "comparison seed required");
    // The mapping is a pure function of the recorded seed, so the export can
    // be independently recomputed without trusting this call.
    return hash("threadline-xy:" + seed).then(digest => {
      const xIsA = parseInt(digest[0], 16) % 2 === 0;
      return Object.freeze({seed, assignedAt:Date.now(),
        mapping:Object.freeze({X:xIsA ? "A" : "B", Y:xIsA ? "B" : "A"}), verdict:null});
    });
  }
  function recordVerdict(decision, verdict) {
    plain(decision);
    assert(decision.mapping, "no comparison mapping assigned yet");
    assert(decision.verdict === null || decision.verdict === undefined,
      "verdict already recorded");
    plain(verdict);
    assert(PREFERENCES.includes(verdict.preference), "invalid preference");
    assert(typeof verdict.criteria === "string" && verdict.criteria.trim().length > 0 &&
      verdict.criteria.length <= 400, "criteria required");
    assert(typeof verdict.confidence === "string" &&
      ["low", "medium", "high"].includes(verdict.confidence), "invalid confidence");
    assert(typeof verdict.notes === "string" && verdict.notes.length <= 4000,
      "invalid notes");
    return Object.freeze({preference:verdict.preference, criteria:verdict.criteria.trim(),
      confidence:verdict.confidence, notes:verdict.notes, decidedAt:Date.now()});
  }
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
      branches:Object.fromEntries(["A", "B"].map(label => [label, {
        status:exp.branches[label].status, phase:exp.branches[label].phase,
        attempts:exp.branches[label].attempts}])),
      decision:exp.decision ? {...exp.decision} : null};
  }
  return {MAX_BYTES, RULE, STATES, PHASES, CHECKS, PREFERENCES, canonical, compare, byteLength,
    hash, wellFormed, fingerprints, formatText, freeze, verifyFrozen, classify, newExperiment, advance,
    eligibleForComparison, assignMapping, recordVerdict, exportSnapshot};
})();
if (typeof globalThis !== "undefined") globalThis.ThreadLineFFCore = ThreadLineFFCore;
if (typeof module !== "undefined") module.exports = ThreadLineFFCore;
