import assert from "node:assert/strict";
import test from "node:test";
import {
  DURATION,
  SPRING,
  MAX_CONCURRENT_SPRINGS,
  stepSpring,
  springSettled,
  animateSpring,
  createAnimationGroup,
  shouldAnimate,
  edgeSpringConfig,
  tokenizeDigits,
  digitSlotsCompatible,
  diffDigitSlots,
  splitTrailingUnit,
  flipDelta,
  flipDeltaSignificant,
  shouldDismissDrag,
  shakeOffset,
} from "../src/lib/motion.js";

// ---------------------------------------------------------------------------
// Fake rAF environment for testing the DOM-facing runners without a browser.
// Each test builds its own fake `window`, which gives it an isolated
// scheduler (motion.js keys one scheduler per real `window` object), so
// tests never bleed into each other.
// ---------------------------------------------------------------------------

// A minimal addEventListener/dispatch pair, just enough to test the
// scheduler's live matchMedia "change" and document "visibilitychange"
// listeners without a real browser.
function createFakeEventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatch(type) {
      listeners.get(type)?.forEach((handler) => handler());
    },
  };
}

function createFakeClock({ reducedMotion = false, hidden = false } = {}) {
  let now = 0;
  let queue = [];
  let nextId = 1;
  const mediaQuery = { matches: reducedMotion, ...createFakeEventTarget() };
  const win = {
    performance: { now: () => now },
    requestAnimationFrame(cb) {
      const id = nextId++;
      queue.push({ id, cb });
      return id;
    },
    cancelAnimationFrame(id) {
      queue = queue.filter((entry) => entry.id !== id);
    },
    matchMedia: (query) => (query.includes("reduce") ? mediaQuery : { matches: false }),
  };
  const doc = { hidden, ...createFakeEventTarget() };
  function tick(deltaMs = 16) {
    now += deltaMs;
    const due = queue;
    queue = [];
    due.forEach(({ cb }) => cb(now));
  }
  function frames(count, deltaMs = 16) {
    for (let i = 0; i < count; i += 1) tick(deltaMs);
  }
  function triggerReducedMotionChange(matches) {
    mediaQuery.matches = matches;
    mediaQuery.dispatch("change");
  }
  function triggerVisibilityChange(isHidden) {
    doc.hidden = isHidden;
    doc.dispatch("visibilitychange");
  }
  return {
    win, doc, tick, frames,
    pendingCount: () => queue.length,
    triggerReducedMotionChange,
    triggerVisibilityChange,
  };
}

// ---------------------------------------------------------------------------
// stepSpring / springSettled (pure integrator)
// ---------------------------------------------------------------------------

test("stepSpring converges to the target with the base preset", () => {
  let state = { x: 0, v: 0 };
  for (let i = 0; i < 400; i += 1) state = stepSpring(state, 100, SPRING, 1 / 60);
  assert.ok(Math.abs(state.x - 100) < 0.05, `expected settle near 100, got ${state.x}`);
  assert.ok(Math.abs(state.v) < 0.5, `expected near-zero velocity, got ${state.v}`);
});

test("stepSpring with the base preset has only a small overshoot", () => {
  let state = { x: 0, v: 0 };
  let maxX = 0;
  for (let i = 0; i < 400; i += 1) {
    state = stepSpring(state, 100, SPRING, 1 / 60);
    maxX = Math.max(maxX, state.x);
  }
  // damping ratio 0.86 should overshoot only slightly past the target.
  assert.ok(maxX < 108, `expected small overshoot, peaked at ${maxX}`);
  assert.ok(maxX >= 100, "a small overshoot is expected, not none at all");
});

test("stepSpring is a pure function: identical inputs give identical outputs", () => {
  const a = stepSpring({ x: 10, v: 2 }, 50, SPRING, 1 / 60);
  const b = stepSpring({ x: 10, v: 2 }, 50, SPRING, 1 / 60);
  assert.deepEqual(a, b);
});

