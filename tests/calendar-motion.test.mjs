import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarPeriodDirection, calendarRowProgress, createCalendarMotion, paintCalendarSelection,
} from "../src/lib/calendar-motion.js";
import { crossfade } from "../src/lib/motion.js";

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type, event = {}) { listeners.get(type)?.forEach((fn) => fn({ type, ...event })); },
  };
}

function setup({ reduced = false } = {}) {
  let now = 0, nextId = 1;
  const callbacks = new Map();
  const media = { matches: reduced, ...eventTarget() };
  const win = {
    ...eventTarget(), performance: { now: () => now }, matchMedia: () => media,
    requestAnimationFrame(fn) { const id = nextId++; callbacks.set(id, fn); return id; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    getComputedStyle: (node) => ({ opacity: node.style.opacity || "1", display: node.display || "block" }),
  };
  const doc = { ...eventTarget(), defaultView: win, hidden: false, activeElement: null };
  win.document = doc;
  function node(className = "", rect = { left: 0, top: 0, width: 56, height: 76 }) {
    const classes = new Set(className.split(" ").filter(Boolean));
    const attributes = new Map();
    const properties = new Map();
    const element = {
      ...eventTarget(), ownerDocument: doc, children: [], parentNode: null, textContent: "",
      style: { transform: "", opacity: "", setProperty: (key, value) => properties.set(key, value),
        removeProperty: (key) => properties.delete(key), getPropertyValue: (key) => properties.get(key) || "" },
      classList: { add: (key) => classes.add(key), remove: (key) => classes.delete(key), contains: (key) => classes.has(key) },
      setAttribute: (key, value) => attributes.set(key, value),
      getAttribute: (key) => attributes.get(key) ?? null,
      getBoundingClientRect: () => rect,
      contains(child) { return this === child || this.children.includes(child); },
      closest(selector) { return selector === ".day-cell" && classes.has("day-cell") ? this : null; },
      querySelectorAll(selector) { return selector === ".day-cell" ? this.children.filter((item) => item.classList.contains("day-cell")) : []; },
      querySelector(selector) {
        return this.children.find((item) => selector === ".day-cell.selected"
          ? item.classList.contains("day-cell") && item.classList.contains("selected")
          : selector === ".day-selection-ring" && item.classList.contains("day-selection-ring")) || null;
      },
      appendChild(child) {
        child.remove(); child.parentNode = this; this.children.push(child); return child;
      },
      replaceChildren(...items) { this.children.forEach((child) => { child.parentNode = null; }); this.children = []; items.forEach((child) => this.appendChild(child)); },
      remove() {
        if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
        this.parentNode = null;
      },
      focus(options) { doc.activeElement = this; this.focusOptions = options; },
    };
    Object.defineProperty(element, "className", { get: () => [...classes].join(" "),
      set: (value) => { classes.clear(); value.split(" ").filter(Boolean).forEach((key) => classes.add(key)); } });
    return element;
  }
  doc.createElement = () => node();
  const container = node("calendar-grid", { left: 10, top: 20, width: 392, height: 380 });
  const cell = (date, { x = 0, y = 0, selected = false } = {}) => {
    const result = node(`day-cell${selected ? " selected" : ""}`, { left: 10 + x, top: 20 + y, width: 56, height: 76 });
    result.setAttribute("data-calendar-date", date);
    return result;
  };
  function tick(delta = 16) {
    now += delta;
    const due = [...callbacks.values()]; callbacks.clear(); due.forEach((fn) => fn(now));
  }
  const frames = (count = 100) => { for (let i = 0; i < count; i += 1) tick(); };
  return { win, doc, node, container, cell, tick, frames,
    pending: () => callbacks.size,
    reduce(value = true) { media.matches = value; media.dispatch("change"); },
    hide() { doc.hidden = true; doc.dispatch("visibilitychange"); },
  };
}

function render(f, controller, cells, period = "2026-10", mode = "amount") {
  controller.beforeRender();
  f.container.replaceChildren(...cells);
  controller.afterRender({ periodKey: period, mode });
  return f.container.querySelector(".day-selection-ring");
}

test("period direction distinguishes refresh, forward, reverse and a year boundary", () => {
  assert.equal(calendarPeriodDirection("2026-12", "2027-1"), 1);
  assert.equal(calendarPeriodDirection("2027-1", "2026-12"), -1);
  assert.equal(calendarPeriodDirection("2026-10", "2026-10"), 0);
  assert.equal(calendarPeriodDirection(null, "2026-10"), 0);
  assert.equal(calendarPeriodDirection("2026-13", "2026-10"), 0);
});

test("row staggering finishes every row and is later for lower rows", () => {
  assert.equal(calendarRowProgress(0, 5, 6), 0);
  assert.equal(calendarRowProgress(1, 5, 6), 1);
  assert.ok(calendarRowProgress(0.3, 0, 6) > calendarRowProgress(0.3, 5, 6));
});

test("rapid date selection retargets from the displayed ring without a jump", () => {
  const f = setup(), controller = createCalendarMotion(f.container, f);
  const ring = render(f, controller, [f.cell("2026-10-01", { selected: true })]);
  f.frames();
  render(f, controller, [f.cell("2026-10-02", { selected: true, x: 56, y: 76 })]);
  f.frames(5);
  const presentation = ring.style.transform;
  assert.notEqual(presentation, "translate(0px, 0px)");
  assert.notEqual(presentation, "translate(56px, 76px)");
  render(f, controller, [f.cell("2026-10-03", { selected: true, x: 112, y: 152 })]);
  assert.equal(ring.style.transform, presentation);
  f.frames();
  assert.equal(ring.style.transform, "translate(112px, 152px)");
  assert.equal(ring.getAttribute("aria-hidden"), "true");
  assert.equal(ring.getAttribute("inert"), "");
  controller.dispose();
});

test("new month has directional entry and row staggering; same month refresh does not reenter", () => {
  const f = setup(), controller = createCalendarMotion(f.container, f);
  const makeCells = () => Array.from({ length: 35 }, (_, i) => f.cell(`synthetic-${i}`, { selected: i === 0 }));
  render(f, controller, makeCells(), "2026-12"); f.frames();
  const cells = makeCells();
  render(f, controller, cells, "2027-1");
  assert.equal(f.container.style.transform, "translateX(38px)");
  f.frames(4);
  assert.ok(Number(cells[0].style.getPropertyValue("--calendar-row-opacity")) > Number(cells[28].style.getPropertyValue("--calendar-row-opacity")));
  f.frames();
  render(f, controller, makeCells(), "2027-1");
  assert.equal(f.container.style.transform, "");
  assert.equal(f.container.classList.contains("is-calendar-entering"), false);
  assert.equal(f.pending(), 0);
  render(f, controller, makeCells(), "2026-12");
  assert.equal(f.container.style.transform, "translateX(-38px)");
  controller.dispose();
});

test("calendar mode changes animate the values and notify selection while preserving the real button", () => {
  const f = setup();
  let connected = 0;
  const controller = createCalendarMotion(f.container, { ...f, onModeChange: () => { connected += 1; } });
  render(f, controller, [f.cell("2026-10-01", { selected: true })]); f.frames();
  const selected = f.cell("2026-10-01", { selected: true });
  render(f, controller, [selected], "2026-10", "count");
  assert.equal(selected.style.getPropertyValue("--calendar-row-y"), "4px");
  assert.equal(f.container.children[0], selected);
  assert.equal(f.container.children.length, 2, "only the real button and inaccessible ring exist");
  assert.equal(connected, 1);
  f.frames();
  assert.equal(selected.style.getPropertyValue("--calendar-row-y"), "");
  controller.dispose();
});

test("keyboard focus stays on the same date through a rebuild; toolbar focus is untouched", () => {
  const f = setup(), controller = createCalendarMotion(f.container, f);
  const old = f.cell("2026-10-02", { selected: true });
  render(f, controller, [old]); f.frames(); old.focus();
  const fresh = f.cell("2026-10-02", { selected: true });
  render(f, controller, [fresh]);
  assert.equal(f.doc.activeElement, fresh);
  assert.deepEqual(fresh.focusOptions, { preventScroll: true });
  const toolbar = f.node(); toolbar.focus();
  render(f, controller, [f.cell("2026-10-03", { selected: true })]);
  assert.equal(f.doc.activeElement, toolbar);
  controller.dispose();
});

test("press feedback is immediate on down, clears on up/cancel and never selects a date", () => {
  const f = setup(), controller = createCalendarMotion(f.container, f);
  const selected = f.cell("2026-10-01", { selected: true });
  render(f, controller, [selected]); f.frames();
  f.container.dispatch("pointerdown", { target: selected });
  assert.equal(selected.classList.contains("is-calendar-pressed"), true);
  f.doc.dispatch("pointerup");
  assert.equal(selected.classList.contains("is-calendar-pressed"), false);
  f.container.dispatch("keydown", { target: selected, key: " " });
  assert.equal(selected.classList.contains("is-calendar-pressed"), true);
  f.doc.dispatch("pointercancel");
  assert.equal(selected.classList.contains("is-calendar-pressed"), false);
  assert.equal(selected.classList.contains("selected"), true);
  controller.dispose();
});

test("reduced-motion changes mid-flight finish ring and entry and clear every presentation style", () => {
  const f = setup(), controller = createCalendarMotion(f.container, f);
  render(f, controller, [f.cell("2026-10-01", { selected: true })]); f.frames();
  const cells = [f.cell("2026-10-02", { selected: true, x: 56, y: 76 })];
  const ring = render(f, controller, cells); f.frames(3);
  f.reduce();
  assert.equal(ring.style.transform, "translate(56px, 76px)");
  assert.equal(f.pending(), 0);
  f.reduce(false);
  render(f, controller, cells, "2026-11"); f.frames(3); f.reduce();
  assert.equal(f.container.style.transform, "");
  assert.equal(f.container.classList.contains("is-calendar-entering"), false);
  assert.equal(cells[0].style.getPropertyValue("--calendar-row-y"), "");
  assert.equal(cells[0].style.getPropertyValue("--calendar-row-opacity"), "");
  assert.equal(f.pending(), 0);
  controller.dispose();
});

test("hidden or reduced-motion initial calendars render immediately without deferred entry", () => {
  for (const hidden of [false, true]) {
    const f = setup({ reduced: !hidden }), controller = createCalendarMotion(f.container, f);
    f.doc.hidden = hidden;
    const ring = render(f, controller, [f.cell("2026-10-01", { selected: true, x: 56 })]);
    assert.equal(ring.style.transform, "translate(56px, 0px)");
    assert.equal(f.container.style.transform, "");
    assert.equal(f.pending(), 0);
    controller.dispose();
  }
});

test("a calendar rendered in a hidden app view places its ring when the real box becomes visible", () => {
  const f = setup();
  let notify, disconnected = false, visible = false;
  f.win.ResizeObserver = class {
    constructor(callback) { notify = callback; }
    observe(target) { assert.equal(target, f.container); }
    disconnect() { disconnected = true; }
  };
  f.container.getBoundingClientRect = () => ({ left: 10, top: 20, width: visible ? 392 : 0, height: visible ? 380 : 0 });
  const selected = f.cell("2026-10-01", { selected: true });
  selected.getBoundingClientRect = () => ({ left: 66, top: 20, width: visible ? 56 : 0, height: visible ? 76 : 0 });
  const controller = createCalendarMotion(f.container, f);
  const ring = render(f, controller, [selected]);
  assert.equal(ring.style.opacity, "0"); assert.equal(f.pending(), 0);
  visible = true; notify();
  assert.equal(ring.style.opacity, "1");
  assert.equal(ring.style.transform, "translate(56px, 0px)");
  assert.equal(f.pending(), 0);
  controller.dispose(); assert.equal(disconnected, true);
});

test("latest full selected-date paint cancels an old dock fade and remains current after settling", () => {
  const f = setup(), panel = f.node(), dock = f.node();
  paintCalendarSelection([panel, dock], "A", () => { panel.textContent = dock.textContent = "A"; }, f);
  crossfade(dock, () => { dock.textContent = "stale A"; }, f);
  f.frames(3);
  paintCalendarSelection([panel, dock], "B", () => { panel.textContent = dock.textContent = "B"; }, f);
  assert.equal(panel.textContent, "B"); assert.equal(dock.textContent, "B");
  f.frames(3);
  paintCalendarSelection([panel, dock], "C", () => { panel.textContent = dock.textContent = "C"; }, f);
  assert.equal(panel.textContent, "C"); assert.equal(dock.textContent, "C");
  f.frames();
  assert.equal(panel.textContent, "C"); assert.equal(dock.textContent, "C");
  assert.equal(panel.style.opacity, ""); assert.equal(panel.style.transform, "");
});

test("selected-date mode change animates but repeated same state does not; reduce clears an active transition", () => {
  const f = setup(), panel = f.node();
  paintCalendarSelection([panel], "2026-10-01:amount", () => { panel.textContent = "latest"; }, f);
  paintCalendarSelection([panel], "2026-10-01:count", () => { panel.textContent = "latest"; }, f);
  assert.equal(panel.classList.contains("is-calendar-selection-moving"), true);
  f.frames(2); f.reduce();
  assert.equal(panel.style.transform, ""); assert.equal(panel.style.opacity, "");
  assert.equal(f.pending(), 0);
  f.reduce(false);
  paintCalendarSelection([panel], "2026-10-01:count", () => { panel.textContent = "new data"; }, f);
  assert.equal(panel.textContent, "new data"); assert.equal(f.pending(), 0);
});

test("phone display:contents wrapper uses the dock's visible box without delaying the full paint", () => {
  const f = setup(), panel = f.node(), dock = f.node();
  panel.display = "contents";
  paintCalendarSelection([panel, dock], "A", () => { panel.textContent = dock.textContent = "A"; }, f);
  paintCalendarSelection([panel, dock], "B", () => { panel.textContent = dock.textContent = "B"; }, f);
  assert.equal(panel.textContent, "B"); assert.equal(dock.textContent, "B");
  assert.equal(panel.style.transform, "");
  assert.equal(dock.style.transform, "translateY(6px)");
  f.reduce();
  assert.equal(dock.style.transform, ""); assert.equal(f.pending(), 0);
});
