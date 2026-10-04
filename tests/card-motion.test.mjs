import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createCardMotion } from "../src/lib/card-motion.js";
import { ENTRY_MOTION, stepSpring } from "../src/lib/motion.js";

function events() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    dispatch(type, event = {}) { [...(listeners.get(type) || [])].forEach(callback => callback({ type, ...event })); },
    count() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}

function setup({ reduced = false, hidden = false, noObserver = false, observerThrows = false } = {}) {
  const media = { matches: reduced, ...events() };
  const doc = { hidden, activeElement: null, ...events() };
  const observed = [];
  const observers = [];
  class Observer {
    constructor(callback) {
      if (observerThrows) throw new Error("observer unavailable");
      this.callback = callback;
      this.targets = new Set();
      this.disconnected = false;
      observers.push(this);
    }
    observe(card) {
      this.targets.add(card);
      observed.push({ card, pendingAtObserve: card.classList.contains("ui-card-pending") });
    }
    unobserve(card) { this.targets.delete(card); }
    disconnect() { this.disconnected = true; this.targets.clear(); }
    enter(card, isIntersecting = true) {
      this.callback([{ target: card, isIntersecting }]);
    }
  }
  const win = { innerHeight: 1000, matchMedia: () => media };
  if (!noObserver) win.IntersectionObserver = Observer;
  doc.defaultView = win;

  function card(id, rect = { top: 1200, bottom: 1500, width: 300, height: 300 }) {
    const names = new Set();
    const listeners = events();
    const classes = {
      add: (...tokens) => tokens.forEach(token => names.add(token)),
      remove: (...tokens) => tokens.forEach(token => names.delete(token)),
      contains: token => names.has(token),
      toggle(token, force) {
        const add = force === undefined ? !names.has(token) : Boolean(force);
        if (add) names.add(token); else names.delete(token);
        return add;
      },
    };
    return {
      id, hidden: false, isConnected: true, classList: classes,
      getBoundingClientRect: () => ({ ...rect }),
      setRect(next) { rect = next; },
      addEventListener: listeners.addEventListener,
      removeEventListener: listeners.removeEventListener,
      dispatch: listeners.dispatch,
      listenerCount: listeners.count,
      contains(target) {
        for (let current = target; current; current = current.parentNode) if (current === this) return true;
        return false;
      },
    };
  }

  return {
    win, doc, media, observed, observers, card,
    motion: createCardMotion({ win, doc }),
    get observer() { return observers[0] ?? null; },
  };
}

const visibleRect = { top: 80, bottom: 360, width: 320, height: 280 };
const zeroRect = { top: 0, bottom: 0, width: 0, height: 0 };
const pending = card => card.classList.contains("ui-card-pending");
const entering = card => card.classList.contains("ui-card-entering");

test("display:contents never stages a boxless wrapper or hides its fixed actions", () => {
  const f = setup(), wrapper = f.card("mobile-day-wrapper", zeroRect);
  f.win.getComputedStyle = () => ({display: "contents"});
  f.motion.prepare([wrapper]);
  f.motion.enter([wrapper]);
  assert.equal(pending(wrapper) || entering(wrapper), false);
  assert.equal(f.observed.length, 0);
  assert.equal(wrapper.listenerCount(), 0);
});

test("prepare keeps initially visible cards settled and stages offscreen or zero-rect cards before observe", () => {
  const f = setup();
  const visible = f.card("visible", visibleRect);
  const offscreen = f.card("offscreen");
  const zero = f.card("zero", zeroRect);
  f.motion.prepare([visible, offscreen, zero]);
  assert.equal(pending(visible), false);
  assert.equal(entering(visible), false);
  assert.equal(pending(offscreen), true);
  assert.equal(pending(zero), true);
  assert.deepEqual(f.observed.map(item => [item.card.id, item.pendingAtObserve]), [["offscreen", true], ["zero", true]]);
});

