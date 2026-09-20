import type { ScheduleMap, SettlementRow } from "./types.ts";

export function extractJsonObject(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("모델 응답에서 JSON 본문을 찾지 못했습니다.");
    }
    return JSON.parse(match[0]);
  }
}

// Aligned with src/lib/route.js; keep Edge deployment independent of browser files.
export function parseScheduleRoutes(value: unknown): string[] {
  const text = (Array.isArray(value) ? value.join(" ") : String(value ?? "")).toUpperCase();
  const groups = text.match(/(?<![0-9A-Z])(?:\d{3}[A-Z]+)+(?![0-9A-Z])/g) || [];
  return [...new Set(groups.flatMap((group) =>
    (group.match(/\d{3}[A-Z]+/g) || []).flatMap((route) =>
      route.slice(3).split("").map((suffix) => route.slice(0, 3) + suffix))))];
}

export function normalizeScheduleMap(parsed: unknown): ScheduleMap {
  const schedule: ScheduleMap = {};
  if (!parsed || typeof parsed !== "object") return schedule;

  // 새 형식: { days: [{ date, routes }] }
  const days = (parsed as { days?: unknown }).days;
  if (Array.isArray(days)) {
    days.forEach((entry) => {
      if (!entry || typeof entry !== "object") return;
      const day = entry as { date?: unknown; routes?: unknown };
      const dateKey = String(day.date ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
      if (Array.isArray(day.routes)) {
        schedule[dateKey] = parseScheduleRoutes(day.routes);
      } else {
        schedule[dateKey] = day.routes === null ? null : parseScheduleRoutes(day.routes);
      }
    });
    return schedule;
  }

  // 레거시 형식: { "YYYY-MM-DD": [...] | null }
  Object.entries(parsed as Record<string, unknown>).forEach(([dateKey, routes]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    if (Array.isArray(routes)) {
      schedule[dateKey] = parseScheduleRoutes(routes);
    } else {
      schedule[dateKey] = routes === null ? null : parseScheduleRoutes(routes);
    }
  });

  return schedule;
}

function toNumber(value: unknown) {
  const normalized = String(value ?? "").replace(/[^\d.-]/g, "");
  return Number(normalized) || 0;
}

export function normalizeSettlementRows(parsed: unknown): SettlementRow[] {
  const source = parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows)
    ? (parsed as { rows: unknown[] }).rows
    : Array.isArray(parsed)
      ? parsed
      : [];

  const rows: SettlementRow[] = [];
  source.forEach((row) => {
    if (!row || typeof row !== "object") return;
    const record = row as Record<string, unknown>;
    const route = String(record.route ?? record.Route ?? "").trim().toUpperCase();
    const deliveryCount = toNumber(record.deliveryCount ?? record.count ?? record.qty ?? record["배송건수"] ?? record["합계"]);
    const amount = toNumber(record.amount ?? record["금액"]);
    const extraIncentive = toNumber(record.extraIncentive ?? record.incentive ?? record["추가 인센티브"]);
    const date = String(record.date ?? record.deliveryDate ?? record["배송일자"] ?? "").trim();

    if (!/^\d{3}[A-Z]$/.test(route)) return;
    if (deliveryCount <= 0 || amount <= 0) return;

    rows.push({
      route,
      date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined,
      deliveryCount,
      amount,
      extraIncentive: extraIncentive || undefined,
    });
  });

  return rows;
}
