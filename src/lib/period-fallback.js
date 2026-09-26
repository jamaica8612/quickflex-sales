// 정산기간이 막 시작해 이번 기간에 기록된 근무일이 아직 없을 때,
// 매출노트 헤드라인 카드와 정산노트 선택값이 방금 끝난 정산기간을 대신
// 보여줄지 정하는 순수 함수. 휴무만 있는 날은 근무일로 치지 않는다 —
// 호출하는 쪽(정산기간 요약 계산)의 근무일 판정 기준을 그대로 따른다.
//
// 지난 정산기간에도 기록이 없으면(신규 사용자) 그대로 빈 상태를 유지해야
// 하므로, previousWorkDays도 함께 확인한다.
function toWorkDayCount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
export function shouldShowPreviousPeriod({ currentWorkDays, previousWorkDays } = {}) {
  return toWorkDayCount(currentWorkDays) <= 0 && toWorkDayCount(previousWorkDays) > 0;
}
