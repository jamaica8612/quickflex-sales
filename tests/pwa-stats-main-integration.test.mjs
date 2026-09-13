import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const statsUi = readFileSync(new URL("../src/ui/stats.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function sourceFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start + 1) : source.length;
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end).replace(/\basync\s*$/, "");
}

test("revenue-only records stay worked while unmatched volume cannot fabricate a delivery unit", () => {
  const result = runInNewContext(`${sourceFunction(main, "statsDailyRecords", "statsModeTitle")}; statsDailyRecords();`, {
    state: { entries: { "2026-09-01": { off: false, rows: [] } } },
    calcRecordDetails: () => ({ revenue: 123456, count: 10, freshRevenue: 0, backupRevenue: 0 }),
    recordRouteAggregates: () => new Map(),
    isWorkedRecord: () => true,
  });
  assert.equal(result[0].revenue, 123456);
  assert.equal(result[0].worked, true);
  assert.equal(result[0].volumeKnown, false);
  assert.equal(result[0].planned, false);
});

test("reconciliation preserves canonical totals instead of summing rounded route shares", () => {
  const el = { revenueList: {} };
  runInNewContext(`${sourceFunction(main, "renderRevenueList", "renderStatsChart")}; renderRevenueList(["a", "b"]);`, {
    el,
    getRecord: (key) => key,
    calcRecordDetails: (key) => ({ revenue: key === "a" ? 101 : 202, freshRevenue: 10, backupRevenue: 20 }),
    statsMetric: (value) => `${value}원`,
  });
  assert.match(el.revenueList.innerHTML, /배송 매출<\/span><strong class="rev-amount">243원/);
  assert.match(el.revenueList.innerHTML, /합계<\/span><strong class="rev-amount">303원/);
});