test("springSettled recognizes a converged state and rejects a mid-flight one", () => {
  assert.equal(springSettled(99.999, 0.001, 100, 0), true);
  assert.equal(springSettled(50, 10, 100, 0), false);
});

// ---------------------------------------------------------------------------
// animateSpring: reduced motion, cancel, retarget
// ---------------------------------------------------------------------------

test("animateSpring jumps straight to the end state under prefers-reduced-motion", () => {
  const { win, doc } = createFakeClock({ reducedMotion: true });
  const updates = [];
  let done = false;
  const controller = animateSpring(0, 100, {
    win, doc,
    onUpdate: (v) => updates.push(v),
    onDone: () => { done = true; },
  });
  assert.deepEqual(updates, [100], "should update exactly once, with the final value");
  assert.equal(done, true);
  assert.equal(controller.isRunning(), false);
});

test("animateSpring jumps straight to the end state while document.hidden", () => {
  const { win, doc } = createFakeClock({ hidden: true });
  const updates = [];
  animateSpring(0, 50, { win, doc, onUpdate: (v) => updates.push(v) });
  assert.deepEqual(updates, [50]);
});

test("animateSpring settles at the target over simulated frames", () => {
  const { win, doc, frames } = createFakeClock();
  const updates = [];
  let done = false;
  animateSpring(0, 200, {
    win, doc,
    onUpdate: (v) => updates.push(v),
    onDone: () => { done = true; },
  });
  frames(120, 16);
  assert.equal(done, true, "spring should have settled within 120 frames");
  const last = updates.at(-1);
  assert.ok(Math.abs(last - 200) < 0.5, `expected final update near 200, got ${last}`);
});

test("cancel() stops further updates", () => {
  const { win, doc, frames } = createFakeClock();
  const updates = [];
  const controller = animateSpring(0, 200, { win, doc, onUpdate: (v) => updates.push(v) });
  frames(3);
  const countAtCancel = updates.length;
  controller.cancel();
  assert.equal(controller.isRunning(), false);
  frames(20);
  assert.equal(updates.length, countAtCancel, "no more updates should arrive after cancel");
});

test("retarget() redirects an in-flight spring without restarting from rest", () => {
  const { win, doc, frames } = createFakeClock();
  const updates = [];
  const controller = animateSpring(0, 100, { win, doc, onUpdate: (v) => updates.push(v) });
  frames(5); // let it build up some velocity toward 100
  const midFlightValue = updates.at(-1);
  assert.ok(midFlightValue > 0, "should have moved off the origin before retargeting");
  controller.retarget(30);
  frames(120);
  const last = updates.at(-1);
  assert.ok(Math.abs(last - 30) < 0.5, `expected to settle near the new target 30, got ${last}`);
});

test("createAnimationGroup cancels a running animation under the same key before starting a new one", () => {
  const { win, doc, frames } = createFakeClock();
  const group = createAnimationGroup();
  const firstUpdates = [];
  const secondUpdates = [];
  group.run("x", 0, 100, { win, doc, onUpdate: (v) => firstUpdates.push(v) });
  frames(3);
  assert.equal(group.isRunning("x"), true);
  group.run("x", firstUpdates.at(-1), -50, { win, doc, onUpdate: (v) => secondUpdates.push(v) });
  const firstCountAfterReplace = firstUpdates.length;
  frames(120);
  assert.equal(firstUpdates.length, firstCountAfterReplace, "the replaced animation must not keep emitting updates");
  assert.ok(Math.abs(secondUpdates.at(-1) - -50) < 0.5);
});

test("cancelAll stops every running animation in the group", () => {
  const { win, doc, frames } = createFakeClock();
  const group = createAnimationGroup();
  const a = [];
  const b = [];
  group.run("a", 0, 100, { win, doc, onUpdate: (v) => a.push(v) });
  group.run("b", 0, 100, { win, doc, onUpdate: (v) => b.push(v) });
  frames(3);
  group.cancelAll();
  const aCount = a.length;
  const bCount = b.length;
  frames(50);
  assert.equal(a.length, aCount);
  assert.equal(b.length, bCount);
});

