import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { purgeLegacyNoahStorage } from "../src/lib/noah-legacy-storage.js";

function memoryStorage(entries) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => map.delete(key),
    keys: () => [...map.keys()],
  };
}

test("startup cleanup deletes the removed Noah device history and keeps other keys", () => {
  const storage = memoryStorage({ "quickflex-noah:user-a": "[]", "quickflex-noah:user-b": "[]", "quickflex-db-url": "x", "quickflex-theme": "dark" });
  const deleted = [];
  const request = {};
  purgeLegacyNoahStorage({ localStorage: storage, indexedDB: { deleteDatabase: (name) => { deleted.push(name); return request; } } });
  assert.deepEqual(storage.keys().sort(), ["quickflex-db-url", "quickflex-theme"]);
  assert.deepEqual(deleted, ["quickflex-noah-local"]);
  assert.equal(typeof request.onerror, "function");
});

test("startup cleanup never throws when storage is unavailable", () => {
  const throwing = { get localStorage() { throw new Error("denied"); }, get indexedDB() { throw new Error("denied"); } };
  assert.doesNotThrow(() => purgeLegacyNoahStorage(throwing));
  assert.doesNotThrow(() => purgeLegacyNoahStorage({}));
  assert.doesNotThrow(() => purgeLegacyNoahStorage({ localStorage: memoryStorage({}), indexedDB: { deleteDatabase() { throw new Error("blocked"); } } }));
});

test("the app runs the cleanup at startup and no longer ships device history or answer feedback", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../src/ui/noah.js", import.meta.url), "utf8");
  const service = readFileSync(new URL("../src/services/noah.js", import.meta.url), "utf8");
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  assert.match(main, /async function init\(\) \{\n  purgeLegacyNoahStorage\(\);/);
  assert.doesNotMatch(ui + service + sw, /noah-history|saveNoahHistory|loadNoahHistory|submit_feedback|noah-feedback|noah-brief-/);
  assert.match(sw, /"\.\/src\/lib\/noah-legacy-storage\.js"/);
});
