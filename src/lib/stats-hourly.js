import { normalizeDateKey } from "./stats-report.js";
import { settlementPeriodForDate } from "./stats-highlights.js";

export const MIN_HOURLY_DAYS = 3;
export const MIN_HOURLY_COVERAGE = 0.8;
const MAX_WORK_SECONDS = 24 * 60 * 60;
const ROUTE_RE = /^\d{3}[A-Z]$/;

function nonNegative(value) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function instant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  if (!normalizeDateKey(value.slice(0, 10))) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function normalizeTiming(row) {
  const started = instant(row.started_at);
  const ended = instant(row.ended_at);
  const activeSeconds = nonNegative(row.active_seconds);
  const measuredItems = nonNegative(row.measured_items);
  const workSeconds = started !== null && ended !== null ? (ended - started) / 1000 : null;
  const routeSeconds = row.route_active_seconds;
  if (workSeconds === null || workSeconds <= 0 || workSeconds > MAX_WORK_SECONDS
      || activeSeconds === null || activeSeconds <= 0 || activeSeconds > workSeconds
      || typeof row.active_seconds !== "number" || !Number.isInteger(activeSeconds)
      || measuredItems === null || typeof row.measured_items !== "number" || !Number.isInteger(measuredItems)
      || !routeSeconds || typeof routeSeconds !== "object" || Array.isArray(routeSeconds)) return null;
  const routes = new Map();
  for (const [route, rawSeconds] of Object.entries(routeSeconds)) {
    const seconds = nonNegative(rawSeconds);
    if (!ROUTE_RE.test(route) || typeof rawSeconds !== "number" || seconds === null || !Number.isInteger(seconds)) return null;
    if (seconds > 0) routes.set(route, seconds);
  }
  // Match the timing write contract's tolerance for independently rounded clocks.
  if ([...routes.values()].reduce((sum, seconds) => sum + seconds, 0) > activeSeconds + 60) return null;
  return { workId: String(row.work_id), workSeconds, activeSeconds, measuredItems, routes };
}

