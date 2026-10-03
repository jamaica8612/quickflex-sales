import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildHourlyStats } from "../src/lib/stats-hourly.js";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const render = source.slice(source.indexOf("function renderStatsHourly("), source.indexOf("function renderStatsRecords("));
const range = { start: "2026-09-26", end: "2026-10-03" };
const days = ["2026-09-27", "2026-09-28", "2026-09-29"].map((dateKey, i) => ({ dateKey, worked: true, count: 100, revenue: 100000,
  routes: [{ route: "310C", count: 80, revenue: 80000, workId: `synthetic-${i}` }, { route: "310D", count: 20, revenue: 20000, workId: `synthetic-${i}` }] }));
const timings = days.map((day, i) => ({ work_id: `synthetic-${i}`, work_date: day.dateKey, started_at: `${day.dateKey}T00:00:00+09:00`, ended_at: `${day.dateKey}T05:00:00+09:00`, active_seconds: 10800, measured_items: 100, route_active_seconds: { "310C": 9000, "310D": 1800 } }));

function run(rows, inputs = days) {
  const nodes = Object.fromEntries(["statsHourlySection", "statsHourlyContent", "statsActualHourly", "statsDeliveryHourly", "statsHourlyRoutes"].map((id) => [id, { id, innerHTML: "", querySelectorAll: () => [] }]));
  const rolling = [];
  const jobs = [];
  runInNewContext(`${render}; renderStatsHourly({range});`, { range, state: { workTimings: rows }, $: (id) => nodes[id], buildHourlyStats,
    statsHourlyDays: () => inputs, todayKey: () => "2026-10-03", escapeAttr: String,
    statsMetric: (number) => `${number}원`, renderStatsRollingAmount: (node, value) => rolling.push([node.id, value]),
    statsMotion: { whenVisible: (...args) => jobs.push(args) }, motion: { shouldAnimate: () => false }, requestAnimationFrame: (fn) => fn() });
  return { nodes, rolling, jobs };
}

test("no timing history hides the card and fewer than three days shows only guidance", () => {
  const empty = run([]);
  assert.equal(empty.nodes.statsHourlySection.hidden, true);
  const few = run(timings.slice(0, 2));
  assert.equal(few.nodes.statsHourlySection.hidden, false);
  assert.match(few.nodes.statsHourlyContent.innerHTML, /측정한 날이 3일 이상 쌓이면 보입니다/);
  assert.doesNotMatch(few.nodes.statsHourlyContent.innerHTML, /실제 시급|배송 시급|구역별/);
  assert.deepEqual(few.rolling, []);
});

test("three measured days render agreed work and active hourly figures and route comparison", () => {
  const { nodes, rolling, jobs } = run(timings);
  assert.equal(nodes.statsHourlySection.hidden, false);
  assert.deepEqual(rolling, [["statsActualHourly", 20000], ["statsDeliveryHourly", 100000 / 3]]);
  assert.match(nodes.statsHourlyContent.innerHTML, /2시간 0분/);
  assert.match(nodes.statsHourlyContent.innerHTML, /개수는 310C가 가장 많지만 시간당으로는 310D/);
  assert.match(nodes.statsHourlyContent.innerHTML, /측정한 3일 기준.*0일 제외/);
  assert.match(nodes.statsHourlyRoutes.innerHTML, /is-best.*310D/);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0][0], nodes.statsHourlySection);
  assert.equal(jobs[0][1], "hourly-bars");
});

test("insufficient coverage never contributes to card amounts or best hourly days", () => {
  const more = [...days, { ...days[0], dateKey: "2026-09-30", revenue: 1000000 }];
  const rows = [...timings, { ...timings[0], work_id: "synthetic-low", work_date: "2026-09-30", measured_items: 79 }];
  const result = run(rows, more);
  assert.equal(result.rolling[0][1], 20000);
  assert.match(result.nodes.statsHourlyContent.innerHTML, /측정한 3일 기준.*1일 제외/);
});

test("hourly card follows same-day comparison and precedes the revenue chart", () => {
  assert.ok(html.indexOf('id="statsChangeSection"') < html.indexOf('id="statsHourlySection"'));
  assert.ok(html.indexOf('id="statsHourlySection"') < html.indexOf('id="statsTrendTitle"'));
});

test("the real route adapter subtracts the day's embedded backup pay and never splits grouped quantities", () => {
  const adapter = source.slice(source.indexOf("function statsHourlyDays("), source.indexOf("function statsModeTitle("));
  const record = { driverType: "backup", backupUnit: 30, automaticWorks: [{ workId: "synthetic-finalized" }], rows: [
    { route: "310C", count: 80, unit: 1080, source: "automatic", workId: "synthetic-finalized" },
    { route: "310D", count: 20, unit: 1500 },
    { route: "310C|310D", count: 5, unit: 1080, source: "automatic", workId: "synthetic-grouped" },
  ] };
  const result = runInNewContext(`${adapter}; statsHourlyDays();`, { state: { entries: { "2026-09-27": record } },
    statsDailyRecords: () => [{ dateKey: "2026-09-27", count: 105, revenue: 120000, worked: true }],
    normalizeRecordShape: (value) => value, defaultBackupUnit: (value) => value, toNum: Number,
    splitStoredRoutes: (value) => value.split("|"), isAutomaticRow: (row) => row.source === "automatic", effectiveUnit: (row) => row.unit,
  });
  assert.equal(result[0].routes.length, 1);
  assert.equal(result[0].routes[0].revenue, 80 * 1050);
  assert.equal(result[0].routes[0].workId, "synthetic-finalized");
  assert.equal(result[0].revenue, 120000, "daily revenue remains the saved total with extras");
  assert.equal(record.rows[0].unit, 1080, "saved snapshots are unchanged");
});
