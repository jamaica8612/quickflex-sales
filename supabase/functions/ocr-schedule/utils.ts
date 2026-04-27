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

export function normalizeScheduleMap(parsed: unknown): ScheduleMap {
  const schedule: ScheduleMap = {};
  if (!parsed || typeof parsed !== "object") return schedule;

  Object.entries(parsed as Record<string, unknown>).forEach(([dateKey, routes]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    schedule[dateKey] = Array.isArray(routes)
      ? routes.map((route) => String(route).trim().toUpperCase()).filter(Boolean)
      : null;
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
