// Shared motion system for the QuickFlex PWA ("플렉스노트").
//
// One spring, three durations, applied consistently everywhere a screen
// reacts to a user action or a real data change. This module has two layers:
//
//  1. Pure helpers (no DOM): the spring integrator, digit-roll diffing,
//     FLIP delta math, drag-dismiss decisions, text tokenizing. These are
//     unit tested directly (see tests/motion.test.mjs) without a browser.
//  2. Thin DOM runners built on top of the pure helpers: animateSpring (a
//     cancelable rAF loop), createAnimationGroup (cancel-and-replace by
//     key), shake, and small conveniences used by src/main.js and
//     src/ui/*.js to wire up each effect.
//
// Rules every caller follows (see AGENTS.md / the motion task for the full
// list): only animate transform/opacity (and SVG stroke-dashoffset / path
// `d`); never blur/filter/box-shadow; respect `prefers-reduced-motion`;
// skip work while `document.hidden`; a new action cancels/retargets a
// running animation instead of queuing behind it; nothing loops forever
// except a loader while a save is actually in flight.

// ---------------------------------------------------------------------------
// Durations & spring presets
// ---------------------------------------------------------------------------

export const DURATION = Object.freeze({ fast: 150, normal: 250, emphasis: 400 });

// Base preset used almost everywhere: a very small overshoot.
export const SPRING = Object.freeze({ stiffness: 520, damping: 0.86 });
// Two-edge "stretch": the leading edge arrives first (stiff), the trailing
// edge lags briefly (soft) before catching up. Used by the tab indicator and
// switch knob.
export const SPRING_LEADING = Object.freeze({ stiffness: 900, damping: 0.9 });
export const SPRING_TRAILING = Object.freeze({ stiffness: 380, damping: 0.84 });
// Critically damped (damping ratio 1): no overshoot, used for fades.
export const SPRING_FADE = Object.freeze({ stiffness: 600, damping: 1 });

// ---------------------------------------------------------------------------
// Environment checks
// ---------------------------------------------------------------------------

function safeMatchMedia(win, query) {
  try {
    return win?.matchMedia ? win.matchMedia(query) : null;
  } catch {
    return null;
  }
}

export function prefersReducedMotion(win = typeof window !== "undefined" ? window : undefined) {
  return Boolean(safeMatchMedia(win, "(prefers-reduced-motion: reduce)")?.matches);
}

/**
 * Should an animation actually run right now? When false, the caller must
 * jump straight to the end state (reduced motion, backgrounded tab, or no
 * usable rAF in this environment).
 */
export function shouldAnimate({
  win = typeof window !== "undefined" ? window : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
} = {}) {
  if (doc && doc.hidden) return false;
  if (prefersReducedMotion(win)) return false;
  return Boolean(win && typeof win.requestAnimationFrame === "function");
}

// ---------------------------------------------------------------------------
// Pure spring integrator
// ---------------------------------------------------------------------------

const SETTLE_POSITION_EPS = 0.0025;
const SETTLE_VELOCITY_EPS = 0.02;
const MAX_FRAME_DT = 0.064; // clamp long pauses (tab switches) to keep the integration stable
const SUBSTEP = 1 / 240;

/**
 * Advance one damped-spring state {x, v} by `dt` seconds toward `target`,
 * using fixed sub-steps so the result is independent of the caller's own
 * frame rate. Pure function: same inputs always produce the same output.
 */
export function stepSpring(state, target, { stiffness = SPRING.stiffness, damping = SPRING.damping } = {}, dt) {
  let { x, v } = state;
  const c = 2 * damping * Math.sqrt(stiffness);
  let remaining = Math.min(Math.max(dt, 0), MAX_FRAME_DT);
  while (remaining > 0) {
    const h = Math.min(remaining, SUBSTEP);
    const a = -stiffness * (x - target) - c * v;
    v += a * h;
    x += v * h;
    remaining -= h;
  }
  return { x, v };
}

