export function buildSchedulePrompt(ownerName: string, year: number, month: number) {
  return [
    `${ownerName}의 쿠팡 퀵플렉스 스케줄표를 읽고 JSON만 반환하세요.`,
    `정산 기준 월은 ${year}년 ${month}월입니다.`,
    "",
    "반환 형식:",
    "{",
    '  "YYYY-MM-DD": ["302C", "313B"],',
    '  "YYYY-MM-DD": null',
    "}",
    "",
    "규칙:",
    `- ${ownerName} 행만 추출`,
    "- 휴무는 null",
    "- 구역은 숫자 3자리 + 영문 1자리 형식만 유지",
    "- 설명 문장 없이 JSON만 반환",
  ].join("\n");
}

export function buildSettlementPrompt(ownerName: string) {
  return [
    `${ownerName} QuickFlex settlement table image. Return JSON only.`,
    "",
    "Read only the main delivery rows, not the summary boxes on the right and not deduction/detail rows at the bottom.",
    "A valid delivery row usually has columns like 구분, ID, Route, 배송일자, 캠프명, 배송유형, 배송건수(파손), 반품, 합계, 추가 인센티브, 금액.",
    "",
    "Return format:",
    "{",
    '  "rows": [',
    '    { "route": "302C", "date": "2025-10-29", "deliveryCount": 250, "amount": 241250, "extraIncentive": 15 }',
    "  ]",
    "}",
    "",
    "Rules:",
    "- Include only rows where Route matches 3 digits plus 1 uppercase letter, like 302C or 407D.",
    "- deliveryCount must come from 배송건수(파손) or 합계 when 배송건수 is unavailable.",
    "- amount must come from 금액, not 총금액, 지급금액, 공급가액, 세액, 차감내역, 프레시백, 에코백, or 백업 인센티브 summary boxes.",
    "- Ignore rows with 미계약 라우트 or missing Route.",
    "- Remove commas from numbers.",
    "- Do not calculate unit price. The client will calculate amount / deliveryCount.",
    "- Return JSON only with no explanation.",
  ].join("\n");
}
