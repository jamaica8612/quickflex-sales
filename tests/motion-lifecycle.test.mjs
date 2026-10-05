import assert from "node:assert/strict";
import test from "node:test";
import {
  updateCountingNumber, cancelCountingNumber, createVisibilityQueue,
  shouldAnimate, shake, confettiBurst, createTabIndicator, crossfade,
  enterElement,
} from "../src/lib/motion.js";

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatch(type) { [...(listeners.get(type) || [])].forEach((callback) => callback({ type })); },
    listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

function clock({ reduced = false, hidden = false } = {}) {
  let now = 0;
  let nextId = 0;
  const frames = new Map();
  const media = { matches: reduced, ...eventTarget() };
  const canvases = [];
  const context = { scale() {}, clearRect() {}, save() {}, translate() {}, rotate() {}, fillRect() {}, restore() {} };
  const doc = {
    hidden, ...eventTarget(),
    body: { appendChild: (canvas) => canvases.push(canvas) },
    createElement() {
      const canvas = { style: {}, setAttribute() {}, getContext: () => context, remove() { this.removed = true; } };
      return canvas;
    },
  };
  const win = {
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 1,
    performance: { now: () => now },
    requestAnimationFrame(callback) { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    matchMedia: () => media,
  };
  return {
    win, doc, media, canvases,
    pending: () => frames.size,
    tick(delta = 16) {
      now += delta;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    },
    reduce(matches = true) { media.matches = matches; media.dispatch("change"); },
    hide(value = true) { doc.hidden = value; doc.dispatch("visibilitychange"); },
  };
}

function numberElement() {
  let text = "";
  const attributes = new Map();
  return {
    childNodes: [], style: {}, isConnected: true, writes: 0,
    get textContent() { return text; },
    set textContent(value) { text = String(value); this.childNodes = [{ text }]; this.writes++; },
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: (name) => attributes.get(name),
  };
}

const rounded = (value) => String(Math.round(value));

test("whole-value count follows 750ms cubic ease-out with one frame regardless of digit count", () => {
  const env = clock();
  const el = numberElement();
  updateCountingNumber(el, 1000000000000, { format: rounded, ...env });
  assert.equal(el.textContent, "0");
  assert.equal(el.getAttribute("aria-label"), "1000000000000");
  assert.equal(env.pending(), 1);
  env.tick(375);
  assert.equal(el.textContent, "875000000000");
  assert.equal(env.pending(), 1);
  env.tick(375);
  assert.equal(el.textContent, "1000000000000");
  assert.equal(env.pending(), 0);
  assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
});

test("retarget starts from the last painted value and cancels its old frame", () => {
  const env = clock();
  const el = numberElement();
  const format = (value) => value.toFixed(3);
  updateCountingNumber(el, 1000, { format, ...env });
  env.tick(375);
  assert.equal(el.textContent, "875.000");
  updateCountingNumber(el, 2000, { format, duration: 1000, ...env });
  assert.equal(el.textContent, "875.000");
  assert.equal(env.pending(), 1);
  env.tick(500);
  assert.equal(el.textContent, "1859.375");
  env.tick(500);
  assert.equal(el.textContent, "2000.000");
  assert.equal(env.pending(), 0);
});

test("same target with a new formatter function keeps the original progress and DOM", () => {
  const env = clock();
  const el = numberElement();
  updateCountingNumber(el, 1000, { format: (value) => rounded(value), ...env });
  env.tick(250);
  const node = el.childNodes[0];
  const writes = el.writes;
  updateCountingNumber(el, 1000, { format: (value) => rounded(value), ...env });
  assert.equal(el.childNodes[0], node);
  assert.equal(el.writes, writes);
  env.tick(500);
  assert.equal(el.textContent, "1000");
  assert.equal(env.pending(), 0, "the unchanged call must not restart the 750ms duration");
  const finalNode = el.childNodes[0];
  updateCountingNumber(el, 1000, { format: (value) => rounded(value), ...env });
  assert.equal(el.childNodes[0], finalNode);
  assert.equal(env.pending(), 0);
});

test("format-only changes repair the final text without replaying motion", () => {
  const env = clock();
  const el = numberElement();
  updateCountingNumber(el, 1000, { duration: 0, ...env });
  updateCountingNumber(el, 1000, { format: (value) => `${value.toLocaleString("en-US")}원`, ...env });
  assert.equal(el.textContent, "1,000원");
  assert.equal(el.getAttribute("aria-label"), "1,000원");
  assert.equal(env.pending(), 0);
});

test("same-text DOM replacement is repaired despite a matching target cache", () => {
  const env = clock();
  const el = numberElement();
  updateCountingNumber(el, 1000, { format: rounded, ...env });
  env.tick(200);
  el.textContent = el.textContent; // another renderer replaced the text node
  updateCountingNumber(el, 1000, { format: rounded, ...env });
  assert.equal(el.textContent, "1000");
  assert.equal(env.pending(), 0);
  assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
});

test("an external plain renderer takes ownership without a stale counter overwrite", () => {
  const env = clock();
  const el = numberElement();
  updateCountingNumber(el, 1000, { format: rounded, ...env });
  env.tick(200);
  el.textContent = "latest plain value";
  env.tick();
  assert.equal(el.textContent, "latest plain value");
  assert.equal(env.pending(), 0);
  assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
});

test("new counter cancels an older fade swap on the same element", () => {
  const env = clock();
  const el = numberElement();
  crossfade(el, () => { el.textContent = "old value"; }, env);
  env.tick(32);
  updateCountingNumber(el, 1000, { format: rounded, ...env });
  env.tick(750);
  assert.equal(el.textContent, "1000");
  assert.equal(env.pending(), 0);
});

for (const options of [{ reduced: true }, { hidden: true }]) {
  test(`counter begins at its final value when motion is disabled: ${JSON.stringify(options)}`, () => {
    const env = clock(options);
    const el = numberElement();
    updateCountingNumber(el, 1234, { format: rounded, ...env });
    assert.equal(el.textContent, "1234");
    assert.equal(env.pending(), 0);
    assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
  });
}

for (const change of ["reduce", "hide"]) {
  test(`counter ${change} transition finishes the latest retarget and removes listeners`, () => {
    const env = clock();
    const el = numberElement();
    updateCountingNumber(el, 1000, { format: rounded, ...env });
    env.tick(100);
    updateCountingNumber(el, 2000, { format: rounded, ...env });
    env[change]();
    assert.equal(el.textContent, "2000");
    assert.equal(env.pending(), 0);
    assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
  });

  test(`shake ${change} transition clears its transform, frame and listeners`, () => {
    const env = clock();
    const el = { style: {} };
    shake(el, env);
    env.tick();
    env.tick();
    assert.notEqual(el.style.transform, "");
    env[change]();
    assert.equal(el.style.transform, "");
    assert.equal(env.pending(), 0);
    assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
  });

  test(`confetti ${change} transition immediately removes its canvas and frame`, () => {
    const env = clock();
    confettiBurst({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }) }, { count: 1, ...env });
    env.tick();
    env[change]();
    assert.equal(env.canvases[0].removed, true);
    assert.equal(env.pending(), 0);
    assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
  });
}

