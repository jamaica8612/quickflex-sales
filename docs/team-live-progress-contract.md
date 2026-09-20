# 팀 실시간 진행 계약

`quickflex_team_live_progress`는 같은 승인 계정으로 로그인한 여러 휴대폰의 현재 진행 상태를 보여 주는 추가 저장소입니다. 이 데이터는 최종 작업 제출, 매출 합계, 송장 중복 제거, 일일 기록, 비용·정산에 연결되지 않습니다.

## 저장 범위

각 행은 `(user_id, work_id)` 하나의 작업입니다. 저장값은 `device_id`, `work_id`, `work_date`, `work_shift` (`day`/`night`), `device_name`, `revision`, `households`, `items`, 정렬된 `routes`, `status` (`active`/`paused`/`finished`), 서버가 기록하는 `updated_at`입니다.

주소, 세대 상세, 송장·바코드·해시, 단가·매출·비용·정산 입력은 받지도 저장하지도 않습니다. 수량은 각각 0부터 1,000,000, 구역은 최대 100개 `000A` 형식만 허용합니다.

## 쓰기

승인된 로그인 계정만 다음 RPC를 호출합니다.

```text
quickflex_publish_team_progress(p_device_id text, p_payload jsonb)
```

`p_payload`는 정확히 다음 키만 받습니다.

```json
{
  "work_id": "work-20260920-a",
  "work_date": "2026-09-20",
  "work_shift": "night",
  "device_name": "업무폰 A",
  "revision": 1,
  "households": 12,
  "items": 24,
  "routes": ["310A", "310B"],
  "status": "active"
}
```

새 작업의 첫 revision은 유효한 0 이상의 값이면 됩니다. 오프라인에서 변경을 합친 뒤 처음 전송해도 됩니다. 같은 `work_id`에서는 `device_id`, 날짜, 근무조를 바꿀 수 없습니다. 더 높은 revision만 진행 상태를 바꿉니다. 낮은 revision은 저장된 최신 행을 그대로 돌려주므로 지연 전송이 현재 상태를 되돌리지 않습니다. 같은 revision의 완전히 동일한 재전송은 `updated_at`만 서버 시간으로 갱신합니다. 같은 revision에 다른 값이 오면 충돌 오류가 납니다. `finished`가 된 작업은 더 높은 revision으로도 `active`나 `paused`로 되돌릴 수 없고, 이름 변경이나 heartbeat는 `finished` 상태를 유지해서만 가능합니다.

작업을 끝내도 행을 삭제하지 않습니다. 한 휴대폰에서 같은 날짜·근무조에 끝난 작업이 여러 개면 각 `work_id` 행이 남습니다.

## 읽기와 권한

```text
quickflex_read_team_progress(p_work_date date, p_work_shift text)
```

승인된 호출자는 자신의 계정 행만 날짜·근무조로 읽습니다. 관리자도 다른 계정의 진행 상태를 읽거나 고칠 수 없습니다. 테이블 직접 쓰기는 권한으로 막고 RPC만 쓰기 경로로 둡니다.

오래된 휴대폰을 숨기지 않습니다. 클라이언트가 받은 `updated_at`과 현재 시간을 비교해 stale 표시만 합니다. 같은 날짜·근무조의 행은 `device_id`별로 클라이언트에서 묶어 보여 주고, 총 진행 수량은 화면용 휴대폰 합계일 뿐 기존 판매·완료 집계에 영향을 주지 않습니다.
