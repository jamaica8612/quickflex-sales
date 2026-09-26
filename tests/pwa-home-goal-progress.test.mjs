import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { fmtWon, fmtCount } from "../src/lib/format.js";
import { shouldShowPreviousPeriod } from "../src/lib/period-fallback.js";

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

// state.year/month is fixed at the 2026-08-26 ~ 2026-09-25 settlement period for every
// test below; its immediately previous period is 2026-07-26 ~ 2026-08-25.
function harness({ revenue, goal, count = 0, averageCount = 0, average = 0, workDays = 0, previous } = {}) {
  const el = {
    monthTitle: { textContent: "" },
    periodRange: { textContent: "" },
    periodRevenue: {}, periodCount: {}, averageCountHome: {}, dailyAverage: {}, workDaysHome: {},
    meterFill: { style: {} },
    meterPct: { textContent: "" },
    meterLabel: { textContent: "" },
    summaryPeriodBadge: { textContent: "이번 정산기간" },
    summaryPeriodNote: { hidden: true, textContent: "" },
  };
  const currentTotal = { revenue, count, averageCount, average, workDays };
  const previousTotal = previous || { ...currentTotal };
  const ledgerCalls = [];
  const context = vm.createContext({
    el,
    state: { year: 2026, month: 9 },
    periodBounds: (year, month) => (year === undefined
      ? { start: new Date("2026-08-26"), end: new Date("2026-09-25") }
      : { start: new Date("2026-07-26"), end: new Date("2026-08-25") }),
    summarizePeriod: (year, month) => (year === undefined ? currentTotal : previousTotal),
    prevPeriod: () => ({ year: 2026, month: 8 }),
    shouldShowPreviousPeriod,
    formatPeriodRangeSimple: (start, end) => `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`,
    renderNumberWithUnit: (target, value) => { target.textContent = value; },
    formatCompactWonWithUnit: (value) => String(value),
    fmtWon,
    fmtCount,
    getGoal: () => goal,
    renderSummaryLedger: (value, start, end) => ledgerCalls.push({ value, start, end }),
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

// New settlement period, nothing recorded yet: the headline card must fall back to the
// period that just ended instead of showing an all-zero "이번 정산기간" card.
test("a fresh period with zero work days shows last period's result, labeled and noted", () => {
  const { el, ledgerCalls } = harness({
    revenue: 0, goal: 7000000, count: 0, averageCount: 0, average: 0, workDays: 0,
    previous: { revenue: 4200000, count: 180, averageCount: 9, average: 233333, workDays: 20 },
  });
  assert.equal(el.periodRevenue.textContent, fmtWon(4200000), "shows last period's settlement amount, not 0");
  assert.equal(el.periodCount.textContent, fmtCount(180));
  assert.equal(el.workDaysHome.textContent, "20일");
  assert.equal(el.summaryPeriodBadge.textContent, "지난 정산 · 7/26 - 8/25");
  assert.equal(el.summaryPeriodNote.hidden, false);
  assert.equal(el.summaryPeriodNote.textContent, "이번 정산(8/26 - 9/25)은 첫 근무를 기록하면 시작돼요");
  assert.equal(el.meterLabel.textContent, "목표 7,000,000원 대비 진행률", "goal progress is computed against last period's revenue");
  assert.equal(ledgerCalls.length, 1);
  assert.equal(ledgerCalls[0].value, 4200000);
  assert.equal(ledgerCalls[0].start.toISOString().slice(0, 10), "2026-07-26", "지출/남는 돈 also read from last period's range");
  assert.equal(ledgerCalls[0].end.toISOString().slice(0, 10), "2026-08-25");
});

test("once the current period has a recorded work day, today's behaviour returns", () => {
  const { el, ledgerCalls } = harness({
    revenue: 150000, goal: 7000000, count: 5, averageCount: 5, average: 150000, workDays: 1,
    previous: { revenue: 4200000, count: 180, averageCount: 9, average: 233333, workDays: 20 },
  });
  assert.equal(el.periodRevenue.textContent, fmtWon(150000), "shows this period's own (small) result, not last period's");
  assert.equal(el.summaryPeriodBadge.textContent, "이번 정산기간");
  assert.equal(el.summaryPeriodNote.hidden, true);
  assert.equal(ledgerCalls[0].start.toISOString().slice(0, 10), "2026-08-26", "지출/남는 돈 reads this period's own range");
});

test("a brand-new user with no previous-period data either keeps the plain empty state", () => {
  const { el } = harness({ revenue: 0, goal: 7000000, workDays: 0, previous: { revenue: 0, count: 0, averageCount: 0, average: 0, workDays: 0 } });
  assert.equal(el.periodRevenue.textContent, fmtWon(0));
  assert.equal(el.summaryPeriodBadge.textContent, "이번 정산기간");
  assert.equal(el.summaryPeriodNote.hidden, true);
});
