import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function extractFunctionDeclaration(name) {
  const asyncMarker = `async function ${name}(`;
  const marker = `function ${name}(`;
  const start = source.indexOf(asyncMarker) >= 0 ? source.indexOf(asyncMarker) : source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist in src/main.js`);
  const paramsStart = source.indexOf("(", start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < source.length; index += 1) {
    if (source[index] === "(") paramsDepth += 1;
    if (source[index] === ")") paramsDepth -= 1;
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  const bodyStart = source.indexOf("{", paramsEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function loadPureHelpers(names) {
  const declarations = names.map(extractFunctionDeclaration).join("\n");
  return vm.runInNewContext(`${declarations}\n({ ${names.join(", ")} })`);
}

test("auth epoch helper rejects a late result and an account switch", () => {
  const { sessionUserId, isAuthOperationCurrent, sessionCredentialsMatch } = loadPureHelpers([
    "sessionUserId",
    "isAuthOperationCurrent",
    "sessionCredentialsMatch",
  ]);
  const sessionA1 = { user: { id: "account-a" }, access_token: "access-a1", refresh_token: "refresh-a1" };
  const sessionA2 = { user: { id: "account-a" }, access_token: "access-a2", refresh_token: "refresh-a2" };
  const sessionB = { user: { id: "account-b" }, access_token: "access-b", refresh_token: "refresh-b" };

  assert.equal(sessionUserId(sessionA1), "account-a");
  assert.equal(isAuthOperationCurrent(7, 7, "account-a", sessionA1), true);
  assert.equal(isAuthOperationCurrent(7, 8, "account-a", sessionA1), false);
  assert.equal(isAuthOperationCurrent(7, 7, "account-a", sessionB), false);
  assert.equal(sessionCredentialsMatch(sessionA1, sessionA1), true);
  assert.equal(sessionCredentialsMatch(sessionA1, sessionA2), false, "rotated tokens are a different native import");
});

test("native session revision remains monotonic across reload and clock movement", () => {
  const { nextMonotonicRevision } = loadPureHelpers(["nextMonotonicRevision"]);

  assert.equal(nextMonotonicRevision(10, 20, 15), 21, "persisted revision wins after a WebView reload");
  assert.equal(nextMonotonicRevision(30, 20, 15), 31, "in-memory revision wins when the clock moves backwards");
  assert.equal(nextMonotonicRevision(10, 20, 1000), 1000, "wall clock provides a fresh first revision");
  assert.equal(nextMonotonicRevision(Number.NaN, -1, 0), 1);
});

test("serialized native sync drops an older rotated session before posting", async () => {
  const declarations = [
    "sessionUserId",
    "isAuthOperationCurrent",
    "sessionCredentialsMatch",
    "syncNativeSession",
  ].map(extractFunctionDeclaration).join("\n");
  const sandbox = { messages: [] };
  vm.runInNewContext(`${declarations}
    let nativeSessionSyncTail = Promise.resolve();
    let authEventEpoch = 1;
    let state = { session: null };
    let revision = 100;
    function allocateNativeSessionRevision() { revision += 1; return revision; }
    function postNativeMessage(payload) { messages.push(payload); }
    globalThis.authHarness = {
      queue: syncNativeSession,
      setCurrent(session, epoch) { state.session = session; authEventEpoch = epoch; },
    };
  `, sandbox);
  const sessionA = { user: { id: "account-a" }, access_token: "old-access", refresh_token: "old-refresh", expires_at: 1 };
  const sessionB = { user: { id: "account-a" }, access_token: "new-access", refresh_token: "new-refresh", expires_at: 2 };

  sandbox.authHarness.setCurrent(sessionA, 1);
  const oldSync = sandbox.authHarness.queue(sessionA, 1);
  sandbox.authHarness.setCurrent(sessionB, 2);
  const newSync = sandbox.authHarness.queue(sessionB, 2);

  assert.equal(await oldSync, false);
  assert.equal(await newSync, true);
  assert.equal(sandbox.messages.length, 1);
  assert.equal(sandbox.messages[0].accessToken, "new-access");
  assert.equal(sandbox.messages[0].sessionRevision, 101);
});

test("a native session request survives readiness and flushes only once", async () => {
  const declarations = [
    "flushNativeSessionSyncRequest",
    "requestNativeSessionSync",
  ].map(extractFunctionDeclaration).join("\n");
  const sandbox = {};
  vm.runInNewContext(`${declarations}
    let nativeSessionSyncRequested = false;
    let state = { db: null };
    let window = { QuickFlexNative: null };
    let syncCalls = 0;
    function syncCurrentSessionToNative() { syncCalls += 1; nativeSessionSyncRequested = false; return Promise.resolve(true); }
    globalThis.nativeRequestHarness = {
      request: requestNativeSessionSync,
      flush: flushNativeSessionSyncRequest,
      ready() { state.db = {}; window.QuickFlexNative = { postMessage() {} }; },
      requested() { return nativeSessionSyncRequested; },
      syncCalls() { return syncCalls; },
    };
  `, sandbox);

  assert.equal(await sandbox.nativeRequestHarness.request(), false);
  assert.equal(sandbox.nativeRequestHarness.requested(), true, "request remains pending before the PWA is ready");
  sandbox.nativeRequestHarness.ready();
  assert.equal(await sandbox.nativeRequestHarness.flush(), true);
  assert.equal(sandbox.nativeRequestHarness.syncCalls(), 1);
  assert.equal(await sandbox.nativeRequestHarness.flush(), false, "the flushed request is not duplicated");
});

test("best-effort native session requests absorb a bridge refresh failure", async () => {
  const declarations = [
    "flushNativeSessionSyncRequest",
    "requestNativeSessionSync",
  ].map(extractFunctionDeclaration).join("\n");
  const sandbox = {};
  vm.runInNewContext(`${declarations}
    let nativeSessionSyncRequested = false;
    let state = { db: {} };
    let window = { QuickFlexNative: { postMessage() {} } };
    function syncCurrentSessionToNative() { return Promise.reject(new Error("network")); }
    globalThis.nativeFailureHarness = {
      request: requestNativeSessionSync,
      requested() { return nativeSessionSyncRequested; },
    };
  `, sandbox);

  assert.equal(await sandbox.nativeFailureHarness.request(), false);
  assert.equal(sandbox.nativeFailureHarness.requested(), true, "a later return can retry the request");
});

function createCurrentSessionHarness(initialSession) {
  const declarations = [
    "sessionUserId",
    "isAuthOperationCurrent",
    "sessionCredentialsMatch",
    "syncNativeSession",
    "syncCurrentSessionToNative",
  ].map(extractFunctionDeclaration).join("\n");
  const sandbox = { initialSession, messages: [] };
  vm.runInNewContext(`${declarations}
    let nativeSessionSyncPromise = null;
    let nativeSessionSyncTail = Promise.resolve();
    let nativeSessionSyncRequested = true;
    let authEventEpoch = 10;
    let nativeSessionRevision = 100;
    let getCalls = 0;
    let refreshCalls = 0;
    let resolveGet;
    let resolveRefresh;
    const getPromise = new Promise((resolve) => { resolveGet = resolve; });
    const refreshPromise = new Promise((resolve) => { resolveRefresh = resolve; });
    let state = {
      session: initialSession,
      db: { auth: {
        getSession() { getCalls += 1; return getPromise; },
        refreshSession() { refreshCalls += 1; return refreshPromise; },
      } },
    };
    let window = { QuickFlexNative: { postMessage() {} } };
    function currentUserId() { return sessionUserId(state.session); }
    function allocateNativeSessionRevision() { nativeSessionRevision += 1; return nativeSessionRevision; }
    function postNativeMessage(payload) { messages.push(payload); }
    function applyAuthSession(session) {
      const previousUserId = currentUserId();
      state.session = session || null;
      authEventEpoch += 1;
      if (!session || previousUserId !== currentUserId()) nativeSessionSyncRequested = false;
      return { authEpoch: authEventEpoch };
    }
    globalThis.currentSessionHarness = {
      sync: syncCurrentSessionToNative,
      resolveGet(value) { resolveGet(value); },
      resolveRefresh(value) { resolveRefresh(value); },
      replaceSession(session) { state.session = session; authEventEpoch += 1; nativeSessionSyncRequested = false; },
      getCalls() { return getCalls; },
      refreshCalls() { return refreshCalls; },
      messages() { return messages; },
      requested() { return nativeSessionSyncRequested; },
    };
  `, sandbox);
  return sandbox.currentSessionHarness;
}

test("concurrent current-session requests share one getSession operation and return the same outcome", async () => {
  const session = { user: { id: "account-a" }, access_token: "access-a", refresh_token: "refresh-a", expires_at: 4_000_000_000 };
  const harness = createCurrentSessionHarness(session);
  const first = harness.sync();
  const second = harness.sync();
  assert.equal(harness.getCalls(), 1);
  harness.resolveGet({ data: { session }, error: null });
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.equal(harness.messages().length, 1);
  assert.equal(harness.requested(), false);
});

test("late getSession and refresh results cannot post after logout or an account replacement", async () => {
  const sessionA = { user: { id: "account-a" }, access_token: "access-a", refresh_token: "refresh-a", expires_at: 4_000_000_000 };
  const sessionB = { user: { id: "account-b" }, access_token: "access-b", refresh_token: "refresh-b", expires_at: 4_000_000_000 };
  const afterLogout = createCurrentSessionHarness(sessionA);
  const logoutRequest = afterLogout.sync();
  afterLogout.replaceSession(null);
  afterLogout.resolveGet({ data: { session: sessionA }, error: null });
  assert.equal(await logoutRequest, false);
  assert.equal(afterLogout.messages().length, 0);

  const expiring = { ...sessionA, expires_at: 1 };
  const afterReplacement = createCurrentSessionHarness(expiring);
  const refreshRequest = afterReplacement.sync();
  afterReplacement.resolveGet({ data: { session: expiring }, error: null });
  await Promise.resolve();
  assert.equal(afterReplacement.refreshCalls(), 1);
  afterReplacement.replaceSession(sessionB);
  afterReplacement.resolveRefresh({ data: { session: { ...expiring, access_token: "rotated-a" } }, error: null });
  assert.equal(await refreshRequest, false);
  assert.equal(afterReplacement.messages().length, 0);
});

test("sign-out or an account change discards an unflushed native session request", () => {
  const declarations = [
    "sessionUserId",
    "currentUserId",
    "captureAccountContext",
    "applyAuthSession",
  ].map(extractFunctionDeclaration).join("\n");
  const sandbox = {};
  vm.runInNewContext(`${declarations}
    let nativeSessionSyncRequested = true;
    let activeAccountId = "account-a";
    let accountEpoch = 0;
    let authEventEpoch = 0;
    let state = { session: { user: { id: "account-a" } } };
    function clearUserScopedState() {}
    function showView() {}
    function renderAll() {}
    function showPending() {}
    function showAuth() {}
    function scheduleSignedInBoot() {}
    globalThis.nativeAccountHarness = {
      signOut() { applyAuthSession(null, { event: "SIGNED_OUT", scheduleBoot: false }); },
      switchAccount() {
        nativeSessionSyncRequested = true;
        applyAuthSession({ user: { id: "account-b" } }, { event: "TOKEN_REFRESHED", scheduleBoot: false });
      },
      requested() { return nativeSessionSyncRequested; },
    };
  `, sandbox);

  sandbox.nativeAccountHarness.signOut();
  assert.equal(sandbox.nativeAccountHarness.requested(), false);
  sandbox.nativeAccountHarness.switchAccount();
  assert.equal(sandbox.nativeAccountHarness.requested(), false);
});

test("account boundary clears user data and drafts before adopting the next session", () => {
  const clearSource = extractFunctionDeclaration("clearUserScopedState");
  for (const requiredReset of [
    "state.profile = null",
    "state.rates = []",
    "state.entries = {}",
    "state.inspections = {}",
    "state.pendingDates.clear()",
    "state.pendingRates = false",
    "state.recordDraft = null",
    "state.inspectionDraft = inspectionDraftFromRecord(null)",
    "ocrDraftMap = null",
  ]) {
    assert.match(clearSource, new RegExp(requiredReset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const transitionSource = extractFunctionDeclaration("applyAuthSession");
  assert.match(transitionSource, /accountChanged \|\| signedOut/);
  assert.ok(
    transitionSource.indexOf("clearUserScopedState()") < transitionSource.indexOf("state.session = nextSession"),
    "old account state must be cleared before the new session becomes current",
  );
});

test("all native token imports carry the exact monotonic revision field", () => {
  const syncSource = extractFunctionDeclaration("syncNativeSession");
  const openSource = extractFunctionDeclaration("openPaceMeasurementApp");
  assert.match(syncSource, /type: "sync_session"[\s\S]*sessionRevision: allocateNativeSessionRevision\(\)/);
  assert.match(openSource, /type: "open_measurement"[\s\S]*sessionRevision: allocateNativeSessionRevision\(\)/);
  assert.match(syncSource, /isAuthOperationCurrent\(/);
  assert.match(syncSource, /sessionCredentialsMatch\(/);
});

test("late profile, data and current-session operations are epoch guarded", () => {
  const bootSource = extractFunctionDeclaration("bootSignedInUser");
  const profileSource = extractFunctionDeclaration("loadProfile");
  const loadSource = extractFunctionDeclaration("loadFromDb");
  const syncSource = extractFunctionDeclaration("syncCurrentSessionToNative");

  assert.match(bootSource, /isAccountContextCurrent\(context\)/);
  assert.match(profileSource, /if \(!isAccountContextCurrent\(context\)\) return false/);
  assert.match(loadSource, /if \(!isAccountContextCurrent\(context\)\) return false/);
  assert.ok((syncSource.match(/isAuthOperationCurrent\(/g) || []).length >= 2);
});

test("late user writes cannot repopulate a replacement account UI", () => {
  for (const name of [
    "saveProfile",
    "saveInspectionSignature",
    "saveGoalAmount",
    "saveInspection",
    "setInspectionNoOperation",
  ]) {
    const functionSource = extractFunctionDeclaration(name);
    assert.match(functionSource, /const context = captureAccountContext\(\)/, `${name} captures its account`);
    assert.ok(
      (functionSource.match(/isAccountContextCurrent\(context\)/g) || []).length >= 2,
      `${name} checks its account before and after async work`,
    );
    assert.match(functionSource, /context\.userId/, `${name} binds writes to the captured account`);
  }
});

test("external SIGNED_OUT clears PWA state without explicit native sign out", () => {
  const bindSource = extractFunctionDeclaration("bindNativeAuthSync");
  assert.match(bindSource, /applyAuthSession\(session, \{ event \}\)/);
  assert.doesNotMatch(bindSource, /postNativeMessage\(\{\s*type: "sign_out"/);
});
