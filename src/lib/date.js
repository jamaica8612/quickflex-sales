import { WEEKDAYS } from "../config.js";

export function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseDateKey(key) {
  return new Date(`${key}T00:00:00`);
}

export function addDays(key, amount) {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

export function todayKey() {
  return toDateKey(new Date());
}

export function formatShort(date) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

export function formatLong(key) {
  const date = parseDateKey(key);
  return `${date.getFullYear()}년 ${String(date.getMonth() + 1).padStart(2, "0")}월 ${String(date.getDate()).padStart(2, "0")}일(${WEEKDAYS[date.getDay()]})`;
}

export function formatRecordTitleDate(key) {
  const date = parseDateKey(key);
  return `${String(date.getFullYear()).slice(2)}년 ${String(date.getMonth() + 1).padStart(2, "0")}월 ${String(date.getDate()).padStart(2, "0")}일`;
}

export function formatLongShort(key) {
  const date = parseDateKey(key);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}(${WEEKDAYS[date.getDay()]})`;
}

// --- Settlement period helpers (26th of prev month .. 25th of this month) ---
// Extracted from main.js. State-default arguments are applied by thin wrappers
// in main.js; these take explicit year/month.

export function periodBounds(year, month) {
  return { start: new Date(year, month - 2, 26), end: new Date(year, month - 1, 25) };
}

export function periodKeysFor(year, month) {
  const { start, end } = periodBounds(year, month);
  const keys = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    keys.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

export function periodForDate(date = new Date()) {
  const month = date.getDate() <= 25 ? date.getMonth() + 1 : date.getMonth() + 2;
  const periodDate = new Date(date.getFullYear(), month - 1, 1);
  return { year: periodDate.getFullYear(), month: periodDate.getMonth() + 1 };
}

export function prevPeriod(year, month) {
  const date = new Date(year, month - 2, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}
