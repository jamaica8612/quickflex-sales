// Pure stats helpers: period-over-period deltas and CSV building.

export function percentDelta(current, previous) {
  if (!previous) return null; // no baseline to compare against
  return ((current - previous) / previous) * 100;
}

export function formatDelta(current, previous) {
  const d = percentDelta(current, previous);
  if (d === null || !Number.isFinite(d)) return "";
  const rounded = Math.abs(d) >= 10 ? Math.round(d) : Math.round(d * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

export function csvEscape(value) {
  const s = String(value ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// header: string[]; rows: (string|number)[][]. Returns a UTF-8-BOM CSV so Excel
// renders Korean correctly, with CRLF line endings.
export function buildCsv(header, rows) {
  const body = [header, ...rows]
    .map((cols) => cols.map(csvEscape).join(","))
    .join("\r\n");
  return `﻿${body}`;
}

// rows: [{ weekday: 0..6 (0=Sun), revenue, worked }]. Returns 7 buckets indexed
// by weekday with total/days/average over worked days only.
export function weekdayAverages(rows) {
  const buckets = Array.from({ length: 7 }, () => ({ total: 0, days: 0 }));
  (rows || []).forEach(({ weekday, revenue, worked }) => {
    if (!worked) return;
    const bucket = buckets[weekday];
    if (!bucket) return;
    bucket.total += revenue || 0;
    bucket.days += 1;
  });
  return buckets.map((bucket, weekday) => ({
    weekday,
    total: bucket.total,
    days: bucket.days,
    average: bucket.days ? bucket.total / bucket.days : 0,
  }));
}
