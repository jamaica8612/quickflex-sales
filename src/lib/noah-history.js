import { validNoahLinks } from "./noah-links.js";

const DB_NAME = "quickflex-noah-local";
const STORE = "conversations";
const PREFIX = "quickflex-noah:";
const MAX_ITEMS = 20;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const generations = new Map();
const queues = new Map();
let dbPromise;
const STORAGE_TIMEOUT_MS = 1500;

function generation(userId) { return generations.get(userId) || 0; }
function queue(userId, work) {
  const previous = queues.get(userId) || Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  queues.set(userId, next);
  next.finally(() => { if (queues.get(userId) === next) queues.delete(userId); }).catch(() => {});
  return next;
}
function localKey(userId) { return PREFIX + encodeURIComponent(userId); }
function storage() { try { return globalThis.localStorage; } catch { return null; } }
function normalize(items) {
  const since = Date.now() - MAX_AGE;
  return (Array.isArray(items) ? items : []).filter((item) =>
    item && (item.role === "user" || item.role === "assistant") &&
    typeof item.body === "string" && item.body.trim() && item.body.length <= 12000 &&
    Number.isFinite(item.timestamp) && item.timestamp >= since && item.timestamp <= Date.now() + 60_000
  ).slice(-MAX_ITEMS).map((item) => ({
    role: item.role, body: item.body, timestamp: item.timestamp,
    links: item.role === "assistant" ? validNoahLinks(item.links) : [],
    sources: item.role === "assistant" && Array.isArray(item.sources) ? item.sources.filter((value) => typeof value === "string").slice(0, 20) : [],
    proposalMarker: item.role === "assistant" && item.proposalMarker === true,
  }));
}

async function database() {
  if (!globalThis.indexedDB) throw new Error("IndexedDB unavailable");
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    let settled = false;
    const timer = setTimeout(() => finish(new Error("IndexedDB timeout")), STORAGE_TIMEOUT_MS);
    function finish(error, db) {
      if (settled) { db?.close?.(); return; }
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(db);
    }
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => finish(null, request.result);
    request.onerror = () => finish(request.error || new Error("IndexedDB failed"));
    request.onblocked = () => finish(new Error("IndexedDB blocked"));
  }).catch((error) => { dbPromise = null; throw error; });
  return dbPromise;
}
function transactionResult(db, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    let settled = false;
    const timer = setTimeout(() => {
      try { tx.abort(); } catch { /* Transaction may already be closed. */ }
      finish(new Error("IndexedDB transaction timeout"));
    }, STORAGE_TIMEOUT_MS);
    function finish(error, value) {
      if (settled) return;
      settled = true; clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    }
    const request = operation(tx.objectStore(STORE));
    if (mode === "readonly") request.onsuccess = () => finish(null, request.result);
    request.onerror = () => finish(request.error || new Error("IndexedDB request failed"));
    tx.oncomplete = () => { if (mode !== "readonly") finish(); };
    tx.onerror = () => finish(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => finish(tx.error || new Error("IndexedDB transaction aborted"));
  });
}
async function idbGet(key) {
  const db = await database();
  return transactionResult(db, "readonly", (store) => store.get(key));
}
async function idbPut(key, value) {
  const db = await database();
  return transactionResult(db, "readwrite", (store) => store.put(value, key));
}
async function idbDelete(key) {
  const db = await database();
  return transactionResult(db, "readwrite", (store) => store.delete(key));
}
function localRead(key) { try { return JSON.parse(storage()?.getItem(key) || "null"); } catch { return null; } }
function localWrite(key, value) { try { storage()?.setItem(key, JSON.stringify(value)); } catch { /* Chat remains available. */ } }
function localDelete(key) { try { storage()?.removeItem(key); } catch { /* Chat remains available. */ } }

export async function loadNoahHistory(userId) {
  if (!userId) return [];
  return queue(userId, async () => {
    const key = localKey(userId);
    let raw;
    try { raw = await idbGet(key); } catch { raw = localRead(key); }
    if (raw == null) raw = localRead(key);
    const items = normalize(raw);
    if (JSON.stringify(items) !== JSON.stringify(raw) || localRead(key) != null) {
      try { await idbPut(key, items); localDelete(key); } catch { localWrite(key, items); }
    }
    return items;
  });
}

export async function saveNoahHistory(userId, items) {
  if (!userId) return;
  const expected = generation(userId);
  return queue(userId, async () => {
    if (generation(userId) !== expected) return;
    const key = localKey(userId);
    const clean = normalize(items);
    try { await idbPut(key, clean); localDelete(key); } catch { localWrite(key, clean); }
  });
}

export async function purgeNoahHistory(userId) {
  if (!userId) return;
  generations.set(userId, generation(userId) + 1);
  return queue(userId, async () => {
    const key = localKey(userId);
    localDelete(key);
    try { await idbDelete(key); } catch { /* localStorage is already cleared. */ }
  });
}
