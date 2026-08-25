import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function extractFunctionDeclaration(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
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
