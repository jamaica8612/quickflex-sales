> 초기 반영 당시의 검토 기록입니다. Google 운영 설정과 최신 검증 결과는 calendar-sync.md 및 design-audit-2026-09-13.md를 참고하세요.

# 지출 · 내보내기 · 캘린더 반영 검토 (2026-09-13)

## 구현한 화면

- 하단: 달력 / 측정 / 지출 / 통계 / 설정. 타인 매출·구역 통계 화면 및 타인 기록 삭제 동작 제거.
- 설정: 내 정보, 근무·단가, 차량·점검, 캘린더, 자료 내보내기, 화면, 계정·데이터, 운영 관리(관리자만)로 접힌 목록 구성.
- 근무표 가져오기는 설정의 근무·단가에서, 외부 캘린더는 설정의 캘린더 연동에서, 월 목표는 설정에서 접근. 기존 서명 팝업과 통계 디자인 유지.
- 지출: 영수증 사진·카메라·PDF(각 10MB), 사진만 보관하는 초안, 확정 입력, 세금 참고 정보, 환불·비용 보전, 휴지통·복원.
- 내보내기: 실제 XLSX 및 증빙 ZIP. 이번 달 1일~말일 / 정산 26일~25일 / 직접 기간. 원본 매출 계산과 확정 지출 기준.
- Google: 근무·휴무·구역명·매출액 선택, 매출 기본 OFF. 삼성 캘린더는 동일 Google 계정 동기화를 통해 표시.

## 운영 반영 대상

Supabase 프로젝트: `xrrdokcjhjqdfvwtbenl` (현재 PWA 설정과 일치).

1. `20260913030523_expense_privacy_and_receipts.sql`
   - 관리자에게 허용되던 타인 매출·단가·점검·서명·원장 읽기/삭제 우회 권한 제거.
   - 가입 승인에는 이름·상태·기사 유형·고정 구역만 반환하는 RPC 사용.
   - 본인 전용 지출·증빙·조정 테이블, 비공개 Storage bucket과 RPC 추가.
   - 기존 업무 데이터와 같은 계정의 여러 기기 집계는 보존.
2. `20260913030622_quickflex_calendar_sync.sql`
   - 서버 전용 연결·OAuth state·이벤트 매핑·작업 큐 테이블 4개 추가.
   - RLS 활성화, 브라우저 역할 권한 없음, service_role만 접근.
3. `calendar-sync` Edge Function 배포
   - OAuth callback 때문에 gateway verify_jwt=false. 일반 POST는 내부 JWT 인증, 승인 계정 검사. worker는 별도 secret 필요.
   - 아직 Google OAuth 클라이언트, 서버 암호화 키, worker secret/스케줄 설정이 필요함. 상세는 `calendar-sync.md`.

**2026-09-13 사용자 승인 후 운영 DB/Edge 반영 완료.** 위 두 migration과 후속 `20260913035729_quickflex_finance_reference_hardening.sql`을 적용했다. 후속 migration은 네 FK 조회 인덱스와 캘린더 identity sequence의 브라우저 권한 회수를 포함한다. `calendar-sync`는 ACTIVE version 1이다.

현재 PWA origin과 로컬 검토 origin(`http://127.0.0.1:8731`)을 `CALENDAR_ALLOWED_REDIRECT_ORIGINS`에 등록했다. Google OAuth 클라이언트/암호화 키/worker secret과 scheduler는 아직 미설정이므로 Google/Samsung 실제 동기화는 완료되지 않았다. 공유 프로젝트의 다른 앱용 Google secrets는 재사용하지 않았다.

## 실제 검증

- Node 전체 테스트 194개 통과 (기존 계산·원장 테스트, 새 PGlite RLS/Storage 정책, 업로드 재시도, XLSX/ZIP 왕복, 캘린더 이벤트 변환 포함).
- PGlite Storage helper를 실제 `storage.foldername()`과 동일하게 파일명을 제외하도록 구성. 실제 Supabase에서 해당 helper 반환값을 읽기 전용으로 확인.
- 실제 PWA: 설정·지출 입력·내보내기, 다크/라이트 360px 확인. 입력창 하단 두 버튼 높이 44px, 글자 14px, 문서 가로 넘침 없음.
- DB와 분리한 브라우저 fixture: 사진-only 초안(금액·날짜 NULL, 합계 제외), 50,000원 확정, 10,000원 부분 환불, 휴지통·복원, 계정 A→B 격리 확인. 복원은 이전 상태와 증빙/조정을 유지.
- 운영 검증: 신규 7개 테이블 RLS, 지출 소유자 SELECT/RPC, 비공개 Storage, 관리자 우회 정책 제거, 캘린더 브라우저 테이블·sequence 접근 차단 확인. 기존 업무 데이터의 행 수가 배포 전후 동일함을 확인했다.
- 추가 PGlite 회귀 테스트: 기본 sequence 권한이 남은 환경에서 권한 회수, service_role nextval 허용, anon nextval 거부 확인.
- 실제 PWA 지출 조회와 내보내기 미리보기 연결 확인: 본인 정산 자료와 지출·증빙 상태가 일치함을 확인했다. Edge 무인증 POST/worker 401, OPTIONS 200, state 없는 callback GET 400, 미지원 메서드 405 확인.
- 실제 계정에 테스트 지출·영수증·외부 일정을 생성하지 않음. 실제 Google/Samsung과 Supabase Storage 바이너리 업로드는 아직 검증하지 않았다.

Advisor 검토: 누락 FK 인덱스 4개는 보완했다. 서버 전용 캘린더 표의 [RLS 정책 없음 안내](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)와 인증 사용자용 [SECURITY DEFINER RPC 안내](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)는 각각 서비스 역할 전용 차단과 내부 소유자·승인·관리자 검사를 사용하는 의도된 구성이다. 새 인덱스의 미사용 안내는 배포 직후 상태이며 제거하지 않는다.

## 남겨둔 범위

- 영수증 OCR 자동 입력, 세금 공제 자동 판정, 양방향 캘린더 및 삼성 기기 로컬 캘린더 직접 쓰기는 포함하지 않음.
- 매출·지출 내보내기는 자료 정리 기능이며 세금 신고서를 생성하지 않음. 미확인 부가세는 NULL로 유지.
- Google 매출 토글 해제는 선택 기간의 기존 앱 관리 이벤트에 재반영해야 외부 금액이 제거됨. 외부에서 수정한 이벤트는 충돌로 보류.
- 네트워크·Storage 장애 시 성공을 표시하지 않음. 고아 파일 정리 실패는 같은 창에서 다음 저장 시 cleanup을 재시도.
