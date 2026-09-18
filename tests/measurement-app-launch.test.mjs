import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { detectMeasurementApp, isMeasurementAppInstalled, measurementAppIntentUrl, MEASUREMENT_APP_INSTALL_URL } from "../src/lib/measurement-app-launch.js";

test("only the exact Play package confirms the measurement app", () => {
  assert.equal(isMeasurementAppInstalled([{ platform: "play", id: "com.jamai.coupangflexaccessibilitytester" }]), true);
  assert.equal(isMeasurementAppInstalled([{ platform: "play", id: "other" }, { platform: "webapp", id: "com.jamai.coupangflexaccessibilitytester" }]), false);
});

test("empty, unsupported, failing and timed out detection stay unknown", async () => {
  assert.equal(await detectMeasurementApp({ navigator: {} }), "unknown");
  assert.equal(await detectMeasurementApp({ navigator: { getInstalledRelatedApps: async () => [] } }), "unknown");
  assert.equal(await detectMeasurementApp({ navigator: { getInstalledRelatedApps: async () => { throw Error("no relation"); } } }), "unknown");
  assert.equal(await detectMeasurementApp({ navigator: { getInstalledRelatedApps: () => new Promise(() => {}) }, timeoutMs: 5 }), "unknown");
});

test("intent URL encodes work date and shift and has an absolute install fallback without secrets", () => {
  assert.match(MEASUREMENT_APP_INSTALL_URL, /\/install\.html$/);
  const url = measurementAppIntentUrl({
    installUrl: "https://example.com/quickflex-sales/install.html",
    workDate: "2026-09-19",
    shift: "night & day",
  });
  assert.match(url, /^intent:\/\/measure\?date=2026-09-19&shift=night%20%26%20day#Intent;/);
  assert.match(url, /package=com\.jamai\.coupangflexaccessibilitytester/);
  assert.match(url, /S\.browser_fallback_url=https%3A%2F%2Fexample\.com%2Fquickflex-sales%2Finstall\.html/);
  assert.doesNotMatch(url, /accessToken|refreshToken|token/i);
});

test("a stale account after access lookup cannot launch the measurement app", async () => {
  const { context, opened } = openHarness({ mode: "installed", current: false });
  await context.launch();
  assert.deepEqual(opened, []);
});

function openHarness({ mode = "installed", current = true, access = "allowed", off = false, native = false } = {}) {
  const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const start = source.indexOf("async function openPaceMeasurementApp(");
  const next = source.indexOf("\nfunction openMeasurementGuide(", start);
  const snippet = source.slice(start, next);
  const opened = [];
  const messages = [];
  const session = { user: { id: "user-1" }, access_token: "access-secret", refresh_token: "refresh-secret" };
  const context = vm.createContext({
    el: { openPaceApp: { dataset: { launchMode: mode } }, measurementAppHint: { textContent: "" } },
    window: { QuickFlexNative: native ? { postMessage() {} } : undefined, location: { set href(value) { opened.push(value); } } },
    navigator: { userAgent: "Android", userActivation: { isActive: true } },
    state: { session, db: native ? { auth: { getSession: async () => ({ data: { session } }) } } : null },
    TABLES: { profiles: "profiles" }, authEventEpoch: 1,
    currentMeasurementWorkDate: () => "2026-09-19", getRecord: () => ({ off }), isNightShift: () => true,
    captureAccountContext: () => ({ userId: "user-1" }), isAccountContextCurrent: () => current,
    checkBetaMeasurementAccess: async () => access, sessionUserId: (value) => value?.user?.id,
    applyAuthSession() {}, allocateNativeSessionRevision: () => 7,
    postNativeMessage: (message) => messages.push(message),
    MEASUREMENT_APP_INSTALL_URL: "https://example.test/install.html",
    measurementAppIntentUrl: ({ workDate, shift }) => `intent://measure?date=${workDate}&shift=${shift}#Intent;package=test;end`,
    toast: (message) => opened.push(`toast:${message}`), encodeURIComponent,
  });
  vm.runInContext(`${snippet}; globalThis.launch = openPaceMeasurementApp;`, context);
  return { context, opened, messages };
}

test("primary download navigates directly to installation guidance", async () => {
  const { context, opened } = openHarness({ mode: "download" });
  await context.launch();
  assert.deepEqual(opened, ["https://example.test/install.html"]);
});

test("confirmed app and explicit Android retry produce an intent without auth data", async () => {
  const primary = openHarness({ mode: "installed" });
  await primary.context.launch();
  assert.deepEqual(primary.opened, ["intent://measure?date=2026-09-19&shift=night#Intent;package=test;end"]);
  assert.doesNotMatch(primary.opened.join(""), /access-secret|refresh-secret/);
  const retry = openHarness({ mode: "download" });
  await retry.context.launch({ forceOpen: true });
  assert.match(retry.opened[0], /^intent:/);
});

test("off dates and denied accounts cannot open or download the app", async () => {
  const off = openHarness({ mode: "download", off: true });
  await off.context.launch();
  assert.match(off.opened[0], /^toast:/);
  const denied = openHarness({ mode: "installed", access: "not_enrolled" });
  await denied.context.launch();
  assert.match(denied.opened[0], /^toast:/);
});

test("duplicate availability refreshes share one pending check and rerender preserves its state", async () => {
  const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const start = source.indexOf("let measurementDetectionSequence = 0;");
  const end = source.indexOf("\nasync function openPaceMeasurementApp(", start);
  let resolveDetection;
  let calls = 0;
  const button = { dataset: { launchMode: "checking" }, disabled: true, attributes: new Set(), setAttribute(k) { this.attributes.add(k); }, removeAttribute(k) { this.attributes.delete(k); } };
  const fallback = { hidden: false };
  const context = vm.createContext({
    el: { openPaceApp: button, openPaceAppFallback: fallback, measurementAppHint: { textContent: "" }, app: { dataset: { view: "measurement" } } },
    window: {}, navigator: { userAgent: "Android" }, getRecord: () => ({ off: false }), currentMeasurementWorkDate: () => "2026-09-19",
    detectMeasurementApp: () => { calls += 1; return new Promise((resolve) => { resolveDetection = resolve; }); },
  });
  vm.runInContext(source.slice(start, end), context);
  const a = context.refreshMeasurementAppAvailability();
  const b = context.refreshMeasurementAppAvailability();
  assert.equal(calls, 1);
  assert.equal(button.disabled, true);
  assert.equal(button.attributes.has("aria-busy"), true);
  context.applyMeasurementLaunchControls(false); // rerender while the check is pending
  assert.equal(button.disabled, true);
  assert.equal(button.attributes.has("aria-busy"), true);
  resolveDetection("installed");
  await Promise.all([a, b]);
  context.applyMeasurementLaunchControls(false); // rerender after a positive detection
  assert.equal(button.dataset.launchMode, "installed");
  assert.equal(button.disabled, false);
  assert.equal(fallback.hidden, true);
});

test("native mode and desktop rerenders preserve hidden fallback and off state", () => {
  const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const start = source.indexOf("let measurementDetectionSequence = 0;");
  const end = source.indexOf("\nasync function openPaceMeasurementApp(", start);
  const button = { dataset: { launchMode: "checking" }, disabled: true, setAttribute() {}, removeAttribute() {} };
  const fallback = { hidden: false };
  const context = vm.createContext({
    el: { openPaceApp: button, openPaceAppFallback: fallback, measurementAppHint: { textContent: "" } },
    window: { QuickFlexNative: { postMessage() {} } }, navigator: { userAgent: "Desktop" },
    getRecord: () => ({ off: true }), currentMeasurementWorkDate: () => "2026-09-19",
    detectMeasurementApp: async () => { throw Error("native mode should not query"); },
  });
  vm.runInContext(source.slice(start, end), context);
  context.setMeasurementLaunchMode("native");
  context.applyMeasurementLaunchControls(true);
  assert.equal(button.dataset.launchMode, "native");
  assert.equal(button.disabled, true);
  assert.equal(fallback.hidden, true);
});
