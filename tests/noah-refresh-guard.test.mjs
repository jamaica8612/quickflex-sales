import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bindNoahRefreshGuard, isNativeShell } from "../src/ui/noah-refresh-guard.js";

function fakeWindow({ native = true, userAgent = "Mozilla/5.0" } = {}) {
  const classes = new Set();
  const listeners = new Map();
  let observer = null;
  const win = {
    scrollY: 0, scrolls: [],
    navigator: { userAgent },
    QuickFlexNative: native ? { postMessage() {} } : undefined,
    document: { documentElement: { classList: {
      toggle: (name, on) => (on ? classes.add(name) : classes.delete(name)),
      remove: (name) => classes.delete(name), contains: (name) => classes.has(name),
    } } },
    scrollTo(x, y) { win.scrollY = y; win.scrolls.push(y); },
    requestAnimationFrame(callback) { callback(); return 1; },
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    MutationObserver: class { constructor(callback) { observer = callback; } observe() {} disconnect() { observer = null; } },
  };
  return { win, classes, fire: (type) => listeners.get(type)?.(), mutate: () => observer?.(), listeners };
}

test("native shell is detected by the bridge or the app user agent", () => {
  assert.equal(isNativeShell(fakeWindow().win), true);
  assert.equal(isNativeShell(fakeWindow({ native: false, userAgent: "Chrome QuickFlexMerged/Beta 1.23" }).win), true);
  assert.equal(isNativeShell(fakeWindow({ native: false }).win), false);
});

test("Noah keeps the page 1px down inside the Android app so pull-to-refresh cannot start", () => {
  const app = { dataset: { view: "home" } };
  const { win, classes, fire, mutate, listeners } = fakeWindow();
  const unbind = bindNoahRefreshGuard({ app, win });
  assert.equal(classes.has("noah-refresh-guard"), false);
  app.dataset.view = "noah"; mutate();
  assert.equal(classes.has("noah-refresh-guard"), true);
  assert.equal(win.scrollY, 1);
  win.scrollY = 0; fire("scroll");
  assert.equal(win.scrollY, 1, "a drag back to the top is undone");
  app.dataset.view = "stats"; mutate();
  assert.equal(classes.has("noah-refresh-guard"), false);
  assert.equal(win.scrollY, 0);
  win.scrollY = 0; fire("scroll");
  assert.equal(win.scrollY, 0, "other tabs keep ordinary pull-to-refresh");
  unbind();
  assert.equal(listeners.size, 0);
});

test("browsers and iOS PWAs are left untouched", () => {
  const app = { dataset: { view: "noah" } };
  const { win, classes } = fakeWindow({ native: false });
  bindNoahRefreshGuard({ app, win })();
  assert.equal(classes.size, 0);
  assert.deepEqual(win.scrolls, []);
});

test("the guard ships in the Noah stylesheet and the shell cache", () => {
  assert.match(readFileSync(new URL("../styles/noah.css", import.meta.url), "utf8"), /html\.noah-refresh-guard body \{ min-height: calc\(100dvh \+ 2px\); \}/);
  assert.ok(readFileSync(new URL("../sw.js", import.meta.url), "utf8").includes('"./src/ui/noah-refresh-guard.js"'));
});
