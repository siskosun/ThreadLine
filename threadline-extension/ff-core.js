/* Fork Beta contract: pure data logic only; no tab, send, or network operations. */
const ThreadLineFFCore = (() => {
  "use strict";
  const MAX_BYTES = 24000, RULE = "canonicalization-v1";
  const STATES = Object.freeze(["pending", "done", "failed", "unknown"]);
  const PHASES = Object.freeze(["created", "draft_ready", "awaiting_send", "generating", "capturing"]);
  const CHECKS = Object.freeze(["memory", "referenceHistory", "customInstructions", "model",
    "thinkingEffort", "tools", "project"]);
  const encoder = new TextEncoder();
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const canonical = value => value.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const compare = value => canonical(value).replace(/\u00a0/g, " ").trim();
  const byteLength = value => encoder.encode(value).byteLength;
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
    const buffer = await crypto.subtle.digest("SHA-256", encoder.encode(value));
    return Array.from(new Uint8Array(buffer), b => b.toString(16).padStart(2, "0")).join("");
  }
  async function fingerprints(value) {
    assert(typeof value === "string", "fingerprint input must be text");
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
    if (!options.trusted || !options.complete || typeof observed !== "string")
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
    const terminal = currentBranch.status !== "pending";
    if (terminal) {
      assert(manualNewAttempt === true && ["failed", "unknown"].includes(currentBranch.status) &&
        status === "pending" && phase === "created" && !prior,
        "terminal state cannot be replaced without explicit new attempt");
    } else {
      assert(!manualNewAttempt, "manual retry requires terminal failed/unknown state");
      assert(!prior || prior.status === "pending", "terminal attempt immutable");
      if (prior) assert(PHASES.indexOf(phase) >= PHASES.indexOf(prior.phase),
        "attempt phase cannot move backwards");
    }
    if (status === "done") {
      assert(phase === "capturing" && ["exact", "canonical_equivalent"].includes(evidence.inputLevel),
        "input unverified");
      assert(typeof evidence.sessionId === "string" && evidence.sessionId.length >= 4,
        "missing session identity");
      assert(evidence.taskCount === 1 && evidence.captureComplete === true &&
        typeof evidence.reply === "string" && evidence.reply.length > 0,
        "response incomplete");
      assert(Array.isArray(evidence.endSignals) && new Set(evidence.endSignals).size >= 2,
        "insufficient completion signals");
      assert(evidence.persisted === true, "response not persisted");
      const other = exp.branches[branch === "A" ? "B" : "A"];
      assert(!other.attempts.some(a => a.evidence?.sessionId === evidence.sessionId),
        "same session assigned to both branches");
    }
    const now = Date.now(), next = structuredClone(exp), b = next.branches[branch];
    const found = b.attempts.find(a => a.id === attemptId);
    if (found) {
      Object.assign(found, {status, phase, updatedAt:now, evidence:structuredClone(evidence)});
    } else {
      b.attempts.push({id:attemptId, status, phase, createdAt:now,
        updatedAt:now, evidence:structuredClone(evidence)});
    }
    b.status = status;
    b.phase = phase;
    b.revision++;
    b.history.push({operationId, attemptId, status, phase, reason, at:now, signature});
    next.revision++;
    return next;
  }
  return {MAX_BYTES, RULE, STATES, PHASES, CHECKS, canonical, compare, byteLength,
    hash, fingerprints, formatText, freeze, verifyFrozen, classify, newExperiment, advance};
})();
if (typeof globalThis !== "undefined") globalThis.ThreadLineFFCore = ThreadLineFFCore;
if (typeof module !== "undefined") module.exports = ThreadLineFFCore;
