import assert from "node:assert/strict";
import test from "node:test";
import { createVisibilityQueue } from "../src/lib/motion.js";

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatch(type) { [...(listeners.get(type) || [])].forEach(callback => callback({ type })); },
    listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

function environment({ hidden = false, reduced = false, raf = true } = {}) {
  const doc = { hidden, ...eventTarget() };
  const media = { matches: reduced, ...eventTarget() };
  let deliver;
  const observers = [];
  const win = {
    ...eventTarget(),
    matchMedia: () => media,
    ...(raf ? { requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} } : {}),
    IntersectionObserver: class {
      constructor(callback) { this.callback = callback; this.observed = new Set(); observers.push(this); deliver = callback; }
      observe(card) { this.observed.add(card); }
      unobserve(card) { this.observed.delete(card); }
      disconnect() { this.disconnected = true; this.observed.clear(); }
    },
  };
  return {
    win, doc, media, observers,
    deliver(entries) { deliver(entries); },
    hidden(value) { doc.hidden = value; doc.dispatch("visibilitychange"); },
    reduce(value = true) { media.matches = value; media.dispatch("change"); },
  };
}

test("stats queue retains hidden registrations and hidden IntersectionObserver entries", () => {
  const env = environment({ hidden: true });
  const card = {}, calls = [];
  const queue = createVisibilityQueue({ ...env, finishWhenHidden: false });
  queue.whenVisible(card, "value", () => calls.push("old"));
  queue.whenVisible(card, "value", () => calls.push("latest"));
  assert.deepEqual(calls, [], "hidden registration must queue instead of finishing");
  env.deliver([{ target: card, isIntersecting: true, intersectionRatio: 1 }]);
  assert.deepEqual(calls, [], "an IO entry while hidden must not drain callbacks");
  assert.equal(queue.isVisible(card), false);
  env.hidden(false);
  assert.deepEqual(calls, ["latest"], "foreground should run the latest queued callback once");
  assert.equal(queue.isVisible(card), true);
  env.deliver([{ target: card, isIntersecting: true, intersectionRatio: 1 }]);
  assert.deepEqual(calls, ["latest"]);
  queue.destroy();
});

test("foreground drains queued work only for visible cards; unseen cards wait for IO", () => {
  const env = environment({ hidden: true });
  const visible = {}, unseen = {}, calls = [];
  const queue = createVisibilityQueue({ ...env, finishWhenHidden: false });
  queue.whenVisible(visible, "metric", () => calls.push("visible"));
  queue.whenVisible(unseen, "metric", () => calls.push("unseen"));
  env.deliver([{ target: visible, isIntersecting: true, intersectionRatio: 1 }]);
  env.hidden(false);
  assert.deepEqual(calls, ["visible"]);
  assert.equal(queue.isVisible(visible), true);
  assert.equal(queue.isVisible(unseen), false);
  env.deliver([{ target: unseen, isIntersecting: true, intersectionRatio: 1 }]);
  assert.deepEqual(calls, ["visible", "unseen"]);
  queue.destroy();
});

test("latest callback wins per key while hidden and foreground delivery is one-shot", () => {
  const env = environment({ hidden: true });
  const card = {}, calls = [];
  const queue = createVisibilityQueue({ ...env, finishWhenHidden: false });
  queue.whenVisible(card, "amount", () => calls.push("old amount"));
  queue.whenVisible(card, "amount", () => calls.push("new amount"));
  queue.whenVisible(card, "count", () => calls.push("count"));
  env.deliver([{ target: card, isIntersecting: true, intersectionRatio: 1 }]);
  assert.deepEqual(calls, []);
  env.hidden(false);
  assert.deepEqual(calls, ["new amount", "count"]);
  env.hidden(true);
  env.hidden(false);
  env.deliver([{ target: card, isIntersecting: true, intersectionRatio: 1 }]);
  assert.deepEqual(calls, ["new amount", "count"]);
  queue.destroy();
});

test("reduced motion finishes queued stats callbacks immediately even while the document is hidden", () => {
  const env = environment({ hidden: true });
  const card = {}, calls = [];
  const queue = createVisibilityQueue({ ...env, finishWhenHidden: false });
  queue.whenVisible(card, "metric", () => calls.push("old"));
  queue.whenVisible(card, "metric", () => calls.push("latest static"));
  assert.deepEqual(calls, []);
  env.reduce(true);
  assert.deepEqual(calls, ["latest static"]);
  env.deliver([{ target: card, isIntersecting: true, intersectionRatio: 1 }]);
  env.hidden(false);
  assert.deepEqual(calls, ["latest static"], "later IO or foreground must not replay finished work");
  queue.destroy();
});

test("destroy discards hidden queued work and releases environment listeners", () => {
  const env = environment({ hidden: true });
  const card = {};
  let calls = 0;
  const queue = createVisibilityQueue({ ...env, finishWhenHidden: false });
  queue.whenVisible(card, "metric", () => calls++);
  queue.destroy();
  env.hidden(false);
  env.reduce(true);
  env.deliver([{ target: card, isIntersecting: true, intersectionRatio: 1 }]);
  assert.equal(calls, 0);
  assert.equal(env.observers[0].disconnected, true);
  assert.equal(env.doc.listenerCount() + env.media.listenerCount(), 0);
});

test("without requestAnimationFrame the visible fallback runs statically without waiting for IO", () => {
  const env = environment({ raf: false });
  const card = {};
  let calls = 0;
  const queue = createVisibilityQueue({ ...env, finishWhenHidden: false });
  queue.whenVisible(card, "metric", () => calls++);
  assert.equal(calls, 1);
  assert.equal(env.observers[0].observed.has(card), false);
  queue.destroy();
});

test("the default finishWhenHidden behavior remains unchanged for existing queues", () => {
  const env = environment({ hidden: true });
  let calls = 0;
  const queue = createVisibilityQueue(env);
  queue.whenVisible({}, "metric", () => calls++);
  assert.equal(calls, 1);
  queue.destroy();
});