function normalizeDays(source) {
  const days = new Map();
  for (const input of Array.isArray(source) ? source : []) {
    const dateKey = normalizeDateKey(input?.dateKey ?? input?.work_date ?? input?.date);
    if (!dateKey || input.off === true || input.worked !== true) continue;
    const count = nonNegative(input.count ?? input.deliveryCount);
    const revenue = nonNegative(input.revenue);
    const previous = days.get(dateKey) || { dateKey, count: 0, revenue: 0, routes: [], workIds: new Set(), valid: true };
    previous.valid &&= count !== null && revenue !== null;
    previous.count += count ?? 0;
    previous.revenue += revenue ?? 0;
    previous.routes.push(...(Array.isArray(input.routes) ? input.routes : []));
    for (const workId of Array.isArray(input.workIds) ? input.workIds : []) {
      if (typeof workId === "string" && workId.trim()) previous.workIds.add(workId.trim());
    }
    days.set(dateKey, previous);
  }
  return [...days.values()].sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function bestBy(items, read) {
  return items.reduce((best, item) => best === null || read(item) > read(best) ? item : best, null);
}

function routeAmount(row) {
  const count = nonNegative(row.count ?? row.delivery_count);
  if (count === null || count <= 0) return null;
  // The adapter supplies delivery-only revenue, including the saved unit price.
  // Raw snapshot callers never fall back to today's rate or add extra payments.
  const revenue = row.revenue !== undefined
    ? nonNegative(row.revenue)
    : count * (nonNegative(row.unit_snapshot) ?? NaN);
  return Number.isFinite(revenue) && revenue >= 0 ? { count, revenue } : null;
}

/**
 * Display statistics from already-calculated saved daily revenue and optional
 * measurement metadata. The caller remains responsible for owner-scoped reads.
 * days: [{ dateKey, worked, off, count, revenue,
 *          workIds?: [finalizedWorkId], routes: [{ route, count, revenue, workId }] }]
 * Route revenue must exclude fresh-bag and backup pay; automatic snapshots that
 * embed backup pay are separated by the existing app revenue adapter.
 */
export function buildHourlyStats({ days = [], timings = [], range, asOfDate, minDays = 10 } = {}) {
  const allDays = normalizeDays(days);
  const asOf = normalizeDateKey(asOfDate) || allDays.at(-1)?.dateKey || null;
  const start = normalizeDateKey(range?.start);
  const end = normalizeDateKey(range?.end);
  const inRange = (key) => (!start || key >= start) && (!end || key <= end);
  const worked = allDays.filter((day) => !asOf || day.dateKey <= asOf);
  const selectedDays = worked.filter((day) => inRange(day.dateKey));
  const byDate = new Map();
  const seenWorks = new Set();
  const timingRows = Array.isArray(timings) ? timings : [];
  for (const row of timingRows) {
    const dateKey = normalizeDateKey(row?.work_date);
    if (!dateKey || (asOf && dateKey > asOf)) continue;
    const workId = typeof row.work_id === "string" ? row.work_id.trim() : "";
    const workKey = JSON.stringify([String(row.user_id || ""), workId]);
    if (workId && seenWorks.has(workKey)) continue;
    if (workId) seenWorks.add(workKey);
    const entry = byDate.get(dateKey) || { valid: true, works: [], measuredItems: 0, measuredItemsKnown: true, reason: null };
    if (typeof row.measured_items === "number" && Number.isInteger(row.measured_items) && row.measured_items >= 0) {
      entry.measuredItems += row.measured_items;
    } else entry.measuredItemsKnown = false;
    const timing = workId ? normalizeTiming({ ...row, work_id: workId }) : null;
    if (!timing) {
      entry.valid = false;
      const reason = !row.started_at || !row.ended_at ? "missing_start_end" : "invalid_timing";
      if (!entry.reason || reason === "missing_start_end") entry.reason = reason;
    }
    else entry.works.push(timing);
    byDate.set(dateKey, entry);
  }

  const allEligible = [];
  const allReviews = [];
  const routeTotals = new Map();
  for (const day of worked) {
    const timing = byDate.get(day.dateKey);
    const coverage = timing?.measuredItemsKnown && day.count > 0 ? timing.measuredItems / day.count : null;
    const workById = new Map((timing?.works || []).map((work) => [work.workId, work]));
    const reason = !day.valid || !Number.isFinite(day.revenue) || !Number.isFinite(day.count) || day.count <= 0 ? "invalid_sales"
      : !timing ? "missing_timing"
        : !timing.valid ? timing.reason
          : [...day.workIds].some((workId) => !workById.has(workId)) || !timing.works.length ? "missing_timing"
            : coverage === null ? "invalid_timing"
              : coverage < MIN_HOURLY_COVERAGE ? "low_coverage" : null;
    allReviews.push({ dateKey: day.dateKey, coverage, eligible: reason === null, reason });
    if (reason !== null) continue;
    const workSeconds = timing.works.reduce((sum, work) => sum + work.workSeconds, 0);
    const activeSeconds = timing.works.reduce((sum, work) => sum + work.activeSeconds, 0);
    const measuredItems = timing.works.reduce((sum, work) => sum + work.measuredItems, 0);
    const eligible = {
      dateKey: day.dateKey, count: day.count, revenue: day.revenue,
      workSeconds, activeSeconds, measuredItems, coverage,
      actualHourly: day.revenue * 3600 / workSeconds,
      deliveryHourly: day.revenue * 3600 / activeSeconds,
      nonDeliverySeconds: workSeconds - activeSeconds,
    };
    allEligible.push(eligible);
    if (!inRange(day.dateKey)) continue;
    const seenRoutes = new Set();
    for (const row of day.routes) {
      const route = typeof row?.route === "string" ? row.route.trim().toUpperCase() : "";
      const workId = String(row?.workId ?? row?.work_id ?? "").trim();
      const work = workById.get(workId);
      const seconds = work?.routes.get(route);
      const amount = row && routeAmount(row);
      const key = JSON.stringify([workId, route]);
      if (!ROUTE_RE.test(route) || !seconds || !amount || seenRoutes.has(key)) continue;
      seenRoutes.add(key);
      const total = routeTotals.get(route) || { route, count: 0, revenue: 0, activeSeconds: 0, dateKeys: new Set() };
      total.count += amount.count;
      total.revenue += amount.revenue;
      total.activeSeconds += seconds;
      total.dateKeys.add(day.dateKey);
      routeTotals.set(route, total);
    }
  }

  const eligibleDays = allEligible.filter((day) => inRange(day.dateKey));
  const measuredDays = eligibleDays.length;
  const ready = measuredDays >= MIN_HOURLY_DAYS;
  const total = eligibleDays.reduce((sum, day) => ({
    revenue: sum.revenue + day.revenue,
    workSeconds: sum.workSeconds + day.workSeconds,
    activeSeconds: sum.activeSeconds + day.activeSeconds,
    nonDeliverySeconds: sum.nonDeliverySeconds + day.nonDeliverySeconds,
  }), { revenue: 0, workSeconds: 0, activeSeconds: 0, nonDeliverySeconds: 0 });
  const routes = [...routeTotals.values()]
    .filter((route) => route.dateKeys.size >= MIN_HOURLY_DAYS)
    .map(({ dateKeys, ...route }) => ({ ...route, hourly: route.revenue * 3600 / route.activeSeconds, days: dateKeys.size }))
    .sort((a, b) => b.hourly - a.hourly || a.route.localeCompare(b.route));
  const currentPeriod = asOf && settlementPeriodForDate(asOf);
  const best = ready ? bestBy(eligibleDays, (day) => day.actualHourly) : null;
  const prior = currentPeriod ? bestBy(allEligible.filter((day) => day.dateKey < currentPeriod.start), (day) => day.actualHourly) : null;
  const bestActual = best ? {
    value: best.actualHourly,
    dateKey: best.dateKey,
    isNew: worked.length >= minDays && prior !== null && best.dateKey >= currentPeriod.start && best.actualHourly > prior.actualHourly,
  } : null;
  const countRoute = bestBy(routes, (route) => route.count);
  const hourlyRoute = bestBy(routes, (route) => route.hourly);
  return {
    hasTimings: timingRows.length > 0,
    ready, measuredDays, excludedDays: selectedDays.length - measuredDays,
    actualHourly: ready ? total.revenue * 3600 / total.workSeconds : null,
    deliveryHourly: ready ? total.revenue * 3600 / total.activeSeconds : null,
    averageNonDeliverySeconds: ready ? total.nonDeliverySeconds / measuredDays : null,
    routes, bestActual, eligibleDays,
    // Auditable statuses for worked dates in the selected range, up to asOfDate.
    dailyReviews: allReviews.filter((day) => inRange(day.dateKey)),
    comparison: countRoute && hourlyRoute && countRoute.route !== hourlyRoute.route
      && hourlyRoute.hourly > countRoute.hourly ? { countRoute, hourlyRoute } : null,
  };
}
