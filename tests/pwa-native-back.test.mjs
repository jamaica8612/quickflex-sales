import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = main.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}()`);
  const paramsStart = main.indexOf("(", start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < main.length; index += 1) {
    if (main[index] === "(") paramsDepth += 1;
    if (main[index] === ")") paramsDepth -= 1;
    if (paramsDepth === 0) {
      paramsEnd = index;
      break;
    }
  }
  const bodyStart = main.indexOf("{", paramsEnd);
  let depth = 0;
  for (let index = bodyStart; index < main.length; index += 1) {
    if (main[index] === "{") depth += 1;
    if (main[index] === "}") depth -= 1;
    if (depth === 0) return main.slice(start, index + 1);
  }
  assert.fail(`unterminated ${name}()`);
}

function loadNativeBack(sandbox = {}) {
  const context = vm.createContext(sandbox);
  vm.runInContext(`${extractFunction("nativeBackAction")}\n${extractFunction("quickflexHandleNativeBack")}\nglobalThis.__actual = { nativeBackAction, quickflexHandleNativeBack };`, context);
  return context.__actual;
}

function layer(openClass = "") {
  return { classList: { contains: (name) => name === openClass } };
}

test("native back action is deterministic and only home is unhandled", () => {
  const { nativeBackAction } = loadNativeBack();
  assert.equal(nativeBackAction({ dbSheetOpen: true, salesOverrideOpen: true, blockingModalOpen: true, view: "record" }), "close-db-sheet");
  assert.equal(nativeBackAction({ salesOverrideOpen: true, blockingModalOpen: true, view: "record" }), "close-sales-override");
  assert.equal(nativeBackAction({ blockingModalOpen: true, view: "settings" }), "unhandled");
  assert.equal(nativeBackAction({ view: "record" }), "leave-record");
  ["inspection", "measurement", "stats", "settings", "admin"].forEach((view) => {
    assert.equal(nativeBackAction({ view }), "go-home", `${view} should return home`);
  });
  assert.equal(nativeBackAction({ view: "home" }), "unhandled");
  assert.equal(nativeBackAction({ view: "future-unknown" }), "unhandled");
});

test("native back closes the database sheet first", () => {
  const calls = [];
  const { quickflexHandleNativeBack } = loadNativeBack({
    el: {
      app: { dataset: { view: "record" } },
      dbSheet: layer("open"),
      salesOverrideOverlay: layer("visible"),
      setupOverlay: layer(),
      authOverlay: layer(),
      pendingOverlay: layer(),
    },
    modalLayerIsOpen: () => false,
    closeSheet: () => calls.push("db"),
    closeSalesOverride: () => calls.push("sales"),
  });
  assert.equal(quickflexHandleNativeBack(), "handled");
  assert.deepEqual(calls, ["db"]);
});

test("native back preserves the sales editor discard confirmation", () => {
  let closeCalls = 0;
  const { quickflexHandleNativeBack } = loadNativeBack({
    el: {
      app: { dataset: { view: "home" } },
      dbSheet: layer(),
      salesOverrideOverlay: layer("visible"),
      setupOverlay: layer(),
      authOverlay: layer(),
      pendingOverlay: layer(),
    },
    modalLayerIsOpen: () => false,
    closeSalesOverride: () => { closeCalls += 1; return false; },
  });
  assert.equal(quickflexHandleNativeBack(), "handled", "declining the existing confirm must not exit the app");
  assert.equal(closeCalls, 1);
});

test("native back uses the existing record back control", () => {
  let clicks = 0;
  const { quickflexHandleNativeBack } = loadNativeBack({
    el: {
      app: { dataset: { view: "record" } },
      backToCalendar: { click: () => { clicks += 1; } },
      dbSheet: layer(),
      salesOverrideOverlay: layer(),
      setupOverlay: layer(),
      authOverlay: layer(),
      pendingOverlay: layer(),
    },
    modalLayerIsOpen: () => false,
  });
  assert.equal(quickflexHandleNativeBack(), "handled");
  assert.equal(clicks, 1);
});

test("native back keeps required account overlays open and returns unhandled", () => {
  let navigations = 0;
  const { quickflexHandleNativeBack } = loadNativeBack({
    el: {
      app: { dataset: { view: "settings" } },
      dbSheet: layer(),
      salesOverrideOverlay: layer(),
      setupOverlay: layer("visible"),
      authOverlay: layer(),
      pendingOverlay: layer(),
    },
    modalLayerIsOpen: (node) => node.classList.contains("visible"),
    showView: () => { navigations += 1; },
  });
  assert.equal(quickflexHandleNativeBack(), "unhandled");
  assert.equal(navigations, 0);
});

test("native back returns internal views home and leaves home to Android", () => {
  const navigations = [];
  const el = {
    app: { dataset: { view: "stats" } },
    dbSheet: layer(),
    salesOverrideOverlay: layer(),
    setupOverlay: layer(),
    authOverlay: layer(),
    pendingOverlay: layer(),
  };
  const { quickflexHandleNativeBack } = loadNativeBack({
    el,
    modalLayerIsOpen: () => false,
    showView: (view) => navigations.push(view),
  });

  assert.equal(quickflexHandleNativeBack(), "handled");
  assert.deepEqual(navigations, ["home"]);
  el.app.dataset.view = "home";
  assert.equal(quickflexHandleNativeBack(), "unhandled");
  assert.deepEqual(navigations, ["home"]);
});

test("PWA exposes the synchronous native bridge contract", () => {
  assert.match(main, /window\.quickflexHandleNativeBack\s*=\s*quickflexHandleNativeBack/);
  assert.doesNotMatch(extractFunction("quickflexHandleNativeBack"), /\basync\b|\bawait\b/);
  assert.match(extractFunction("quickflexHandleNativeBack"), /return "handled"/);
  assert.match(extractFunction("quickflexHandleNativeBack"), /return "unhandled"/);
});
