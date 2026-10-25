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
  const STORES = Object.freeze([
    "conclusions",
    "versions",
    "sources",
    "links",
    "projects",
    "operations",
  ]);

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (db.objectStoreNames.contains(name)) continue;
          if (name === "projects")
            db.createObjectStore(name, { keyPath: "projectId" });
          else if (name === "operations")
            db.createObjectStore(name, { keyPath: "operationId" });
          else db.createObjectStore(name, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error || new Error("evidence DB open failed"));
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
      await Promise.all(STORES.map((s) => getAll(tx, s)));
    const toMap = (rows, key) =>
      Object.fromEntries(rows.map((r) => [r[key], r]));
    return {
      conclusions: toMap(conclusions, "id"),
      versions: toMap(versions, "id"),
      sources: toMap(sources, "id"),
      links: toMap(links, "id"),
      projects: Object.fromEntries(projects.map((p) => [p.projectId, p])),
      operations: toMap(operations, "operationId"),
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
      const done = (value) => {
        if (!settled) {
          settled = true;
          resolve(value);
        }
      };
      const fail = (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      };
      let tx;
      try {
        tx = db.transaction(STORES, "readwrite");
      } catch (e) {
        return fail(e);
      }
      // Do not resolve a durable replay until the read-only transaction has
      // actually completed: a request callback is not a commit boundary.
      let completedResult = plan.result;
      tx.oncomplete = () => done(completedResult);
      tx.onabort = () =>
        fail(tx.error || new Error("证据事务中止：无部分写入"));
      tx.onerror = () => fail(tx.error || new Error("证据事务失败"));
      const stores = {};
      for (const name of STORES) stores[name] = tx.objectStore(name);
      const w = plan.writes;
      // The ledger is authoritative for retries, even if the project revision
      // has moved since the original request.  Check it first in this same tx.
      const ledgerReq = stores.operations.get(w.ledger.operationId);
      ledgerReq.onsuccess = () => {
        const prior = ledgerReq.result;
        if (prior) {
          if(prior.redacted){tx.abort();return fail(new Error("旧操作所属数据已删除或替换，不能重放"));}
          if (
            prior.schema !== 2 ||
            prior.kind !== w.ledger.kind ||
            prior.requestHash !== w.ledger.requestHash
          ) {
            try {
              tx.abort();
            } catch {}
            return fail(new Error("操作 ID 已用于不同请求，已拒绝"));
          }
          completedResult = prior.result;
          return;
        }
        const projectReq = stores.projects.get(w.project.projectId);
        projectReq.onsuccess = () => {
          const current = projectReq.result;
          const expected =
            plan.expectedRevision === undefined
              ? w.project.evidenceRevision - 1
              : plan.expectedRevision;
          if ((expected === null && current) || (expected !== null &&
              (!current || current.evidenceRevision !== expected))) {
            try {
              tx.abort();
            } catch {
              /* already aborting */
            }
            return fail(
              new Error(
                "证据版本冲突（CAS）：请刷新后重试，本地修订 " +
                  (current ? current.evidenceRevision : "无") +
                  " ≠ 期望 " +
                  expected,
              ),
            );
          }
          const add = (store, value) => {
            stores[store].add(value);
          };
          try {
            for (const [store, ids] of Object.entries(w.deleteIds || {})) {
              if (!STORES.includes(store) || store === "projects" || store === "operations")
                throw new Error("无效的证据删除范围");
              if (!Array.isArray(ids)) throw new Error("无效的证据删除 ID");
              for (const id of ids) stores[store].delete(id);
            }
            if (w.conclusion) {
              if (w.ledger.kind === "adopt") add("conclusions",w.conclusion);
              else stores.conclusions.put(w.conclusion);
            }
            if (w.version) add("versions", w.version);
            for (const s of w.sources || []) add("sources", s);
            for (const l of w.links || []) add("links", l);
            for (const c of w.bulkConclusions || []) add("conclusions", c);
            for (const v of w.bulkVersions || []) add("versions", v);
            for (const s of w.bulkSources || []) add("sources", s);
            for (const l of w.bulkLinks || []) add("links", l);
            stores.projects.put(w.project);
            for(const ledger of w.redactedOperations||[])stores.operations.put(ledger);
            add("operations", {...w.ledger,projectId:w.project.projectId});
          } catch (e) {
            try {
              tx.abort();
            } catch {}
            return fail(e);
          }
        };
        projectReq.onerror = () =>
          fail(projectReq.error || new Error("projects 读取失败"));
      };
      ledgerReq.onerror = () =>
        fail(ledgerReq.error || new Error("operations 读取失败"));
    });
  }

  /* Projection bookkeeping: after a projection has been written from the
   * committed store, bump projectionRevision and clear the todo in the SAME
   * transaction, CAS-guarded on evidenceRevision (a newer commit must keep
   * the todo set for the next pass). */
  function clearProjectionTodo(db, projectId, expectedRevision) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (v) => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      const fail = (e) => {
        if (!settled) {
          settled = true;
          reject(e);
        }
      };
      let tx;
      try {
        tx = db.transaction(["projects"], "readwrite");
      } catch (e) {
        return fail(e);
      }
      tx.oncomplete = () => done({ cleared: true });
      tx.onabort = () => fail(tx.error || new Error("投影事务中止"));
      tx.onerror = () => fail(tx.error || new Error("投影事务失败"));
      const req = tx.objectStore("projects").get(projectId);
      req.onsuccess = () => {
        const current = req.result;
        if (!current || current.evidenceRevision !== expectedRevision) {
          try {
            tx.abort();
          } catch {}
          return done({ cleared: false, stale: true });
        }
        tx.objectStore("projects").put({
          ...current,
          projectionRevision: expectedRevision,
          projectionTodo: false,
        });
      };
      req.onerror = () => fail(req.error);
    });
  }

  /* A tombstone is durable evidence that cleanup was requested.  It must not
   * be cleared by a stale worker after a restore/re-delete changed revision. */
  function markCleanupDone(db, projectId, expectedRevision) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (v) => { if (!settled) { settled = true; resolve(v); } };
      const fail = (e) => { if (!settled) { settled = true; reject(e); } };
      let tx;
      try { tx = db.transaction(["projects"], "readwrite"); }
      catch (e) { return fail(e); }
      tx.oncomplete = () => done({ done: true });
      tx.onabort = () => fail(tx.error || new Error("删除清理标记事务中止"));
      tx.onerror = () => fail(tx.error || new Error("删除清理标记事务失败"));
      const store = tx.objectStore("projects"), req = store.get(projectId);
      req.onsuccess = () => {
        const current = req.result;
        if (!current || !current.deleted || current.evidenceRevision !== expectedRevision) {
          try { tx.abort(); } catch {}
          return done({ done: false, stale: true });
        }
        store.put({ ...current, cleanupPending: false });
      };
      req.onerror = () => fail(req.error || new Error("删除清理标记读取失败"));
    });
  }

  async function ensureProject(db, projectId, Core) {
    const tx = db.transaction(["projects"], "readwrite");
    return new Promise((resolve, reject) => {
      const req = tx.objectStore("projects").get(projectId);
      let created;
      tx.oncomplete = () => resolve(created || req.result);
      tx.onabort = () => reject(tx.error || new Error("证据课题初始化中止"));
      tx.onerror = () => reject(tx.error || new Error("证据课题初始化失败"));
      req.onsuccess = () => {
        if (req.result) {
          if (req.result.deleted) {
            reject(new Error("课题证据已删除：请使用明确恢复流程，不能自动复活"));
            tx.abort(); return;
          }
          created = req.result;
          return;
        }
        const record = Core.newProjectRecord(projectId);
        tx.objectStore("projects").put(record);
        created = record;
      };
      req.onerror = () => reject(req.error);
    });
  }

  function markRestoreDone(db, projectId, revision) {
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(["projects"],"readwrite"),q=tx.objectStore("projects").get(projectId);
      tx.oncomplete=()=>resolve(true);tx.onabort=()=>reject(tx.error||Error("恢复对账中止"));tx.onerror=()=>reject(tx.error);
      q.onsuccess=()=>{const p=q.result;if(!p||p.evidenceRevision!==revision){tx.abort();return;}
        const next={...p,restorePending:false};delete next.restoreTopic;tx.objectStore("projects").put(next);};
    });
  }

  const DB = {
    DB_NAME,
    DB_VERSION,
    STORES,
    open,
    snapshot,
    applyPlan,
    ensureProject,
    clearProjectionTodo,
    markCleanupDone,
    markRestoreDone,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = DB;
  else globalThis.ThreadLineEvidenceDB = DB;
})();
