# 폰별 진행과 취소 구역 상세 표시

2026-09-20, Supabase 프로젝트 `xrrdokcjhjqdfvwtbenl`에 지정한 두 migration만 적용했다. 과거 migration이나 전체 canonical schema는 재적용하지 않았다.

- `20260920021710_recover_team_detail_counts_from_complete_evidence`: 원본을 수정하지 않고 상세 조회 view만 교체했다. 근거가 완전한 업무의 빈 상세 구역값만 복구한다.
- `20260920021733_quickflex_team_live_progress`: 승인된 같은 계정의 여러 휴대폰 진행 전용 테이블·RPC·RLS를 추가했다. 기존 매출·송장·정산 테이블에 연결하지 않는다.

개발 당시 파일명의 시간은 운영에 기록된 migration version으로 정렬했다. `supabase-schema.sql`의 해당 두 블록과 migration 본문을 일치시켰다. 기존 PWA 자산은 변경하지 않아 서비스 워커·PWA 버전 변경은 없다.

## 운영 확인

- 보고된 계정의 2026-09-19 상세 조회는 316C01=137, 316C02=59, 316D01=100이다. 같은 날 원본 입력·전체 매출 조회 fingerprint는 변경 전후 동일하다.
- 실제 로그인된 PWA에서 316C 196건 / 163,660원 아래에 `316C01 137건, 취소 1건 · 316C02 59건`이 표시된다. 316D 100건과 취소 포함 매출도 유지된다.
- `quickflex_team_detail_totals`의 security_invoker가 유지되며 authenticated 본인 역할로 상세 조회를 검증했다.
- 진행 테이블의 RLS가 켜져 있고 authenticated 직접 권한은 SELECT뿐이다. 두 RPC는 authenticated 실행만 허용하고 승인·소유자를 검증한다. 진행 테이블에 테스트 데이터는 남기지 않았다.
- 서버 관련 Node 검사 45개 통과. 파일명 정렬 뒤 새 SQL 검사 13개 재통과. `node --check app.js`, `node --check sw.js`, `git diff --check` 통과.

Android Beta 1.17 준비본에 폰별 진행 카드·전송·조회·오프라인 복구가 연결되어 있다. 기본값은 꺼짐이고 2대 제한 없이 3대 이상을 표시한다. 실기기 다중 접속은 아직 검증하지 않았다.
