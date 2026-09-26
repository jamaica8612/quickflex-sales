import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { shouldShowPreviousPeriod } from "../src/lib/period-fallback.js";

// Regression coverage for 정산노트(stats): when the current settlement period has no
// recorded work day yet, the range selector should default to "지난 정산" (lastMonth)
// instead of the usual "이번 정산" (thisMonth) — unless the user already picked a range
// explicitly this session, in which case their choice is never overwritten.
const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");

function extract(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = source.indexOf(`function ${nextName}(`, start + 1);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}
// syncStatsToCurrentPeriod and applyDefaultStatsRangeMode are declared back to back;
// currentSettlementPeriod (which resolves "today") is deliberately left out so tests
// can control what "the real current period" is without depending on the real clock.
const body = extract("syncStatsToCurrentPeriod", "queueUsageEvent");
assert.match(body, /function applyDefaultStatsRangeMode\(/, "applyDefaultStatsRangeMode must be included");

// Fixture: the real current settlement period is always 2026-09 (statsYear/statsMonth
// start there too, unless a test says otherwise), and its immediate previous period is
// 2026-08.
function harness({
  statsYear = 2026,
  statsMonth = 9,
  statsRangeMode = "thisMonth",
  statsRangeModeUserSet = false,
  currentWorkDays = 0,
  previousWorkDays = 0,
  realPeriod = { year: 2026, month: 9 },
} = {}) {
  const state = { statsYear, statsMonth, statsRangeMode, statsRangeModeUserSet };
  const context = vm.createContext({
    state,
    currentSettlementPeriod: () => realPeriod,
    prevPeriod: (year, month) => (year === 2026 && month === 9 ? { year: 2026, month: 8 } : { year, month: month - 1 }),
    summarizePeriod: (year, month) => (year === statsYear && month === statsMonth
      ? { workDays: currentWorkDays }
      : { workDays: previousWorkDays }),
    shouldShowPreviousPeriod,
  });
  vm.runInContext(`${body}\nglobalThis.sync = syncStatsToCurrentPeriod;`, context);
  context.sync();
  return state;
}

test("defaults to 지난 정산 when the current period has no recorded work day yet", () => {
  const state = harness({ currentWorkDays: 0, previousWorkDays: 20 });
  assert.equal(state.statsRangeMode, "lastMonth");
});

test("stays on 이번 정산 once the current period has at least one recorded work day", () => {
  const state = harness({ currentWorkDays: 1, previousWorkDays: 20, statsRangeMode: "lastMonth" });
  assert.equal(state.statsRangeMode, "thisMonth", "returns to today's behaviour as soon as work is recorded");
});

test("brand-new users with no previous-period data either keep 이번 정산", () => {
  const state = harness({ currentWorkDays: 0, previousWorkDays: 0 });
  assert.equal(state.statsRangeMode, "thisMonth");
});

test("never overrides a range the user already picked explicitly this session", () => {
  const state = harness({
    currentWorkDays: 0, previousWorkDays: 20,
    statsRangeMode: "thisMonth", statsRangeModeUserSet: true,
  });
  assert.equal(state.statsRangeMode, "thisMonth", "the user's explicit choice must not be silently swapped");
});

test("leaves an explicit last3/last12/custom selection untouched even without the user flag", () => {
  const state = harness({ currentWorkDays: 0, previousWorkDays: 20, statsRangeMode: "last3" });
  assert.equal(state.statsRangeMode, "last3");
});

test("syncStatsToCurrentPeriod always resyncs statsYear/statsMonth to the real current period", () => {
  const state = harness({ statsYear: 2026, statsMonth: 6, currentWorkDays: 0, previousWorkDays: 0, realPeriod: { year: 2026, month: 9 } });
  assert.equal(state.statsYear, 2026);
  assert.equal(state.statsMonth, 9);
});
