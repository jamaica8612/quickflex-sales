import assert from "node:assert/strict";
import test from "node:test";
import { createStatsCardMotion } from "../src/lib/stats-card-motion.js";

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
      observed.push({ card, pendingAtObserve: card.classList.contains("stats-card-pending") });
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
      id, hidden: false, classList: classes,
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
    motion: createStatsCardMotion({ win, doc }),
    get observer() { return observers[0] ?? null; },
  };
}

const visibleRect = { top: 80, bottom: 360, width: 320, height: 280 };
const zeroRect = { top: 0, bottom: 0, width: 0, height: 0 };
const pending = card => card.classList.contains("stats-card-pending");
const entering = card => card.classList.contains("stats-card-entering");

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

test("only the card's stats-card-rise animation end or cancel finishes entering", () => {
  const f = setup();
  const card = f.card("motion"), child = { parentNode: card };
  f.motion.prepare([card]);
  f.observer.enter(card);
  card.dispatch("transitionend", { target: card, propertyName: "opacity" });
  card.dispatch("animationend", { target: child, animationName: "stats-card-rise" });
  card.dispatch("animationend", { target: card, animationName: "other-animation" });
  assert.equal(entering(card), true);
  card.dispatch("animationend", { target: card, animationName: "stats-card-rise" });
  assert.equal(entering(card), false);

  f.motion.prepare([card]);
  const second = f.card("cancel");
  f.motion.prepare([second]);
  f.observer.enter(second);
  second.dispatch("animationcancel", { target: second, animationName: "stats-card-rise" });
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
