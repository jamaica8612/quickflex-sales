import type { ScheduleMap } from "./types.ts";

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
