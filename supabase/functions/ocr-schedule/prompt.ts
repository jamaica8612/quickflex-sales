export function buildSchedulePrompt(ownerName: string, year: number, month: number) {
  return [
    `${ownerName}의 쿠팡 퀵플렉스 스케줄표 이미지를 정확히 읽어 JSON으로만 응답하세요.`,
    `정산 기준 월: ${year}년 ${month}월. 표 헤더의 날짜 컬럼을 정확히 매핑하세요.`,
    "",
    "중요 규칙:",
    `1) ${ownerName} 본인 행만 읽습니다. 다른 기사 행은 모두 무시.`,
    "2) 셀에 구역 코드가 있으면 그 코드만 추출. 형식: 숫자 3자리 + 영문 대문자 1자리 (예: 302C, 313B).",
    "3) 한 셀에 여러 구역이면 모두 배열에 포함 (예: ['302C', '304B']).",
    "4) 빈 셀, 휴무, OFF, '-', 'X' 표시는 routes를 null로.",
    "5) 영문은 항상 대문자, 공백/특수문자 제거.",
    "6) 표에 없는 날짜는 결과에서 빼세요.",
    "7) 셀의 글자가 흐리거나 애매해도 추측하지 말고 정확히 보이는 것만 기록. 모르면 null.",
    "",
    "응답 형식 (JSON만, 설명문 절대 금지):",
    "{",
    `  "${year}-${String(month).padStart(2, "0")}-01": ["302C"],`,
    `  "${year}-${String(month).padStart(2, "0")}-02": null,`,
    `  "${year}-${String(month).padStart(2, "0")}-03": ["302C", "304B"]`,
    "}",
  ].join("\n");
}

export function buildSettlementPrompt(ownerName: string) {
  return [
    `${ownerName}의 쿠팡 QuickFlex 정산표 이미지를 읽고 JSON만 반환하세요.`,
    "",
    "메인 배송 행만 읽습니다. 우측 요약 박스, 하단 차감/상세 행은 무시.",
    "유효한 행은 보통 구분, ID, Route, 배송일자, 캠프명, 배송유형, 배송건수(파손), 반품, 합계, 추가 인센티브, 금액 컬럼을 가집니다.",
    "",
    "추출 규칙:",
    "- Route는 숫자 3자리 + 영문 대문자 1자리 (302C, 407D 등)만 유효.",
    "- deliveryCount는 '배송건수(파손)' 컬럼. 없으면 '합계'.",
    "- amount는 '금액' 컬럼. '총금액', '지급금액', '공급가액', '세액', '차감내역', '프레시백', '에코백', '백업 인센티브' 박스는 절대 사용 금지.",
    "- '미계약 라우트' 또는 Route 빈 행 무시.",
    "- 숫자에서 콤마 제거.",
    "- 단가 계산 금지 (클라이언트가 amount/deliveryCount로 계산).",
    "- date는 YYYY-MM-DD. 모호하면 빈 문자열.",
    "",
    "응답 형식 (JSON만):",
    "{",
    '  "rows": [',
    '    { "route": "302C", "date": "2025-10-29", "deliveryCount": 250, "amount": 241250, "extraIncentive": 15 }',
    "  ]",
    "}",
  ].join("\n");
}