test("counter releases a detached element without writing to it again", () => {
  const env = clock();
  const el = numberElement();
  updateCountingNumber(el, 1000, { format: rounded, ...env });
  env.tick(100);
  el.isConnected = false;
  const before = el.textContent;
  env.tick();
  assert.equal(el.textContent, before);
  assert.equal(env.pending(), 0);
  assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
});

test("enterElement rises and fades, then restores prior inline styles", () => {
  const env = clock();
  const el = { style: { opacity: "0.7", transform: "scale(1.02)" }, isConnected: true };
  enterElement(el, { ...env, distance: 24 });
  assert.equal(el.style.opacity, "0");
  assert.match(el.style.transform, /^translateY\(24px\) scale\(1\.02\)$/);
  for (let i = 0; env.pending() && i < 240; i++) env.tick(16);
  assert.equal(el.style.opacity, "0.7");
  assert.equal(el.style.transform, "scale(1.02)");
  assert.equal(env.pending(), 0);
});

test("entry settles without a rebound while opacity stays bounded and the final position is exact", () => {
  const env = clock();
  const el = {style: {opacity: "", transform: ""}, isConnected: true};
  enterElement(el, env);
  let smallest = 0;
  for (let i = 0; env.pending() && i < 160; i++) {
    env.tick(16);
    const y = Number(el.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] || 0);
    smallest = Math.min(smallest, y);
    if (el.style.opacity) assert.ok(Number(el.style.opacity) >= 0 && Number(el.style.opacity) <= 1);
  }
  assert.ok(smallest >= 0, "entries are critically damped and never pass their resting place");
  assert.equal(el.style.transform, "");
  assert.equal(el.style.opacity, "");
  assert.equal(env.pending(), 0);
});

