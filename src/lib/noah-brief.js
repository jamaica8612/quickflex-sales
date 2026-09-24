export const NOAH_NOTICE = "노아는 질문에 필요한 기사님 기록만 찾아서 답해요. 대화는 저장하지 않고, 무언가를 바꿀 때는 꼭 확인을 받아요.";
export const NOAH_PRIVACY_URL = "./privacy.html#noah";
export const NOAH_WELCOME_DEFAULT = "안녕하세요, 노아예요 🙂 오늘도 수고 많으셨어요. 매출이나 지출, 구역 팁까지 궁금한 건 편하게 물어보세요. 제가 기록을 찾아서 알려드릴게요.";

// Suggested questions show what Noah can actually look up or prepare with its tools.
// "{route}" is filled with the next work route; those questions are skipped when no route is known.
const CHIPS = {
  beforeShift: [
    "{route} 주의할 곳만 추려줘", "{route} 공동현관 비번 정리해줘", "{route} 주차 어디가 편해?",
    "목표까지 하루 얼마 벌어야 해?", "이번 주 페이스 어때?", "지난달 같은 요일 평균 매출은?",
    "이번 정산 목표 달성 가능해?",
  ],
  active: [
    "{route} 주의할 곳", "{route} 공동현관 비번 있어?", "{route} 경비실 어디야?",
    "{route} 주차 어디 해?", "{route} 엘리베이터 없는 동 있어?", "{route} 하차하기 좋은 곳",
  ],
  completed: [
    "오늘 매출 얼마야?", "지난주 같은 요일이랑 비교해줘", "이번 달 최고 매출일은 언제야?",
    "이번 정산 목표까지 얼마 남았어?", "오늘 기름값 기록해줘", "이번 주 구역별 매출 순위",
    "이번 달 일평균 매출은?",
  ],
  closing: [
    "이번 정산 한눈에 요약해줘", "지난 정산이랑 비교해줘", "이번 정산 순수익 얼마야?",
    "지출 제일 많은 항목 알려줘", "정산 전에 빠진 기록 있어?", "이번 정산 구역별 매출 순위",
  ],
  off: [
    "이번 달 지출 정리해줘", "요일별 평균 매출 알려줘", "다음 근무 구역 팁 미리 보여줘",
    "목표 달성하려면 며칠 더 일해야 해?", "지난달이랑 이번 달 비교해줘", "영수증 안 넣은 지출 있어?",
  ],
  firstUse: [
    "이번 주 얼마 벌었어?", "지난달이랑 이번 달 비교해줘", "내 구역 팁 보여줘",
    "지출 제일 많은 항목 알려줘", "목표까지 하루 얼마 벌어야 해?",
  ],
  default: [
    "이번 주 얼마 벌었어?", "지난주랑 비교해줘", "이번 정산 요약해줘", "지출 제일 많은 항목 알려줘",
    "내 구역 팁 보여줘", "목표까지 하루 얼마 벌어야 해?", "이번 달 최고 매출일은 언제야?",
  ],
};

export function noahWelcome(context = {}) {
  const phase = context.phase;
  if (phase === "firstUse") return "처음 오셨네요, 반가워요! 저는 기사님 기록만 볼 수 있고, 뭔가 바꿀 때는 꼭 확인을 받은 뒤에 해요.";
  if (phase === "active") return "오늘도 안전 운전하세요. 구역 팁이 필요하면 짧게 물어보셔도 돼요.";
  if (phase === "completed") return "오늘 근무 수고 많으셨어요! 오늘 매출이나 이번 정산 흐름이 궁금하면 물어보세요.";
  if (phase === "off") return "오늘은 쉬는 날이네요. 푹 쉬시고, 지출 정리나 정산 확인은 천천히 도와드릴게요.";
  if (phase === "beforeShift") {
    const date = typeof context.workDateLabel === "string" ? context.workDateLabel.trim() : "";
    const route = Array.isArray(context.routes) ? context.routes.find((item) => typeof item === "string" && item.trim())?.trim() : "";
    const when = context.workShift === "night" && String(context.workDateCaption || "").startsWith("오늘 밤") ? "오늘 밤 " : "";
    if (date && route) return `${when}${date} 근무 준비 중이시죠? ${route} 팁이나 목표까지 남은 금액, 필요하면 바로 알려드릴게요.`;
    if (date) return `${when}${date} 근무 준비 중이시죠? 구역 팁이나 목표까지 남은 금액, 필요하면 바로 알려드릴게요.`;
    return "근무 준비 중이시죠? 구역 팁이나 목표까지 남은 금액, 필요하면 바로 알려드릴게요.";
  }
  return NOAH_WELCOME_DEFAULT;
}

/** Three distinct questions for the phase, drawn in random order. Pass `random` for tests. */
export function noahChips(context = {}, random = Math.random) {
  const route = Array.isArray(context.routes) ? context.routes.find((item) => typeof item === "string" && item.trim())?.trim() : "";
  const key = context.closing ? "closing" : Object.hasOwn(CHIPS, context.phase) ? context.phase : "default";
  const pool = CHIPS[key]
    .map((question) => question.includes("{route}") ? (route ? question.replace("{route}", route) : "") : question)
    .filter(Boolean);
  const source = pool.length >= 3 ? pool : [...new Set([...pool, ...CHIPS.default])];
  const shuffled = [...source];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.slice(0, 3);
}