/** Has the spring settled close enough to `target` to snap and stop? */
export function springSettled(x, v, target, from = target) {
  const scale = Math.max(1, Math.abs(target - from));
  return Math.abs(x - target) < SETTLE_POSITION_EPS * scale && Math.abs(v) < SETTLE_VELOCITY_EPS * scale;
}

// ---------------------------------------------------------------------------
// Single shared rAF scheduler
// ---------------------------------------------------------------------------
//
// Exactly one ticking loop per `window`, no matter how many springs are
// running. It sleeps (no rAF requested) whenever nothing is active, retargets
// in place when the same key is reused (keeping the current x and v so a new
// action never fights or resets an old one), caps concurrent springs so a
// burst of updates (e.g. a whole list re-animating at once) can't pile up
// unboundedly, and snaps every active spring straight to its target the
// moment the tab is hidden or the OS switches on reduced motion mid-flight.

export const MAX_CONCURRENT_SPRINGS = 16;
const MOTION_DEBUG_KEY = "quickflexMotionDebug";

function createScheduler() {
  const entries = new Map();
  let nextId = 1;
  let rafId = 0;
  let boundWin = null;
  let listenersBound = false;

  function bindGlobals(win, doc) {
    if (listenersBound) return;
    listenersBound = true;
    boundWin = win;
    try {
      const mq = win?.matchMedia?.("(prefers-reduced-motion: reduce)");
      const onChange = () => { if (mq?.matches) snapAll(); };
      if (mq?.addEventListener) mq.addEventListener("change", onChange);
      else if (mq?.addListener) mq.addListener(onChange); // older Safari
    } catch {
      // matchMedia unavailable in this environment; reduced-motion changes
      // simply won't be observed live, which is fine outside a browser.
    }
    try {
      doc?.addEventListener?.("visibilitychange", () => { if (doc.hidden) snapAll(); });
    } catch {
      // no-op: doc without addEventListener (e.g. a minimal test double).
    }
    setupDebugObserver(win);
  }

  function stopTicking() {
    if (rafId) boundWin?.cancelAnimationFrame?.(rafId);
    rafId = 0;
  }

  function ensureTicking() {
    if (rafId || !boundWin || entries.size === 0) return;
    rafId = boundWin.requestAnimationFrame(tick);
  }

  function settle(id, entry) {
    entries.delete(id);
    entry.onUpdate?.(entry.target);
    entry.onDone?.();
  }

  /** Snap every active spring to its end value immediately and go to sleep. */
  function snapAll() {
    stopTicking();
    const pending = [...entries.entries()];
    entries.clear();
    pending.forEach(([, entry]) => {
      entry.onUpdate?.(entry.target);
      entry.onDone?.();
    });
  }

  function tick(now) {
    rafId = 0;
    entries.forEach((entry, id) => {
      const dt = (now - entry.last) / 1000;
      entry.last = now;
      const next = stepSpring({ x: entry.x, v: entry.v }, entry.target, entry, dt);
      entry.x = next.x;
      entry.v = next.v;
      if (springSettled(entry.x, entry.v, entry.target, entry.origin)) settle(id, entry);
      else entry.onUpdate?.(entry.x);
    });
    ensureTicking();
  }

  /** Evicts the single lowest-priority entry if `priority` can outrank it. Returns true if room was made. */
  function evictForCapacity(priority) {
    let evictId = null;
    let evictEntry = null;
    entries.forEach((entry, id) => {
      if (!evictEntry || entry.priority < evictEntry.priority) {
        evictEntry = entry;
        evictId = id;
      }
    });
    if (!evictEntry || evictEntry.priority > priority) return false;
    settle(evictId, evictEntry);
    return true;
  }

  function add(entry, { win, doc }) {
    bindGlobals(win, doc);
    if (entries.size >= MAX_CONCURRENT_SPRINGS && !evictForCapacity(entry.priority)) {
      // Every existing spring outranks this new one: snap the new one
      // immediately instead of letting the pile grow past the cap.
      entry.onUpdate?.(entry.target);
      entry.onDone?.();
      return null;
    }
    const id = nextId++;
    entries.set(id, entry);
    ensureTicking();
    return id;
  }

  function cancel(id) {
    entries.delete(id);
  }

  function retarget(id, newTarget, callbacks = {}) {
    const entry = entries.get(id);
    if (!entry) return false;
    entry.origin = entry.x; // keep current x and v; only the destination changes
    entry.target = newTarget;
    if (callbacks.onUpdate) entry.onUpdate = callbacks.onUpdate;
    if (callbacks.onDone) entry.onDone = callbacks.onDone;
    return true;
  }

  function has(id) {
    return entries.has(id);
  }

  return { add, cancel, retarget, has, snapAll, size: () => entries.size };
}

