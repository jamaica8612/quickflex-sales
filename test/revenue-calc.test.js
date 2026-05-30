import test from "node:test";
import assert from "node:assert/strict";

import { calcRecordDetails, recordRouteAggregates } from "../src/lib/revenue.js";

const deps = (mode = "single") => ({
  effectiveUnit: (row) => Number(row.unit) || 0,
  freshbagMode: mode,
  defaultFreshUnit: (v) => (v == null || v === "" ? 100 : v),
  defaultBackupUnit: (v) => (v == null || v === "" ? 30 : v),
});

test("calcRecordDetails: single mode with backup driver", () => {
  const rec = {
    off: false,
    rows: [{ route: "302A", count: 10, unit: 1000 }, { route: "302B", count: 5, unit: 2000 }],
    freshCount: 3, freshUnit: 100, driverType: "backup", backupUnit: 30,
  };
  const d = calcRecordDetails(rec, deps());
  assert.equal(d.count, 15);
  assert.equal(d.routeRevenue, 20000);
  assert.equal(d.freshRevenue, 300); // 3 * 100
  assert.equal(d.backupRevenue, 450); // 15 * 30
  assert.equal(d.revenue, 20750);
});

test("calcRecordDetails: fixed driver gets no backup bonus", () => {
  const rec = {
    off: false,
    rows: [{ route: "302A", count: 10, unit: 1000 }],
    freshCount: 3, freshUnit: 100, driverType: "fixed", backupUnit: 30,
  };
  const d = calcRecordDetails(rec, deps());
  assert.equal(d.backupRevenue, 0);
  assert.equal(d.revenue, 10300); // 10000 route + 300 fresh
});

test("calcRecordDetails: dual freshbag pricing (200/100)", () => {
  const rec = {
    off: false, rows: [], freshSoloCount: 2, freshLinkedCount: 3, driverType: "fixed",
  };
  const d = calcRecordDetails(rec, deps("dual"));
  assert.equal(d.freshCount, 5);
  assert.equal(d.freshUnit, 0);
  assert.equal(d.freshRevenue, 700); // 2*200 + 3*100
  assert.equal(d.revenue, 700);
});

test("calcRecordDetails: day off yields zero revenue", () => {
  const d = calcRecordDetails({ off: true, freshUnit: 150, backupUnit: 40 }, deps());
  assert.equal(d.revenue, 0);
  assert.equal(d.count, 0);
  assert.equal(d.freshUnit, 150);
});

test("recordRouteAggregates splits shared routes evenly", () => {
  const eff = (row) => Number(row.unit) || 0;
  const out = recordRouteAggregates(
    { off: false, rows: [{ route: "302A 302B", count: 10, unit: 1000 }] },
    eff,
  );
  assert.deepEqual(out.get("302A"), { count: 5, revenue: 5000 });
  assert.deepEqual(out.get("302B"), { count: 5, revenue: 5000 });
});

test("recordRouteAggregates returns empty map for day off", () => {
  const out = recordRouteAggregates({ off: true, rows: [] }, () => 0);
  assert.equal(out.size, 0);
});
