import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeRoute,
  routeListFromText,
  expandRouteText,
  compactRouteList,
  formatRouteLabel,
  formatRecordRoutes,
} from "../src/lib/route.js";
import { toDateKey, parseDateKey, addDays, formatLongShort } from "../src/lib/date.js";
import { toNum, routeRevenue } from "../src/lib/revenue.js";
import { fmtWon, fmtCount, fmtNum } from "../src/lib/format.js";

test("normalizeRoute trims and uppercases", () => {
  assert.equal(normalizeRoute("  302a "), "302A");
  assert.equal(normalizeRoute(null), "");
});

test("routeListFromText splits on comma/space/slash/pipe and dedups", () => {
  assert.deepEqual(routeListFromText("302A, 302B/303A 302A"), ["302A", "302B", "303A"]);
  assert.deepEqual(routeListFromText("302a|303b"), ["302A", "303B"]);
  assert.deepEqual(routeListFromText(""), []);
});

test("expandRouteText expands multi-suffix codes and dedups", () => {
  assert.deepEqual(expandRouteText("302AB"), ["302A", "302B"]);
  assert.deepEqual(expandRouteText("302A,303B"), ["302A", "303B"]);
  assert.deepEqual(expandRouteText("302AB,302A"), ["302A", "302B"]);
});

test("compactRouteList groups suffixes by prefix", () => {
  assert.equal(compactRouteList(["302A", "302B", "303A"]), "302AB 303A");
  assert.equal(compactRouteList("302A 302B"), "302AB");
});

test("formatRouteLabel and formatRecordRoutes", () => {
  assert.equal(formatRouteLabel("302A 302B"), "302AB");
  assert.equal(formatRecordRoutes([{ route: "302A" }, { route: "302B" }]), "302AB");
  assert.equal(formatRecordRoutes([]), "");
});

test("toDateKey / parseDateKey round trip", () => {
  assert.equal(toDateKey(new Date(2026, 4, 30)), "2026-05-30");
  assert.equal(toDateKey(parseDateKey("2026-05-30")), "2026-05-30");
});

test("addDays crosses month and year boundaries", () => {
  assert.equal(addDays("2026-05-30", 2), "2026-06-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

test("formatLongShort renders MM/DD(weekday)", () => {
  const out = formatLongShort("2026-05-30");
  assert.match(out, /^05\/30\(.\)$/);
});

test("toNum strips formatting and coerces safely", () => {
  assert.equal(toNum("1,234,567원"), 1234567);
  assert.equal(toNum("12.5"), 12.5);
  assert.equal(toNum(""), 0);
  assert.equal(toNum(null), 0);
  assert.equal(toNum("abc"), 0);
});

test("routeRevenue multiplies count by unit", () => {
  assert.equal(routeRevenue(10, 1000), 10000);
  assert.equal(routeRevenue("10", "1000"), 10000);
  assert.equal(routeRevenue(null, 1000), 0);
});

test("money formatters group and round", () => {
  assert.equal(fmtWon(1234567), "1,234,567원");
  assert.equal(fmtCount(1000), "1,000건");
  assert.equal(fmtNum(0), "0");
  assert.equal(fmtWon("abc"), "0원");
  assert.equal(fmtWon(99.6), "100원");
});
