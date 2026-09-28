import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import * as actualMotion from "../src/lib/motion.js";

// Exercise the production helpers and motion scheduler together. The small
// DOM records the visible strip position, rather than trusting aria-label or
// the renderer cache: those can be correct while the screen still says zero.
class Node {
  constructor(tag = "span", text = "") {
    this.tagName = tag.toUpperCase();
    this.nodeType = tag === "#text" ? 3 : 1;
    this.data = text;
    this.childNodes = [];
    this.dataset = {};
    this.style = {};
    this.attributes = new Map();
  }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get nextElementSibling() {
    const siblings = this.parentNode?.children || [];
    return siblings[siblings.indexOf(this) + 1] || null;
  }
  get textContent() { return this.data + this.childNodes.map((node) => node.textContent).join(""); }
  set textContent(text) { this.replaceChildren(); this.data = String(text); }
  appendChild(node) { node.parentNode = this; this.childNodes.push(node); return node; }
  replaceChildren(...nodes) {
    this.childNodes.forEach((node) => { node.parentNode = null; });
    this.childNodes = [];
    this.data = "";
    nodes.forEach((node) => this.appendChild(node));
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  removeAttribute(name) { this.attributes.delete(name); }
  querySelectorAll(selector) {
    assert.equal(selector, "[data-mo-digit]");
    return this.children.flatMap((node) => [
      ...(node.dataset.moDigit ? [node] : []), ...node.querySelectorAll(selector),
    ]);
  }
}

function eventTarget() {
  const handlers = new Map();
  return {
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(handler);
    },
    dispatch(type) { handlers.get(type)?.forEach((handler) => handler()); },
  };
}

function setup({ hidden = false, reduced = false } = {}) {
  let now = 0;
  let nextId = 0;
  const frames = new Map();
  const media = { matches: reduced, ...eventTarget() };
  const doc = {
    hidden, ...eventTarget(),
    createElement: (tag) => new Node(tag),
    createTextNode: (text) => new Node("#text", text),
  };
  const win = {
    performance: { now: () => now },
    requestAnimationFrame(callback) { frames.set(++nextId, callback); return nextId; },
    cancelAnimationFrame(id) { frames.delete(id); },
    matchMedia: () => media,
  };
  globalThis.document = doc;
  const motion = {
    ...actualMotion,
    crossfade: (element, swap) => actualMotion.crossfade(element, swap, { win, doc }),
    updateRollingNumber: (element, text, options) => actualMotion.updateRollingNumber(element, text, { ...options, win, doc }),
  };
  const source = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const helpers = source.slice(source.indexOf("function setPlainNumberWithUnit("), source.indexOf("function aggregateRevenueByItem("));
  const context = vm.createContext({ document: doc, motion });
  vm.runInContext(helpers, context);
  const element = new Node("strong");
  element.textContent = "0건";
  function tick(count = 1) {
    for (let i = 0; i < count; i += 1) {
      now += 16;
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback(now));
    }
  }
  function finish() {
    for (let i = 0; frames.size && i < 500; i += 1) tick();
    assert.equal(frames.size, 0, "all motion must finish");
  }
  return {
    element, tick, finish,
    render: (text, sameMetric) => context.renderNumberWithUnit(element, text, { sameMetric }),
    plain: (text) => context.renderNumberWithUnit(element, text),
    rolling: (text) => motion.updateRollingNumber(element, text),
    hide() { doc.hidden = true; doc.dispatch("visibilitychange"); },
    reduce() { media.matches = true; media.dispatch("change"); },
  };
}

function visibleText(node) {
  if (node.style.visibility === "hidden") return "";
  if (node.dataset.moDigit) {
    const transform = node.firstElementChild.style.transform;
    const match = transform?.match(/translateY\(([-\d.]+)%\)/);
    assert.ok(match, "digit strip has a rendered position");
    return String(Math.round(-Number(match[1]) / 10));
  }
  return node.data + node.childNodes.map(visibleText).join("");
}

function expectNumber(env, expected) {
  env.finish();
  assert.equal(visibleText(env.element), expected, "visible number");
  assert.equal(env.element.getAttribute("aria-label"), expected, "accessible number");
  assert.equal(Number(env.element.style.opacity || 1), 1, "number remains visible");
}

for (const [initial, actual] of [["0건", "690건"], ["0일", "2일"]]) {
  test(`initial ${initial} fade cannot overwrite loaded ${actual}`, () => {
    const env = setup();
    env.element.textContent = initial;
    env.render(initial, false);
    env.tick(2);
    env.render(actual, true);
    env.finish();
    env.render(actual, true);
    expectNumber(env, actual);
  });
}

test("rapid same-period updates display the latest count", () => {
  const env = setup();
  env.render("680건", true);
  env.render("690건", true);
  env.tick(3);
  env.render("745건", true);
  env.render("752건", true);
  expectNumber(env, "752건");
});

test("period A to B to A ignores obsolete crossfade swaps", () => {
  const env = setup();
  env.render("690건", false);
  env.tick(2);
  env.render("120건", false);
  env.tick(2);
  env.render("690건", false);
  expectNumber(env, "690건");
  env.render("690건", true);
  expectNumber(env, "690건");
});

test("plain replacement is repaired even when the rolling value cache matches", () => {
  const env = setup();
  env.rolling("690건");
  env.plain("0건");
  env.rolling("690건");
  expectNumber(env, "690건");
});

test("replacing a running digit strip does not leave old springs active", () => {
  const env = setup();
  env.rolling("690건");
  env.rolling("745건");
  env.tick(2);
  const detachedStrips = env.element.querySelectorAll("[data-mo-digit]").map((digit) => digit.firstElementChild);
  const detachedPositions = detachedStrips.map((strip) => strip.style.transform);
  env.plain("0건");
  env.rolling("745건");
  expectNumber(env, "745건");
  assert.deepEqual(detachedStrips.map((strip) => strip.style.transform), detachedPositions,
    "discarded digit strips must stop animating after rebuilding");
});

test("matching digits with changed unit rebuild the displayed unit", () => {
  const env = setup();
  env.rolling("30원");
  env.rolling("30만원");
  expectNumber(env, "30만원");
  env.rolling("30원");
  expectNumber(env, "30원");
});

for (const [before, after] of [["600,085원", "6,600,085원"], ["6,600,085원", "600,085원"]]) {
  test(`revenue roll-in rebuilds all digits when shape changes: ${before} to ${after}`, () => {
    const env = setup();
    env.element.__moRollIn = true;
    env.render(before, false);
    expectNumber(env, before);
    // Both values start with 6. After rebuilding the new layout from zeros,
    // comparing against the old layout would skip that unchanged leading 6.
    env.render(after, false);
    expectNumber(env, after);
  });
}

for (const options of [{ hidden: true }, { reduced: true }]) {
  test(`disabled motion renders latest value immediately: ${JSON.stringify(options)}`, () => {
    const env = setup(options);
    env.render("0건", false);
    env.render("690건", true);
    expectNumber(env, "690건");
  });
}

for (const change of ["hide", "reduce"]) {
  test(`${change} during a rapid update settles the latest value`, () => {
    const env = setup();
    env.render("0일", false);
    env.tick(2);
    env.render("2일", true);
    env[change]();
    expectNumber(env, "2일");
  });
}
