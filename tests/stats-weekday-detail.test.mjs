import assert from "node:assert/strict";
import test from "node:test";
import { buildWeekdayRecords, createStatsWeekdayDetail } from "../src/lib/stats-weekday-detail.js";

test("weekday detail keeps canonical totals, including zero-sales work and off days", () => {
  const days = [
    { dateKey: "2026-10-04", revenue: 0, count: 0, worked: true, off: false, raw: "private" },
    { dateKey: "2026-09-27", revenue: 1234, count: 2, worked: true },
    { dateKey: "2026-09-20", revenue: 0, off: true },
    { dateKey: "2026-10-05", revenue: 500, worked: true },
  ];
  const rows = buildWeekdayRecords(days, 0);
  assert.deepEqual(rows.map((day) => day.dateKey), ["2026-10-04", "2026-09-27", "2026-09-20"]);
  assert.equal(rows[0].worked, true);
  assert.equal(rows[0].revenue, 0);
  assert.equal(rows[1].revenue, 1234);
  assert.equal(rows[2].off, true);
  assert.equal("raw" in rows[0], false);
  assert.equal(days[0].raw, "private");
});

test("weekday detail rejects impossible dates and invalid selection", () => {
  const days = [{ dateKey: "2026-02-29" }, { dateKey: "2026-13-01" }, { dateKey: "2026-1-04" }, { dateKey: '<img src=x>' }, null];
  for (let index = 0; index < 7; index++) assert.deepEqual(buildWeekdayRecords(days, index), []);
  for (const index of [-1, 7, NaN, "0"]) assert.deepEqual(buildWeekdayRecords([], index), []);
  assert.equal(buildWeekdayRecords([{ dateKey: "2024-02-29" }], 4).length, 1);
});

function column(index, best = false) {
  const classes = new Set(best ? ["is-best"] : []);
  return {
    dataset: { weekday: String(index) }, attrs: {}, listeners: {},
    classList: { contains: (name) => classes.has(name), remove: (name) => classes.delete(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) },
    setAttribute(name, value) { this.attrs[name] = value; }, removeAttribute(name) { delete this.attrs[name]; },
    addEventListener(name, handler) { this.listeners[name] = handler; },
    removeEventListener(name, handler) { if (this.listeners[name] === handler) delete this.listeners[name]; },
    querySelector: () => ({ textContent: "10만" }), focus() { this.focused = true; },
  };
}

test("weekday controls support keyboard selection and release replaced columns", () => {
  let cols = Array.from({ length: 7 }, (_, index) => column(index, index === 5));
  const recordsRoot = { innerHTML: "", querySelector: () => null };
  const controller = createStatsWeekdayDetail({ root: { querySelectorAll: () => cols }, recordsRoot });
  controller.render({ days: [{ dateKey: "2026-10-02", worked: true, revenue: 100000, count: 10 }] });
  assert.equal(cols[5].attrs["aria-pressed"], "true");
  assert.match(recordsRoot.innerHTML, /금요일 · 1일/);
  assert.match(recordsRoot.innerHTML, /10개/);
  let prevented = 0;
  cols[5].listeners.keydown({ key: "ArrowRight", preventDefault() { prevented++; } });
  assert.equal(cols[6].focused, true);
  assert.equal(cols[6].attrs["aria-pressed"], "true");
  assert.match(recordsRoot.innerHTML, /근무 기록이 없습니다/);
  cols[6].listeners.keydown({ key: "Home", preventDefault() { prevented++; } });
  assert.equal(cols[0].attrs["aria-pressed"], "true");
  cols[0].listeners.keydown({ key: "End", preventDefault() { prevented++; } });
  assert.equal(cols[6].attrs["aria-pressed"], "true");
  cols[5].listeners.keydown({ key: " ", preventDefault() { prevented++; } });
  assert.equal(cols[5].attrs["aria-pressed"], "true");
  assert.equal(prevented, 4);
  const oldCols = cols;
  cols = Array.from({ length: 7 }, (_, index) => column(index));
  controller.render({ days: [] });
  assert.equal(Object.keys(oldCols[0].listeners).length, 0);
  assert.equal(cols[5].attrs["aria-pressed"], "true");
  controller.destroy();
  assert.equal(Object.keys(cols[0].listeners).length, 0);
  assert.equal(cols[0].attrs.role, undefined);
  assert.equal(recordsRoot.innerHTML, "");
});