function setupDebugObserver(win) {
  try {
    if (!win?.localStorage?.getItem?.(MOTION_DEBUG_KEY)) return;
    if (typeof win.PerformanceObserver !== "function") return;
    const observer = new win.PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration > 50) {
          // eslint-disable-next-line no-console
          console.warn(`[motion] long animation frame: ${entry.duration.toFixed(1)}ms`, entry);
        }
      }
    });
    observer.observe({ type: "long-animation-frame", buffered: true });
  } catch {
    // "long-animation-frame" isn't supported in every browser; that's fine,
    // this is an opt-in diagnostic, not required for the motion system to work.
  }
}

// One scheduler per real `window` (i.e. exactly one in production; tests
// that pass their own fake `win` each get an isolated scheduler so tests
// never bleed into each other).
const schedulersByWindow = new WeakMap();
function getScheduler(win) {
  let scheduler = schedulersByWindow.get(win);
  if (!scheduler) {
    scheduler = createScheduler();
    schedulersByWindow.set(win, scheduler);
  }
  return scheduler;
}

// ---------------------------------------------------------------------------
// rAF-driven spring runner with cancel + retarget
// ---------------------------------------------------------------------------

/**
 * Drives a spring from `from` to `to` on the shared scheduler. Returns a
 * controller `{ cancel(), retarget(newTo), isRunning() }`. If animation
 * shouldn't run (reduced motion, hidden tab, no rAF), it calls onUpdate(to)
 * + onDone() synchronously and returns no-op controls. `priority` (default
 * 0) decides which spring gets snapped first if too many run at once.
 */
export function animateSpring(from, to, {
  stiffness,
  damping,
  onUpdate,
  onDone,
  priority = 0,
  win = typeof window !== "undefined" ? window : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
} = {}) {
  if (!shouldAnimate({ win, doc })) {
    onUpdate?.(to);
    onDone?.();
    return { cancel() {}, retarget() {}, isRunning: () => false };
  }
  const scheduler = getScheduler(win);
  const now = win.performance && typeof win.performance.now === "function" ? win.performance.now() : Date.now();
  const entry = { x: from, v: 0, target: to, origin: from, stiffness, damping, onUpdate, onDone, priority, last: now };
  const id = scheduler.add(entry, { win, doc });
  if (id == null) return { cancel() {}, retarget() {}, isRunning: () => false };
  return {
    cancel() { scheduler.cancel(id); },
    // Redirects the same in-flight motion toward a new target without
    // restarting from rest, so a new user action never fights the old one.
    retarget(newTo, callbacks) { scheduler.retarget(id, newTo, callbacks); },
    isRunning: () => scheduler.has(id),
  };
}

/**
 * A small registry so a caller can run several named springs (e.g. one per
 * tab-indicator edge, one per digit column) keyed by name. Reusing a key
 * while it's still running retargets that same spring in place (current x
 * and v preserved) instead of restarting it from rest.
 */
