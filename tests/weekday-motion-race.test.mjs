import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const sourceStart = main.indexOf("const weekdayBars = motion.createAnimationGroup();");
const sourceEnd = main.indexOf("function compactMoneyLabel(", sourceStart);
assert.ok(sourceStart >= 0 && sourceEnd > sourceStart, "actual weekday renderer source markers exist");
const weekdaySource = main.slice(sourceStart, sourceEnd);

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    dispatch(type) { [...(listeners.get(type) || [])].forEach((callback) => callback({ type })); },
  };
}

function setup() {
  let now = 0;
  let nextTimerId = 1;
  let built = false;
  const timers = new Map();
  const cancelledTimers = [];
  const runs = [];
  const records = new Map();
  const media = { matches: false, ...eventTarget() };
  const doc = { hidden: false, ...eventTarget() };
  const columns = Array.from({ length: 7 }, () => ({
    fill: { dataset: {}, style: {}, isConnected: true },
    average: { textContent: "" }, days: { textContent: "" }, classList: { toggle() {} },
  }));
  const note = { textContent: "" };
  const host = {
    querySelectorAll(selector) {
      if (!built) return [];
      if (selector === ".wd-col") return columns;
      if (selector === ".wd-track > span") return columns.map((column) => column.fill);
      return [];
    },
    set innerHTML(value) { built = value.includes('class="wd-bars"'); },
    querySelector(selector) {
      if (selector === ".wd-note") return note;
      const match = selector.match(/data-weekday="(\d+)"/);
      if (!built || !match) return null;
      const column = columns[Number(match[1])];
      return {
        classList: column.classList,
        querySelector(child) {
          if (child === ".wd-avg") return column.average;
          if (child === ".wd-days") return column.days;
          if (child === ".wd-track > span") return column.fill;
          return null;
        },
      };
    },
  };
  const group = {
    cancelAll() {},
    run(key, from, target, options) {
      runs.push({ key, from, target, at: now });
      // Spring integrator lifecycle is covered separately. Immediate settling
      // isolates the real renderer's timer cancellation and revision ownership.
      options.onUpdate(target);
    },
  };
  const context = {
    document: doc, window: { matchMedia: () => media },
    el: { weekdayStats: host },
    WEEKDAY_LABELS: ["일", "월", "화", "수", "목", "금", "토"],
    getRecord: (key) => records.get(key),
    hasMeaningfulRecord: (record) => Boolean(record),
    normalizeRecordShape: (record) => record,
    calcRecordDetails: (record) => ({ revenue: record.revenue, count: 1 }),
    isWorkedRecord: (record) => !record.off,
    parseDateKey: (key) => ({ getDay: () => records.get(key).weekday }),
    fmtWon: String, compactMoneyLabel: String,
    motion: { createAnimationGroup: () => group, shouldAnimate: () => !media.matches && !doc.hidden },
    statsCard: () => host,
    statsMotion: { whenVisible(_card, _key, callback) { callback(); } },
    setTimeout(callback, delay = 0) {
      const id = nextTimerId++;
      timers.set(id, { id, callback, due: now + delay });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer) cancelledTimers.push(timer);
      timers.delete(id);
    },
  };
  runInNewContext(`${weekdaySource}\n;globalThis.weekdayTestApi = {
    render: renderWeekdayStats,
    pendingRendererTimers: () => weekdayBarTimers.size,
  };`, context, { timeout: 1000 });

  function fixture(prefix, sundayRevenue = 100, saturdayRevenue = 80) {
    return [0, 6].map((weekday) => {
      const key = `synthetic-${prefix}-weekday-${weekday}`;
      records.set(key, { weekday, revenue: weekday === 0 ? sundayRevenue : saturdayRevenue, off: false });
      return key;
    });
  }
  function advanceTo(targetTime) {
    for (;;) {
      const next = [...timers.values()].filter((timer) => timer.due <= targetTime)
        .sort((a, b) => a.due - b.due || a.id - b.id)[0];
      if (!next) break;
      now = next.due;
      timers.delete(next.id);
      next.callback();
    }
    now = targetTime;
  }
  return {
    columns, runs, timers, cancelledTimers, fixture, advanceTo,
    render: context.weekdayTestApi.render,
    pendingRendererTimers: context.weekdayTestApi.pendingRendererTimers,
    reduce() { media.matches = true; media.dispatch("change"); },
    hide() { doc.hidden = true; doc.dispatch("visibilitychange"); },
  };
}

function assertSettledAtLatestTargets(env) {
  env.columns.forEach(({ fill }) => {
    const target = Number(fill.dataset.moScale || 0);
    assert.equal(Number(fill.dataset.moShown || 0), target);
    assert.equal(fill.style.transform, `scaleY(${target})`);
  });
}

test("rapid weekday A to B cannot let a cancelled old callback overwrite the latest height", () => {
  const env = setup();
  env.render(env.fixture("A", 100, 80));
  env.advanceTo(10);
  const saturday = env.columns[6].fill;
  assert.equal(saturday.dataset.moShown, "0", "A Saturday is still waiting for its stagger");
  env.render(env.fixture("B", 100, 0));
  assert.equal(Number(saturday.dataset.moScale), 0.04);
  assert.ok(env.cancelledTimers.length > 0, "the next render cancels A's pending timers");
  // A callback that was already handed to another queue must still lose the
  // ownership check, even independently of clearTimeout's normal protection.
  const runsBeforeStaleCallbacks = env.runs.length;
  env.cancelledTimers.forEach((timer) => timer.callback());
  assert.equal(env.runs.length, runsBeforeStaleCallbacks, "old revision cannot start a spring");
  env.advanceTo(1000);
  assert.equal(saturday.style.transform, "scaleY(0.04)");
  assert.equal(env.columns[6].average.textContent, "0");
  assertSettledAtLatestTargets(env);
  assert.equal(env.timers.size, 0);
  assert.equal(env.pendingRendererTimers(), 0);
});

test("the same target is rescheduled when its first stagger has not painted yet", () => {
  const env = setup();
  const keys = env.fixture("same", 100, 80);
  env.render(keys);
  env.advanceTo(10);
  const saturday = env.columns[6].fill;
  assert.equal(Number(saturday.dataset.moScale), 0.8);
  assert.equal(Number(saturday.dataset.moShown), 0);
  env.render(keys);
  assert.ok(env.timers.size > 0, "cancelled same-target work needs a replacement start");
  env.advanceTo(1000);
  assert.equal(saturday.style.transform, "scaleY(0.8)");
  assert.equal(env.runs.filter((run) => run.key === "wd-6").length, 1);
  assertSettledAtLatestTargets(env);
  assert.equal(env.pendingRendererTimers(), 0);
});

for (const [label, stop] of [["reduced motion", "reduce"], ["hidden document", "hide"]]) {
  test(`${label} immediately cancels pending weekday timers and snaps all latest targets`, () => {
    const env = setup();
    env.render(env.fixture("environment", 100, 80));
    env.advanceTo(10);
    assert.ok(env.timers.size > 0);
    assert.ok(env.pendingRendererTimers() > 0);
    const runsBeforeStop = env.runs.length;
    env[stop]();
    assert.equal(env.timers.size, 0, "environment change clears pending setTimeout callbacks immediately");
    assert.equal(env.pendingRendererTimers(), 0, "renderer releases every timer handle");
    assertSettledAtLatestTargets(env);
    env.advanceTo(1000);
    assert.equal(env.runs.length, runsBeforeStop, "no delayed spring starts after the environment change");
    assertSettledAtLatestTargets(env);
  });
}
