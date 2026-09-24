// Keep the Noah copy identical; work-date-parity.test.mjs guards both runtimes.
const NIGHT_NEXT_WORK_DATE_HOUR = 12;
const pad = (value) => String(value).padStart(2, "0");
const localKey = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const shiftDate = (key, days) => {
  const date = new Date(`${key}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/** Compatibility: this legacy helper intentionally uses the caller's local clock. */
export function measurementWorkDateForClock(now, workShift) {
  const currentDate = localKey(now);
  return workShift === "night" && now.getHours() >= NIGHT_NEXT_WORK_DATE_HOUR
    ? shiftDate(currentDate, 1) : currentDate;
}

/** Work dates are Korean civil dates, independent of browser/server timezone. */
export function koreanDateKey(now = new Date()) {
  return new Date(new Date(now).getTime() + 9 * 3600000).toISOString().slice(0, 10);
}

/**
 * Undefined/null evidence means unavailable, never a known empty schedule.
 * activeWorkDate is the effective date to open; previousWorkDate is the preceding
 * closing date (today after today's completion). Day shift always uses today.
 */
export function resolveWorkDates({ now = new Date(), workShift, dayState = {} }) {
  const today = koreanDateKey(now);
  const tomorrow = shiftDate(today, 1);
  const result = (nextWorkDate, reason) => ({
    previousWorkDate: workShift === "night" ? shiftDate(nextWorkDate, -1) : today,
    nextWorkDate,
    activeWorkDate: nextWorkDate,
    reason,
  });
  if (workShift !== "night") return result(today, "day");
  const active = dayState?.activeWorkDate;
  if (typeof active === "string" && /^\d{4}-\d{2}-\d{2}$/.test(active)
      && Number.isFinite(Date.parse(`${active}T12:00:00Z`))
      && shiftDate(active, 0) === active) return result(active, "active");
  if (dayState?.hasAutomaticCompletion === true) return result(tomorrow, "completed");
  if (dayState?.isOff === true) return result(tomorrow, "off");
  if (dayState?.hasSchedule === false && dayState?.hasAutomaticCompletion === false) {
    return result(tomorrow, "empty");
  }
  if (dayState?.hasSchedule === true && dayState?.hasAutomaticCompletion === false) {
    return result(today, "scheduled");
  }
  const koreanClock = new Date(new Date(now).getTime() + 9 * 3600000);
  const civilClock = new Date(koreanClock.getUTCFullYear(), koreanClock.getUTCMonth(),
    koreanClock.getUTCDate(), koreanClock.getUTCHours(), koreanClock.getUTCMinutes());
  return result(measurementWorkDateForClock(civilClock, workShift), "clock");
}
