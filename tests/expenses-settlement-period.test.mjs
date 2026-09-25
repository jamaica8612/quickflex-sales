import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  settlementPeriodBounds,
  settlementPeriodFor,
  settlementPeriodLabel,
  shiftSettlementPeriod,
} from "../src/ui/expenses.js";

// Item 5: the 지출 (expenses) tab must follow the same 26th-to-25th
// settlement period as 매출 and the home summary card, not a calendar month.

test("settlementPeriodFor anchors on the 25th/26th boundary, matching the sales side", () => {
  assert.deepEqual(settlementPeriodFor(new Date(2026, 8, 25)), { year: 2026, month: 9 });
  assert.deepEqual(settlementPeriodFor(new Date(2026, 8, 26)), { year: 2026, month: 10 });
  // December 26 rolls into next January's settlement period.
  assert.deepEqual(settlementPeriodFor(new Date(2026, 11, 26)), { year: 2027, month: 1 });
});

test("settlementPeriodBounds spans the 26th of the prior month through the 25th", () => {
  assert.deepEqual(settlementPeriodBounds(2026, 9), { from: "2026-08-26", to: "2026-09-25" });
  // January's period reaches back into December of the previous year.
  assert.deepEqual(settlementPeriodBounds(2027, 1), { from: "2026-12-26", to: "2027-01-25" });
});

test("shiftSettlementPeriod moves by settlement period, not calendar month, and wraps years", () => {
  assert.deepEqual(shiftSettlementPeriod(2026, 9, 1), { year: 2026, month: 10 });
  assert.deepEqual(shiftSettlementPeriod(2026, 9, -1), { year: 2026, month: 8 });
  assert.deepEqual(shiftSettlementPeriod(2026, 1, -1), { year: 2025, month: 12 });
});

test("settlementPeriodLabel reads like the sales side's period header (short, non-padded M/D)", () => {
  assert.equal(settlementPeriodLabel(2026, 9), "8/26 - 9/25");
  assert.equal(settlementPeriodLabel(2027, 1), "12/26 - 1/25");
});

test("the 지출 tab's own header title says 지출 while its subtitle stays, and only that view changes", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const start = html.indexOf('<section class="view view-expenses">');
  assert.notEqual(start, -1, "missing view-expenses section");
  const end = html.indexOf("</header>", start);
  const header = html.slice(start, end);
  assert.match(header, /<h1>지출<\/h1>/);
  assert.match(header, /영수증부터 가볍게 기록하세요/, "subtitle copy is unchanged");
  // The 매출 (home) view keeps its own 매출노트 title untouched.
  const homeStart = html.indexOf('<section class="view view-home">');
  const homeHeader = html.slice(homeStart, html.indexOf("</header>", homeStart));
  assert.match(homeHeader, /<h1>매출노트<\/h1>/);
});
