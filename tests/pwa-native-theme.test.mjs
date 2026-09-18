import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
function functionBefore(name, next) {
  return main.slice(main.indexOf(`function ${name}(`), main.indexOf(`function ${next}(`));
}

function themeHarness({ bridge, storageThrows = false } = {}) {
  const stored = new Map();
  const buttons = ["dark", "light"].map((themeSet) => ({
    dataset: { themeSet },
    classList: { toggle(_, selected) { this.active = selected; } },
    setAttribute(_, value) { this.pressed = value; },
  }));
  const document = {
    documentElement: { dataset: {} }, body: { dataset: {} },
    querySelector: () => ({ setAttribute() {} }), querySelectorAll: () => buttons,
  };
  const context = vm.createContext({
    document, window: { QuickFlexNative: bridge }, THEME_KEY: "quickflex-theme",
    localStorage: { setItem(key, value) { if (storageThrows) throw Error("unavailable"); stored.set(key, value); } },
  });
  vm.runInContext(`${functionBefore("postNativeMessage", "requestNativeMessage")}\n${functionBefore("applyTheme", "getInitialTheme")}`, context);
  return { context, stored, document, buttons };
}

test("theme changes immediately update PWA, persist, and notify native in order", () => {
  const messages = [];
  const { context, stored, document, buttons } = themeHarness({ bridge: { postMessage: (raw) => messages.push(JSON.parse(raw)) } });
  context.applyTheme("light");
  assert.equal(document.documentElement.dataset.theme, "light");
  assert.equal(document.body.dataset.theme, "light");
  assert.equal(stored.get("quickflex-theme"), "light");
  assert.equal(buttons[1].pressed, "true");
  context.applyTheme("dark");
  assert.equal(stored.get("quickflex-theme"), "dark");
  assert.equal(buttons[0].pressed, "true");
  assert.deepEqual(messages, [{ type: "sync_theme", theme: "light" }, { type: "sync_theme", theme: "dark" }]);
});

test("normal browsers and unavailable native/storage still apply the visible theme", () => {
  for (const bridge of [undefined, { postMessage() { throw Error("unavailable"); } }]) {
    const { context, document } = themeHarness({ bridge, storageThrows: true });
    assert.doesNotThrow(() => context.applyTheme("light"));
    assert.equal(document.documentElement.dataset.theme, "light");
  }
});

test("measurement entry sends the currently displayed choice with its existing account context", async () => {
  const messages = [];
  const session = { access_token: "test-access", refresh_token: "test-refresh", user: { id: "owner" } };
  const context = vm.createContext({
    el: { openPaceApp: { dataset: { launchMode: "native" } } },
    document: { documentElement: { dataset: { theme: "light" } } },
    window: { QuickFlexNative: { postMessage: (raw) => messages.push(JSON.parse(raw)) } },
    state: { session, db: { auth: { getSession: async () => ({ data: { session } }) } } },
    TABLES: { profiles: "profiles" }, authEventEpoch: 1,
    captureAccountContext: () => ({ userId: "owner" }),
    isAccountContextCurrent: () => true, checkBetaMeasurementAccess: async () => "allowed",
    currentMeasurementWorkDate: () => "2026-09-16", getRecord: () => ({ off: false }),
    isNightShift: () => false, sessionUserId: (s) => s.user.id,
    applyAuthSession() {}, allocateNativeSessionRevision: () => 10,
    toast(message) { throw Error(message); },
  });
  vm.runInContext(`${functionBefore("postNativeMessage", "requestNativeMessage")}\nasync ${functionBefore("openPaceMeasurementApp", "openMeasurementGuide")}`, context);
  await context.openPaceMeasurementApp();
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "open_measurement");
  assert.equal(messages[0].theme, "light");
  assert.equal(messages[0].workDate, "2026-09-16");
  assert.equal(messages[0].accessToken, "test-access");
});