export function createAnimationGroup() {
  const running = new Map();
  return {
    run(key, from, to, opts = {}) {
      const existing = running.get(key);
      if (existing?.isRunning()) {
        existing.retarget(to, { onUpdate: opts.onUpdate, onDone: opts.onDone });
        return existing;
      }
      const controller = animateSpring(from, to, opts);
      if (controller.isRunning()) running.set(key, controller);
      else running.delete(key);
      return controller;
    },
    cancel(key) {
      running.get(key)?.cancel();
      running.delete(key);
    },
    cancelAll() {
      running.forEach((controller) => controller.cancel());
      running.clear();
    },
    isRunning(key) {
      return Boolean(running.get(key)?.isRunning());
    },
  };
}

// ---------------------------------------------------------------------------
// Two-edge "stretch" helper (tab indicator, switch knob)
// ---------------------------------------------------------------------------

/** Which spring config leads and which trails, given the direction of travel. */
export function edgeSpringConfig(movingForward) {
  return movingForward
    ? { leading: SPRING_LEADING, trailing: SPRING_TRAILING }
    : { leading: SPRING_TRAILING, trailing: SPRING_LEADING };
}

// ---------------------------------------------------------------------------
// Rolling-digit text diffing (pure)
// ---------------------------------------------------------------------------

/**
 * Splits a formatted string into a stable sequence of slots: single ASCII
 * digits (animatable) and runs of everything else (commas, spaces, Korean
 * units, decimal points) as static text. Comparing two token lists tells us
 * whether it's safe to roll digit-by-digit or whether the shape changed and
 * we should just jump to the new value.
 */
export function tokenizeDigits(text) {
  const slots = [];
  let buffer = "";
  const flush = () => {
    if (buffer) {
      slots.push({ type: "text", value: buffer });
      buffer = "";
    }
  };
  for (const ch of String(text ?? "")) {
    if (ch >= "0" && ch <= "9") {
      flush();
      slots.push({ type: "digit", value: ch });
    } else {
      buffer += ch;
    }
  }
  flush();
  return slots;
}

/** Same slot shape (count, type, and static text) so digits can roll in place. */
export function digitSlotsCompatible(prev, next) {
  if (!Array.isArray(prev) || !Array.isArray(next) || prev.length !== next.length) return false;
  return prev.every((slot, i) => {
    const other = next[i];
    if (slot.type !== other.type) return false;
    return slot.type === "digit" || slot.value === other.value;
  });
}

/** Indices (into `next`) of digit slots whose value actually changed. */
export function diffDigitSlots(prev, next) {
  const changed = [];
  next.forEach((slot, i) => {
    if (slot.type === "digit" && prev?.[i]?.value !== slot.value) changed.push(i);
  });
  return changed;
}

const DEFAULT_UNIT_SUFFIXES = ["만원", "원", "건", "일"];

/** Splits a trailing Korean unit ("원", "건", "일", "만원", ...) off a formatted string. */
export function splitTrailingUnit(text, units = DEFAULT_UNIT_SUFFIXES) {
  const value = String(text ?? "");
  for (const unit of units) {
    if (value.endsWith(unit) && value.length > unit.length) {
      return { number: value.slice(0, -unit.length), unit };
    }
  }
  return { number: value, unit: "" };
}

// ---------------------------------------------------------------------------
// FLIP helper (calendar selection ring, reordering route cards)
// ---------------------------------------------------------------------------

/**
 * Classic FLIP delta between a "first" rect (where the element used to be)
 * and a "last" rect (where it is now, post-layout). Apply the returned
 * transform immediately (no transition) then animate to identity.
 */
export function flipDelta(firstRect, lastRect) {
  if (!firstRect || !lastRect) return { dx: 0, dy: 0, sx: 1, sy: 1 };
  return {
    dx: firstRect.left - lastRect.left,
    dy: firstRect.top - lastRect.top,
    sx: lastRect.width ? firstRect.width / lastRect.width : 1,
    sy: lastRect.height ? firstRect.height / lastRect.height : 1,
  };
}

/** True when a FLIP delta is a real move worth animating (guards against float noise). */
export function flipDeltaSignificant({ dx, dy, sx, sy }, epsilon = 0.5) {
  return Math.abs(dx) > epsilon || Math.abs(dy) > epsilon || Math.abs(sx - 1) > 0.01 || Math.abs(sy - 1) > 0.01;
}

