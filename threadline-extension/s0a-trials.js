/* S0a human adoption trial summary. Deliberately never self-approves a manual gate.
 * Do not mix browser-driven write latency with human task timing. */
(() => {
  "use strict";
  const VERSION = "threadline-s0a-human-trials/1";
  const TYPES = Object.freeze(["direct","direct","direct","direct","direct","direct",
    "correct","correct","correct","missing_source","missing_source","missing_source"]);
  const validOperator = value => typeof value === "string" && /^[A-Za-z0-9_-]{2,16}$/.test(value);
  function quantile(values, q) {
    if (!values.length) return null;
    const sorted = [...values].sort((a,b) => a-b);
    if (q === 0.5 && sorted.length % 2 === 0)
      return (sorted[sorted.length/2-1]+sorted[sorted.length/2])/2;
    return sorted[Math.max(0,Math.ceil(sorted.length*q)-1)];
  }
  function summarize(trials) {
    const rows = Array.isArray(trials) ? trials : [];
    const seen = new Set();
    const eligible = [];
    const kinds = {direct:0,correct:0,missing_source:0};
    let caseIntegrity = true;
    for (const row of rows) {
      if (!row || !Number.isInteger(row.caseNumber) || row.caseNumber < 1 ||
          row.caseNumber > TYPES.length || seen.has(row.caseNumber) ||
          row.caseType !== TYPES[row.caseNumber-1]) {
        caseIntegrity = false;
        continue;
      }
      seen.add(row.caseNumber);
      kinds[row.caseType]++;
      if (row.outcome === "committed" && row.taskConfirmed === true &&
          validOperator(row.operatorCode) && Number.isFinite(row.elapsedMs) &&
          row.elapsedMs >= 0 && row.elapsedMs <= 24*60*60*1000 &&
          (row.assisted === true || row.assisted === false) &&
          (row.nonDesigner === true || row.nonDesigner === false)) eligible.push(row);
    }
    if (rows.length !== seen.size) caseIntegrity = false;
    const times = eligible.map(row=>row.elapsedMs);
    const unassisted = eligible.filter(row=>!row.assisted).length;
    const nonDesigner = eligible.filter(row=>row.nonDesigner).length;
    const complete = rows.length === 12 && seen.size === 12 && caseIntegrity &&
      kinds.direct === 6 && kinds.correct === 3 && kinds.missing_source === 3;
    const medianMs = quantile(times,0.5), p90Ms=quantile(times,0.9);
    const thresholdsMet = complete && eligible.length === 12 && unassisted >= 11 &&
      nonDesigner >= 4 && medianMs <= 30000 && p90Ms <= 60000;
    return {
      protocol:VERSION, recordedCases:rows.length, caseIntegrity, complete,
      taskKinds:kinds, eligibleCommitted:eligible.length, unassisted,
      nonDesignerOperations:nonDesigner, medianMs, p90Ms, thresholdsMet,
      // The actual operator, task correctness, and no-help declaration require independent verification.
      gate:complete ? "HUMAN_REVIEW_REQUIRED" : "INCOMPLETE",
      note:"自报操作与合成材料记录；不能自动认定真实用户任务成功或 S0A done。"
    };
  }
  const api=Object.freeze({VERSION,TYPES,validOperator,summarize});
  if (typeof module !== "undefined" && module.exports) module.exports=api;
  if (typeof globalThis !== "undefined") globalThis.ThreadLineS0ATrials=api;
})();