// ---------------------------------------------------------------------------
// shouldAnimate
// ---------------------------------------------------------------------------

test("shouldAnimate is false with no rAF-capable window", () => {
  assert.equal(shouldAnimate({ win: undefined, doc: { hidden: false } }), false);
});

test("shouldAnimate is false while the document is hidden", () => {
  const { win } = createFakeClock();
  assert.equal(shouldAnimate({ win, doc: { hidden: true } }), false);
});

test("shouldAnimate is false under prefers-reduced-motion", () => {
  const { win, doc } = createFakeClock({ reducedMotion: true });
  assert.equal(shouldAnimate({ win, doc }), false);
});

test("shouldAnimate is true in an ordinary foreground, motion-allowed environment", () => {
  const { win, doc } = createFakeClock();
  assert.equal(shouldAnimate({ win, doc }), true);
});

// ---------------------------------------------------------------------------
// edgeSpringConfig
// ---------------------------------------------------------------------------

test("edgeSpringConfig swaps which edge leads based on direction", () => {
  const forward = edgeSpringConfig(true);
  const backward = edgeSpringConfig(false);
  assert.equal(forward.leading, backward.trailing);
  assert.equal(forward.trailing, backward.leading);
  assert.ok(forward.leading.stiffness > forward.trailing.stiffness, "leading edge should be stiffer");
});

// ---------------------------------------------------------------------------
// digit tokenizing / diffing (rolling numbers)
// ---------------------------------------------------------------------------

test("tokenizeDigits splits digits from static text", () => {
  assert.deepEqual(tokenizeDigits("1,234원"), [
    { type: "digit", value: "1" },
    { type: "text", value: "," },
    { type: "digit", value: "2" },
    { type: "digit", value: "3" },
    { type: "digit", value: "4" },
    { type: "text", value: "원" },
  ]);
});

test("digitSlotsCompatible accepts same shape and rejects different shape", () => {
  const a = tokenizeDigits("1,234원");
  const b = tokenizeDigits("1,239원");
  const c = tokenizeDigits("12,349원"); // different digit count
  const d = tokenizeDigits("1,234건"); // different static text
  assert.equal(digitSlotsCompatible(a, b), true);
  assert.equal(digitSlotsCompatible(a, c), false);
  assert.equal(digitSlotsCompatible(a, d), false);
  assert.equal(digitSlotsCompatible(null, a), false);
});

test("diffDigitSlots reports only the digit positions that changed", () => {
  const a = tokenizeDigits("1,234원");
  const b = tokenizeDigits("1,239원");
  const changed = diffDigitSlots(a, b);
  // Only the last digit (4 -> 9) differs; index 4 in the token array
  // (0:"1", 1:",", 2:"2", 3:"3", 4:"4").
  assert.deepEqual(changed, [4]);
});

test("diffDigitSlots finds nothing when values are identical", () => {
  const a = tokenizeDigits("27일");
  assert.deepEqual(diffDigitSlots(a, tokenizeDigits("27일")), []);
});

test("splitTrailingUnit separates the Korean unit suffix from the number", () => {
  assert.deepEqual(splitTrailingUnit("7,835,685원"), { number: "7,835,685", unit: "원" });
  assert.deepEqual(splitTrailingUnit("29.4만원"), { number: "29.4", unit: "만원" });
  assert.deepEqual(splitTrailingUnit("27일"), { number: "27", unit: "일" });
  assert.deepEqual(splitTrailingUnit("휴무"), { number: "휴무", unit: "" });
});

// ---------------------------------------------------------------------------
// FLIP delta
// ---------------------------------------------------------------------------

test("flipDelta computes the offset needed to visually keep the old position", () => {
  const first = { left: 10, top: 20, width: 30, height: 30 };
  const last = { left: 50, top: 20, width: 30, height: 30 };
  const delta = flipDelta(first, last);
  assert.equal(delta.dx, -40);
  assert.equal(delta.dy, 0);
  assert.equal(delta.sx, 1);
  assert.equal(delta.sy, 1);
});

