# Google Calendar 동기화

QuickFlex는 **근무표 → QuickFlex가 만든 Google 보조 캘린더**만 단방향으로 동기화한다. 삼성 캘린더 앱에서 같은 Google 계정을 동기화해 이 일정을 보는 방식이며, 삼성 계정 또는 `내 휴대전화` 캘린더에 직접 쓰는 기능은 아니다.

## 동작 범위

- 기본값은 근무·휴무이며 매출 표시와 구역명 표시는 기본으로 꺼져 있다.
- 매출 표시를 켜면 기록된 일 매출만 제목에 넣는다. 예: `퀵플렉스 근무 · 294,735원`.
- 근무표·구역 없이 매출만 기록한 날은 `퀵플렉스 매출 · 294,735원`으로 만들 수 있다.
- 미기록 매출은 제목에서 생략하고, 실제 0원은 `0원`으로 표시한다.
- 매출 표시를 끄면 앱이 관리하는 근무 일정의 금액만 제거한다. 매출 전용 일정은 정리한다.
- 모든 이벤트는 `start.date`/`end.date`인 종일 일정이다. 브라우저의 현재 시간이나 야간 시계로 `work_date`를 바꾸지 않는다.
- 연결 해제는 서버 후속 동기화만 멈춘다. 기존 Google 일정은 기본으로 보존한다.
- Google에서 앱 일정이 편집·삭제되면 충돌로 표시하고 자동 복원하지 않는다. **불일치 다시 반영**을 눌렀을 때만 덮어쓰기 또는 재생성을 시도한다.

각 날짜는 사용자별 고정 Google event ID와 private extended property를 사용한다. 재시도와 중복 클릭은 같은 이벤트를 갱신하며, 다른 개인 일정은 읽거나 변경하지 않는다.

## 브라우저 계약

설정 화면은 다음처럼 마운트한다.

```js
import { mountCalendarSync } from "./ui/calendar-sync.js";

const calendarSync = mountCalendarSync({
  host: document.getElementById("calendarSyncContent"),
  db: state.db,
  getDays: async (startDate, endDate) => [
    // 반드시 현재 로그인한 사용자의 canonical day snapshot만 반환한다.
    { date: "2026-09-13", off: false, worked: true, hasSchedule: true,
      revenue: 294735, routeLabel: "310C01", workShift: "night" },
  ],
  toast,
});
```

`getDays`는 저장 대기분을 먼저 반영하고 DB를 다시 읽은 뒤, 선택 기간의 본인 기록만 반환해야 한다. 각 날이 없어도 controller가 중립 스냅샷을 채워 옵션 변경으로 기존 관리 이벤트를 정리한다. `user_id`, OAuth 토큰, Google client secret은 절대 전달하지 않는다. 로그아웃 시 `calendarSync.dispose()` 또는 `calendarSync.reset()`을 호출해 이전 계정의 화면 상태를 지운다.

`calendar-sync` Edge Function의 인증된 POST action은 아래뿐이다.

| action | body | 결과 |
| --- | --- | --- |
| `status` | 없음 | 연결·대기·재연결 상태 |
| `oauth_start` | `{ returnTo }` | Google 승인 URL |
| `queue` | `{ startDate, endDate, settings, days }` | 서버 동기화 작업 예약 |
| `reapply` | queue와 같음 | 충돌 날짜를 명시적으로 다시 반영하는 작업 예약 |
| `disconnect` | 없음 | 후속 동기화 중지, 외부 이벤트 보존 |

사용자 ID는 JWT에서만 얻는다. `days`에는 다른 사용자의 ID나 재무 원장을 쓰는 필드가 없으며, 이 API는 매출/세금 데이터를 수정하지 않는다.

## Google Cloud 준비

아래는 실제 연결 전 운영자가 해야 할 일이다. 이 저장소에는 OAuth client secret이나 서비스 키를 넣지 않는다.

