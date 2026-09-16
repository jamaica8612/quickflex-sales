# 2026-09-16 배송측정 구역 중복 표시 수정

- 기준: `3790419`, 작업 브랜치 `codex/route-display-20260916`.
- 원인: 배송측정 브리지가 여러 매출 행의 구역을 그대로 이어 붙여 동일 구역을 반복 표시했다.
- 변경: `src/main.js`의 `renderMeasurementBridge()`에서 기존 `routeListFromText()`로 표시 배열을 정규화하고 중복 제거한다. `303A, 303A, 303C`는 `303A · 303C`로 표시한다.
- 매출 행, 수량, 일정 저장, DB, 서비스워커는 변경하지 않았다. 이 수정이 서버 일정 덮어쓰기를 입증하는 것은 아니다.
- 검증: `node --check src/main.js`, `node --check app.js`, `node --check sw.js` 통과. 중복·대소문자/공백·기존 행 보존을 확인하는 Node assertion 3개 통과. `git diff --check` 통과.
- 기존 export 기능 테스트는 변경 범위가 아니므로 실행하지 않았다. 브라우저/휴대폰 실제 화면 검사는 미실행이다.
- 로컬 수정만 완료. 버전 변경·커밋·푸시·배포 없음.

## 배포 준비 후속 검증

- 운영 settings 변경 327bb7e를 보존해 통합하고 PWA 1.0.65 / Android Beta 1.10 링크를 준비했다.
- 전체 Node 검사 243개 통과, 실패·제외 0. 기존 VM 검사에 구역 helper와 document theme fixture를 제공하고 Beta 링크 검사를 새 버전으로 갱신했다. 중복 구역 표시와 저장 행·총가구 보존을 실행 검사했다.
- 브라우저 JavaScript 39개 및 변경된 테스트 구문, git diff --check 통과. 커밋·푸시·공개·실기기 설치는 배포 담당 단계에서 진행한다.
