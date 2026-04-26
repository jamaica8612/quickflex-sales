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
