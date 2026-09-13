# 플렉스노트 디자인·운영 최종 검수 보고서

검수일: 2026-09-13

## 검수 결과

- `npm ci` 완료.
- `node --test tests/*.test.mjs`: 207/207 통과, skip 없음.
- 주요 `main`, service worker, calendar 파일 `node --check` 통과.
- diff check 통과.
- 다크·라이트 테마의 모바일 360px 및 614px 화면을 확인했다.
- 홈, 기록, 통계, 지출 입력, 설정, 서명 44px/14px 쌍 버튼, 내보내기 대화상자를 확인했다.
- 확인한 화면 크기에서 가로 overflow가 없었다.

## 반영된 디자인 기준

- 홈·기록 숫자에 tabular numerals와 `700`을 적용하고 단위는 더 작고 muted하게 조정했다.
- 프로필 입력은 44px 높이, 14px 글자, 500 굵기를 사용한다.
- 지출 총액은 52px 높이, 20px 글자, 600 굵기를 사용한다.
- 설정 라벨은 12px/500, 모바일 날짜는 14px/600으로 clipping 없이 표시된다.
- 라이트 테마 보조 색상 토큰을 중립 계열로 정리했다.
- `DESIGN-RULES.md`를 디자인 규칙의 단일 기준으로 사용한다.

## Google Calendar 검증

- 전용 `퀵플렉스 근무` 일정 26개와 3개 동기화 작업이 성공했다.
- 연결 해제 후 재연결을 포함해 중복 일정이 생성되지 않았다.
- worker Cron은 5분 주기다.
- 상태 UI polling은 focus를 보존하며 갱신된다.
- Google scope는 `calendar.app.created`만 사용한다.
- 금액과 구역 정보는 opt-in이다.

## 공개 전 운영 경계

- 아직 배포 및 Google OAuth 공개 전환 전이다.
- Branding homepage/privacy 미등록으로 공개 publish는 비활성 상태다.
- Samsung Calendar 실기기 표시 검증은 아직 하지 않았다.
- 외부 Google 일정 수정·삭제 충돌의 실기능 검증은 아직 하지 않았다.
- 계정 삭제는 수동 운영자 절차이며, 이 제한을 개인정보처리방침과 운영 설명에 공개한다.
- Deno typecheck는 실행하지 않았다.

브라우저 screenshot과 계정 관련 세부 자료는 별도 로컬 private audit에 보관하며 이 보고서에는 포함하지 않는다.
