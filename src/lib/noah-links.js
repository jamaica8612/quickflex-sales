const DATE = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[\w-]{1,100}$/;

export function validNoahLink(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const kind = raw.kind;
  const target = raw.target;
  if (!target || typeof target !== "object" || Array.isArray(target)) return null;
  if (kind === "day" && DATE.test(target.date || "") && !Number.isNaN(Date.parse(`${target.date}T00:00:00Z`))) {
    return { kind, target: { date: target.date }, label: `매출 ${target.date}` };
  }
  if (kind === "route" && ID.test(target.zoneId || "")) {
    return { kind, target: { zoneId: target.zoneId }, label: "구역 팁 보기" };
  }
  if (kind === "expenses" && Object.keys(target).length === 0) return { kind, target: {}, label: "지출 보기" };
  if (kind === "stats" && DATE.test(target.from || "") && DATE.test(target.to || "") && target.from <= target.to) {
    return { kind, target: { from: target.from, to: target.to }, label: "통계 보기" };
  }
  if (kind === "settings" && Object.keys(target).length === 0) return { kind, target: {}, label: "설정 보기" };
  return null;
}

export function validNoahLinks(value) {
  return (Array.isArray(value) ? value : []).slice(0, 5).map(validNoahLink).filter(Boolean);
}
