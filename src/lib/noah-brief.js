export const NOAH_NOTICE = "질문과 답에 필요한 내 기록이 OpenAI로 전달돼요. 대화는 서버에 저장하지 않고 이 폰에만 최근 대화를 잠시 보관해요.";
export const NOAH_WELCOME_DEFAULT = "안녕하세요, 노아예요 🙂 오늘도 수고 많으셨어요. 매출이나 지출, 구역 팁까지 궁금한 건 편하게 물어보세요. 제가 기록을 찾아서 알려드릴게요.";

const CHIPS = {
  beforeShift: ["오늘 내 구역 팁", "목표까지 하루 얼마?", "이번 주 얼마 벌었어?"],
  active: ["이 구역 주의할 곳", "공동현관 비번 있어?", "주차 어디 해?"],
  completed: ["오늘 매출 얼마야?", "지난주랑 비교해줘", "오늘 기름값 기록해줘"],
  closing: ["이번 정산 요약", "지출 제일 많은 항목", "순수익 얼마야?"],
  default: ["이번 주 얼마 벌었어?", "지출 제일 많은 항목", "내 구역 팁 보여줘"],
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

export function noahChips(context = {}) {
  return [...(CHIPS[context.closing ? "closing" : context.phase] || CHIPS.default)].slice(0, 3);
}

export function noahBrief(context = {}) {
  const rows = [];
  const date = typeof context.workDateLabel === "string" ? context.workDateLabel.trim() : "";
  if (date) rows.push({ label: `근무일 ${date}`, question: `${date} 근무 구역 알려줘` });
  const routes = Array.isArray(context.routes) ? context.routes.filter((item) => typeof item === "string" && item.trim()).slice(0, 3) : [];
  const routeQuestion = routes.length ? `${routes.join(", ")} 팁 요약해줘` : "오늘 내 구역 팁";
  if (routes.length) rows.push({ label: `구역 ${routes.join(" · ")}`, question: routeQuestion });
  if (Number.isSafeInteger(context.routeTipCount) && context.routeTipCount >= 0) rows.push({ label: `구역 팁 ${context.routeTipCount}개`, question: routeQuestion });
  if (Number.isFinite(context.goalRequiredPerDay) && context.goalRequiredPerDay >= 0) {
    rows.push({ label: context.goalRequiredPerDay === 0 ? "월 목표 달성" : `목표까지 하루 ${Math.ceil(context.goalRequiredPerDay).toLocaleString("ko-KR")}원`, question: "목표까지 하루 얼마?" });
  }
  if (!rows.length && context.phase !== "off") return null;
  return { title: context.phase === "off" ? (rows.length ? "다음 근무 준비" : "오늘은 쉬는 날") : "오늘의 기록",
    caption: typeof context.workDateCaption === "string" ? context.workDateCaption.trim() : "", rows };
}
