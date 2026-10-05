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
// One entry feel across cards, rows and dialogs. Card CSS samples this same
// spring so it runs natively; small elements use the existing shared scheduler.
export const ENTRY_MOTION = Object.freeze({
  // Short and quiet: critically damped (no rebound), settles in about a third of a second.
  stiffness: 480, damping: 1, durationMs: 340,
  cardDistance: 12, elementDistance: 8, headerDistance: 0, disclosureDistance: 8,
  // Cards entering together start this far apart, in at most four slots.
  staggerMs: 40, staggerSlots: 4,
  // Numbers and bars inside a card start once the card has nearly settled.
  contentDelayMs: 150,
});
/** How long the startup splash takes to fade after it starts leaving (startup.js). */
export const STARTUP_FADE_MS = 180;

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

// Short-lived DOM effects clean up their listeners when they finish; the
// shared spring scheduler keeps its existing window-level listeners.
function watchMotionEnvironment(win, doc, onChange) {
  const media = safeMatchMedia(win, "(prefers-reduced-motion: reduce)");
  if (media?.addEventListener) media.addEventListener("change", onChange);
  else media?.addListener?.(onChange);
  doc?.addEventListener?.("visibilitychange", onChange);
  return () => {
    if (media?.removeEventListener) media.removeEventListener("change", onChange);
    else media?.removeListener?.(onChange);
    doc?.removeEventListener?.("visibilitychange", onChange);
  };
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

  // Entrance motion that starts under the startup splash waits in its first
  // frame and plays once the splash has faded (data-startup removed + fade).
  let startupReleaseAt = null;
  function heldByStartup(now) {
    const root = boundWin?.document?.documentElement;
    if (!root || typeof root.hasAttribute !== "function") return false;
    if (root.hasAttribute("data-startup")) { startupReleaseAt = null; return true; }
    if (startupReleaseAt === null) startupReleaseAt = now + STARTUP_FADE_MS;
    return now < startupReleaseAt;
  }

  function tick(now) {
    rafId = 0;
    if (heldByStartup(now)) {
      entries.forEach((entry) => { entry.last = now; });
      ensureTicking();
      return;
    }
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

// Small, reusable entrance treatment for newly inserted rows and screens.
// It owns only inline opacity/transform while running and restores the exact
// prior inline values on every completion/cancellation path.
const elementEntrances = new WeakMap();
export function enterElement(el, {
  distance = ENTRY_MOTION.elementDistance,
  delay = 0,
  win = typeof window !== "undefined" ? window : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
} = {}) {
  if (!el || typeof el !== "object") return () => {};
  elementEntrances.get(el)?.cancel();
  const original = { opacity: el?.style?.opacity ?? "", transform: el?.style?.transform ?? "" };
  const restore = () => {
    if (!el?.style) return;
    el.style.opacity = original.opacity;
    el.style.transform = original.transform;
  };
  if (!el?.style || !shouldAnimate({ win, doc }) || el.isConnected === false) {
    restore();
    return () => {};
  }

  let timer = 0;
  let spring = null;
  let unwatch = () => {};
  let finished = false;
  let staged = false;
  let targetOpacity = 1;
  const record = { cancel };
  elementEntrances.set(el, record);

  function finish() {
    if (finished) return;
    finished = true;
    if (timer) (win?.clearTimeout || clearTimeout)(timer);
    timer = 0;
    spring?.cancel();
    spring = null;
    unwatch();
    unwatch = () => {};
    restore();
    if (elementEntrances.get(el) === record) elementEntrances.delete(el);
  }
  function cancel() { finish(); }
  const checkEnvironment = () => {
    if (!shouldAnimate({ win, doc }) || el.isConnected === false) finish();
  };
  unwatch = watchMotionEnvironment(win, doc, checkEnvironment);

  const stage = () => {
    if (staged || finished) return;
    if (!shouldAnimate({ win, doc }) || el.isConnected === false) { finish(); return; }
    try {
      const computed = win?.getComputedStyle?.(el)?.opacity;
      if (computed != null && Number.isFinite(Number(computed))) targetOpacity = Number(computed);
    } catch { /* computed styles are optional in lightweight DOMs */ }
    el.style.opacity = "0";
    el.style.transform = `translateY(${Number(distance) || 0}px)${original.transform ? ` ${original.transform}` : ""}`;
    staged = true;
  };

  const start = () => {
    timer = 0;
    if (finished) return;
    if (!shouldAnimate({ win, doc }) || el.isConnected === false) { finish(); return; }
    stage();
    if (finished) return;
    spring = animateSpring(0, 1, {
      stiffness: ENTRY_MOTION.stiffness,
      damping: ENTRY_MOTION.damping,
      win,
      doc,
      onUpdate: (value) => {
        if (finished) return;
        if (!shouldAnimate({ win, doc }) || el.isConnected === false) { finish(); return; }
        const progress = Math.max(0, Math.min(1, value));
        el.style.opacity = String(targetOpacity * progress);
        el.style.transform = `translateY(${((Number(distance) || 0) * (1 - value)).toFixed(2)}px)${original.transform ? ` ${original.transform}` : ""}`;
      },
      onDone: finish,
    });
  };

  const wait = Math.max(0, Number(delay) || 0);
  if (wait) {
    stage();
    if (!finished) timer = win?.setTimeout ? win.setTimeout(start, wait) : setTimeout(start, wait);
  }
  else start();
  return cancel;
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
  let unwatch = () => {};
  const stop = () => {
    if (stopped) return;
    stopped = true;
    win.cancelAnimationFrame?.(raf);
    el.style.transform = "";
    unwatch();
    if (shakeRegistry.get(el) === stop) shakeRegistry.delete(el);
  };
  const tick = (now) => {
    if (stopped) return;
    if (!shouldAnimate({ win, doc })) { stop(); return; }
    if (start === null) start = now;
    const t = (now - start) / 1000;
    if (t >= durationSeconds) {
      stop();
      return;
    }
    el.style.transform = `translateX(${shakeOffset(t, { duration: durationSeconds, distance }).toFixed(2)}px)`;
    raf = win.requestAnimationFrame(tick);
  };
  unwatch = watchMotionEnvironment(win, doc, () => { if (!shouldAnimate({ win, doc })) stop(); });
  shakeRegistry.set(el, stop);
  raf = win.requestAnimationFrame(tick);
}

// ---------------------------------------------------------------------------
// One-shot "pop" (emphasis) — goal reached chip, chart goal-crossing point
// ---------------------------------------------------------------------------

const popRegistry = new WeakMap();

/**
 * Scale+fade pop-in, once, using the base spring. Cancels any pop already
 * running on `el`. `from` is the starting scale (0.7 for a chip popping in
 * from nothing, 0.92 for a dialog card that's already roughly its own size).
 */
export function popIn(el, { win, doc, from = 0.7 } = {}) {
  if (!el) return;
  popRegistry.get(el)?.();
  const controller = animateSpring(0, 1, {
    ...SPRING,
    win,
    doc,
    onUpdate: (v) => {
      el.style.opacity = String(Math.min(1, v));
      el.style.transform = `scale(${from + (1 - from) * v})`;
    },
    onDone: () => {
      el.style.opacity = "";
      el.style.transform = "";
      popRegistry.delete(el);
    },
  });
  popRegistry.set(el, () => controller.cancel());
}

const pressPopRegistry = new WeakMap();

/**
 * A quick tactile "press" bounce for an already-visible control (unlike
 * popIn, opacity is untouched — only a brief scale dip and recovery via the
 * base spring's small overshoot).
 */
export function pressPop(el, { from = 0.94, win, doc } = {}) {
  if (!el) return;
  pressPopRegistry.get(el)?.();
  const controller = animateSpring(from, 1, {
    ...SPRING,
    win,
    doc,
    onUpdate: (v) => { el.style.transform = `scale(${v})`; },
    onDone: () => {
      el.style.transform = "";
      pressPopRegistry.delete(el);
    },
  });
  pressPopRegistry.set(el, () => controller.cancel());
}

// ---------------------------------------------------------------------------
// Critically damped fade / crossfade
// ---------------------------------------------------------------------------

const fadeRegistry = new WeakMap();

/** A new renderer owns the element now; a pending fade must not swap old content. */
export function cancelFade(el) {
  const cancel = el && fadeRegistry.get(el);
  if (!cancel) return;
  cancel();
  fadeRegistry.delete(el);
  el.style.opacity = "";
}

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
// Whole-value counter (sample-style cubic ease-out, one rAF per number)
// ---------------------------------------------------------------------------

const countingRegistry = new WeakMap();

/** Stops a counter before another renderer takes ownership of its element. */
export function cancelCountingNumber(el) {
  const entry = el && countingRegistry.get(el);
  if (!entry) return;
  entry.cancel();
  countingRegistry.delete(el);
}

function ownsCountingDom(el, entry) {
  if (el.textContent !== entry.text) return false;
  const nodes = Array.from(el.childNodes || []);
  return nodes.length === entry.nodes.length && nodes.every((node, index) => node === entry.nodes[index]);
}

/**
 * Interpolates the whole numeric value using the sample's 750ms cubic
 * ease-out. Retargeting starts at the last painted value; an unchanged target
 * leaves the current motion alone. Replaced DOM is repaired without trusting
 * its old value cache. Hidden/reduced-motion transitions paint the final value
 * immediately and release the frame and event listeners.
 */
export function updateCountingNumber(el, number, {
  format = String,
  duration = 750,
  win = typeof window !== "undefined" ? window : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
} = {}) {
  if (!el || !Number.isFinite(number)) return;
  cancelFade(el);
  rollerRegistry.get(el)?.group.cancelAll();
  let entry = countingRegistry.get(el);
  const intact = entry && ownsCountingDom(el, entry);
  const finalText = String(format(number));
  el.setAttribute?.("aria-label", finalText);
  if (intact && entry.target === number) {
    entry.format = format;
    if (entry.text !== String(format(entry.current))) entry.paint(entry.current);
    if (!shouldAnimate({ win, doc }) && entry.running) entry.finish();
    return;
  }

  const repair = Boolean(entry && !intact);
  const from = intact ? entry.current : 0;
  entry?.cancel();
  entry = { current: from, target: number, format, text: "", nodes: [], running: false };
  let raf = null;
  let unwatch = () => {};
  entry.paint = (value) => {
    entry.current = value;
    entry.text = String(entry.format(value));
    el.textContent = entry.text;
    entry.nodes = Array.from(el.childNodes || []);
  };
  entry.cancel = () => {
    entry.running = false;
    if (raf !== null) win?.cancelAnimationFrame?.(raf);
    raf = null;
    unwatch();
    unwatch = () => {};
  };
  entry.finish = () => { entry.cancel(); entry.paint(entry.target); };
  countingRegistry.set(el, entry);
  const milliseconds = Number.isFinite(duration) ? Math.max(0, duration) : 750;
  if (repair || !shouldAnimate({ win, doc }) || milliseconds === 0 || from === number) {
    entry.finish();
    return;
  }
  entry.paint(from);
  entry.running = true;
  const start = win.performance?.now?.() ?? Date.now();
  const tick = (now) => {
    raf = null;
    if (!entry.running) return;
    if (el.isConnected === false || !ownsCountingDom(el, entry)) {
      entry.cancel();
      if (countingRegistry.get(el) === entry) countingRegistry.delete(el);
      return;
    }
    if (!shouldAnimate({ win, doc })) { entry.finish(); return; }
    const progress = Math.min(1, Math.max(0, (now - start) / milliseconds));
    if (progress === 1) { entry.finish(); return; }
    entry.paint(from + (number - from) * (1 - (1 - progress) ** 3));
    raf = win.requestAnimationFrame(tick);
  };
  unwatch = watchMotionEnvironment(win, doc, () => {
    if (shouldAnimate({ win, doc })) return;
    if (el.isConnected === false || !ownsCountingDom(el, entry)) {
      entry.cancel();
      if (countingRegistry.get(el) === entry) countingRegistry.delete(el);
    } else entry.finish();
  });
  raf = win.requestAnimationFrame(tick);
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
export function updateRollingNumber(el, formatted, { units = DEFAULT_UNIT_SUFFIXES, group, win, doc, rollIn = false } = {}) {
  if (!el) return;
  cancelCountingNumber(el);
  cancelFade(el);
  const text = String(formatted ?? "");
  const { number, unit } = splitTrailingUnit(text, units);
  const tokens = tokenizeDigits(number);
  const grp = group || getRoller(el).group;
  const prevEntry = getRoller(el);
  // A period crossfade or plain renderer may have replaced the entire number.
  // Cached text is only usable while this renderer still owns those DOM nodes.
  const domIntact = prevEntry.nodes?.length === el.childNodes.length
    && prevEntry.nodes.every((node, index) => node === el.childNodes[index]);
  let prev = domIntact && prevEntry.unit === unit ? prevEntry.tokens : null;
  if (!prev) grp.cancelAll();

  el.setAttribute("aria-label", text);

  if (prev && prevEntry.rawText === text) return; // no real change, skip all DOM work

  let animate = shouldAnimate({ win, doc }) && digitSlotsCompatible(prev, tokens);
  if (!animate && rollIn && shouldAnimate({ win, doc })) {
    // Appear by rolling up from zeros in the new digit layout.
    const zeros = tokens.map((t) => (t.type === "digit" ? { ...t, value: "0" } : t));
    grp.cancelAll();
    buildRollingNumber(el, zeros, unit);
    prev = zeros;
    prevEntry.nodes = Array.from(el.childNodes);
    prevEntry.unit = unit;
    animate = true;
  }
  if (!animate) {
    grp.cancelAll();
    buildRollingNumber(el, tokens, unit);
    prevEntry.tokens = tokens;
    prevEntry.rawText = text;
    prevEntry.nodes = Array.from(el.childNodes);
    prevEntry.unit = unit;
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
    if (strip.nextElementSibling) strip.nextElementSibling.textContent = String(to);
    grp.run(`digit-${index}`, from, to, {
      ...SPRING,
      win,
      doc,
      onUpdate: (v) => { strip.style.transform = `translateY(${(-v * 10).toFixed(2)}%)`; },
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
    entry = { tokens: null, rawText: "", nodes: null, unit: "", group: createAnimationGroup() };
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
    // An invisible in-flow copy of the digit gives the cell its width and the
    // same text baseline as its neighbours; the strip rides above it, clipped.
    digitEl.style.display = "inline-block";
    digitEl.style.position = "relative";
    digitEl.style.clipPath = "inset(0)";
    digitEl.style.lineHeight = "1.2em";
    digitEl.style.font = "inherit";
    const strip = document.createElement("span");
    strip.style.display = "block";
    strip.style.position = "absolute";
    strip.style.left = "0";
    strip.style.right = "0";
    strip.style.top = "0";
    // Host label rules such as `.summary-grid span` would otherwise shrink the rows.
    strip.style.font = "inherit";
    strip.style.color = "inherit";
    strip.dataset.moValue = slot.value;
    strip.style.transform = `translateY(${-Number(slot.value) * 10}%)`;
    for (let i = 0; i < 10; i += 1) {
      const digitChar = document.createElement("span");
      digitChar.style.display = "block";
      digitChar.style.font = "inherit";
      digitChar.style.color = "inherit";
      digitChar.style.height = "1.2em";
      digitChar.style.lineHeight = "1.2em";
      digitChar.textContent = String(i);
      strip.appendChild(digitChar);
    }
    const placeholder = document.createElement("span");
    placeholder.style.visibility = "hidden";
    placeholder.style.font = "inherit";
    placeholder.textContent = slot.value;
    digitEl.appendChild(strip);
    digitEl.appendChild(placeholder);
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

  // The indicator is the selected pill itself: it takes the button's height
  // and follows its two edges, so the stretch shows on the real surface.
  function place() {
    const width = Math.max(0, edge.r - edge.l);
    indicator.style.width = `${width.toFixed(2)}px`;
    indicator.style.transform = `translateX(${edge.l.toFixed(2)}px)`;
    indicator.style.opacity = width > 0 ? "1" : "0";
  }

  function measure(btn) {
    const trackRect = container.getBoundingClientRect();
    const rect = btn.getBoundingClientRect();
    indicator.style.top = `${(rect.top - trackRect.top).toFixed(2)}px`;
    indicator.style.height = `${rect.height.toFixed(2)}px`;
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
      ...springs.trailing,
      win, doc,
      onUpdate: (x) => { edge.l = x; place(); },
    });
    group.run("r", edge.r, to.r, {
      ...springs.leading,
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

// ---------------------------------------------------------------------------
// On-screen gating
// ---------------------------------------------------------------------------

/**
 * Holds motion until its card is actually on screen. whenVisible(card, key, fn)
 * runs fn now when the card is visible (or animation is off); otherwise it keeps
 * the newest fn per key and runs it once the card scrolls into view, so a value
 * that changed several times off screen animates once, to its latest state.
 * A card inside a hidden tab counts as off screen. onEnter(card) runs on every
 * entry, for one-time reveal styling.
 */
export function createVisibilityQueue({
  win = typeof window !== "undefined" ? window : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
  threshold = 0.2,
  onEnter,
  finishWhenHidden = true,
  enterDelay = 0,
} = {}) {
  const Observer = win?.IntersectionObserver;
  if (typeof Observer !== "function") {
    return { supported: false, observe() {}, destroy() {}, isVisible: () => true, whenVisible: (card, key, fn) => fn() };
  }
  const visible = new Set();
  const observed = new WeakSet();
  const queues = new Map();
  const minimumRatio = Number.isFinite(threshold) ? Math.min(1, Math.max(0, threshold)) : 0.2;
  let destroyed = false;
  const runQueued = (card) => {
    const queue = queues.get(card);
    if (!queue) return;
    queues.delete(card);
    queue.forEach((fn) => fn());
  };
  const finishQueued = () => {
    const pending = [...queues.keys()];
    pending.forEach(runQueued);
  };
  const shouldFinishQueued = () => !shouldAnimate({ win, doc })
    && (finishWhenHidden || !doc?.hidden || prefersReducedMotion(win));
  const observer = new Observer((entries) => {
    if (destroyed) return;
    entries.forEach((entry) => {
      const card = entry.target;
      // Real IntersectionObserver entries always provide intersectionRatio;
      // the fallback preserves compatibility with minimal older test doubles.
      const ratio = entry.intersectionRatio ?? (entry.isIntersecting ? 1 : 0);
      if (!entry.isIntersecting || ratio < minimumRatio) {
        visible.delete(card);
        return;
      }
      const entering = !visible.has(card);
      visible.add(card);
      if (!doc?.hidden) {
        if (entering) onEnter?.(card);
        if (entering && enterDelay > 0 && queues.has(card)) {
          (win?.setTimeout || setTimeout)(() => { if (!destroyed && visible.has(card)) runQueued(card); }, enterDelay);
        } else runQueued(card);
      }
    });
    if (shouldFinishQueued()) finishQueued();
  }, { threshold: minimumRatio });
  let wasHidden = Boolean(doc?.hidden);
  const unwatch = watchMotionEnvironment(win, doc, () => {
    if (shouldFinishQueued()) finishQueued();
    if (wasHidden && !doc?.hidden) visible.forEach((card) => {
      onEnter?.(card);
      runQueued(card);
    });
    wasHidden = Boolean(doc?.hidden);
  });
  const observe = (card) => {
    if (destroyed || !card || observed.has(card)) return;
    observed.add(card);
    observer.observe(card);
  };
  const forgetQueued = (card, key) => {
    const queue = queues.get(card);
    queue?.delete(key);
    if (queue?.size === 0) queues.delete(card);
  };
  return {
    supported: true,
    observe,
    destroy() {
      destroyed = true;
      unwatch();
      observer.disconnect?.();
      visible.clear();
      queues.clear();
    },
    isVisible: (card) => !doc?.hidden && visible.has(card),
    whenVisible(card, key, fn) {
      if (destroyed) return;
      if (!card || shouldFinishQueued()) {
        forgetQueued(card, key);
        fn();
        return;
      }
      observe(card);
      if (!doc?.hidden && visible.has(card)) {
        forgetQueued(card, key);
        fn();
        return;
      }
      const queue = queues.get(card) || new Map();
      queue.set(key, fn);
      queues.set(card, queue);
    },
  };
}

const confettiRegistry = new WeakMap();

/** A short confetti burst on a self-removing canvas; a new burst replaces the old one. */
export function confettiBurst(origin, {
  win = typeof window !== "undefined" ? window : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
  colors = [],
  count = 80,
  duration = 1400,
} = {}) {
  if (win) confettiRegistry.get(win)?.();
  if (!origin || !doc?.body || !shouldAnimate({ win, doc })) return;
  const canvas = doc.createElement("canvas");
  canvas.setAttribute("aria-hidden", "true");
  canvas.style.cssText = "position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999";
  doc.body.appendChild(canvas);
  let ctx;
  try { ctx = canvas.getContext("2d"); } catch { canvas.remove(); return; }
  if (!ctx) { canvas.remove(); return; }
  const width = win.innerWidth, height = win.innerHeight, dpr = win.devicePixelRatio || 1;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.scale(dpr, dpr);
  const rect = origin.getBoundingClientRect();
  const x0 = rect.left + rect.width / 2, y0 = rect.top + rect.height / 2;
  const palette = colors.filter(Boolean).length ? colors.filter(Boolean) : ["#888"];
  const parts = Array.from({ length: count }, () => {
    const angle = Math.random() * Math.PI * 2, speed = 3 + Math.random() * 6;
    return {
      x: x0, y: y0, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 4,
      size: 3 + Math.random() * 4, turn: Math.random() * 6, spin: (Math.random() - 0.5) * 0.4,
      color: palette[Math.floor(Math.random() * palette.length)],
    };
  });
  const start = win.performance?.now?.() ?? Date.now();
  let raf = null;
  let stopped = false;
  let unwatch = () => {};
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (raf !== null) win.cancelAnimationFrame?.(raf);
    raf = null;
    unwatch();
    canvas.remove();
    if (confettiRegistry.get(win) === stop) confettiRegistry.delete(win);
  };
  const frame = (now) => {
    raf = null;
    if (stopped) return;
    if (!shouldAnimate({ win, doc })) { stop(); return; }
    const elapsed = now - start;
    ctx.clearRect(0, 0, width, height);
    parts.forEach((p) => {
      p.vy += 0.22; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.turn += p.spin;
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - elapsed / duration);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.turn);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
      ctx.restore();
    });
    if (elapsed < duration) raf = win.requestAnimationFrame(frame);
    else stop();
  };
  unwatch = watchMotionEnvironment(win, doc, () => { if (!shouldAnimate({ win, doc })) stop(); });
  confettiRegistry.set(win, stop);
  raf = win.requestAnimationFrame(frame);
}

/**
 * Folds a row away (height, spacing and opacity to zero) and resolves when it is gone.
 * Without animation, or without the Web Animations API, it resolves at once.
 */
export function collapseOut(el, {
  duration = 220,
  win = typeof window !== "undefined" ? window : undefined,
  doc = typeof document !== "undefined" ? document : undefined,
} = {}) {
  if (!el || typeof el.animate !== "function" || !shouldAnimate({ win, doc })) return Promise.resolve();
  const height = el.getBoundingClientRect().height;
  el.style.overflow = "hidden";
  const animation = el.animate([
    { height: `${height}px`, opacity: 1 },
    { height: "0px", opacity: 0, marginTop: "0px", marginBottom: "0px", paddingTop: "0px", paddingBottom: "0px" },
  ], { duration, easing: "cubic-bezier(.2,.8,.2,1)", fill: "forwards" });
  return animation.finished.then(() => undefined, () => undefined);
}

/** A short check beside a save button's label once its save succeeded. Presentation only. */
export function markSaved(button, { duration = 1200, doc = typeof document !== "undefined" ? document : undefined } = {}) {
  if (!button || !doc?.createElement || button.isConnected === false) return;
  button.querySelector(":scope > .save-tick")?.remove();
  const tick = doc.createElement("span");
  tick.className = "save-tick";
  tick.setAttribute("aria-hidden", "true");
  tick.textContent = "✓";
  button.append(tick);
  setTimeout(() => tick.remove(), duration);
}