test("flipDeltaSignificant ignores sub-pixel noise but flags a real move", () => {
  assert.equal(flipDeltaSignificant({ dx: 0.1, dy: -0.2, sx: 1, sy: 1 }), false);
  assert.equal(flipDeltaSignificant({ dx: 40, dy: 0, sx: 1, sy: 1 }), true);
});

// ---------------------------------------------------------------------------
// Drag-dismiss decision (bottom sheets)
// ---------------------------------------------------------------------------

test("shouldDismissDrag dismisses past the distance ratio", () => {
  assert.equal(shouldDismissDrag({ dragDistance: 200, panelSize: 500, velocity: 0 }), true); // 40% > 35%
  assert.equal(shouldDismissDrag({ dragDistance: 100, panelSize: 500, velocity: 0 }), false); // 20% < 35%
});

test("shouldDismissDrag dismisses on a fast downward flick regardless of distance", () => {
  assert.equal(shouldDismissDrag({ dragDistance: 20, panelSize: 500, velocity: 900 }), true);
});

test("shouldDismissDrag never dismisses for zero or negative drag distance", () => {
  assert.equal(shouldDismissDrag({ dragDistance: 0, panelSize: 500, velocity: 5000 }), false);
  assert.equal(shouldDismissDrag({ dragDistance: -10, panelSize: 500, velocity: 5000 }), false);
});

test("shouldDismissDrag respects a custom dismissRatio / flickVelocity", () => {
  assert.equal(shouldDismissDrag({ dragDistance: 60, panelSize: 100, velocity: 0, dismissRatio: 0.5 }), true);
  assert.equal(shouldDismissDrag({ dragDistance: 60, panelSize: 100, velocity: 0, dismissRatio: 0.7 }), false);
  assert.equal(shouldDismissDrag({ dragDistance: 10, panelSize: 100, velocity: 1200, flickVelocity: 2000 }), false);
});

// ---------------------------------------------------------------------------
// Shake offset (invalid input)
// ---------------------------------------------------------------------------

test("shakeOffset starts and ends at zero", () => {
  assert.equal(shakeOffset(0, { duration: 0.15 }), 0);
  assert.ok(Math.abs(shakeOffset(0.15, { duration: 0.15 })) < 1e-9);
});

test("shakeOffset peaks near the requested distance and oscillates both ways", () => {
  const duration = 0.15;
  const samples = [];
  for (let i = 0; i <= 30; i += 1) samples.push(shakeOffset((i / 30) * duration, { duration, distance: 6 }));
  const max = Math.max(...samples);
  const min = Math.min(...samples);
  assert.ok(max > 3 && max <= 6.01, `expected a positive peak near 6, got ${max}`);
  assert.ok(min < -3 && min >= -6.01, `expected a negative peak near -6, got ${min}`);
});

test("shakeOffset is a pure function of time", () => {
  const opts = { duration: 0.15, distance: 6, cycles: 2 };
  assert.equal(shakeOffset(0.05, opts), shakeOffset(0.05, opts));
});

test("DURATION exposes exactly the three agreed values", () => {
  assert.deepEqual(DURATION, { fast: 150, normal: 250, emphasis: 400 });
});

// ---------------------------------------------------------------------------
// Single shared scheduler: sleeps when idle, caps concurrency, and reacts
// live to reduced-motion / visibility changes.
// ---------------------------------------------------------------------------

test("the scheduler sleeps (no pending rAF) once every spring has settled", () => {
  const { win, doc, frames, pendingCount } = createFakeClock();
  animateSpring(0, 100, { win, doc, onUpdate() {} });
  frames(1);
  assert.ok(pendingCount() > 0, "should be ticking while a spring is active");
  frames(200); // let it fully settle
  assert.equal(pendingCount(), 0, "scheduler should stop requesting frames once idle");
});

