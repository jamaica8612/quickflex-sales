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
  const context = vm.createContext({ document: { querySelector: () => null }, expensesController: null, exportsController: null, routeNotesController: null, routeNoteShareDialog: null, ...sandbox });
  vm.runInContext(`${extractFunction("nativeBackAction")}\n${extractFunction("quickflexHandleNativeBack")}\nglobalThis.__actual = { nativeBackAction, quickflexHandleNativeBack };`, context);
  return context.__actual;
}

function layer(openClass = "") {
  return { classList: { contains: (name) => name === openClass } };
}

test("native route-note gesture state blocks only the signed-in route view", () => {
  const calls = [];
  let user = "driver";
  const app = { dataset: { view: "routes" } };
  const context = vm.createContext({ el: { app }, currentUserId: () => user, postNativeMessage: (message) => calls.push(message) });
  vm.runInContext(`${extractFunction("syncNativeRouteNotesState")}\nglobalThis.sync = syncNativeRouteNotesState;`, context);
  context.sync();
  app.dataset.view = "home";
  context.sync();
  app.dataset.view = "routes";
  user = null;
  context.sync();
  assert.deepEqual(calls.map((message) => [message.type, message.active]), [
    ["set_route_notes_active", true], ["set_route_notes_active", false], ["set_route_notes_active", false],
  ]);
});

test("cancelled route-note navigation does not re-enable native pull to refresh", () => {
  const messages = [];
  let allowClose = false;
  const app = { dataset: { view: "routes" } };
  const context = vm.createContext({
    el: { app, navTabs: [] }, state: {}, currentUserId: () => "driver",
    routeNotesController: { canClose: () => allowClose, close() {} },
    postNativeMessage: (message) => messages.push(message), queueUsageEvent() {},
  });
  vm.runInContext(`${extractFunction("syncNativeRouteNotesState")}\n${extractFunction("showView")}\nglobalThis.show = showView;`, context);
  context.show("home");
  assert.equal(app.dataset.view, "routes");
  assert.equal(messages.length, 0);
  allowClose = true;
  context.show("home");
  assert.equal(app.dataset.view, "home");
  assert.equal(messages.at(-1).active, false);
});

test("native back action is deterministic and only home is unhandled", () => {
  const { nativeBackAction } = loadNativeBack();
  assert.equal(nativeBackAction({ dbSheetOpen: true, salesOverrideOpen: true, blockingModalOpen: true, view: "record" }), "close-db-sheet");
  assert.equal(nativeBackAction({ salesOverrideOpen: true, blockingModalOpen: true, view: "record" }), "close-sales-override");
  assert.equal(nativeBackAction({ blockingModalOpen: true, view: "settings" }), "unhandled");
  assert.equal(nativeBackAction({ blockingModalOpen: true, measurementGuideOpen: true, view: "measurement" }), "unhandled");
  assert.equal(nativeBackAction({ measurementGuideOpen: true, view: "measurement" }), "close-measurement-guide");
  assert.equal(nativeBackAction({ view: "record" }), "leave-record");
  ["inspection", "measurement", "expenses", "settings", "routes"].forEach((view) => {
    assert.equal(nativeBackAction({ view }), "go-home", `${view} should return home`);
  });
  assert.equal(nativeBackAction({ view: "schedule" }), "go-settings");
  assert.equal(nativeBackAction({ view: "stats" }), "go-home");
  assert.equal(nativeBackAction({ view: "noah" }), "go-home");
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

test("native back closes a route-note share dialog before any route navigation", () => {
  let resets = 0, routeBacks = 0;
  const { quickflexHandleNativeBack } = loadNativeBack({
    routeNoteShareDialog: { handleBack: () => { resets += 1; return true; } },
    routeNotesController: { handleBack: () => { routeBacks += 1; return true; } },
    el: { app: { dataset: { view: "routes" } } },
  });
  assert.equal(quickflexHandleNativeBack(), "handled");
  assert.equal(resets, 1);
  assert.equal(routeBacks, 0);
});

test("route-note editor handles native back without leaving the view", () => {
  let handled=0, navigated=0;
  const {quickflexHandleNativeBack}=loadNativeBack({
    el:{app:{dataset:{view:'routes'}}}, modalLayerIsOpen:()=>false,
    routeNotesController:{handleBack:()=>{handled++;return true;}},
    showView:()=>navigated++,
  });
  assert.equal(quickflexHandleNativeBack(),'handled');
  assert.equal(handled,1);assert.equal(navigated,0);
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

test("native back closes the measurement guide before leaving measurement", () => {
  let closeCalls = 0;
  let navigations = 0;
  const { quickflexHandleNativeBack } = loadNativeBack({
    el: {
      app: { dataset: { view: "measurement" } },
      dbSheet: layer(),
      salesOverrideOverlay: layer(),
      measurementGuideOverlay: layer("visible"),
      setupOverlay: layer(),
      authOverlay: layer(),
      pendingOverlay: layer(),
    },
    modalLayerIsOpen: (node) => node.classList.contains("visible"),
    closeMeasurementGuide: () => { closeCalls += 1; },
    showView: () => { navigations += 1; },
  });

  assert.equal(quickflexHandleNativeBack(), "handled");
  assert.equal(closeCalls, 1);
  assert.equal(navigations, 0);
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
    app: { dataset: { view: "expenses" } },
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
  el.app.dataset.view = "schedule";
  assert.equal(quickflexHandleNativeBack(), "handled");
  assert.deepEqual(navigations, ["home", "settings"]);
  el.app.dataset.view = "expenses";
  assert.equal(quickflexHandleNativeBack(), "handled");
  assert.deepEqual(navigations, ["home", "settings", "home"]);
  el.app.dataset.view = "stats";
  assert.equal(quickflexHandleNativeBack(), "handled");
  assert.deepEqual(navigations, ["home", "settings", "home", "home"]);
  el.app.dataset.view = "home";
  assert.equal(quickflexHandleNativeBack(), "unhandled");
  assert.deepEqual(navigations, ["home", "settings", "home", "home"]);
});

test("PWA exposes the synchronous native bridge contract", () => {
  assert.match(main, /window\.quickflexHandleNativeBack\s*=\s*quickflexHandleNativeBack/);
  assert.doesNotMatch(extractFunction("quickflexHandleNativeBack"), /\basync\b|\bawait\b/);
  assert.match(extractFunction("quickflexHandleNativeBack"), /return "handled"/);
  assert.match(extractFunction("quickflexHandleNativeBack"), /return "unhandled"/);
});