1. Google Cloud 프로젝트에서 Calendar API를 활성화하고 OAuth 동의 화면과 **웹 애플리케이션** OAuth 클라이언트를 만든다.
2. 승인된 redirect URI에 `https://<project-ref>.supabase.co/functions/v1/calendar-sync`를 정확히 등록한다. 여기서 `<project-ref>`는 배포한 Supabase 프로젝트다.
3. 앱이 만든 보조 캘린더만 다루도록 `https://www.googleapis.com/auth/calendar.app.created` scope를 승인한다. Google의 [Calendar authorization scope 안내](https://developers.google.com/workspace/calendar/api/auth)와 [웹 서버 OAuth 안내](https://developers.google.com/identity/protocols/oauth2/web-server)를 따른다.
4. Supabase Edge Function secret으로 다음을 설정한다. `CALENDAR_TOKEN_ENCRYPTION_KEY`는 32바이트 base64url 키이며, 브라우저 설정값이 아니다.

```powershell
npx supabase secrets set GOOGLE_OAUTH_CLIENT_ID=<web-client-id>
npx supabase secrets set GOOGLE_OAUTH_CLIENT_SECRET=<web-client-secret>
npx supabase secrets set CALENDAR_TOKEN_ENCRYPTION_KEY=<32-byte-base64url-key>
npx supabase secrets set CALENDAR_ALLOWED_REDIRECT_ORIGINS=https://jamaica8612.github.io
npx supabase secrets set CALENDAR_WORKER_SECRET=<long-random-worker-secret>
```

5. OAuth callback은 Google이 로그인 세션 JWT 없이 호출하므로 `supabase/config.toml`에 다음 설정을 추가한 뒤 함수를 배포한다. callback 이외의 action은 함수 안에서 Supabase `auth.getUser()`로 JWT를 검증한다.

```toml
[functions.calendar-sync]
verify_jwt = false
```

```powershell
npx supabase functions deploy calendar-sync
```

OAuth state는 10분 후 만료하며 서버에는 SHA-256 hash만 남긴다. refresh token은 public schema의 `quickflex_calendar_*` 전용 테이블에 AES-GCM 암호문으로만 저장한다. migration은 RLS를 켜고 정책을 만들지 않으며, `anon`/`authenticated`/`public` 권한을 모두 회수하고 `service_role`에만 권한을 준다. 따라서 기본 Data API 경로를 쓰는 Edge Function은 동작하고 브라우저는 토큰·OAuth state·작업·이벤트 매핑을 읽거나 쓰지 못한다.

## 서버 작업자와 재시도

브라우저는 `queue`에서 작업만 넣는다. `worker` action은 `x-calendar-worker-secret` 헤더가 있어야 하며 준비된 작업을 최대 8개 처리한다. 일시적 Google 오류는 최대 5회 지수 backoff로 재시도한다. 401/refresh-token 오류는 `needs_reconnect`로 바꾸며 자동 재시도하지 않는다.

동시에 들어온 서로 다른 작업은 사용자별 connection lease를 먼저 얻는다. lease를 얻지 못한 작업은 실패로 세지 않고 30초 뒤 다시 대기하므로, 두 worker가 같은 사용자용 보조 캘린더를 중복 생성하지 않는다.

운영에서는 Supabase Cron, GitHub Actions scheduled workflow, 또는 신뢰할 수 있는 scheduler가 5분마다 다음 HTTP 요청을 보내야 브라우저를 닫아도 처리된다. 현재 migration은 scheduler를 자동 생성하지 않으며, worker secret을 SQL 또는 공개 로그에 넣어서는 안 된다.

```http
POST https://<project-ref>.supabase.co/functions/v1/calendar-sync
Content-Type: application/json
x-calendar-worker-secret: <CALENDAR_WORKER_SECRET>

{"action":"worker"}
```

전체 개인 일정 동기화가 아니라 앱 전용 보조 캘린더의 이벤트 ID와 etag만 확인한다. Google의 [증분 동기화 안내](https://developers.google.com/workspace/calendar/api/guides/sync)는 향후 원격 변경분을 대량 처리할 때의 확장 경로다.

## 배포 전 확인

- migration `20260913030622_quickflex_calendar_sync.sql`를 canonical schema 변경과 함께 검토·적용한다.
- Settings host와 module import, service worker cache 목록은 통합 담당자가 추가한다.
- Google Cloud 프로젝트와 OAuth 웹 클라이언트가 준비됐고, 고정 callback URI가 등록됐다. OAuth 동의 화면은 외부 Testing 상태이며 본인 테스트 계정만 등록된 상태다. Branding homepage/privacy 미등록으로 공개 전환 및 publish는 비활성이다.
- 실제 Google Calendar 월 화면에서 전용 `퀵플렉스 근무` 일정 26개를 확인했다. Samsung 휴대폰 표시와 외부 수정·삭제 충돌 동작은 아직 실기능 미검증이다.

## 2026-09-13 운영 상태

- `xrrdokcjhjqdfvwtbenl`에 calendar migration과 sequence 권한 보완 migration이 적용됐고, `calendar-sync` version 4가 ACTIVE다.
- 실제 OAuth callback URI는 `https://xrrdokcjhjqdfvwtbenl.supabase.co/functions/v1/calendar-sync`다.
- `CALENDAR_ALLOWED_REDIRECT_ORIGINS`는 `https://jamaica8612.github.io,http://127.0.0.1:8731`로 설정됐다. 로컬 주소는 현재 개발 미리보기용이다.
- Google Calendar API가 활성화됐고 웹 OAuth 클라이언트가 준비됐다. 허용 scope는 `calendar.app.created`이며 callback URI는 위 고정 주소다. OAuth 동의 화면은 외부 Testing 상태이고 본인 테스트 계정만 등록됐다. Branding homepage/privacy 미등록으로 publish는 비활성이다. 공개 전환 전에는 Google의 7일 refresh-token 제한을 검토한다.
- 전용 서버 secret 4개가 설정됐고, worker secret은 Vault named secret `quickflex_calendar_worker_secret`에 저장됐다. secret 값과 client ID는 문서·로그에 기록하지 않는다.
- `pg_cron` job `quickflex-calendar-sync-worker` (jobid 7)가 5분 주기 active 상태다. job은 Vault에서 worker secret을 조회해 `calendar-sync`의 POST `worker` action을 호출하며 timeout은 120000ms다.
- 2026-09-01~2026-09-30 근무·휴무 snapshot(구역·매출 OFF)의 job 1이 HTTP 200, `processed: 1`, attempts 1로 성공했고 mapping 26건이 확인됐다. 동일 조건 job 2도 06:25:10Z에 succeeded했다. 전용 캘린더 월 화면에서 26개 일정을 확인했으며, event ID와 etag의 MD5가 전후 동일해 중복 생성·변경이 없음을 검증했다. 기존 금액 데이터는 수정하지 않았다.
- 자동 동기화는 예약된 snapshot 작업만 처리한다. 사용자가 폼을 열어 두지 않아도 queue 작업을 처리하지만, 원격 Google 일정 전체를 수집하거나 임의의 개인 일정을 동기화하지 않는다.
- 캘린더 관련 Node 테스트 13개(권한 SQL, 암호화, 날짜·금액 옵션, 재연결 보호, 상태 표시·초점 보존)가 통과했다. 이후 표시 스타일 수정 후 UI 테스트 5개도 다시 통과했다.
- 실제 계정에서 연결 해제 후 재연결했고 기존 캘린더 및 일정 매핑 26건이 유지됐다. 재연결 후 job 3도 HTTP 200으로 성공했고 중복 일정은 생기지 않았다.
- 앱에서 대기 상태가 서버 완료 시각으로 자동 전환되는 동안 날짜 입력 초점이 유지됨을 확인했다. 열린 패널은 10초마다 최대 6분 확인하며, 숨김 탭·닫힌 패널에서는 멈추고 패널을 다시 열면 최신 상태를 확인한다.
- 최신 작업의 실패·외부 변경 충돌은 과거 성공 시각보다 우선 표시한다. OAuth 재연결은 새 권한으로 기존 앱 캘린더 접근을 확인한 뒤에만 기존 ID를 유지해 저장한다.
- 다크·라이트 각각 360px·614px 화면을 확인했다. 캘린더 주 버튼 44px, 보조 버튼 36px, 버튼 글자 13px이며 가로 넘침이 없다.
- 공개용 운영자 표기는 김관현, 문의 이메일은 flexnote2026@gmail.com으로 확정했다. 개인정보처리방침 초안은 준비됐고, 전체 디자인 검수 후 사이트 배포와 Google Branding 공개 전환을 이어간다. 배포 전 확인 항목 중 Google 연결·예약 snapshot 검증은 완료됐고, Samsung 표시 및 외부 수정·삭제 충돌 실기능 검증은 미완료다.
