# 팀 매출 상세 노선 복구

`quickflex_team_detail_totals`는 기존 업무 입력을 바꾸지 않는 읽기 전용
projection이다. `routes[].detail_counts`가 비어 있거나 없는 업무라도, 같은
사용자·같은 업무의 배송 증거가 해당 base 노선의 확정 `delivery_count`를 완전히
설명하면 상세 노선을 표시한다.

복구가 허용되는 조건은 모두 충족해야 한다.

- 해당 route의 `detail_counts`는 빈 객체이거나 누락되어야 한다. 하나라도 제공된
  상세 수량은 부분값이어도 그대로 유지한다.
- 업무의 모든 배송 증거는 유효한 base·상세 노선과 양의 수량을 가져야 한다. 그중
  해당 route의 증거 합계는 route의 `delivery_count`와 정확히 같아야 한다.
- 한 업무 안에서 같은 송장 hash를 반복했으면 base와 상세 노선이 모두 일치해야
  한다. hash가 없는 증거는 기존처럼 업무별 로컬 ID로 별개로 취급한다.

따라서 수동 보정으로 base 수량이 증거 합계와 달라진 경우, 누락된 상세 메타데이터,
모호한 상세 노선, 충돌한 송장은 추정하지 않는다. base 노선 합계, 단가·매출,
취소 수량, 날짜 보정은 이 projection에서 변경하지 않는다.

상세 기여값은 기존과 같이 각 업무의 관측값을 뺀 뒤 날짜 범위의 고유 송장을 다시
더한다. 그래서 두 휴대폰이 같은 송장을 보낸 경우에도 한 번만 집계된다. 예를 들어
316C `delivery_count=196`에 316C01=137, 316C02=59의 완전한 증거가 있고 상세값만
빠진 경우, 팀 상세 화면은 두 행을 복구한다. 그중 316C01의 취소 1건은 기존
`cancellation_detail_counts` projection이 그대로 보존한다.

이 마이그레이션은 `quickflex_team_detail_totals`만 `security_invoker = true`로 다시
정의한다. 기존 `quickflex_sales_work_details`는 이 뷰를 참조하므로 동일한 owner RLS
경계와 응답 shape로 복구 결과를 노출한다.