test("a capacity overflow snaps the lowest-priority spring to its end instead of queuing indefinitely", () => {
  const { win, doc, frames } = createFakeClock();
  const results = [];
  // Fill the cap with distinct, increasing priorities (0..15).
  for (let i = 0; i < MAX_CONCURRENT_SPRINGS; i += 1) {
    animateSpring(0, 100, {
      win, doc, priority: i,
      onDone: () => results.push(`done-${i}`),
    });
  }
  frames(2); // nothing should have settled naturally yet
  assert.deepEqual(results, [], "none of the 16 springs should have finished this quickly on their own");
  // One more, higher priority than the lowest (0) already running: it must
  // evict priority 0 immediately rather than growing past the cap.
  let seventeenthUpdates = 0;
  animateSpring(0, 50, { win, doc, priority: 5, onUpdate: () => { seventeenthUpdates += 1; } });
  assert.deepEqual(results, ["done-0"], "the lowest-priority spring (0) must be snapped immediately to make room");
  frames(1); // admitted springs only report updates once the scheduler ticks
  assert.ok(seventeenthUpdates >= 1, "the new spring should have been admitted and started updating");
});

test("a new spring that cannot outrank anything already running is snapped immediately instead of admitted", () => {
  const { win, doc } = createFakeClock();
  for (let i = 0; i < MAX_CONCURRENT_SPRINGS; i += 1) {
    animateSpring(0, 100, { win, doc, priority: 10, onUpdate() {} });
  }
  let updates = 0;
  let done = false;
  const controller = animateSpring(0, 100, {
    win, doc, priority: 0,
    onUpdate: () => { updates += 1; },
    onDone: () => { done = true; },
  });
  assert.equal(updates, 1, "should receive exactly one update: the final value");
  assert.equal(done, true);
  assert.equal(controller.isRunning(), false);
});

test("a live prefers-reduced-motion change snaps every active spring to its target", () => {
  const { win, doc, frames, triggerReducedMotionChange } = createFakeClock();
  const a = [];
  const b = [];
  animateSpring(0, 100, { win, doc, onUpdate: (v) => a.push(v) });
  animateSpring(0, -40, { win, doc, onUpdate: (v) => b.push(v) });
  frames(3);
  assert.ok(a.length > 0 && b.length > 0, "both springs should be mid-flight");
  triggerReducedMotionChange(true);
  assert.equal(a.at(-1), 100, "spring a should have jumped straight to its target");
  assert.equal(b.at(-1), -40, "spring b should have jumped straight to its target");
  const countA = a.length;
  const countB = b.length;
  frames(50);
  assert.equal(a.length, countA, "no further updates once snapped");
  assert.equal(b.length, countB, "no further updates once snapped");
});

test("the document going hidden snaps every active spring to its target", () => {
  const { win, doc, frames, triggerVisibilityChange } = createFakeClock();
  const updates = [];
  let done = false;
  animateSpring(0, 200, { win, doc, onUpdate: (v) => updates.push(v), onDone: () => { done = true; } });
  frames(3);
  assert.equal(done, false);
  triggerVisibilityChange(true);
  assert.equal(updates.at(-1), 200);
  assert.equal(done, true);
});

test("retargeting through createAnimationGroup preserves the spring's current position (no reset to `from`)", () => {
  const { win, doc, frames } = createFakeClock();
  const group = createAnimationGroup();
  const updates = [];
  group.run("x", 0, 100, { win, doc, onUpdate: (v) => updates.push(v) });
  frames(5);
  const midFlight = updates.at(-1);
  assert.ok(midFlight > 0 && midFlight < 100, "should be mid-flight, not at either end");
  // Retarget with a stale/irrelevant `from` — the scheduler must ignore it
  // and continue from wherever the spring actually is.
  group.run("x", 999999, -20, { win, doc, onUpdate: (v) => updates.push(v) });
  const justAfterRetarget = updates.at(-1);
  assert.ok(Math.abs(justAfterRetarget - midFlight) < 5, "retargeting must not jump back to the stale `from` value");
  frames(120);
  assert.ok(Math.abs(updates.at(-1) - -20) < 0.5, "should settle at the new target");
});
