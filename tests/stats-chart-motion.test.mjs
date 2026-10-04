import assert from "node:assert/strict";
import test from "node:test";
import { chartPaths, drawStatsChart, cancelStatsChartDraw } from "../src/lib/stats-chart-motion.js";

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatch(type) { [...(listeners.get(type) || [])].forEach((callback) => callback()); },
    listeners: () => [...listeners.values()].reduce((total, set) => total + set.size, 0),
  };
}

function setup({ reduced = false, hidden = false, fail, legacyMedia = false } = {}) {
  let now = 0;
  let nextId = 0;
  const frames = new Map();
  const media = { matches: reduced, ...events() };
  if (legacyMedia) {
    media.addListener = (callback) => mediaAdd("change", callback);
    media.removeListener = (callback) => mediaRemove("change", callback);
    const mediaAdd = media.addEventListener.bind(media);
    const mediaRemove = media.removeEventListener.bind(media);
    delete media.addEventListener;
    delete media.removeEventListener;
  }
  const svgs = [];
  const animations = [];
  const parent = {
    children: [],
    appendChild(node) {
      this.children.push(node);
      node.parentNode = this;
      if (fail === "append") throw new Error("append failed");
    },
    removeChild(node) { this.children = this.children.filter((child) => child !== node); node.parentNode = null; },
  };
  const plot = { points: [{ x: 5, y: 30 }, { x: 35, y: 10 }, { x: 65, y: 20 }], baseline: 90, width: 100, height: 100, color: "#abc123" };
  const canvas = { parentNode: parent, isConnected: true, style: { opacity: "" }, __moPlot: plot, accessibleSummary: "existing summary" };
  function animate(kind, frames, options) {
    if (fail === `${kind}-animate`) throw new Error("WAAPI failed");
    let resolve;
    let reject;
    const finished = new Promise((yes, no) => { resolve = yes; reject = no; });
    const animation = {
      kind, keyframes: frames, options, finished,
      cancelCalls: 0,
      resolve,
      reject: () => reject(new Error("animation rejected")),
      cancel() {
        this.cancelCalls++;
        if (fail === "cancel" && kind === "line") throw new Error("cancel failed");
        if (fail === "missing-finished") return; // partial WAAPI double exposes no completion promise
        reject(new Error("animation cancelled"));
      },
    };
    if (fail === "missing-finished") delete animation.finished;
    animations.push(animation);
    return animation;
  }
  const doc = {
    hidden, ...events(),
    createElementNS() {
      if (fail === "create") throw new Error("SVG unavailable");
      const line = {
        style: {},
        getTotalLength() { if (fail === "length") throw new Error("path unavailable"); return fail === "zero-length" ? 0 : 80; },
        animate: (frames, options) => animate("line", frames, options),
      };
      const area = { style: {}, animate: (frames, options) => animate("area", frames, options) };
      const attributes = new Map();
      const svg = {
        style: {}, line, area, parentNode: null, classList: { add() {} },
        animate() {},
        setAttribute: (name, value) => attributes.set(name, value),
        getAttribute: (name) => attributes.get(name),
        querySelector: (selector) => selector === ".stats-chart-line" ? line : area,
        remove() { if (fail === "remove") throw new Error("remove failed"); this.parentNode?.removeChild(this); this.removed = true; },
      };
      if (fail === "unsupported") delete svg.animate;
      svgs.push(svg);
      return svg;
    },
  };
  if (fail === "listener") doc.addEventListener = () => { throw new Error("listener failed"); };
  const win = {
    performance: { now: () => now },
    requestAnimationFrame(callback) {
      if (fail === "raf") throw new Error("rAF failed");
      frames.set(++nextId, callback);
      return nextId;
    },
    cancelAnimationFrame(id) { frames.delete(id); },
    matchMedia() { if (fail === "media") throw new Error("media unavailable"); return media; },
  };
  return {
    win, doc, media, canvas, plot, parent, svgs, animations,
    pending: () => frames.size,
    tick(delta = 16) {
      now += delta;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    },
    reduce() { media.matches = true; media.dispatch("change"); },
    hide() { doc.hidden = true; doc.dispatch("visibilitychange"); },
  };
}

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };

function expectClean(env) {
  assert.equal(env.canvas.style.opacity, "");
  assert.equal(env.parent.children.length, 0);
  assert.equal(env.pending(), 0);
  assert.equal(env.doc.listeners() + env.media.listeners(), 0);
}

test("chart path geometry keeps supplied points and baseline unchanged", () => {
  const plot = Object.freeze({ points: Object.freeze([Object.freeze({ x: 0, y: 10 }), Object.freeze({ x: 20, y: 30 })]), baseline: 50 });
  assert.deepEqual(chartPaths(plot), { line: "M0,10C10,10 10,30 20,30", area: "M0,10C10,10 10,30 20,30L20,50L0,50Z" });
  assert.deepEqual(chartPaths({ points: [{ x: 3, y: 4 }], baseline: 9 }), { line: "M3,4L3.1,4", area: "M3,4L3.1,4L3,9L3,9Z" });
  assert.equal(chartPaths({ points: [], baseline: 9 }), null);
});

