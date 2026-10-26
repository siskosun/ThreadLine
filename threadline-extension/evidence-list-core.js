/* Read-only client-side filtering for the evidence list. No storage or network writes. */
const ThreadLineEvidenceList = (() => {
  "use strict";
  const PAGE_SIZE = 20;
  const normalize = value => String(value ?? "").normalize("NFKC").toLocaleLowerCase().trim();
  function select(rows, {query = "", status = "all", limit = PAGE_SIZE} = {}) {
    const all = Array.isArray(rows) ? rows : [];
    const needle = normalize(query);
    const matches = all.filter(row => {
      const withdrawn = row?.conclusion?.status === "withdrawn";
      if (status === "active" && withdrawn) return false;
      if (status === "withdrawn" && !withdrawn) return false;
      if (!needle) return true;
      return normalize([row?.current?.text, row?.current?.conditions, row?.conclusion?.id].join(" ")).includes(needle);
    });
    const cap = Number.isSafeInteger(limit) && limit > 0 ? limit : PAGE_SIZE;
    return {
      rows: matches.slice(0, cap),
      total: all.length,
      matched: matches.length,
      hasMore: matches.length > cap
    };
  }
  function preview(row, maxPoints = 90) {
    const text = String(row?.current?.text || row?.conclusion?.id || "无标题结论").replace(/\s+/g, " ").trim();
    const points = Array.from(text);
    return points.length > maxPoints ? points.slice(0, maxPoints).join("") + "…（展开查看全文）" : text;
  }
  const api = {PAGE_SIZE, select, preview};
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  return api;
})();
if (typeof globalThis !== "undefined") globalThis.ThreadLineEvidenceList = ThreadLineEvidenceList;
