import {
  dateKeysBetween,
  normalizeDateKey,
  shiftSettlementPeriod,
} from "./stats-report.js";

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function inRange(days, start, end) {
  return days
    .filter((day) => day.dateKey >= start && day.dateKey <= end)
    .sort((a, b) => a.dateKey.localeCompare(b.dateKey));
}

function workedDaysInRange(days, start, end) {
  return inRange(days, start, end).filter((day) => day.worked === true && day.off !== true);
}

function driverAverages(days, volumeAvailable = false) {
  if (!days.length) {
    return {
      averageCount: null,
      averageDeliveryUnit: null,
      averageExtraRevenue: null,
    };
  }

  const totals = days.reduce((result, day) => {
    result.count += number(day.count);
    result.deliveryRevenue += number(day.deliveryRevenue);
    result.extraRevenue += number(day.freshRevenue) + number(day.backupRevenue);
    return result;
  }, { count: 0, deliveryRevenue: 0, extraRevenue: 0 });

  return {
    averageCount: volumeAvailable ? totals.count / days.length : null,
    averageDeliveryUnit: volumeAvailable && totals.count > 0
      ? totals.deliveryRevenue / totals.count
      : null,
    averageExtraRevenue: totals.extraRevenue / days.length,
  };
}

function percentile(sortedValues, fraction) {
  if (!sortedValues.length) return null;
  const position = (sortedValues.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  const weight = position - lowerIndex;
  return sortedValues[lowerIndex]
    + (sortedValues[upperIndex] - sortedValues[lowerIndex]) * weight;
}

export function buildStatsInsights({ days = [], report, asOfDate } = {}) {
  const asOfKey = normalizeDateKey(asOfDate);
  const period = report.period;
  const applicable = report.mode === "thisSettlement"
    && asOfKey !== null
    && asOfKey >= period.start
    && asOfKey <= period.end;
  const dayByDate = new Map(days.map((day) => [day.dateKey, day]));
  const currentEnd = asOfKey && asOfKey < period.end ? asOfKey : period.end;
  const currentWorked = applicable
    ? workedDaysInRange(days, period.start, currentEnd)
    : [];
  const workedDays = currentWorked.length;
  const averageRevenue = workedDays
    ? currentWorked.reduce((sum, day) => sum + number(day.revenue), 0) / workedDays
    : null;

  let plannedDays = 0;
  let unknownDays = 0;
  let pendingToday = false;
  if (applicable) {
    const today = dayByDate.get(asOfKey);
    pendingToday = !today || (today.off !== true && today.worked !== true);
    dateKeysBetween(asOfKey, period.end).slice(1).forEach((dateKey) => {
      const day = dayByDate.get(dateKey);
      if (day?.off === true) return;
      if (day?.planned === true && day.worked !== true) {
        plannedDays += 1;
        return;
      }
      if (day?.worked !== true) unknownDays += 1;
    });
  }

  const target = applicable ? (report.goal?.target ?? null) : null;
  const remainingAmount = target === null
    ? null
    : Math.max(0, target - number(report.summary?.revenue));
  const requiredDailyRevenue = remainingAmount === null
    ? null
    : (remainingAmount === 0 ? 0 : (plannedDays > 0 ? remainingAmount / plannedDays : null));
  const canProject = applicable
    && workedDays >= 3
    && plannedDays > 0
    && unknownDays === 0
    && !pendingToday;
  const projectedRevenue = canProject
    ? number(report.summary?.revenue) + averageRevenue * plannedDays
    : null;
  const reviewDates = applicable
    ? inRange(days, report.range.start, report.range.end)
      .filter((day) => day.dateKey < asOfKey
        && day.planned === true
        && day.off !== true
        && day.worked !== true)
      .map((day) => day.dateKey)
    : [];

  const driversAvailable = applicable && report.comparison?.available === true;
  let previousWorked = [];
  if (driversAvailable) {
    const previousPeriod = shiftSettlementPeriod(period, -1);
    previousWorked = workedDaysInRange(days, previousPeriod.start, previousPeriod.end)
      .slice(0, currentWorked.length);
  }
  const volumeAvailable = driversAvailable
    && currentWorked.every((day) => day.volumeKnown === true)
    && previousWorked.every((day) => day.volumeKnown === true);

  const typicalRevenues = workedDaysInRange(days, report.range.start, report.range.end)
    .map((day) => number(day.revenue))
    .sort((a, b) => a - b);

  return {
    outlook: {
      applicable,
      remainingAmount,
      target,
      plannedDays,
      unknownDays,
      requiredDailyRevenue,
      projectedRevenue,
      workedDays,
      averageRevenue,
      pendingToday,
      reviewDates,
    },
    drivers: {
      available: driversAvailable,
      current: driversAvailable
        ? driverAverages(currentWorked, volumeAvailable)
        : driverAverages([]),
      previous: driversAvailable
        ? driverAverages(previousWorked, volumeAvailable)
        : driverAverages([]),
    },
    typical: {
      days: typicalRevenues.length,
      medianRevenue: percentile(typicalRevenues, 0.5),
      lowRevenue: percentile(typicalRevenues, 0.25),
      highRevenue: percentile(typicalRevenues, 0.75),
    },
  };
}
