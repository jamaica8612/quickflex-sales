import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { expandRouteText, formatRecordRoutes, joinStoredRoutes, splitStoredRoutes } from "../src/lib/route.js";
import { fmtCount, fmtWon } from "../src/lib/format.js";
import { toNum } from "../src/lib/revenue.js";

const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8").replaceAll("\r\n", "\n");
function declaration(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, name);
  const next = source.slice(start + 1).search(/\n(?:async )?function /);
  return source.slice(start, next < 0 ? source.length : start + 1 + next);
}

function setup() {
  const el = Object.fromEntries([
    "selectedDateBreakdown", "selectedDateBreakdownTitle", "selectedDateBreakdownRows",
    "selectedDateBreakdownNote", "openSalesOverride",
  ].map((key) => [key, { textContent: "", innerHTML: "" }]));
  el.selectedDateBreakdown.classList = {
    toggle(name, hidden) { assert.equal(name, "hidden"); el.selectedDateBreakdown.hidden = hidden; },
  };
  const context = vm.createContext({
    el, state: { selectedDate: "2026-10-13", workRouteDetails: {}, workRouteDetailsContractAvailable: false },
    DEFAULT_BACKUP_UNIT: 30, isBackupDriver: () => true, freshbagMode: () => "single",
    // Current defaults deliberately differ from the date's saved unit snapshots.
    sharedRateForRoutes: () => 9999, rateFor: () => 9999,
    expandRouteText, formatRecordRoutes, joinStoredRoutes, splitStoredRoutes, fmtCount, fmtWon, toNum,
    formatMonthDay: () => "10월 13일",
    escapeAttr: (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;"),
  });
  const names = [
    "defaultFreshUnit", "defaultBackupUnit", "freshbagModeForRecord", "isAutomaticRow", "automaticRows",
    "hasAutomaticEntries", "mergeGroupedRows", "normalizeRecordShape", "hasEnteredCounts", "effectiveUnit", "calcRecordDetails",
    "renderSelectedDateBreakdown",
  ];
  vm.runInContext(names.map(declaration).join("\n"), context);
  return { el, render: context.renderSelectedDateBreakdown, totals: context.calcRecordDetails };
}

function manual(overrides = {}) {
  return {
    off: false, rows: [{ route: "990A", count: 3, unit: 1000 }, { route: "990B", count: 5, unit: 2000 }],
    automaticWorks: [], driverType: "backup", backupUnit: 30,
    freshCount: 2, freshUnit: 100, freshbagMode: "single", ...overrides,
  };
}

for (const driverType of ["backup", "fixed"]) {
  test(`manual ${driverType} date displays saved route quantities, prices and fresh bags without measurement access`, () => {
    const { el, render, totals } = setup();
    const record = manual({ driverType });
    const before = structuredClone(record);
    render(record);
    assert.equal(el.selectedDateBreakdown.hidden, false);
    const html = el.selectedDateBreakdownRows.innerHTML;
    assert.match(html, /<strong>990A<\/strong><span>3건<\/span>/);
    assert.match(html, /<strong>990B<\/strong><span>5건<\/span>/);
    assert.ok(html.includes(driverType === "backup" ? "3,090원" : "3,000원"));
    assert.ok(html.includes(driverType === "backup" ? "10,150원" : "10,000원"));
    assert.match(html, /<strong>프레시백<\/strong><span>2건<\/span>/);
    assert.match(html, /200원/);
    assert.equal(totals(record).revenue, driverType === "backup" ? 13440 : 13200);
    assert.doesNotMatch(html, /세부구역 기록 없음|이전 앱|0건으로 보정/);
    assert.equal(el.selectedDateBreakdownNote.hidden, true);
    assert.deepEqual(record, before);
  });
}

test("manual grouped routes keep the entered quantity together without an inferred or rounded split", () => {
  const { el, render } = setup();
  const record = manual({ rows: [{ route: "990A|990B", count: 3, unit: 1000 }], freshCount: 0 });
  const before = structuredClone(record);
  render(record);
  assert.equal(el.selectedDateBreakdown.hidden, false);
  const html = el.selectedDateBreakdownRows.innerHTML;
  assert.equal((html.match(/<article /g) || []).length, 1);
  assert.match(html, /<strong>990AB<\/strong><span>3건<\/span>/);
  assert.match(html, /3,090원/);
  assert.deepEqual(record, before);
});

test("empty, scheduled-only and off dates hide the preceding manual date's detail panel", () => {
  const { el, render } = setup();
  for (const record of [
    manual({ rows: [], freshCount: 0 }),
    manual({ rows: [{ route: "990A", count: "", unit: 1000 }], freshCount: 0 }),
    manual({ off: true }),
  ]) {
    render(manual());
    assert.equal(el.selectedDateBreakdown.hidden, false);
    render(record);
    assert.equal(el.selectedDateBreakdown.hidden, true);
  }
});

for (const freshbagMode of ["single", "dual"]) {
  test(`manual ${freshbagMode} fresh-only date displays bag revenue without a zero-delivery correction warning`, () => {
    const { el, render } = setup();
    render(manual({ rows: [], freshbagMode, freshSoloCount: 1, freshLinkedCount: 2 }));
    assert.equal(el.selectedDateBreakdown.hidden, false);
    const html = el.selectedDateBreakdownRows.innerHTML;
    assert.equal((html.match(/<article /g) || []).length, 1);
    assert.ok(html.includes(freshbagMode === "dual" ? "3건" : "2건"));
    assert.ok(html.includes(freshbagMode === "dual" ? "400원" : "200원"));
    assert.doesNotMatch(html, /0건으로 보정|세부구역 기록 없음/);
    assert.equal(el.selectedDateBreakdownNote.hidden, true);
  });
}