// ---------------------------------------------------------------------------
// Drag-to-dismiss decision (bottom sheets)
// ---------------------------------------------------------------------------

/**
 * Pure decision for "should releasing the drag here dismiss the sheet?".
 * `dragDistance` and `panelSize` in px (0 or negative distance never
 * dismisses); `velocity` in px/s (positive = moving toward dismiss).
 */
export function shouldDismissDrag({ dragDistance, panelSize, velocity = 0, dismissRatio = 0.35, flickVelocity = 800 }) {
  if (!(dragDistance > 0)) return false;
  if (velocity >= flickVelocity) return true;
  if (!(panelSize > 0)) return false;
  return dragDistance / panelSize >= dismissRatio;
}

// ---------------------------------------------------------------------------
// Shake (invalid input)
// ---------------------------------------------------------------------------

/**
 * Pure decaying-oscillation offset at time `t` (seconds) into a shake of
 * `duration` seconds and peak `distance` px: two visible back-and-forth
 * cycles that die out to exactly 0 by the end.
 */
export function shakeOffset(t, { duration = DURATION.fast / 1000, distance = 6, cycles = 2 } = {}) {
  if (t <= 0 || t >= duration) return 0;
  const progress = t / duration;
  const envelope = Math.sin(Math.PI * progress); // 0 -> 1 -> 0, so it always ends at rest
  return distance * envelope * Math.sin(progress * cycles * 2 * Math.PI);
}

const shakeRegistry = new WeakMap();

/** Shakes `el` horizontally (transform only) and always returns it to translateX(0). */
export function shake(el, {
  distance = 6,
  duration = DURATION.fast,
  win = typeof window !== "undefined" ? window : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
} = {}) {
  if (!el) return;
  shakeRegistry.get(el)?.();
  if (!shouldAnimate({ win, doc })) {
    el.style.transform = "";
    return;
  }
  const durationSeconds = duration / 1000;
  let start = null;
  let raf = 0;
  let stopped = false;
  const tick = (now) => {
    if (stopped) return;
    if (start === null) start = now;
    const t = (now - start) / 1000;
    if (t >= durationSeconds) {
      el.style.transform = "";
      shakeRegistry.delete(el);
      return;
    }
    el.style.transform = `translateX(${shakeOffset(t, { duration: durationSeconds, distance }).toFixed(2)}px)`;
    raf = win.requestAnimationFrame(tick);
  };
  raf = win.requestAnimationFrame(tick);
  shakeRegistry.set(el, () => {
    stopped = true;
    win.cancelAnimationFrame?.(raf);
    el.style.transform = "";
  });
}

// ---------------------------------------------------------------------------
// One-shot "pop" (emphasis) — goal reached chip, chart goal-crossing point
// ---------------------------------------------------------------------------

const popRegistry = new WeakMap();

/** Scale+fade pop-in, once, using the base spring. Cancels any pop already running on `el`. */
export function popIn(el, { win, doc } = {}) {
  if (!el) return;
  popRegistry.get(el)?.();
  const controller = animateSpring(0, 1, {
    ...SPRING,
    win,
    doc,
    onUpdate: (v) => {
      el.style.opacity = String(Math.min(1, v));
      el.style.transform = `scale(${0.7 + 0.3 * v})`;
    },
    onDone: () => {
      el.style.opacity = "";
      el.style.transform = "";
      popRegistry.delete(el);
    },
  });
  popRegistry.set(el, () => controller.cancel());
}

// ---------------------------------------------------------------------------
// Critically damped fade / crossfade
// ---------------------------------------------------------------------------

const fadeRegistry = new WeakMap();