test("observer entry swaps pending for entering and later entries cannot replay a seen card", () => {
  const f = setup();
  const card = f.card("card");
  f.motion.prepare([card]);
  f.observer.enter(card);
  assert.equal(pending(card), false);
  assert.equal(entering(card), true);
  assert.equal(f.observer.targets.has(card), false);
  f.observer.enter(card);
  assert.equal(entering(card), true);
});

test("hidden-tab zero-rect cards stage safely and enter only after foreground visibility", () => {
  const f = setup({ hidden: true });
  const card = f.card("hidden-zero", zeroRect);
  f.motion.prepare([card]);
  assert.equal(pending(card), true);
  assert.equal(f.observed.at(-1).pendingAtObserve, true);
  f.observer.enter(card);
  assert.equal(pending(card), true, "observer callbacks while hidden must not reveal the card");
  assert.equal(entering(card), false);
  f.doc.hidden = false;
  card.setRect(visibleRect);
  f.doc.dispatch("visibilitychange");
  assert.equal(pending(card), false);
  assert.equal(entering(card), true);
});

test("hiding settles only active entering cards and preserves unseen pending cards", () => {
  const f = setup();
  const active = f.card("active"), unseen = f.card("unseen");
  f.motion.prepare([active, unseen]);
  f.observer.enter(active);
  f.doc.hidden = true;
  f.doc.dispatch("visibilitychange");
  assert.equal(entering(active), false);
  assert.equal(pending(active), false);
  assert.equal(pending(unseen), true);
  f.doc.hidden = false;
  unseen.setRect(visibleRect);
  f.doc.dispatch("visibilitychange");
  assert.equal(pending(unseen), false);
  assert.equal(entering(unseen), true);
});

test("reduced motion starts settled and clears pending or entering state when enabled", () => {
  const reduced = setup({ reduced: true });
  const visible = reduced.card("visible", visibleRect), hidden = reduced.card("hidden");
  reduced.motion.prepare([visible, hidden]);
  assert.equal(pending(visible) || entering(visible), false);
  assert.equal(pending(hidden) || entering(hidden), false);

  const f = setup();
  const active = f.card("active"), unseen = f.card("unseen");
  f.motion.prepare([active, unseen]);
  f.observer.enter(active);
  f.media.matches = true;
  f.media.dispatch("change", { matches: true });
  assert.equal(pending(active) || entering(active), false);
  assert.equal(pending(unseen) || entering(unseen), false);
});

test("focus entering a card subtree immediately settles it and prevents later observer replay", () => {
  const f = setup();
  const card = f.card("focus"), child = { parentNode: card };
  f.motion.prepare([card]);
  f.doc.dispatch("focusin", { target: child });
  assert.equal(pending(card), false);
  assert.equal(entering(card), false);
  f.observer.enter(card);
  assert.equal(entering(card), false);
});

test("missing or throwing IntersectionObserver leaves every card in its final visible state", () => {
  for (const options of [{ noObserver: true }, { observerThrows: true }]) {
    const f = setup(options);
    const cards = [f.card("visible", visibleRect), f.card("offscreen")];
    f.motion.prepare(cards);
    for (const card of cards) {
      assert.equal(pending(card), false);
      assert.equal(entering(card), false);
    }
  }
});

test("only the card's ui-card-rise animation end or cancel finishes entering", () => {
  const f = setup();
  const card = f.card("motion"), child = { parentNode: card };
  f.motion.prepare([card]);
  f.observer.enter(card);
  card.dispatch("transitionend", { target: card, propertyName: "opacity" });
  card.dispatch("animationend", { target: child, animationName: "ui-card-rise" });
  card.dispatch("animationend", { target: card, animationName: "other-animation" });
  assert.equal(entering(card), true);
  card.dispatch("animationend", { target: card, animationName: "ui-card-rise" });
  assert.equal(entering(card), false);

  f.motion.prepare([card]);
  const second = f.card("cancel");
  f.motion.prepare([second]);
  f.observer.enter(second);
  second.dispatch("animationcancel", { target: second, animationName: "ui-card-rise" });
  assert.equal(entering(second), false);
});

