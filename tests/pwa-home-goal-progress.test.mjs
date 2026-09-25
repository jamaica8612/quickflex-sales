import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fmtWon, fmtCount } from "../src/lib/format.js";

// Regression coverage: the 매출노트 home summary card used to clamp both the
// goal bar's percentage TEXT and its fill width to 100%, so a driver who beat
// their goal (7,835,685원 vs a 7,000,000원 goal) saw "100%" on the home card
// while 정산노트(stats) correctly showed "112%" for the same numbers.
// renderSummary() must show the real percentage while keeping the bar visually
// full, and its caption must state the amount exceeded once over goal.
const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");

function extractRenderSummary() {
  const start = source.indexOf("function renderSummary(");
  assert.notEqual(start, -1, "missing renderSummary()");
  const next = source.indexOf("\nfunction ", start + 1);
  assert.notEqual(next, -1, "missing renderSummary() boundary");
  return source.slice(start, next);
}

function harness({ revenue, goal, count = 0, averageCount = 0, average = 0, workDays = 0 }) {
  const el = {
    monthTitle: { textContent: "" },
    periodRange: { textContent: "" },
    periodRevenue: {}, periodCount: {}, averageCountHome: {}, dailyAverage: {}, workDaysHome: {},
    meterFill: { style: {} },
    meterPct: { textContent: "" },
    meterLabel: { textContent: "" },
  };
  const ledgerCalls = [];
  const context = vm.createContext({
    el,
    state: { year: 2026, month: 9 },
    periodBounds: () => ({ start: new Date("2026-08-26"), end: new Date("2026-09-25") }),
    summarizePeriod: () => ({ revenue, count, averageCount, average, workDays }),
    formatPeriodRangeSimple: () => "8/26 - 9/25",
    renderNumberWithUnit: () => {},
    formatCompactWonWithUnit: () => "",
    fmtWon,
    fmtCount,
    getGoal: () => goal,
    renderSummaryLedger: (value) => ledgerCalls.push(value),
  });
  vm.runInContext(`${extractRenderSummary()}\nglobalThis.render = renderSummary;`, context);
  context.render();
  return { el, ledgerCalls };
}

test("revenue above goal shows the real percentage, not a clamped 100%", () => {
  const { el } = harness({ revenue: 7835685, goal: 7000000 });
  assert.equal(el.meterPct.textContent, "112%", "must match the same percent stats shows for these numbers");
  assert.equal(el.meterFill.style.width, "100%", "the bar itself stays visually full once over goal");
  assert.equal(el.meterLabel.textContent, "목표 7,000,000원 대비 +835,685원");
});

test("revenue under goal keeps the plain progress caption and an unclamped bar", () => {
  const { el } = harness({ revenue: 3500000, goal: 7000000 });
  assert.equal(el.meterPct.textContent, "50%");
  assert.equal(el.meterFill.style.width, "50%");
  assert.equal(el.meterLabel.textContent, "목표 7,000,000원 대비 진행률");
});

test("revenue exactly at goal is not treated as over goal", () => {
  const { el } = harness({ revenue: 7000000, goal: 7000000 });
  assert.equal(el.meterPct.textContent, "100%");
  assert.equal(el.meterFill.style.width, "100%");
  assert.equal(el.meterLabel.textContent, "목표 7,000,000원 대비 진행률");
});
