export const CALENDAR_SYNC_FUNCTION = "calendar-sync";

export const DEFAULT_CALENDAR_SYNC_SETTINGS = Object.freeze({
  includeWork: true,
  includeOff: true,
  includeRoute: false,
  includeRevenue: false,
});

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isCalendarDateKey(value) {
  return DATE_KEY.test(String(value || ""));
}

/** Adds a calendar day without turning a record work date into an instant. */
export function nextDateKey(dateKey) {
  if (!isCalendarDateKey(dateKey)) throw new Error("유효한 근무일이 아닙니다.");
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function normalizeCalendarSyncSettings(settings = {}) {
  return {
    includeWork: settings.includeWork !== false,
    includeOff: settings.includeOff !== false,
    includeRoute: settings.includeRoute === true,
    includeRevenue: settings.includeRevenue === true,
  };
}

export function normalizeCalendarSyncDays(days) {
  const byDate = new Map();
  (Array.isArray(days) ? days : []).forEach((value) => {
    if (!value || !isCalendarDateKey(value.date)) return;
    const revenue = value.revenue === null || value.revenue === undefined || value.revenue === ""
      ? null
      : Number(value.revenue);
    if (revenue !== null && (!Number.isFinite(revenue) || revenue < 0 || !Number.isInteger(revenue))) return;
    byDate.set(value.date, {
      date: value.date,
      off: value.off === true,
      worked: value.worked === true,
      hasSchedule: value.hasSchedule === true,
      revenue,
      routeLabel: String(value.routeLabel || "").trim().slice(0, 120),
      workShift: value.workShift === "night" ? "night" : "day",
    });
  });
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

export function formatCalendarWon(amount) {
  return `${Number(amount).toLocaleString("ko-KR")}원`;
}

/**
 * Produces the whole all-day event owned by QuickFlex. A null result means the
 * current options intentionally do not manage that date.
 */
export function buildCalendarDesiredEvent(day, settings = DEFAULT_CALENDAR_SYNC_SETTINGS) {
  const normalized = normalizeCalendarSyncDays([day])[0];
  if (!normalized) return null;
  const options = normalizeCalendarSyncSettings(settings);
  const scheduledWork = !normalized.off && (normalized.worked || normalized.hasSchedule);
  const amount = options.includeRevenue && normalized.revenue !== null
    ? formatCalendarWon(normalized.revenue)
    : "";

  let kind = "";
  let title = "";
  if (scheduledWork && options.includeWork) {
    kind = "work";
    title = "퀵플렉스 근무";
    if (options.includeRoute && normalized.routeLabel) title += ` · ${normalized.routeLabel}`;
  } else if (normalized.off && options.includeOff) {
    kind = "off";
    title = "퀵플렉스 휴무";
  } else if (options.includeRevenue && normalized.revenue !== null) {
    kind = "revenue";
    title = "퀵플렉스 매출";
  } else {
    return null;
  }
  if (amount) title += ` · ${amount}`;

  return {
    date: normalized.date,
    kind,
    title,
    start: { date: normalized.date },
    end: { date: nextDateKey(normalized.date) },
    // This is an all-day work-date event. Do not infer this from the current clock.
    allDay: true,
    workShift: normalized.workShift,
  };
}

export function datesInCalendarRange(days, startDate, endDate) {
  return normalizeCalendarSyncDays(days).filter((day) => (
    (!startDate || day.date >= startDate) && (!endDate || day.date <= endDate)
  ));
}

/**
 * Includes neutral days so a changed option can remove a previously managed
 * event even when the canonical records have no row for that date.
 */
export function expandCalendarSyncRange(days, startDate, endDate) {
  if (!isCalendarDateKey(startDate) || !isCalendarDateKey(endDate) || startDate > endDate) {
    throw new Error("유효한 동기화 기간이 필요합니다.");
  }
  const byDate = new Map(datesInCalendarRange(days, startDate, endDate).map((day) => [day.date, day]));
  const result = [];
  let date = startDate;
  while (date <= endDate) {
    result.push(byDate.get(date) || {
      date, off: false, worked: false, hasSchedule: false, revenue: null, routeLabel: "", workShift: "day",
    });
    if (result.length > 366) throw new Error("동기화 기간은 최대 366일입니다.");
    date = nextDateKey(date);
  }
  return result;
}
