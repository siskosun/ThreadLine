/* Separate Fork Beta database. Only background.js is allowed to invoke writes. */
const ThreadLineFFDB = (() => {
  "use strict";
  const NAME = "threadline_ff_v1";
  const VERSION = 1, STORE = "experiments";

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      let abandoned = false;
      req.onupgradeneeded = () => {
        // A blocked request may become writable after the caller already
        // received a failure. Do not commit an abandoned schema upgrade.
        if (abandoned) { try {req.transaction?.abort();} catch {} return; }
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE))
          db.createObjectStore(STORE, {keyPath:"id"});
      };
      req.onsuccess = () => {
        const db = req.result;
        // onblocked rejects our Promise, but the browser may still emit
        // onsuccess later. Close that otherwise orphaned connection.
        if (abandoned) { db.close(); return; }
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error("Fork database unavailable"));
      req.onblocked = () => {
        abandoned = true;
        reject(new Error("Fork database upgrade blocked by another page"));
      };
    });
  }
  async function transaction(mode, action) {
    const db = await open();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        let value, aborted = false;
        tx.oncomplete = () => resolve(value);
        tx.onerror = () => reject(tx.error || new Error("Fork database write failed"));
        tx.onabort = () => reject(tx.error || new Error("Fork database transaction aborted"));
        const fail = error => {
          if (aborted) return;
          aborted = true;
          try {tx.abort();} catch {}
          reject(error);
        };
        try {
          action(tx.objectStore(STORE), result => {value = result;}, fail);
        } catch (error) {fail(error);}
      });
    } finally {
      db.close();
    }
  }
  function read(id) {
    return transaction("readonly", (store, result) => {
      const req = store.get(id);
      req.onsuccess = () => result(req.result || null);
    });
  }
  function list() {
    return transaction("readonly", (store, result) => {
      const req = store.getAll();
      req.onsuccess = () => result(req.result || []);
    });
  }
  function create(record) {
    if (!record || typeof record.id !== "string" || record.revision !== 0)
      return Promise.reject(new Error("invalid initial experiment"));
    return transaction("readwrite", (store, result) => {
      store.add(record); // Duplicate IDs abort the entire transaction.
      result(record);
    });
  }
  function createImported(record) {
    if (!record || typeof record.id !== "string" ||
      !Number.isSafeInteger(record.revision) || record.revision < 0)
      return Promise.reject(new Error("invalid imported experiment"));
    return transaction("readwrite", (store, result) => {
      store.add(record);
      result(record);
    });
  }
  function update(id, expectedRevision, reducer) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 ||
      typeof reducer !== "function")
      return Promise.reject(new Error("invalid expected revision"));
    return transaction("readwrite", (store, result, fail) => {
      const req = store.get(id);
      req.onsuccess = () => {
        try {
          const previous = req.result;
          if (!previous) throw new Error("experiment not found");
          // Reducers receive the persisted object for compatibility, but may not
          // mutate it: every validation below must use this pre-reducer baseline.
          const serializedPrevious = JSON.stringify(previous);
          const baseline = JSON.parse(serializedPrevious);
          const next = reducer(previous);
          if (JSON.stringify(previous) !== serializedPrevious)
            throw new Error("reducer must not mutate previous");
          if (next === previous) {result(previous); return;} // Idempotent replay.
          if (baseline.revision !== expectedRevision) throw new Error("stale revision");
          if (!next || next.id !== baseline.id || next.revision !== baseline.revision + 1)
            throw new Error("invalid revision");
          if (JSON.stringify(next.frozen) !== JSON.stringify(baseline.frozen))
            throw new Error("frozen input is immutable");
          // Create provenance is part of the experiment identity. A reducer must
          // not rewrite who created the record or when, even if revision advances.
          if (next.createOperationId !== baseline.createOperationId ||
            next.createdAt !== baseline.createdAt)
            throw new Error("create identity is immutable");
          store.put(next);
          result(next);
        } catch (error) {fail(error);}
      };
    });
  }
  return {NAME, VERSION, read, list, create, createImported, update};
})();
if (typeof globalThis !== "undefined") globalThis.ThreadLineFFDB = ThreadLineFFDB;
if (typeof module !== "undefined") module.exports = ThreadLineFFDB;
