import { addDays, normalizeDateKey, settlementPeriod } from "./stats-report.js";

// Highlights for 정산노트 built from the same daily rows as the report
// (statsDailyRecords): personal records, the day-off what-if, and the split of
// a same-workday revenue change into volume, unit price and extra pay.

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function isWorked(day) {
  return day.worked === true && day.off !== true;
}

function total(days, read) {
  return days.reduce((sum, day) => sum + read(day), 0);
}

/** The settlement (26th to 25th) a date belongs to. */
export function settlementPeriodForDate(dateKey) {
  const key = normalizeDateKey(dateKey);
  if (!key) return null;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const day = Number(key.slice(8, 10));
  if (day <= 25) return settlementPeriod(year, month);
  return month === 12 ? settlementPeriod(year + 1, 1) : settlementPeriod(year, month + 1);
}

/**
 * Splits the revenue gap between two equally long sets of worked days.
 * volume + unit is exactly the delivery-revenue gap; extra is the fresh-bag and
 * backup-pay gap; other is whatever revenue sits outside those (normally 0).
 * Returns null when either side has a day without a matching parcel count.
 */
export function decomposeRevenueChange(current = [], previous = []) {
  if (!current.length || current.length !== previous.length) return null;
  if (![...current, ...previous].every((day) => day.volumeKnown === true)) return null;
  const countNow = total(current, (day) => number(day.count));
  const countBefore = total(previous, (day) => number(day.count));
  if (countNow <= 0 || countBefore <= 0) return null;
  const unitNow = total(current, (day) => number(day.deliveryRevenue)) / countNow;
  const unitBefore = total(previous, (day) => number(day.deliveryRevenue)) / countBefore;
  const extra = (days) => total(days, (day) => number(day.freshRevenue) + number(day.backupRevenue));
  const revenueDelta = total(current, (day) => number(day.revenue)) - total(previous, (day) => number(day.revenue));
  const volume = (countNow - countBefore) * unitBefore;
  const unit = (unitNow - unitBefore) * countNow;
  const extraDelta = extra(current) - extra(previous);
  return {
    days: current.length,
    revenueDelta,
    volume,
    unit,
    extra: extraDelta,
    other: revenueDelta - volume - unit - extraDelta,
    countDelta: countNow - countBefore,
    unitDelta: unitNow - unitBefore,
    freshCountDelta: total(current, (day) => number(day.freshCount)) - total(previous, (day) => number(day.freshCount)),
  };
}

/** Projected settlement revenue after moving `shift` remaining workdays to days off (negative: working off days). */
export function projectDayOffChange({ revenue, averageRevenue, plannedDays, offDaysAhead, shift = 0 }) {
  const min = -Math.max(0, offDaysAhead || 0);
  const max = Math.max(0, plannedDays || 0);
  const applied = Math.min(max, Math.max(min, Math.trunc(shift) || 0));
  const workDays = max - applied;
  return {
    shift: applied,
    min,
    max,
    workDays,
    projectedRevenue: number(revenue) + number(averageRevenue) * workDays,
  };
}

function bestBy(items, read) {
  // Ties keep the earliest, so a record moves only when it is actually beaten.
  return items.reduce((best, item) => (best === null || read(item) > read(best) ? item : best), null);
}

function streaks(workedKeys) {
  const runs = [];
  workedKeys.forEach((dateKey) => {
    const last = runs.at(-1);
    if (last && addDays(last.end, 1) === dateKey) {
      last.end = dateKey;
      last.value += 1;
    } else {
      runs.push({ start: dateKey, end: dateKey, value: 1 });
    }
  });
  return runs;
}

/**
 * All-time personal records up to `asOfDate`. A record is new when it was set in
 * the running settlement and beats a record that existed before that settlement
 * began; with fewer than `minDays` worked days nothing is marked new.
 */
export function buildPersonalRecords(days = [], { asOfDate, minDays = 10 } = {}) {
  const asOf = normalizeDateKey(asOfDate);
  if (!asOf) return null;
  const worked = days
    .filter((day) => isWorked(day) && day.dateKey <= asOf)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
  if (!worked.length) return null;
  const current = settlementPeriodForDate(asOf);
  const enough = worked.length >= minDays;
  const before = (key) => key < current.start;
  const mark = (best, prior, key, read) => ({
    ...best,
    isNew: enough && prior !== null && !before(key) && read(best) > read(prior),
  });

  const revenueBest = bestBy(worked, (day) => number(day.revenue));
  const revenuePrior = bestBy(worked.filter((day) => before(day.dateKey)), (day) => number(day.revenue));
  const counted = worked.filter((day) => day.volumeKnown === true && number(day.count) > 0);
  const countBest = bestBy(counted, (day) => number(day.count));
  const countPrior = bestBy(counted.filter((day) => before(day.dateKey)), (day) => number(day.count));

  const settlements = new Map();
  worked.forEach((day) => {
    const period = settlementPeriodForDate(day.dateKey);
    const entry = settlements.get(period.id) || { period, value: 0, end: period.end };
    entry.value += number(day.revenue);
    settlements.set(period.id, entry);
  });
  const settlementList = [...settlements.values()];
  const settlementBest = bestBy(settlementList, (item) => item.value);
  const settlementPrior = bestBy(settlementList.filter((item) => item.period.id !== current.id), (item) => item.value);

  const runs = streaks(worked.map((day) => day.dateKey));
  const streakBest = bestBy(runs, (run) => run.value);
  const streakPrior = bestBy(runs.filter((run) => before(run.end)), (run) => run.value);

  return {
    since: worked[0].dateKey,
    workedDays: worked.length,
    revenue: mark({ value: number(revenueBest.revenue), dateKey: revenueBest.dateKey }, revenuePrior && { value: number(revenuePrior.revenue) }, revenueBest.dateKey, (item) => item.value),
    count: countBest ? mark({ value: number(countBest.count), dateKey: countBest.dateKey }, countPrior && { value: number(countPrior.count) }, countBest.dateKey, (item) => item.value) : null,
    settlement: {
      value: settlementBest.value,
      period: settlementBest.period,
      isNew: enough && settlementPrior !== null && settlementBest.period.id === current.id && settlementBest.value > settlementPrior.value,
    },
    streak: mark({ value: streakBest.value, start: streakBest.start, end: streakBest.end }, streakPrior && { value: streakPrior.value }, streakBest.end, (item) => item.value),
  };
}
