import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const start = main.indexOf("function renderHomeDayOverview(");
const end = main.indexOf("\nfunction selectDate(", start);
assert.ok(start > 0 && end > start);

function setup() {
  const el = Object.fromEntries([
    "homeDayPanel", "homeDayTitle", "homeDayToday", "homeDayIcon",
    "homeDayValue", "homeDayHint", "homeDayState", "homeOffWideLabel",
  ].map((key) => [key, { textContent: "", hidden: false, dataset: {} }]));
  el.homeDayIcon.toggleAttribute = (name, hidden) => { el.homeDayIcon.hidden = hidden; };
  const state = { selectedDate: "2026-09-13" };
  const context = vm.createContext({
    el, state, Intl, Date,
    toDateKey: () => "2026-09-13",
    hasEnteredCounts: (record) => record.rows.some((row) => Number(row.count) > 0),
    fmtWon: (value) => `${value.toLocaleString("ko-KR")}원`,
    renderNumberWithUnit: (target, value) => { target.textContent = value; },
  });
  vm.runInContext(main.slice(start, end), context);
  return { el, state, render: context.renderHomeDayOverview };
}

test("selected-day panel replaces an off day with route-free manual sales and a missing day without stale content", () => {
  const { el, state, render } = setup();
  const off = { off: true, rows: [] };
  render(off, { revenue: 0 }, false);
  assert.equal(el.homeDayPanel.dataset.dayState, "off");
  assert.equal(el.homeDayIcon.hidden, false);
  assert.equal(el.homeDayValue.textContent, "휴무일");
  assert.equal(el.homeOffWideLabel.textContent, "근무로 변경");
  assert.equal(el.homeDayToday.hidden, false);
  assert.deepEqual(off, { off: true, rows: [] });

  state.selectedDate = "2026-09-12";
  render({ off: false, rows: [] }, { revenue: 120000 }, false);
  assert.equal(el.homeDayPanel.dataset.dayState, "recorded");
  assert.equal(el.homeDayValue.textContent, "120,000원");
  assert.equal(el.homeDayIcon.hidden, true);
  assert.equal(el.homeDayToday.hidden, true);
  assert.match(el.homeDayTitle.textContent, /9월 12일.*토요일/);

  render({ off: false, rows: [] }, { revenue: 0 }, false);
  assert.equal(el.homeDayPanel.dataset.dayState, "missing");
  assert.equal(el.homeDayValue.textContent, "매출 미기록");
  assert.equal(el.homeDayState.textContent, "미기록");
  assert.equal(el.homeOffWideLabel.textContent, "휴무로 설정");
});

test("a schedule without quantities stays unrecorded while a completed automatic zero remains a real zero", () => {
  const { el, render } = setup();
  const schedule = { off: false, rows: [{ route: "232C", count: 0 }] };
  render(schedule, { revenue: 0 }, false);
  assert.equal(el.homeDayPanel.dataset.dayState, "planned");
  assert.equal(el.homeDayValue.textContent, "매출 미기록");
  assert.equal(el.homeDayState.textContent, "근무표 등록");
  render(schedule, { revenue: 0 }, true);
  assert.equal(el.homeDayPanel.dataset.dayState, "recorded");
  assert.equal(el.homeDayValue.textContent, "0원");
});
