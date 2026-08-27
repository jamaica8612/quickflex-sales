import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const statsUi = readFileSync(new URL("../src/ui/stats.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function sourceFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start + 1) : source.length;
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

test("the rendered report uses the shared model and existing priced record calculations", () => {
  const adapter = sourceFunction(main, "statsDailyRecords", "statsModeTitle");
  const render = sourceFunction(main, "renderStats", "syncStatsChartToggle");
  assert.match(adapter, /calcRecordDetails\(record\)/);
  assert.match(adapter, /isWorkedRecord\(record, details\)/);
  assert.match(render, /buildStatsReport\(\{/);
  assert.match(render, /dailyRecords: statsDailyRecords\(\)/);
  assert.match(render, /customRange: state\.statsRangeCustom/);
  assert.match(render, /dateKey >= report\.range\.start && dateKey <= report\.range\.end/);
  assert.doesNotMatch(render, /summarizeKeys\(/);
  assert.doesNotMatch(render, /renderYearlyStats|renderTotalStats|renderStatsSummaryRows/);
});

test("long-range chart renders report buckets and treats the selected metric as active", () => {
  const chart = sourceFunction(main, "renderStatsChart", "showChartTooltip");
  const tooltip = sourceFunction(main, "showChartTooltip", "loadWorkLedgerForRange");
  assert.match(chart, /trend\?\.buckets/);
  assert.match(chart, /statsTrendUnit\(statsChartState\.granularity\)/);
  assert.match(chart, /const active = value > 0/);
  assert.match(chart, /series\.map\(valOf\)\.filter\(\(value\) => value > 0\)/);
  assert.doesNotMatch(chart, /recordVisibleRevenue|parseDateKey\(series\[idx\]/);
  assert.match(tooltip, /point\.start === point\.end/);
  assert.match(tooltip, /point\.label \|\| pointRange/);
  assert.match(tooltip, /canvas\.offsetLeft \+ point\.x/);
  assert.match(tooltip, /canvas\.offsetTop \+ point\.y/);
});

test("revenue composition is read-only and daily disclosure exposes its state", () => {
  const revenue = sourceFunction(main, "renderRevenueList", "niceStep");
  const daily = sourceFunction(main, "renderDailyStatsFor", "renderYearlyStats");
  assert.match(revenue, /<div class="rev-row">/);
  assert.match(revenue, />합계</);
  assert.doesNotMatch(revenue, /checkbox|data-rev-key|revenueVisibility|선택 합계/);
  assert.match(daily, /aria-expanded="\$\{open\}"/);
  assert.match(daily, /aria-controls="\$\{detailId\}"/);
  assert.match(daily, /id="\$\{detailId\}"\$\{open \? "" : " hidden"\}/);
});

test("range controls validate dates and emit only allowlisted usage controls", () => {
  assert.match(statsUi, /if \(!from \|\| !to \|\| from > to\)/);
  assert.match(statsUi, /dayCount > maxStatsCustomRangeDays/);
  assert.match(statsUi, /최대 \$\{maxStatsCustomRangeDays\}일/);
  assert.match(statsUi, /trackStatsControl\?\.\("range_changed"\)/);
  assert.match(statsUi, /trackStatsControl\?\.\("custom_range_applied"\)/);
  assert.match(statsUi, /trackStatsControl\?\.\("chart_metric_changed"\)/);
  assert.match(main, /trackStatsControl\("chart_point_viewed"\)/);
});

test("report and admin settlement navigation keep independent period state", () => {
  const adminHeader = sourceFunction(main, "renderAdminPeriodHeader", "renderAdminDashboard");
  const adminMove = sourceFunction(main, "moveAdminMonth", "routesFromCell");
  const showView = sourceFunction(main, "showView", "nativeBackAction");
  assert.match(main, /adminYear: initialPeriodDate\.getFullYear\(\)/);
  assert.match(main, /adminMonth: initialPeriodDate\.getMonth\(\) \+ 1/);
  assert.match(adminHeader, /periodBounds\(state\.adminYear, state\.adminMonth\)/);
  assert.match(adminMove, /state\.adminYear/);
  assert.match(adminMove, /state\.adminMonth/);
  assert.doesNotMatch(adminMove, /state\.statsYear|state\.statsMonth|renderStats/);
  assert.match(showView, /state\.statsRangeMode !== "custom"[\s\S]*?syncStatsToCurrentPeriod\(\)/);
  assert.match(statsUi, /state\.statsRangeMode === next[\s\S]*?next !== "custom"[\s\S]*?syncStatsToCurrentPeriod/);
});

test("chart exposes keyboard point navigation and a visible focus treatment", () => {
  assert.match(html, /id="statsChart"[^>]*tabindex="0"/);
  assert.match(html, /좌우 방향키/);
  assert.match(statsUi, /addEventListener\("keydown"/);
  assert.match(statsUi, /event\.key === "ArrowLeft"/);
  assert.match(statsUi, /event\.key === "ArrowRight"/);
  assert.match(statsUi, /hasCurrentIndex \? Math\.min\(pointCount - 1, index \+ 1\) : 0/);
  assert.match(statsUi, /showChartTooltipAtIndex\?\.\(index\)/);
  assert.match(main, /canvas\.dataset\.pointCount = String\(series\.length\)/);
  assert.match(css, /\.stats-chart-card canvas:focus-visible[\s\S]*?outline:/);
});

test("approved boot, real view transitions, and admin aggregate are wired without raw usage UI", () => {
  assert.match(main, /showAuth\(false\);\s*trackApprovedSessionStart\(\)/);
  assert.match(main, /if \(view !== previousView\) queueUsageEvent\("screen_viewed", \{ screen: view \}\)/);
  assert.match(main, /fetchUsageSummary\(state\.db, \{ windowDays: 30 \}\)/);
  assert.match(main, /void renderAdminUsageSummary\(\)/);
  assert.match(html, /id="adminUsageSummary"/);
  assert.match(main, /매출·수량·구역·날짜는 수집하지 않습니다/);
});