test("enterElement safely replaces and cancels a previous entrance", () => {
  const env = clock();
  const el = { style: { opacity: "", transform: "" }, isConnected: true };
  const cancelFirst = enterElement(el, { ...env, distance: 32 });
  env.tick(32);
  const secondStart = el.style.transform;
  const cancelSecond = enterElement(el, { ...env, distance: 12 });
  assert.notEqual(el.style.transform, secondStart);
  cancelFirst();
  assert.equal(el.style.transform, "translateY(12px)", "stale cancellation must not clear the replacement");
  cancelSecond();
  env.tick(); // the shared scheduler drains its already-requested frame
  assert.equal(el.style.opacity, "");
  assert.equal(el.style.transform, "");
  assert.equal(env.pending(), 0);
});

test("enterElement stages delayed rows immediately and restores them if hidden before start", () => {
  const env = clock();
  const el = { style: { opacity: "", transform: "" }, isConnected: true };
  enterElement(el, { ...env, delay: 60_000 });
  assert.equal(el.style.opacity, "0", "the new node is hidden before the stagger timer can fire");
  assert.equal(el.style.transform, "translateY(8px)", "default rise distance is staged immediately");
  assert.equal(env.pending(), 0, "staging does not start a spring before the delay");
  env.hide();
  assert.equal(el.style.opacity, "");
  assert.equal(el.style.transform, "");
  assert.equal(env.pending(), 0);
});

for (const change of ["hide", "reduce"]) {
  test(`enterElement ${change} transition restores styles and stops its spring`, () => {
    const env = clock();
    const el = { style: { opacity: "", transform: "" }, isConnected: true };
    enterElement(el, { ...env });
    env.tick(32);
    env[change]();
    assert.equal(el.style.opacity, "");
    assert.equal(el.style.transform, "");
    assert.equal(env.pending(), 0);
  });
}

test("enterElement immediately restores styles when motion is unavailable or element detached", () => {
  const env = clock();
  const noRaf = { ...env, win: { matchMedia: env.win.matchMedia } };
  const detached = { style: { opacity: "0.4", transform: "scale(.9)" }, isConnected: false };
  enterElement(detached, { ...env });
  assert.equal(detached.style.opacity, "0.4");
  assert.equal(detached.style.transform, "scale(.9)");
  const staticEl = { style: { opacity: "", transform: "" }, isConnected: true };
  enterElement(staticEl, noRaf);
  assert.equal(staticEl.style.opacity, "");
  assert.equal(staticEl.style.transform, "");
});

test("a motion-setting event cannot overwrite DOM already taken by another renderer", () => {
  const env = clock();
  const el = numberElement();
  updateCountingNumber(el, 1000, { format: rounded, ...env });
  env.tick(100);
  el.textContent = "new owner";
  env.reduce();
  assert.equal(el.textContent, "new owner");
  assert.equal(env.pending(), 0);
  assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
});

test("whole-value counters remain independent beyond the spring capacity", () => {
  const env = clock();
  const elements = Array.from({ length: 17 }, () => numberElement());
  elements.forEach((el) => updateCountingNumber(el, 1000, { format: rounded, ...env }));
  assert.equal(env.pending(), elements.length, "one outstanding frame per whole value");
  env.tick(375);
  assert.ok(elements.every((el) => el.textContent === "875"));
  env.tick(375);
  assert.ok(elements.every((el) => el.textContent === "1000"));
  assert.equal(env.pending(), 0);
  assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
});

test("explicit counter cancellation leaves its painted value and no pending work", () => {
  const env = clock();
  const el = numberElement();
  updateCountingNumber(el, 1000, { format: rounded, ...env });
  env.tick(100);
  const before = el.textContent;
  cancelCountingNumber(el);
  env.tick(1000);
  assert.equal(el.textContent, before);
  assert.equal(env.pending(), 0);
  assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
});

test("a repeated confetti burst replaces the old full-screen canvas", () => {
  const env = clock();
  const origin = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 20, height: 20 }) };
  confettiBurst(origin, { count: 1, ...env });
  confettiBurst(origin, { count: 1, ...env });
  assert.equal(env.canvases[0].removed, true);
  assert.equal(env.canvases[1].removed, undefined);
  assert.equal(env.pending(), 1);
  env.tick(1400);
  assert.equal(env.canvases[1].removed, true);
  assert.equal(env.pending(), 0);
  assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
});