/** Fades `el`'s opacity from its current value to `to` with no overshoot. */
export function fadeTo(el, to, { win, doc, onDone } = {}) {
  if (!el) return;
  fadeRegistry.get(el)?.();
  const from = Number(el.style.opacity || getComputedOpacity(el));
  const controller = animateSpring(Number.isFinite(from) ? from : 1, to, {
    ...SPRING_FADE,
    win,
    doc,
    onUpdate: (v) => { el.style.opacity = String(v); },
    onDone: () => { fadeRegistry.delete(el); onDone?.(); },
  });
  fadeRegistry.set(el, () => controller.cancel());
}

function getComputedOpacity(el) {
  try {
    return Number(el.ownerDocument?.defaultView?.getComputedStyle(el).opacity ?? 1);
  } catch {
    return 1;
  }
}

/**
 * Short crossfade: fade `el` out, swap its content via `swap()`, fade it
 * back in. Used for the day-summary bar and similar small content swaps.
 * `swap` runs synchronously once the fade-out settles (or immediately, when
 * reduced motion / a hidden tab skips animation entirely).
 */
export function crossfade(el, swap, { win, doc } = {}) {
  if (!el) return;
  if (!shouldAnimate({ win, doc })) {
    swap();
    return;
  }
  fadeTo(el, 0, {
    win,
    doc,
    onDone: () => {
      swap();
      fadeTo(el, 1, { win, doc });
    },
  });
}

// ---------------------------------------------------------------------------
// Rolling number renderer (DOM)
// ---------------------------------------------------------------------------

const rollerRegistry = new WeakMap();

/**
 * Renders `formatted` (e.g. "1,234,567원") into `el` as rolling digits: only
 * digit columns that actually changed animate, everything else (commas,
 * units, decimal points) is static text. First render and any change in
 * digit *shape* (count/position) just sets the value instantly. Always keeps
 * `el`'s accessible text correct via aria-label.
 */
export function updateRollingNumber(el, formatted, { units = DEFAULT_UNIT_SUFFIXES, group, win, doc } = {}) {
  if (!el) return;
  const text = String(formatted ?? "");
  const { number, unit } = splitTrailingUnit(text, units);
  const tokens = tokenizeDigits(number);
  const grp = group || getRoller(el).group;
  const prevEntry = getRoller(el);
  const prev = prevEntry.tokens;

  el.setAttribute("aria-label", text);

  if (prev && prevEntry.rawText === text) return; // no real change, skip all DOM work

  const animate = shouldAnimate({ win, doc }) && digitSlotsCompatible(prev, tokens);
  if (!animate) {
    buildRollingNumber(el, tokens, unit);
    prevEntry.tokens = tokens;
    prevEntry.rawText = text;
    return;
  }
  const changed = diffDigitSlots(prev, tokens);
  const digitEls = el.querySelectorAll("[data-mo-digit]");
  changed.forEach((index) => {
    const digitEl = digitEls[digitIndexToDomIndex(tokens, index)];
    if (!digitEl) return;
    const strip = digitEl.firstElementChild;
    const from = Number(strip.dataset.moValue || 0);
    const to = Number(tokens[index].value);
    strip.dataset.moValue = String(to);
    grp.run(`digit-${index}`, from, to, {
      ...SPRING,
      win,
      doc,
      onUpdate: (v) => { strip.style.transform = `translateY(${(-v * 100).toFixed(2)}%)`; },
    });
  });
  prevEntry.tokens = tokens;
  prevEntry.rawText = text;
}

function digitIndexToDomIndex(tokens, index) {
  // digit-only elements are appended in order, so the Nth digit token maps
  // to the Nth [data-mo-digit] node.
  let count = 0;
  for (let i = 0; i < index; i += 1) if (tokens[i].type === "digit") count += 1;
  return count;
}

function getRoller(el) {
  let entry = rollerRegistry.get(el);
  if (!entry) {
    entry = { tokens: null, rawText: "", group: createAnimationGroup() };
    rollerRegistry.set(el, entry);
  }
  return entry;
}