test("trace uses existing geometry and the sample's separate line/area timing", async () => {
  const env = setup();
  const before = structuredClone(env.plot);
  drawStatsChart(env.canvas, env);
  assert.equal(env.canvas.style.opacity, "0");
  assert.equal(env.canvas.accessibleSummary, "existing summary");
  assert.deepEqual(env.plot, before);
  assert.equal(env.svgs[0].getAttribute("viewBox"), "0 0 100 100");
  assert.equal(env.svgs[0].getAttribute("aria-hidden"), "true");
  assert.ok(env.svgs[0].innerHTML.includes(chartPaths(env.plot).line));
  assert.ok(env.svgs[0].innerHTML.includes(chartPaths(env.plot).area));
  assert.deepEqual(env.animations[0].options, { duration: 900, easing: "cubic-bezier(.2,.8,.2,1)", fill: "both" });
  assert.deepEqual(env.animations[1].options, { duration: 600, delay: 350, easing: "ease", fill: "both" });
  env.animations[0].resolve();
  await flush();
  assert.equal(env.canvas.style.opacity, "0", "line completion must leave the area fade running");
  env.animations[1].resolve();
  await flush();
  expectClean(env);
});

test("explicit mid-animation cancellation restores canvas opacity and releases everything", async () => {
  const env = setup();
  env.canvas.style.opacity = "0.8";
  drawStatsChart(env.canvas, env);
  env.tick(200);
  cancelStatsChartDraw(env.canvas);
  await flush();
  assert.equal(env.canvas.style.opacity, "0.8");
  assert.equal(env.parent.children.length, 0);
  assert.equal(env.pending(), 0);
  assert.ok(env.animations.every((animation) => animation.cancelCalls === 1));
  assert.equal(env.doc.listeners() + env.media.listeners(), 0);
  cancelStatsChartDraw(env.canvas);
  assert.ok(env.animations.every((animation) => animation.cancelCalls === 1));
});

test("restarting removes the old trace and old promise callbacks cannot remove the new trace", async () => {
  const env = setup();
  drawStatsChart(env.canvas, env);
  const old = env.svgs[0];
  env.tick(100);
  drawStatsChart(env.canvas, env);
  await flush();
  assert.equal(old.parentNode, null);
  assert.equal(env.parent.children.length, 1);
  assert.equal(env.parent.children[0], env.svgs[1]);
  assert.equal(env.canvas.style.opacity, "0");
  assert.equal(env.pending(), 1);
  cancelStatsChartDraw(env.canvas);
  await flush();
  expectClean(env);
});

for (const options of [{ reduced: true }, { hidden: true }]) {
  test(`disabled motion leaves the existing canvas visible: ${JSON.stringify(options)}`, () => {
    const env = setup(options);
    drawStatsChart(env.canvas, env);
    assert.equal(env.svgs.length, 0);
    assert.equal(env.animations.length, 0);
    expectClean(env);
  });
}

for (const change of ["reduce", "hide"]) {
  test(`live ${change} cleans up the trace before another frame`, async () => {
    const env = setup();
    drawStatsChart(env.canvas, env);
    env.tick(100);
    env[change]();
    expectClean(env);
    await flush();
    expectClean(env);
  });
}

for (const fail of ["unsupported", "create", "append", "length", "zero-length", "media", "listener", "line-animate", "area-animate", "missing-finished", "raf"]) {
  test(`setup failure falls back to the visible canvas without pending work: ${fail}`, async () => {
    const env = setup({ fail });
    assert.doesNotThrow(() => drawStatsChart(env.canvas, env));
    await flush();
    expectClean(env);
  });
}

for (const kind of ["line", "area"]) {
  test(`a ${kind} animation rejection restores the canvas and cancels both animations`, async () => {
    const env = setup();
    drawStatsChart(env.canvas, env);
    env.animations.find((animation) => animation.kind === kind).reject();
    await flush();
    expectClean(env);
    assert.ok(env.animations.every((animation) => animation.cancelCalls === 1));
  });
}

test("one throwing animation cancel cannot prevent the remaining cleanup", async () => {
  const env = setup({ fail: "cancel" });
  drawStatsChart(env.canvas, env);
  assert.doesNotThrow(() => cancelStatsChartDraw(env.canvas));
  await flush();
  expectClean(env);
  assert.ok(env.animations.every((animation) => animation.cancelCalls === 1));
});

test("SVG remove failure still removes the overlay via its parent", async () => {
  const env = setup({ fail: "remove" });
  drawStatsChart(env.canvas, env);
  cancelStatsChartDraw(env.canvas);
  await flush();
  expectClean(env);
});

test("missing completion notifications cannot leave the canvas hidden beyond the effect duration", async () => {
  const env = setup();
  drawStatsChart(env.canvas, env);
  env.tick(949);
  assert.equal(env.canvas.style.opacity, "0");
  env.tick(1);
  await flush();
  expectClean(env);
});

test("a detached canvas terminates its trace and monitor", async () => {
  const env = setup();
  drawStatsChart(env.canvas, env);
  env.canvas.isConnected = false;
  env.tick();
  await flush();
  expectClean(env);
});

test("legacy media-query listeners still stop the trace and are removed", async () => {
  const env = setup({ legacyMedia: true });
  drawStatsChart(env.canvas, env);
  env.reduce();
  await flush();
  expectClean(env);
});

test("cancellation does not overwrite opacity adopted by a newer renderer", async () => {
  const env = setup();
  drawStatsChart(env.canvas, env);
  env.canvas.style.opacity = "0.4";
  cancelStatsChartDraw(env.canvas);
  await flush();
  assert.equal(env.canvas.style.opacity, "0.4");
  assert.equal(env.parent.children.length, 0);
  assert.equal(env.pending(), 0);
});