test("prepare registers each card once and a later render never hides a visible card", () => {
  const f = setup();
  const first = f.card("first");
  f.motion.prepare([first]);
  assert.equal(f.observed.length, 1);
  first.setRect(visibleRect);
  f.observer.enter(first);
  const newlyVisible = f.card("new", visibleRect);
  f.motion.prepare([first, newlyVisible]);
  assert.equal(f.observed.filter(item => item.card === first).length, 1);
  assert.equal(pending(first), false);
  assert.equal(entering(first), true, "prepare must not restart or hide a card already entering");
  assert.equal(pending(newlyVisible), false);
  assert.equal(entering(newlyVisible), false);
});

test("destroy disconnects observers, removes listeners, and restores every card", () => {
  const f = setup();
  const active = f.card("active"), pendingCard = f.card("pending");
  f.motion.prepare([active, pendingCard]);
  f.observer.enter(active);
  f.motion.destroy();
  assert.equal(f.observer.disconnected, true);
  assert.equal(f.doc.count(), 0);
  assert.equal(f.media.count(), 0);
  assert.equal(active.listenerCount(), 0);
  assert.equal(pendingCard.listenerCount(), 0);
  for (const card of [active, pendingCard]) {
    assert.equal(pending(card), false);
    assert.equal(entering(card), false);
  }
});

test("prepare prunes detached pending and running cards including observer targets and listeners", () => {
  const f = setup();
  const active = f.card("active"), unseen = f.card("unseen"), keep = f.card("keep");
  f.motion.prepare([active, unseen, keep]);
  f.observer.enter(active);
  active.isConnected = false;
  unseen.isConnected = false;
  f.motion.prepare([keep]);
  assert.equal(active.listenerCount(), 0);
  assert.equal(unseen.listenerCount(), 0);
  assert.equal(f.observer.targets.has(active), false);
  assert.equal(f.observer.targets.has(unseen), false);
  assert.equal(f.observer.targets.has(keep), true);
  for (const card of [active, unseen]) {
    assert.equal(pending(card) || entering(card), false);
    f.observer.enter(card);
    assert.equal(pending(card) || entering(card), false, "stale observer entries must not revive a removed card");
  }
  f.doc.dispatch("focusin", { target: {parentNode: unseen} });
  active.isConnected = true;
  f.motion.prepare([active]);
  assert.equal(pending(active), true, "reconnected dynamic cards are registered as new cards");
  assert.equal(active.listenerCount(), 2);
  f.observer.enter(active);
  assert.equal(entering(active), true, "pruning also removed the old seen state");
});

test("prepare skips disconnected input and observer delivery prunes a newly detached card", () => {
  const f = setup();
  const detached = f.card("detached");
  detached.isConnected = false;
  f.motion.prepare([detached]);
  assert.equal(detached.listenerCount(), 0);
  assert.equal(pending(detached), false);
  const late = f.card("late");
  f.motion.prepare([late]);
  late.isConnected = false;
  f.observer.enter(late);
  assert.equal(late.listenerCount(), 0);
  assert.equal(pending(late) || entering(late), false);
  assert.equal(f.observer.targets.has(late), false);
});