function visibilityEnvironment() {
  const env = clock();
  let deliver;
  let disconnected = false;
  env.win.IntersectionObserver = class {
    constructor(callback) { deliver = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  return { ...env, deliver: (entries) => deliver(entries), disconnected: () => disconnected };
}

test("visibility queue waits for the actual threshold and runs only the newest key", () => {
  const env = visibilityEnvironment();
  const card = {};
  const runs = [];
  let entered = 0;
  const queue = createVisibilityQueue({ ...env, onEnter: () => entered++ });
  queue.whenVisible(card, "count", () => runs.push("old"));
  queue.whenVisible(card, "count", () => runs.push("new"));
  env.deliver([{ target: card, isIntersecting: true, intersectionRatio: 0.19 }]);
  assert.equal(queue.isVisible(card), false);
  assert.deepEqual(runs, []);
  env.deliver([{ target: card, isIntersecting: true, intersectionRatio: 0.2 }]);
  assert.deepEqual(runs, ["new"]);
  assert.equal(entered, 1);
  env.deliver([{ target: card, isIntersecting: true, intersectionRatio: 0.5 }]);
  assert.equal(entered, 1, "an already-visible card is not a new entry");
  queue.destroy();
});

for (const change of ["reduce", "hide"]) {
  test(`visibility queue ${change} transition finishes all offscreen latest keys once`, () => {
    const env = visibilityEnvironment();
    const card = {};
    const other = {};
    const runs = [];
    const queue = createVisibilityQueue(env);
    queue.whenVisible(card, "count", () => runs.push("old"));
    queue.whenVisible(card, "count", () => runs.push(`new:${shouldAnimate(env)}`));
    queue.whenVisible(other, "bar", () => runs.push(`bar:${shouldAnimate(env)}`));
    env[change]();
    assert.deepEqual(runs, ["new:false", "bar:false"]);
    env.deliver([{ target: card, isIntersecting: true, intersectionRatio: 1 }]);
    assert.deepEqual(runs, ["new:false", "bar:false"], "intersection must not replay already-finished work");
    queue.destroy();
  });
}

test("a hidden intersection is revealed on restore without replaying old queued work", () => {
  const env = visibilityEnvironment();
  const card = {};
  let entered = 0;
  let runs = 0;
  const queue = createVisibilityQueue({ ...env, onEnter: () => entered++ });
  queue.whenVisible(card, "count", () => runs++);
  env.hide();
  env.deliver([{ target: card, isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(queue.isVisible(card), false);
  assert.equal(entered, 0);
  assert.equal(runs, 1);
  env.hide(false);
  assert.equal(queue.isVisible(card), true);
  assert.equal(entered, 1);
  assert.equal(runs, 1);
  queue.whenVisible(card, "count", () => runs++);
  assert.equal(runs, 2, "a restored visible card still accepts immediate updates");
  queue.destroy();
});

test("destroyed visibility queues remove listeners and ignore late observer delivery", () => {
  const env = visibilityEnvironment();
  const card = {};
  let runs = 0;
  const queue = createVisibilityQueue(env);
  queue.whenVisible(card, "count", () => runs++);
  queue.destroy();
  env.deliver([{ target: card, isIntersecting: true, intersectionRatio: 1 }]);
  env.reduce();
  assert.equal(runs, 0);
  assert.equal(env.disconnected(), true);
  assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
});

for (const reverse of [false, true]) {
  test(`tab indicator stretches toward its leading edge: reverse=${reverse}`, () => {
    const env = clock();
    const indicator = { style: {} };
    const container = { getBoundingClientRect: () => ({ left: 0, top: 0 }) };
    const left = { getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, height: 40 }) };
    const right = { getBoundingClientRect: () => ({ left: 100, right: 200, top: 0, height: 40 }) };
    const tab = createTabIndicator(container, indicator, env);
    tab.moveTo(reverse ? right : left, { instant: true });
    tab.moveTo(reverse ? left : right);
    env.tick();
    assert.ok(parseFloat(indicator.style.width) > 100, "leading edge must move faster than trailing edge");
    for (let i = 0; env.pending() && i < 200; i++) env.tick();
    assert.equal(indicator.style.width, "100.00px");
    assert.equal(indicator.style.transform, `translateX(${reverse ? "0.00" : "100.00"}px)`);
    assert.equal(env.pending(), 0);
  });
}
