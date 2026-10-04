import assert from "node:assert/strict";
import test from "node:test";
import { createViewMotion } from "../src/lib/view-motion.js";

function fixture() {
  const calls = [], handlers = new Map(), prepared = [], cardEntries = [];
  let cardDestroyed = false;
  const doc = {
    addEventListener: (type, fn) => handlers.set(type, fn),
    removeEventListener: (type, fn) => { if (handlers.get(type) === fn) handlers.delete(type); },
  };
  const enter = (node, options) => {
    const effect = { node, options, canceled: false };
    calls.push(effect);
    return () => { effect.canceled = true; };
  };
  const cards = { prepare: nodes => prepared.push(nodes), enter: nodes => cardEntries.push(nodes), destroy: () => { cardDestroyed = true; } };
  const controller = createViewMotion({ doc, enter, cards });
  const view = name => {
    const header = { name: `${name}-header` }, main = { name: `${name}-main` };
    const nodes = ["home", "measurement", "settings", "stats"].includes(name) ? [{ name: `${name}-card` }] : [];
    return { name, header, main, nodes,
      querySelector: selector => selector.includes("header") ? header : main,
      querySelectorAll: () => nodes,
      matches: selector => selector.includes(`.view-${name}`),
    };
  };
  return { calls, controller, handlers, prepared, cardEntries, view, get cardDestroyed() { return cardDestroyed; } };
}

test("screens share entry roles; a rapid tab switch cancels the previous screen immediately", () => {
  const f = fixture(), home = f.view("home"), measurement = f.view("measurement");
  f.controller.show(home, null);
  assert.equal(f.calls.length, 1, "cards must not also receive a parent transform");
  f.controller.show(measurement, home);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].canceled);
  assert.deepEqual(f.prepared, [home.nodes, measurement.nodes]);
  assert.deepEqual(f.cardEntries, [home.nodes, measurement.nodes]);
  // Re-rendering the same screen cannot replay its entry or interrupt inputs.
  f.controller.show(measurement, measurement);
  assert.equal(f.calls.length, 2);
});

test("a screen without reveal cards uses the same element entry for its header and content", () => {
  const f = fixture();
  f.controller.show(f.view("expenses"), null);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls[0].options.distance < f.calls[1].options.distance, "the header leads gently while content uses the same entry runner");
});

test("the home summary card never moves with its parent header", () => {
  const f = fixture(), home = f.view("home"), heading = {};
  home.header.querySelector = () => heading;
  f.controller.show(home, null);
  assert.equal(f.calls[0].node, heading);
  assert.ok(!f.calls.some(effect => effect.node === home.header || effect.node === home.main));
  assert.deepEqual(f.cardEntries, [home.nodes]);
});

test("stats cards, map positioning and chat scrolling do not also receive a parent transform", () => {
  const f = fixture();
  for (const name of ["stats", "routes", "noah"]) {
    const view = f.view(name);
    f.controller.show(view, null);
    assert.equal(f.calls.at(-1).node, view.header);
    assert.ok(!f.calls.some(effect => effect.node === view.main));
  }
  assert.equal(f.calls.length, 3);
});

test("each dialog uses the same entry and closes or reopens without leaving a hidden card", () => {
  const f = fixture(), card = {}, layer = { querySelector: () => card };
  f.controller.modal(layer, true);
  f.controller.modal(layer, true);
  assert.equal(f.calls.length, 1, "an already-open dialog cannot flash on a repeated render");
  f.controller.modal(layer, false);
  assert.ok(f.calls[0].canceled);
  f.controller.modal(layer, true);
  assert.equal(f.calls.length, 2);
});

test("settings disclosures animate content only; closing restores it and unrelated toggles are ignored", () => {
  const f = fixture(), content = {};
  const details = { open: true, isConnected: true, matches: () => true, querySelector: () => content };
  const toggle = f.handlers.get("toggle");
  toggle({ target: details });
  assert.equal(f.calls[0].node, content);
  assert.equal(f.calls[0].options.distance, 16);
  details.open = false;
  toggle({ target: details });
  assert.ok(f.calls[0].canceled);
  toggle({ target: { matches: () => false, open: true } });
  assert.equal(f.calls.length, 1);
});

test("destroy cancels every role, disconnects cards and stops future entry work", () => {
  const f = fixture(), view = f.view("settings");
  f.controller.show(view, null);
  f.controller.modal({ querySelector: () => ({}) }, true);
  f.controller.destroy();
  assert.ok(f.calls.every(effect => effect.canceled));
  assert.ok(f.cardDestroyed);
  assert.equal(f.handlers.size, 0);
  f.controller.show(view, null);
  assert.equal(f.calls.length, 2);
});