function buildRollingNumber(el, tokens, unit) {
  el.textContent = "";
  for (const slot of tokens) {
    if (slot.type === "text") {
      el.appendChild(document.createTextNode(slot.value));
      continue;
    }
    const digitEl = document.createElement("span");
    digitEl.dataset.moDigit = "true";
    digitEl.setAttribute("aria-hidden", "true");
    digitEl.style.display = "inline-block";
    digitEl.style.overflow = "hidden";
    digitEl.style.height = "1em";
    digitEl.style.lineHeight = "1em";
    digitEl.style.verticalAlign = "top";
    const strip = document.createElement("span");
    strip.style.display = "block";
    strip.dataset.moValue = slot.value;
    strip.style.transform = `translateY(${-Number(slot.value) * 100}%)`;
    for (let i = 0; i < 10; i += 1) {
      const digitChar = document.createElement("span");
      digitChar.style.display = "block";
      digitChar.style.height = "1em";
      digitChar.style.lineHeight = "1em";
      digitChar.textContent = String(i);
      strip.appendChild(digitChar);
    }
    digitEl.appendChild(strip);
    el.appendChild(digitEl);
  }
  if (unit) {
    const unitEl = document.createElement("span");
    unitEl.className = "number-unit";
    unitEl.textContent = unit;
    el.appendChild(unitEl);
  }
}

// ---------------------------------------------------------------------------
// Tab / segmented-control indicator (two-edge stretch)
// ---------------------------------------------------------------------------

/**
 * Attaches a sliding indicator element inside `container` (which must be
 * `position: relative`). `indicator` should be `position: absolute; left:
 * 0; width: 1px; transform-origin: left` in CSS; this only ever sets its
 * transform, never left/width, so layout is untouched.
 */
export function createTabIndicator(container, indicator, { win, doc } = {}) {
  const group = createAnimationGroup();
  let edge = { l: 0, r: 0 };
  let placed = false;

  function place() {
    const width = Math.max(0, edge.r - edge.l);
    indicator.style.transform = `translateX(${edge.l.toFixed(2)}px) scaleX(${width.toFixed(2)})`;
    indicator.style.opacity = width > 0 ? "1" : "0";
  }

  function measure(btn) {
    const trackRect = container.getBoundingClientRect();
    const rect = btn.getBoundingClientRect();
    return { l: rect.left - trackRect.left, r: rect.right - trackRect.left };
  }

  function moveTo(btn, { instant = false } = {}) {
    if (!btn) {
      group.cancelAll();
      edge = { l: edge.l, r: edge.l };
      place();
      return;
    }
    const to = measure(btn);
    if (instant || !placed || !shouldAnimate({ win, doc })) {
      group.cancelAll();
      edge = to;
      placed = true;
      place();
      return;
    }
    const movingForward = to.l > edge.l;
    const springs = edgeSpringConfig(movingForward);
    // The edge in the direction of travel is the "leading" edge (stiff);
    // the other edge lags behind (soft) before catching up.
    group.run("l", edge.l, to.l, {
      ...(movingForward ? springs.trailing : springs.leading),
      win, doc,
      onUpdate: (x) => { edge.l = x; place(); },
    });
    group.run("r", edge.r, to.r, {
      ...(movingForward ? springs.leading : springs.trailing),
      win, doc,
      onUpdate: (x) => { edge.r = x; place(); },
    });
  }

  return { moveTo, cancelAll: () => group.cancelAll() };
}

// ---------------------------------------------------------------------------
// FLIP move (calendar selection ring, reordering cards)
// ---------------------------------------------------------------------------

/**
 * Animates `el` from `firstRect` to its current (already-laid-out) rect
 * using transform only. Call after the element is placed at its new
 * position; pass the rect it used to occupy as `firstRect`.
 */
