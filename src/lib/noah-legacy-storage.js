// Noah chat history used to be cached on the device (PWA 1.0.95–1.0.96). The feature
// was removed; this one-time cleanup deletes any copy left in the browser. Keep it until
// installs older than 1.0.97 are no longer in use (see docs/NOAH.md).
const LEGACY_DB_NAME = "quickflex-noah-local";
const LEGACY_KEY_PREFIX = "quickflex-noah:";

export function purgeLegacyNoahStorage(scope = globalThis) {
  try {
    const storage = scope.localStorage;
    if (storage) {
      const keys = [];
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (typeof key === "string" && key.startsWith(LEGACY_KEY_PREFIX)) keys.push(key);
      }
      keys.forEach((key) => storage.removeItem(key));
    }
  } catch { /* Storage can be unavailable in private mode; the app works without it. */ }
  try {
    const request = scope.indexedDB?.deleteDatabase(LEGACY_DB_NAME);
    if (request) request.onerror = request.onblocked = () => {};
  } catch { /* A failed cleanup must never block the app. */ }
}