test("the rendered report uses the shared model and existing priced record calculations", () => {
  const adapter = sourceFunction(main, "statsDailyRecords", "statsModeTitle");
  const render = sourceFunction(main, "renderStats", "renderWeekdayStats");
  assert.match(adapter, /calcRecordDetails\(record\)/);
  assert.match(adapter, /isWorkedRecord\(record, details\)/);
  assert.match(render, /buildStatsReport\(\{/);
  assert.match(render, /dailyRecords: statsDailyRecords\(\)/);
  assert.match(render, /customRange: state\.statsRangeCustom/);
  assert.match(render, /dateKey >= report\.range\.start && dateKey <= report\.range\.end/);
  assert.doesNotMatch(render, /summarizeKeys\(/);
  assert.doesNotMatch(render, /renderYearlyStats|renderTotalStats|renderStatsSummaryRows/);
});

test("sparkline joins worked records densely while keeping genuine zero revenue", () => {
  let path = [];
  const linePaths = [];
  const ctx = {
    setTransform() {}, clearRect() {}, fill() {}, closePath() {},
    beginPath() { path = []; },
    moveTo(x, y) { path.push([x, y]); },
    lineTo(x, y) { path.push([x, y]); },
    bezierCurveTo(a, b, c, d, x, y) { path.push([x, y]); },
    stroke() { linePaths.push(path); },
    createLinearGradient: () => ({ addColorStop() {} }),
  };
  const labels = {};
  const canvas = { clientWidth: 320, getContext: () => ctx, setAttribute(key, value) { labels[key] = value; } };
  const el = { statsChart: canvas, statsChartSummary: {}, statsChartEmpty: {} };
  const days = [
    { revenue: 100000, workDays: 1, recordDays: 1, offDays: 0 },
    { revenue: 0, workDays: 1, recordDays: 1, offDays: 0 },
    { revenue: 0, workDays: 0, recordDays: 1, offDays: 1 },
    { revenue: 0, workDays: 0, recordDays: 0, offDays: 0 },
    { revenue: 200000, workDays: 1, recordDays: 1, offDays: 0 },
  ];
  const env = {
    el, window: { devicePixelRatio: 1 }, document: { documentElement: {} },
    getComputedStyle: () => ({ getPropertyValue: () => "#888888" }),
    fmtWon: String, trend: { buckets: days },
  };
  const source = sourceFunction(main, "renderStatsChart", "effectiveAutomaticLedgerItems") + "; renderStatsChart(trend);";
  runInNewContext(source, env);
  assert.equal(linePaths.length, 1, "one continuous stroke spans all worked records");
  assert.equal(linePaths[0].length, 3, "off and missing dates have no points");
  assert.deepEqual(linePaths[0].map(([x]) => x), [4, 160, 316], "no empty date gaps remain");
  assert.equal(linePaths[0][1][1], 108, "the recorded zero remains on the baseline");
  assert.match(labels["aria-label"], /3개 근무 구간/);
  assert.equal(canvas.hidden, false);
  assert.equal(el.statsChartEmpty.hidden, true);
  env.trend = { buckets: days.slice(2, 4) };
  runInNewContext(source, env);
  assert.equal(canvas.hidden, true, "no decorative curve is fabricated without work");
  assert.equal(el.statsChartEmpty.hidden, false);
});

test("revenue composition is read-only and daily disclosure exposes its state", () => {
  const revenue = sourceFunction(main, "renderRevenueList", "renderStatsChart");
  const daily = sourceFunction(main, "renderDailyStatsFor", "renderYearlyStats");
  assert.match(revenue, /<div class="rev-row">/);
  assert.match(revenue, />합계</);
  assert.doesNotMatch(revenue, /checkbox|data-rev-key|revenueVisibility|선택 합계/);
  assert.match(daily, /aria-expanded="\$\{open\}"/);
  assert.match(daily, /aria-controls="\$\{detailId\}"/);
  assert.match(daily, /id="\$\{detailId\}"\$\{open \? "" : " hidden"\}/);
});

test("sparkline context describes actual endpoints without invalid or partial-period percentages", () => {
  const el = { statsChart: { clientWidth: 320, setAttribute() {}, getContext: () => null }, statsChartChange: {}, statsChartEndpoints: {} };
  const env = { el, window: { devicePixelRatio: 1 }, fmtWon: String };
  const source = sourceFunction(main, "statsMetric", "renderDriverInsights")
    + sourceFunction(main, "renderStatsChart", "effectiveAutomaticLedgerItems") + "; renderStatsChart(trend);";
  const render = (buckets, granularity = "day") => {
    env.trend = { buckets, granularity };
    runInNewContext(source, env);
  };
  const first = { start: "2026-08-26", end: "2026-08-26", workDays: 1, revenue: 347300 };
  const last = { start: "2026-09-12", end: "2026-09-12", workDays: 1, revenue: 294735 };
  render([first, last]);
  assert.match(el.statsChartChange.innerHTML, /첫 근무일 대비.*15\.1.*감소/);
  assert.match(el.statsChartEndpoints.innerHTML, /8\.26 · 시작.*34\.7.*만원.*9\.12 · 최근.*29\.5.*만원/);
  render([{ ...first, revenue: 0 }, last]);
  assert.doesNotMatch(el.statsChartChange.innerHTML, /Infinity|NaN|%/);
  assert.match(el.statsChartChange.innerHTML, /29\.5.*증가/);
  render([{ ...first, end: "2026-08-30" }, last], "week");
  assert.equal(el.statsChartChange.textContent, "주별 합계");
  assert.match(el.statsChartEndpoints.innerHTML, /8\.26–8\.30 · 시작/);
  render([{ ...first, start: "2025-09-26", end: "2025-10-25" }, last], "settlement");
  assert.equal(el.statsChartChange.textContent, "정산별 합계");
  assert.match(el.statsChartEndpoints.innerHTML, /25\.9\.26–25\.10\.25/);
  render([first]);
  assert.equal(el.statsChartChange.textContent, "기록 1일");
  assert.doesNotMatch(el.statsChartEndpoints.innerHTML, /최근/);
  render([]);
  assert.equal(el.statsChartEndpoints.hidden, true);
  assert.equal(el.statsChartChange.hidden, true);
});

test("range controls validate dates and emit only allowlisted usage controls", () => {
  assert.match(statsUi, /if \(!from \|\| !to \|\| from > to\)/);
  assert.match(statsUi, /dayCount > maxStatsCustomRangeDays/);
  assert.match(statsUi, /최대 \$\{maxStatsCustomRangeDays\}일/);
  assert.match(statsUi, /trackStatsControl\?\.\("range_changed"\)/);
  assert.match(statsUi, /trackStatsControl\?\.\("custom_range_applied"\)/);
});

test("report settlement navigation stays independent from view changes", () => {
  const showView = sourceFunction(main, "showView", "nativeBackAction");
  assert.match(showView, /state\.statsRangeMode !== "custom"[\s\S]*?syncStatsToCurrentPeriod\(\)/);
  assert.match(statsUi, /state\.statsRangeMode === next[\s\S]*?next !== "custom"[\s\S]*?syncStatsToCurrentPeriod/);
});

test("revenue flow stays passive and appears before daily patterns", () => {
  assert.ok(html.indexOf('id="statsChart"') < html.indexOf('id="statsPatternsTitle"'));
  assert.doesNotMatch(html, /id="statsChart"[^>]*tabindex/);
  assert.doesNotMatch(html, /id="statsChartToggle"|id="statsChartTooltip"|id="statsTrendDisclosure"/);
  assert.doesNotMatch(statsUi, /showChartTooltip|chart_metric_changed|chart_point_viewed/);
});

test("approved boot and real view transitions retain privacy-safe usage tracking", () => {
  assert.match(main, /showAuth\(false\);\s*trackApprovedSessionStart\(\)/);
  assert.match(main, /if \(view !== previousView\) queueUsageEvent\("screen_viewed", \{ screen: view \}\)/);
  assert.doesNotMatch(main, /renderAdminDashboard|loadWorkLedgerForRange/);
});

test("detail route counts remain visible without unknown or mismatch warnings", () => {
  const selected = sourceFunction(main, "renderSelectedDateBreakdown", "renderHomeSelection");
  const daily = sourceFunction(main, "renderDailyStatsFor", "renderYearlyStats");
  const routes = sourceFunction(main, "renderRouteStats", "renderStatsSummaryRows");
  assert.match(selected, /selected-detail-routes/);
  assert.match(routes, /rs-detail-routes/);
  for (const source of [selected, routes]) {
    assert.doesNotMatch(source, /세부 미확인·미저장|매출 수정과/);
    assert.doesNotMatch(source, /detail-warning/);
  }
  assert.doesNotMatch(css, /selected-detail-warning|rs-detail-warning/);
  assert.match(selected, /totals\.returnCount > 0/);
  assert.match(selected, /반품/);
  assert.match(selected, /배송 매출에 포함/);
  assert.match(daily, /details\.returnCount/);
  assert.match(selected, /totals\.cancellationCount > 0/);
  assert.match(selected, /취소/);
  assert.match(daily, /details\.cancellationCount/);
  assert.match(main, /WORK_RESULT_SELECT = "[^"]*cancel_count/);
});
