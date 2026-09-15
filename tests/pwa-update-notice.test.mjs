import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const config = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const plainStart = main.indexOf("function " + name + "(");
  const asyncStart = main.indexOf("async function " + name + "(");
  const start = asyncStart >= 0 && (plainStart < 0 || asyncStart < plainStart) ? asyncStart : plainStart;
  assert.ok(start >= 0, `missing ${name}()`);
  const paramsStart = main.indexOf("(", start); let paramsDepth = 0; let paramsEnd = -1;
  for (let index = paramsStart; index < main.length; index += 1) {
    if (main[index] === "(") paramsDepth += 1;
    if (main[index] === ")") paramsDepth -= 1;
    if (paramsDepth === 0) { paramsEnd = index; break; }
  }
  const bodyStart = main.indexOf("{", paramsEnd); let depth = 0;
  for (let index = bodyStart; index < main.length; index += 1) {
    if (main[index] === "{") depth += 1;
    if (main[index] === "}") depth -= 1;
    if (depth === 0) return main.slice(start, index + 1);
  }
  assert.fail(`unterminated ${name}()`);
}

test("measurement-open notice has the new version and accessible actions", () => {
  assert.match(config, /id:\s*["']2026-09-15-measurement-open-v1["']/);
  assert.match(html, /id="updateNoticeOverlay"[^>]*aria-hidden="true"[^>]*inert/);
  assert.match(html, /id="updateNoticeDialog"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="updateNoticeTitle"/);
  assert.match(html, /id="openMeasurementNotice"/);
  assert.match(html, /id="acknowledgeUpdateNotice"/);
  assert.match(main, /function mayShowAppUpdateNotice\(context = captureAccountContext\(\)\)[\s\S]*?state\.profile\?\.status === "approved"/);
  assert.match(main, /openMeasurementNotice\?\.addEventListener\("click", openMeasurementFromNotice\)/);
  assert.match(main, /acknowledgeUpdateNotice\?\.addEventListener\("click", acknowledgeAppUpdateNotice\)/);
});

test("only the current approved account can receive the notice", () => {
  const helperStart = main.indexOf("function mayShowAppUpdateNotice(context = captureAccountContext()");
  assert.ok(helperStart >= 0, "missing mayShowAppUpdateNotice()");
  const source = main.slice(helperStart, main.indexOf("function showAppUpdateNotice", helperStart));
  assert.match(source, /state\.profile\?\.id\s*===\s*context\.userId/);
  assert.match(source, /state\.profile\?\.status\s*===\s*["']approved["']/);
  assert.match(source, /isAccountContextCurrent\(context\)/);
  assert.doesNotMatch(source, /isNativeAppRuntime/);
  const evaluate = (profile, current = true, userId = "u1") => {
    const context = vm.createContext({ state: { profile }, captureAccountContext: () => ({ userId }), isAccountContextCurrent: () => current });
    vm.runInContext(`${source}\nglobalThis.result = mayShowAppUpdateNotice({ userId: "${userId}" });`, context);
    return context.result;
  };
  assert.equal(evaluate({ id: "u1", status: "approved" }), true);
  for (const status of ["pending", "blocked", undefined]) assert.equal(evaluate({ id: "u1", status }), false);
  assert.equal(evaluate(null), false, "signed-out profile is rejected");
  assert.equal(evaluate({ id: "u1", status: "approved" }, false), false, "stale account context is rejected");
  assert.equal(evaluate({ id: "u2", status: "approved" }), false, "mismatched identity is rejected");
});

test("ordinary browsers and installed PWAs are not filtered by native runtime", () => {
  assert.doesNotMatch(extractFunction("showAppUpdateNotice"), /if \(!isNativeAppRuntime\(\)\) return false/);
  assert.doesNotMatch(extractFunction("maybeOfferRateUpdate"), /if \(!isNativeAppRuntime\(\)\) return false/);
});

test("acknowledgement is once per user/device and version changes re-offer", () => {
  const values = new Map();
  const context = vm.createContext({ APP_NOTICE_LOCAL_KEY_PREFIX: "quickflex-app-notice:", APP_UPDATE_NOTICE: { id: "2026-09-15-measurement-open-v1" }, localStorage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) } });
  vm.runInContext(`${extractFunction("appNoticeStorageKey")}\n${extractFunction("appNoticeSeenLocally")}\n${extractFunction("rememberAppNoticeLocally")}\nglobalThis.actual = { appNoticeSeenLocally, rememberAppNoticeLocally };`, context);
  const { appNoticeSeenLocally, rememberAppNoticeLocally } = context.actual;
  assert.equal(appNoticeSeenLocally("user-a"), false); assert.equal(rememberAppNoticeLocally("user-a"), true);
  assert.equal(appNoticeSeenLocally("user-a"), true); assert.equal(appNoticeSeenLocally("user-b"), false);
  assert.equal(appNoticeSeenLocally("user-a", "2026-09-16-measurement-open-v2"), false);
});

test("positive action acknowledges and navigates only to measurement", () => {
  const source = extractFunction("openMeasurementFromNotice");
  assert.match(source, /acknowledgeAppUpdateNotice\(\)/); assert.match(source, /showView\(["']measurement["']\)/); assert.doesNotMatch(source, /openPaceMeasurementApp/);
  const calls = []; const context = vm.createContext({ window: { requestAnimationFrame: () => {} }, acknowledgeAppUpdateNotice: () => { calls.push("ack"); return true; }, showView: (view) => calls.push(view), captureAccountContext: () => ({ userId: "u1" }), isAccountContextCurrent: () => true, state: { profile: { id: "u1", status: "approved" } }, el: { app: { dataset: { view: "measurement" } } }, mayShowAppUpdateNotice: () => true });
  vm.runInContext(`${source}\nglobalThis.result = openMeasurementFromNotice();`, context);
  assert.equal(context.result, true); assert.deepEqual(calls, ["ack", "measurement"]);

  const denied = vm.createContext({ window: { requestAnimationFrame: () => {} }, mayShowAppUpdateNotice: () => false, acknowledgeAppUpdateNotice: () => { calls.push("unexpected-ack"); return true; }, showView: (view) => calls.push(`unexpected-${view}`), el: { app: { dataset: { view: "home" } } } });
  vm.runInContext(`${source}\nglobalThis.result = openMeasurementFromNotice();`, denied);
  assert.equal(denied.result, false);
  assert.deepEqual(calls, ["ack", "measurement"], "denied notice must not acknowledge or navigate");

  const acknowledgeFailed = vm.createContext({ window: { requestAnimationFrame: () => {} }, mayShowAppUpdateNotice: () => true, acknowledgeAppUpdateNotice: () => false, showView: (view) => calls.push(`unexpected-${view}`), el: { app: { dataset: { view: "home" } } } });
  vm.runInContext(`${source}\nglobalThis.result = openMeasurementFromNotice();`, acknowledgeFailed);
  assert.equal(acknowledgeFailed.result, false);
  assert.deepEqual(calls, ["ack", "measurement"], "failed acknowledgement must not navigate");
});

test("storage, audit, and account swaps cannot block or cross-contaminate handling", async () => {
  const seen = extractFunction("appNoticeSeenLocally"); const remember = extractFunction("rememberAppNoticeLocally"); const persist = extractFunction("persistAppNoticeAudit");
  assert.match(seen, /catch \(_\) \{ return false; \}/); assert.match(remember, /catch \(_\) \{[\s\S]*return false;/); assert.match(persist, /isAccountContextCurrent\(context\)/);
  const calls = []; const context = vm.createContext({ APP_NOTICE_LOCAL_KEY_PREFIX: "quickflex-app-notice:", APP_UPDATE_NOTICE: { id: "v1" }, localStorage: { getItem() { throw new Error("storage unavailable"); }, setItem() { throw new Error("storage unavailable"); } }, isProductionSiteRuntime: () => true, state: { db: { from: () => { calls.push("db"); return {}; } } }, isAccountContextCurrent: () => false });
  vm.runInContext(`${seen}\n${remember}\nglobalThis.actual = { appNoticeSeenLocally, rememberAppNoticeLocally };`, context);
  assert.equal(context.actual.appNoticeSeenLocally("u1"), false); assert.equal(context.actual.rememberAppNoticeLocally("u1"), false);
  vm.runInContext(`(async () => { ${persist} globalThis.audit = persistAppNoticeAudit("v1", { userId: "old", epoch: 1 }); })();`, context);
  assert.equal(await context.audit, false); assert.deepEqual(calls, []);
});
