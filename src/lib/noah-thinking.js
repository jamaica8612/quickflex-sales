// 노아가 보내는 진행 신호("…하고 있어요.")를 생각 말풍선의 단계 문구로 바꿔요.
const TOPICS = Object.freeze([
  ["매출 기록", "매출 기록"], ["구역 팁", "구역 팁"], ["지출 내역", "지출 내역"],
  ["점검 기록", "점검 기록"], ["설정", "설정"],
]);

export function noahStepText(message) {
  return String(message || "").trim().replace(/[.…]+$/u, "").slice(0, 120);
}

export function noahStepDone(message) {
  const text = noahStepText(message);
  return text
    .replace(/보고 있어요$/u, "봤어요")
    .replace(/찾고 있어요$/u, "찾았어요")
    .replace(/하고 있어요$/u, "했어요");
}

export function noahThinkingSummary(steps, elapsedMs) {
  const seen = [];
  for (const step of Array.isArray(steps) ? steps : []) {
    for (const [needle, label] of TOPICS) if (String(step).includes(needle) && !seen.includes(label)) seen.push(label);
  }
  const head = seen.length ? `${seen.slice(0, 2).join("·")} 확인함` : "생각 완료";
  const seconds = Number(elapsedMs) / 1000;
  return Number.isFinite(seconds) && seconds > 0 ? `${head} · ${seconds.toFixed(1)}초` : head;
}
