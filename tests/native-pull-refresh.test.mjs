import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  PULL_REFRESH_VIEWS,
  createNativePullRefresh,
  isEditingElement,
  pullRefreshAllowed,
} from "../src/ui/native-pull-refresh.js";

function element(tagName, type) {
  return { nodeType: 1, tagName, isContentEditable: false, getAttribute: (name) => (name === "type" ? type : null) };
}

function harness({ view = "home", signedIn = true, modalOpen = false, refresh = async () => true } = {}) {
  const posts = [];
  const notices = [];
  const listeners = new Map();
  let observer = null;
  const doc = {
    activeElement: null,
    body: {},
    openDialog: false,
    querySelector(selector) { return selector === "dialog[open]" && doc.openDialog ? {} : null; },
    addEventListener(type, callback) { listeners.set(type, callback); },
  };
  const win = {
    requestAnimationFrame(callback) { callback(); return 1; },
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} },
  };
  const env = { view, signedIn, modalOpen };
  const controller = createNativePullRefresh({
    win, doc,
    getView: () => env.view,
    isSignedIn: () => env.signedIn,
    isModalOpen: () => env.modalOpen,
    refresh,
    post: (message) => posts.push(message),
    notify: (ok) => notices.push(ok),
  });
  return { controller, posts, notices, env, doc, win, fire: (type) => listeners.get(type)?.(), mutate: () => observer?.() };
}

const lastEnabled = (posts) => posts.filter((m) => m.type === "set_pull_refresh").at(-1)?.enabled;

test("only screens whose numbers change elsewhere can pull to refresh", () => {
  assert.deepEqual([...PULL_REFRESH_VIEWS], ["home", "stats", "measurement"]);
  for (const view of ["noah", "routes", "record", "expenses", "inspection", "schedule", "settings"]) {
    assert.equal(pullRefreshAllowed({ view, signedIn: true, modalOpen: false, editing: false }), false, view);
  }
  assert.equal(pullRefreshAllowed({ view: "home", signedIn: false, modalOpen: false, editing: false }), false);
});

test("typing in a text field blocks the pull but a focused button does not", () => {
  assert.equal(isEditingElement(element("INPUT", "number")), true);
  assert.equal(isEditingElement(element("INPUT", null)), true);
  assert.equal(isEditingElement(element("TEXTAREA")), true);
  assert.equal(isEditingElement(element("INPUT", "checkbox")), false);
  assert.equal(isEditingElement(element("BUTTON")), false);
  assert.equal(isEditingElement(null), false);
});

test("the app hears the allowed state once per change: screen, popup and typing", () => {
  const { controller, posts, env, doc, fire, mutate } = harness();
  assert.equal(lastEnabled(posts), true);
  const count = posts.length;
  controller.sync();
  assert.equal(posts.length, count, "no duplicate message when nothing changed");

  env.view = "noah"; controller.sync();
  assert.equal(lastEnabled(posts), false);
  env.view = "home"; controller.sync();
  assert.equal(lastEnabled(posts), true);

  env.modalOpen = true; controller.sync();
  assert.equal(lastEnabled(posts), false);
  env.modalOpen = false; controller.sync();

  doc.openDialog = true; mutate();
  assert.equal(lastEnabled(posts), false, "an open <dialog> blocks the pull");
  doc.openDialog = false; mutate();

  doc.activeElement = element("INPUT", "text"); fire("focusin");
  assert.equal(lastEnabled(posts), false);
  doc.activeElement = null; fire("focusout");
  assert.equal(lastEnabled(posts), true);
});

test("a pull refreshes data in place and tells the app when it is done", async () => {
  let calls = 0;
  const { win, posts, notices } = harness({ refresh: async () => { calls += 1; return true; } });
  assert.equal(win.quickflexHandleNativeRefresh(), "handled");
  assert.equal(win.quickflexHandleNativeRefresh(), "handled", "a second pull while running does not start another");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
  assert.deepEqual(notices, [true]);
  assert.equal(posts.at(-1).type, "pull_refresh_done");
});

test("a failed refresh still stops the spinner and says so", async () => {
  const { win, posts, notices } = harness({ refresh: async () => { throw new Error("offline"); } });
  assert.equal(win.quickflexHandleNativeRefresh(), "handled");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(notices, [false]);
  assert.equal(posts.at(-1).type, "pull_refresh_done");
});

test("a pull that slips through while blocked is refused without reloading", () => {
  let calls = 0;
  const { win, env, posts } = harness({ refresh: async () => { calls += 1; } });
  env.view = "noah";
  assert.equal(win.quickflexHandleNativeRefresh(), "blocked");
  assert.equal(calls, 0);
  assert.equal(lastEnabled(posts), false, "the refusal re-sends the blocked state");
});

test("main.js creates the controller only inside the app and never reloads the page for a pull", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /if \(isNativeShell\(window\)\) \{[\s\S]{0,200}?createNativePullRefresh\(\{/);
  const refresh = main.slice(main.indexOf("async function refreshForPull"), main.indexOf("async function refreshAfterNativeMeasurement"));
  assert.doesNotMatch(refresh, /location\.reload/);
  assert.match(refresh, /loadFromDb\(context\)/);
});
