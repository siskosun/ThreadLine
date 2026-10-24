/* ThreadLine evidence store (S0a prototype, plan §十一.6).
 * One IndexedDB database, threadline_evidence_v1. All writes commit inside a
 * single readwrite transaction across every touched store; the project's
 * evidenceRevision is re-read INSIDE that transaction and the change aborts
 * on a stale value (CAS). Hashing/validation happen in evidence-core before
 * the transaction opens; nothing inside the transaction waits on network or
 * other async work. The service worker is the only writer (background.js).
 */
(() => {
  "use strict";
  const DB_NAME = "threadline_evidence_v1";
  const DB_VERSION = 1;
  const STORES = Object.freeze(
    ["conclusions", "versions", "sources", "links", "projects", "operations"]);

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (db.objectStoreNames.contains(name)) continue;
          if (name === "projects") db.createObjectStore(name, { keyPath: "projectId" });
          else if (name === "operations") db.createObjectStore(name, { keyPath: "operationId" });
          else db.createObjectStore(name, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("evidence DB open failed"));
    });
  }

  function getAll(tx, store) {
    return new Promise((resolve, reject) => {
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function snapshot(db) {
    const tx = db.transaction(STORES, "readonly");
    const [conclusions, versions, sources, links, projects, operations] =
      await Promise.all(STORES.map(s => getAll(tx, s)));
    const toMap = (rows, key) => Object.fromEntries(rows.map(r => [r[key], r]));
    return {
      conclusions: toMap(conclusions, "id"),
      versions: toMap(versions, "id"),
      sources: toMap(sources, "id"),
      links: toMap(links, "id"),
      projects: Object.fromEntries(projects.map(p => [p.projectId, p])),
      operations: toMap(operations, "id")
    };
  }

  /* Apply a plan from evidence-core inside ONE readwrite transaction.
   * plan.writes: {conclusion?, version?, sources[], links[], project,
   *               ledger, bulkConclusions?, bulkVersions?, bulkSources?, bulkLinks?}
   * CAS: the project row re-read inside the tx must equal
   * writes.project.evidenceRevision - 1 or the whole change aborts. */
  function applyPlan(db, plan) {
    if (plan.replay) return Promise.resolve(plan.replay);
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = value => { if (!settled) { settled = true; resolve(value); } };
      const fail = error => { if (!settled) { settled = true; reject(error); } };
      let tx;
      try { tx = db.transaction(STORES, "readwrite"); }
      catch (e) { return fail(e); }
      tx.oncomplete = () => done(plan.result);
      tx.onabort = () => fail(tx.error || new Error("证据事务中止：无部分写入"));
      tx.onerror = () => fail(tx.error || new Error("证据事务失败"));
      const stores = {};
      for (const name of STORES) stores[name] = tx.objectStore(name);
      const projectReq = stores.projects.get(plan.writes.project.projectId);
      projectReq.onsuccess = () => {
        const current = projectReq.result;
        const expected = plan.writes.project.evidenceRevision - 1;
        if (!current || current.evidenceRevision !== expected) {
          try { tx.abort(); } catch { /* already aborting */ }
          return fail(new Error("证据版本冲突（CAS）：请刷新后重试，本地修订 " +
            (current ? current.evidenceRevision : "无") + " ≠ 期望 " + expected));
        }
        const w = plan.writes;
        try {
          if (w.conclusion) stores.conclusions.put(w.conclusion);
          if (w.version) stores.versions.put(w.version);
          for (const s of w.sources || []) stores.sources.put(s);
          for (const l of w.links || []) stores.links.put(l);
          for (const c of w.bulkConclusions || []) stores.conclusions.put(c);
          for (const v of w.bulkVersions || []) stores.versions.put(v);
          for (const s of w.bulkSources || []) stores.sources.put(s);
          for (const l of w.bulkLinks || []) stores.links.put(l);
          stores.projects.put(w.project);
          stores.operations.put(w.ledger);
        } catch (e) {
          try { tx.abort(); } catch { }
          return fail(e);
        }
      };
      projectReq.onerror = () => fail(projectReq.error || new Error("projects 读取失败"));
    });
  }

  async function ensureProject(db, projectId, Core) {
    const tx = db.transaction(["projects"], "readwrite");
    return new Promise((resolve, reject) => {
      const req = tx.objectStore("projects").get(projectId);
      req.onsuccess = () => {
        if (req.result) return resolve(req.result);
        const record = Core.newProjectRecord(projectId);
        tx.objectStore("projects").put(record);
        tx.oncomplete = () => resolve(record);
      };
      req.onerror = () => reject(req.error);
    });
  }

  const DB = { DB_NAME, DB_VERSION, STORES, open, snapshot, applyPlan, ensureProject };
  if (typeof module !== "undefined" && module.exports) module.exports = DB;
  else globalThis.ThreadLineEvidenceDB = DB;
})();
