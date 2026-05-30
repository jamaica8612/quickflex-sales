import { splitStoredRoutes } from "./route.js";

export function toNum(value) {
  return Number(String(value ?? "").replace(/[^\d.-]/g, "")) || 0;
}

export function routeRevenue(count, unit) {
  return (Number(count) || 0) * (Number(unit) || 0);
}

// Record revenue math, extracted from main.js. `rec` must already be shape-
// normalized. State-coupled bits are injected: `effectiveUnit(row)` resolves a
// row's unit (and may backfill row.unit), `freshbagMode` is the resolved mode
// string, and defaultFreshUnit/defaultBackupUnit supply unit fallbacks.
export function calcRecordDetails(rec, { effectiveUnit, freshbagMode, defaultFreshUnit, defaultBackupUnit }) {
  if (rec.off) {
    return {
      count: 0, routeRevenue: 0, freshCount: 0, freshUnit: toNum(defaultFreshUnit(rec.freshUnit)),
      freshRevenue: 0, backupUnit: toNum(defaultBackupUnit(rec.backupUnit)), backupRevenue: 0, revenue: 0,
    };
  }
  const routeTotal = rec.rows.reduce((sum, row) => {
    const count = toNum(row.count);
    return { count: sum.count + count, revenue: sum.revenue + count * effectiveUnit(row) };
  }, { count: 0, revenue: 0 });
  const isDual = freshbagMode === "dual";
  const freshCount = isDual ? toNum(rec.freshSoloCount) + toNum(rec.freshLinkedCount) : toNum(rec.freshCount);
  const freshUnit = isDual ? 0 : toNum(defaultFreshUnit(rec.freshUnit));
  const freshRevenue = isDual ? toNum(rec.freshSoloCount) * 200 + toNum(rec.freshLinkedCount) * 100 : freshCount * freshUnit;
  const backupApplies = rec.driverType === "backup";
  const backupUnit = backupApplies ? toNum(defaultBackupUnit(rec.backupUnit)) : 0;
  const backupRevenue = backupApplies ? routeTotal.count * backupUnit : 0;
  return {
    count: routeTotal.count,
    routeRevenue: routeTotal.revenue,
    freshCount,
    freshUnit,
    freshRevenue,
    backupUnit,
    backupRevenue,
    revenue: routeTotal.revenue + freshRevenue + backupRevenue,
  };
}

// Per-route count/revenue, splitting shared routes evenly. `effectiveUnit` is injected.
export function recordRouteAggregates(rec, effectiveUnit) {
  const out = new Map();
  if (rec.off) return out;
  rec.rows.forEach((row) => {
    splitStoredRoutes(row.route).forEach((r) => {
      const count = toNum(row.count);
      const unit = effectiveUnit(row);
      const share = splitStoredRoutes(row.route).length || 1;
      const entry = out.get(r) || { count: 0, revenue: 0 };
      entry.count += count / share;
      entry.revenue += (count * unit) / share;
      out.set(r, entry);
    });
  });
  return out;
}
