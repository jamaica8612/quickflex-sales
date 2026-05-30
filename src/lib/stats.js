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