export function flipMove(el, firstRect, { group, win, doc, key = "flip" } = {}) {
  if (!el || !firstRect) return;
  const lastRect = el.getBoundingClientRect();
  const delta = flipDelta(firstRect, lastRect);
  if (!flipDeltaSignificant(delta)) return;
  const grp = group || createAnimationGroup();
  if (!shouldAnimate({ win, doc })) return;
  el.style.transformOrigin = "top left";
  grp.run(`${key}-x`, delta.dx, 0, {
    ...SPRING, win, doc,
    onUpdate: (x) => applyFlipTransform(el, { ...delta, dx: x }),
  });
  grp.run(`${key}-y`, delta.dy, 0, {
    ...SPRING, win, doc,
    onUpdate: (y) => applyFlipTransform(el, { ...delta, dy: y }),
  });
}

const flipState = new WeakMap();
function applyFlipTransform(el, { dx, dy }) {
  flipState.set(el, { dx, dy });
  el.style.transform = `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px)`;
  if (Math.abs(dx) < 0.05 && Math.abs(dy) < 0.05) el.style.transform = "";
}

// ---------------------------------------------------------------------------
// Sheet drag (bottom sheets follow the finger)
// ---------------------------------------------------------------------------

/**
 * Wires pointer-drag-to-dismiss on `handle` (e.g. a sheet's header/handle),
 * moving `panel` with the finger via translateY. On release, calls
 * `onDismiss()` if the drag crossed the dismiss threshold or was a fast
 * downward flick; `onDismiss` should run the existing close path and may
 * refuse to close (e.g. an unsaved-draft confirm), in which case the caller
 * must call `cancelDismiss()` to spring back. If the drag never crossed the
 * threshold, the panel always springs back on its own.
 */
export function attachSheetDrag(panel, handle, {
  getPanelSize = () => panel.getBoundingClientRect().height,
  onDismiss,
  dismissRatio = 0.35,
  flickVelocity = 800,
  win = typeof window !== "undefined" ? window : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
} = {}) {
  if (!panel || !handle || typeof handle.addEventListener !== "function") return { destroy() {} };
  const group = createAnimationGroup();
  let dragging = false;
  let startY = 0;
  let currentY = 0;
  let lastY = 0;
  let lastT = 0;
  let velocity = 0;
  let pointerId = null;

  function setTransform(y) {
    panel.style.transform = y > 0 ? `translateY(${y.toFixed(2)}px)` : "";
  }

  function springBack() {
    group.run("y", currentY, 0, {
      ...SPRING, win, doc,
      onUpdate: (y) => { currentY = y; setTransform(y); },
    });
  }

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    dragging = true;
    startY = event.clientY;
    lastY = event.clientY;
    lastT = event.timeStamp || Date.now();
    velocity = 0;
    pointerId = event.pointerId;
    group.cancelAll();
    handle.setPointerCapture?.(pointerId);
  }

  function onPointerMove(event) {
    if (!dragging || (pointerId != null && event.pointerId !== pointerId)) return;
    const y = Math.max(0, event.clientY - startY);
    const now = event.timeStamp || Date.now();
    const dt = Math.max(1, now - lastT);
    velocity = ((event.clientY - lastY) / dt) * 1000;
    lastY = event.clientY;
    lastT = now;
    currentY = y;
    setTransform(y);
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    const panelSize = getPanelSize() || 1;
    if (shouldDismissDrag({ dragDistance: currentY, panelSize, velocity, dismissRatio, flickVelocity })) {
      const stillOpen = onDismiss?.();
      if (stillOpen === false) return; // caller already handled visuals / removed the panel
      springBack(); // confirm cancelled the close (or caller wants a spring-back regardless)
    } else {
      springBack();
    }
  }

  handle.addEventListener("pointerdown", onPointerDown);
  handle.addEventListener("pointermove", onPointerMove);
  handle.addEventListener("pointerup", onPointerUp);
  handle.addEventListener("pointercancel", onPointerUp);

  return {
    destroy() {
      group.cancelAll();
      handle.removeEventListener("pointerdown", onPointerDown);
      handle.removeEventListener("pointermove", onPointerMove);
      handle.removeEventListener("pointerup", onPointerUp);
      handle.removeEventListener("pointercancel", onPointerUp);
    },
  };
}