test("native card and small-element entry curves share a spring, with a small overshoot and static fallbacks", () => {
  const css = readFileSync(new URL("../styles/motion.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /stats-driver-report|stats-card-/);
  assert.ok(css.includes(`--motion-card-distance:${ENTRY_MOTION.cardDistance}px`));
  assert.ok(css.includes(`--motion-entry-duration:${ENTRY_MOTION.durationMs}ms`));
  const frames = [...css.matchAll(/(\d+)%\{opacity:([\d.]+);transform:translateY\(([-\d.]+)px\)\}/g)];
  assert.equal(frames.length, 51);
  const offsets = frames.map(frame => Number(frame[3]));
  assert.ok(Math.min(...offsets) < -1 && Math.min(...offsets) > -3, "one visible soft rebound, without a large bounce");
  for (const [percent, opacity, offset] of frames.map(frame => frame.slice(1).map(Number))) {
    if (percent === 100) { assert.equal(offset, 0); assert.equal(opacity, 1); continue; }
    let state = {x: 0, v: 0};
    const seconds = ENTRY_MOTION.durationMs * percent / 100000;
    const steps = Math.ceil(seconds * 2400);
    for (let i = 0; i < steps; i++) state = stepSpring(state, 1, ENTRY_MOTION, seconds / steps);
    assert.ok(Math.abs(offset - ENTRY_MOTION.cardDistance * (1 - state.x)) < .15, `entry mismatch at ${percent}%`);
    assert.ok(Math.abs(opacity - Math.max(0, Math.min(1, state.x))) < .004, "fade and travel must use the same progress");
  }
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /@media print/);
});

test("explicit navigation enters prepared visible cards directly and prepare remains refresh-only", () => {
  const f = setup();
  const card = f.card("visible", visibleRect);
  const mutations = [];
  const add = card.classList.add;
  card.classList.add = (...tokens) => { mutations.push(...tokens); add(...tokens); };
  f.motion.prepare([card]);
  assert.equal(pending(card) || entering(card), false);
  f.motion.enter([card]);
  assert.equal(pending(card), false);
  assert.equal(entering(card), true);
  assert.equal(mutations.includes("ui-card-pending"), false, "visible cards never receive hidden staging");
  const firstEntries = mutations.filter(name => name === "ui-card-entering").length;
  f.motion.enter([card]);
  assert.equal(mutations.filter(name => name === "ui-card-entering").length, firstEntries, "a running spring cannot restart");
  card.dispatch("animationend", {target:card,animationName:"ui-card-rise"});
  f.motion.prepare([card]);
  assert.equal(entering(card),false,"refresh leaves a completed visible card settled");
  f.motion.enter([card]);
  assert.equal(entering(card),true,"a later explicit navigation can enter it again");
});

test("navigation enters newly visible pending cards but preserves offscreen pending state", () => {
  const f=setup();
  const shown=f.card("shown"), offscreen=f.card("offscreen");
  f.motion.prepare([shown,offscreen]);
  shown.setRect(visibleRect);
  f.motion.enter([shown,offscreen]);
  assert.equal(entering(shown),true);
  assert.equal(pending(shown),false);
  assert.equal(f.observer.targets.has(shown),false);
  assert.equal(pending(offscreen),true);
  assert.equal(entering(offscreen),false);
  assert.equal(f.observer.targets.has(offscreen),true);
});

test("navigation skips hidden, disconnected, focused and unprepared cards and honors static environments", () => {
  for (const options of [{reduced:true},{noObserver:true},{observerThrows:true}]) {
    const f=setup(options), card=f.card("static",visibleRect);
    f.motion.prepare([card]);
    f.motion.enter([card]);
    assert.equal(pending(card)||entering(card),false);
  }
  const f=setup(), card=f.card("hidden"), unseen=f.card("unseen"), unknown=f.card("unknown",visibleRect);
  f.motion.prepare([card,unseen]);
  card.setRect(visibleRect);
  f.doc.hidden=true;
  f.motion.enter([card,unseen,unknown]);
  assert.equal(pending(card),true,"hidden documents preserve an unseen card for later entry");
  assert.equal(entering(unknown),false,"unprepared elements are not silently registered");
  f.doc.hidden=false;
  card.hidden=true;
  f.motion.enter([card]);
  assert.equal(entering(card),false);
  card.hidden=false;
  f.doc.activeElement={parentNode:card};
  f.motion.enter([card]);
  assert.equal(pending(card)||entering(card),false,"focused inputs remain stable");
  f.doc.activeElement=null;
  card.isConnected=false;
  f.motion.enter([card]);
  assert.equal(card.listenerCount(),0);
  assert.equal(pending(card)||entering(card),false);
  f.motion.destroy();
  f.motion.enter([unknown]);
  assert.equal(entering(unknown),false);
});
