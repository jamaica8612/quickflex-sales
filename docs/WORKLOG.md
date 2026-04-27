# QuickFlex Worklog

Last updated: 2026-04-27 (handoff verification pass)

## 2026-04-27 OCR 503 Error Handling Pass (Codex)

작업 폴더: `C:\Users\jamai\Documents\Codex\2026-04-25\new-chat`

### Problem

- User hit OCR failure from Gemini:
  - `503`
  - `UNAVAILABLE`
  - `This model is currently experiencing high demand`
- The frontend displayed the raw escaped JSON error, which is not user-friendly.

### Changed Files

- `supabase/functions/ocr-schedule/providers/gemini.ts`
  - Added retry for transient Gemini `429`/`503` responses.
  - Converts high-demand/UNAVAILABLE failures into a Korean actionable message:
    - `OCR 모델 사용량이 많아 잠시 처리하지 못했습니다. 1~2분 뒤 다시 시도해 주세요.`
- `src/main.js`
  - Added OCR response/error parsing helper.
  - Schedule OCR and settlement OCR now show a clean Korean message instead of raw JSON.
- `sw.js`
  - `CACHE_NAME` bumped to `quickflex-shell-v10`.

### Deployment Note

- Frontend changes need normal GitHub Pages deploy.
- Edge Function change must also be deployed to Supabase:
  - `supabase functions deploy ocr-schedule`

---

## 2026-04-27 PWA Icon & Install Guidance Pass (Codex)

작업 폴더: `C:\Users\jamai\Documents\Codex\2026-04-25\new-chat`

### Changed Files

- `icon.svg`
  - Replaced the simple box mark with a more app-like QuickFlex Sales icon using the gold brand background, dark record card, route lines, and a Q/search-style revenue mark.
- `icon-192.png`
- `icon-512.png`
  - Added PNG app icons for Android/iOS home-screen use.
- `manifest.webmanifest`
  - Added `192x192` and `512x512` PNG icon entries before the SVG fallback.
- `index.html`
- `intro.html`
  - Added favicon and `apple-touch-icon` links.
- `intro.html`
  - Added a “홈 화면에 추가” install guidance section with iOS, Android, and PC steps.
- `sw.js`
  - `CACHE_NAME` bumped to `quickflex-shell-v9`.
  - Added PNG app icons to `SHELL_FILES`.

### Checks To Run

- `node --check` for all JS files.
- Browser check:
  - `intro.html` shows the app icon and home-screen install guide.
  - Manifest contains `icon-192.png`, `icon-512.png`, and `icon.svg`.
  - After deployment, unregister/refresh service worker once if an old icon is cached.

---

## 2026-04-27 Intro Page Completion Pass (Codex)

작업 폴더: `C:\Users\jamai\Documents\Codex\2026-04-25\new-chat`

### Changed Files

- `intro.html`
  - Completed the user-facing product introduction page.
  - Added top navigation, mobile metadata, CTA wording for login/signup request, and responsive polish.
  - Added member/admin explanation sections:
    - 백업기사 / 고정기사 지원
    - 관리자 승인제
    - 관리자 요약/라우트/사용자/정산표 탭
    - 가입 요청 → 관리자 승인 → 일별 기록 → 통계 확인 flow
- `index.html`
  - Added an auth-card link to `intro.html` so first-time users can read the feature introduction from the login screen.
- `styles.css`
  - Added small auth intro-link styling.
- `sw.js`
  - `CACHE_NAME` bumped to `quickflex-shell-v8`.
  - Added `./intro.html` to `SHELL_FILES` so the deployed PWA can cache the introduction page.

### Checks To Run

- `node --check` for all JS files.
- Local/browser check:
  - `intro.html` loads without console errors.
  - `index.html` login card shows `처음이라면 기능 소개 보기`.
  - `intro.html` CTA returns to `index.html`.
  - Mobile width around 390px does not overflow.

---

## 2026-04-27 Verification Pass (Claude)

작업 폴더: `C:\Users\jamai\Documents\Codex\2026-04-25\new-chat`

### Changed Files

- `src/config.js`
  - `PUBLIC_SUPABASE_CONFIG.anonKey`에 운영 anon publishable key 채움 (`sb_publishable_prnLDb7bcWORu7wrqTRsXQ_NWJL8Jnk`).
- `sw.js`
  - `CACHE_NAME`을 `quickflex-shell-v4` → `quickflex-shell-v5`로 bump (config.js 변경 반영).

### Checks Run

- `node --check`: `app.js`, `sw.js`, `src/main.js`, `src/config.js`, `src/state.js`, `src/services/{auth,db}.js`, `src/ui/{calendar,record,stats,settings,admin,ocr}.js`, `src/lib/{date,route,revenue,format}.js` — 모두 OK.
- 로컬 정적 서빙 (`local-server.js`, port 4173) → preview 진입.
  - 콘솔 에러: 0건.
  - 모듈/네트워크: anon key 채운 뒤 Auth 카드 + DB 연결 시트가 정상 노출됨 ("DB에 연결되어 있습니다.").
  - 초기 nav: `달력 / 통계 / 설정`만 표시 (`관리` 탭 hidden) — driver 기본 가드 정상.
  - DOM 구조: `view-admin` 섹션 존재, `data-admin-tab` 4개(`summary/routes/users/settlement`)와 동일 panel 4개 매칭 확인.
  - role 토글 시뮬레이션: `app.dataset.role='admin'` + `.admin-only` unhide 시 nav `관리` 탭 노출, 4개 nav-tab 모두 표시. 다시 driver로 복귀 + admin nav 클릭 → `showView()` 가드가 `view=home`으로 되돌림.

### Not Verified (Needs Real Supabase Login)

- 관리자 내부 탭 4개의 실 데이터 렌더링 (요약/라우트/사용자/정산표).
  - 이유: `renderAdminDashboard()`가 `state.profile?.role !== "admin"`이면 early return. 모듈 스코프 `state`에 외부에서 admin profile을 주입할 hook이 없어서 실로그인 외 방법으로 panel 전환을 검증할 수 없음.
- 실 admin 계정 → 사용자 관리 카드 저장 → RLS 통과 여부.
- 실 driver 계정 → 관리 탭 미노출 + 데이터 격리.
- 정산표 OCR end-to-end (Edge Function 호출 + 단가 후보 → 적용).

위 항목은 사용자가 운영 GitHub Pages 또는 로컬에서 admin/driver 계정으로 직접 로그인해 확인 필요. 결과 공유받으면 다음 패스에서 후속 수정 진행.

### Deployment Checklist Status (`docs/DEPLOYMENT.md`)

- [x] `supabase/config.toml`의 `verify_jwt = true` 유지.
- [x] `PUBLIC_SUPABASE_CONFIG.url` + `anonKey` 채움.
- [x] `sw.js` `CACHE_NAME` → v5.
- [x] `node --check` 전체 JS pass.
- [ ] `supabase-schema.sql` 최신본 SQL Editor 적용 — 사용자 확인 필요.
- [ ] Auth Site URL/Redirect URL = `https://jamaica8612.github.io/quickflex-sales/` — Supabase 대시보드 확인 필요.
- [ ] 첫 admin 프로필 존재 + `status='approved'` — 사용자 확인 필요.
- [ ] PWA 새 캐시 진입 (SW unregister → reload) — 배포 후 확인 필요.

### Layout Bug Fixes (visual review pass)

`styles.css` 4건 패치, `sw.js` v5 → v6 bump.

- `.sub-header` 반투명(`rgba(21,25,34,.96)`) → 불투명 `var(--panel)` + `backdrop-filter: blur(12px)`. 설정 화면 스크롤 시 본문이 sticky 헤더 뒤로 비치는 문제 해소.
- `.rate-list > .daily-card { grid-column: 1 / -1; }` 추가. "등록된 단가가 없습니다." 빈 상태 메시지가 4-column grid의 1열에 갇혀 "등록된 / 단가가 / 없습니다."로 줄바꿈되던 버그 해소.
- `.upload-row .upload-btn` 스타일 신규 + 내부 `<input type="file">`을 `position: absolute; opacity: 0;`로 visually hidden 처리. OS 기본 파일 input과 "이미지 선택" 텍스트가 분리되어 보이던 문제를 pill 버튼 1개로 통합.
- `.upload-row .secondary-btn { flex: 0 0 auto; min-width: 96px; white-space: nowrap; }` 추가. "OCR 실행"이 좁아져 "OCR 실 / 행"으로 세로 깨지던 문제 해소.

검증: 로컬 preview 재로드 후 설정 화면 스크린샷에서 4건 모두 정상 렌더링 확인. 콘솔 에러 0건.

### Font & Spacing Polish Pass

`styles.css` 톤다운 + 간격 정규화, `sw.js` v6 → v7.

폰트:
- `h1` 28 → 24px
- `.summary-row strong` / `.summary-card.compact strong` 34 → 30px
- `.calendar-toolbar strong`, `.day-dock strong` 20 → 18px
- `.total-card strong` 30 → 26px
- `.admin-route-head strong/span` 18 → 16px
- `.admin-revenue-head strong` 17 → 16px
- `.admin-revenue-total` 20 → 18px

간격 (8/12/16 4의 배수 스케일로 정리):
- `.entry-head/.entry-row gap` 7 → 8px, `.entry-row padding-y` 9 → 8px, input/select padding 9 → 8px
- `.settings-section padding` 18 → 16px, `gap` 14 → 12px
- `.settings-field gap` 7 → 8px
- `.rate-list gap` 7 → 8px
- `.record-body/.settings-body gap` 14 → 12px
- `.summary-meter margin` `15px 0 18px` → `16px 0`
- `@media (max-width: 380px)` 안에서 `.calc-row gap` 6 → 8px, `.entry-row gap` 5 → 6px

관리 카드 모바일 가독성:
- `@media (max-width: 380px) .admin-card-row` 3열 → 2열, 저장 버튼은 `grid-column: 1 / -1`로 다음 줄 wide.

검증: 로컬 preview 재로드 후 홈/설정/관리 화면 스크린샷 확인. 콘솔 에러 0건.

### UX Polish Candidates (Pending Real-Data Review)

- 관리자/통계 view가 `state.statsYear/Month`를 공유 — 별도 월로 분리할지 사용자 결정.
- `renderAdminProfiles` 카드마다 같은 hint 반복 → 리스트 상단으로 1회 통합.
- 빈 상태 안내 문구 통일 ("사용자 정보가 없습니다." vs "선택한 정산기간 기록이 없습니다.").
- admin 카드 모바일 폭에서 status select + driver_type select + 저장 버튼 줄넘김 점검.

---



## Current Goal

Convert the QuickFlex sales app from a personal/static workflow into a member-based Supabase Auth app while keeping the GitHub Pages/PWA deployment model.

The operating rule is:

- Drivers see login/signup/approval-waiting first.
- The manual DB connection screen is only for local development.
- Production member management happens through the app admin UI plus Supabase Auth/RLS.
- Route pricing is one default unit price per Route, with daily `unit_snapshot` preserving historical revenue.

## Base Folder

`C:\Users\jamai\Documents\Codex\2026-04-25\new-chat`

## Files Changed In This Pass

- `index.html`
  - App script entry changed to `<script type="module" src="./src/main.js?v=1"></script>`.
  - Login card now starts with email/password only.
  - Signup-only fields are hidden until the user chooses 가입 요청.
  - Added an admin-only `관리` bottom tab and a dedicated admin SPA view.
  - Moved admin revenue summary, route stats, user management, and settlement rate OCR into the admin view.
  - Removed the old admin panel from `통계` and user management from `설정`.
- `app.js`
  - Kept as a small compatibility bootstrap that loads `src/main.js`.
- `src/main.js`
  - Main app logic copied from the previous monolithic app.
  - Imports public config/table constants from `src/config.js`.
  - Imports display formatters from `src/lib/format.js`.
  - Added local-only DB setup gate.
  - Added production deployment-config error when public Supabase config is missing.
  - Removed the route-rate-history table constant.
  - Added admin editing for `fixed_routes`.
  - Added login/signup auth mode switching.
  - Added admin-only view routing.
  - Added admin internal tabs: summary, routes, users, settlement.
  - Added route-level admin aggregation using saved `delivery_count * unit_snapshot`.
- `src/config.js`
  - Holds public Supabase config, table names, and shared constants.
- `src/state.js`
  - Added state shape helpers for future extraction.
- `src/services/auth.js`
  - Placeholder module for auth extraction.
- `src/services/db.js`
  - Placeholder module for database extraction.
- `src/ui/calendar.js`
- `src/ui/record.js`
- `src/ui/stats.js`
- `src/ui/settings.js`
- `src/ui/admin.js`
- `src/ui/ocr.js`
  - Placeholder UI modules so the project now has role-based homes.
- `src/lib/date.js`
- `src/lib/route.js`
- `src/lib/revenue.js`
- `src/lib/format.js`
  - Holds shared won/count formatters used by `src/main.js`.
- `sw.js`
  - `CACHE_NAME` bumped to `quickflex-shell-v4`.
  - `SHELL_FILES` updated with `src/` module files.
- `supabase-schema.sql`
  - Kept as canonical schema.
  - Removed period-based route-rate-history table/policies.
  - Added `quickflex_is_approved()`.
  - Added approved-user RLS gate for route rates, daily records, and daily route items.
- `supabase/schema.sql`
  - Replaced with a pointer telling agents to use root `supabase-schema.sql`.
- `docs/DEPLOYMENT.md`
  - Rewritten as readable deployment/Auth/SW/schema guide.
- `AGENTS.md`
  - Added deployment guide and worklog entrypoints.
- `CLAUDE.md`
  - Added deployment guide and worklog entrypoints.

## Important Current State

The app is now structurally prepared for modular work, and `src/main.js` already imports config/constants and formatters from modules. Most UI/service runtime logic still lives in `src/main.js`. The new `src/services/*`, `src/ui/*`, and remaining `src/lib/*` files are the intended extraction targets for the next pass.

This was intentional for this pass: keep the app behavior stable first, then continue moving functions out of `src/main.js` in smaller verified slices.

## Remaining TODO

- Move real functions from `src/main.js` into:
  - `src/services/auth.js`
  - `src/services/db.js`
  - `src/ui/calendar.js`
  - `src/ui/record.js`
  - `src/ui/stats.js`
  - `src/ui/settings.js`
  - `src/ui/admin.js`
  - `src/ui/ocr.js`
- Move constants from `src/main.js` into `src/config.js` and import them.
- Move pure helpers from `src/main.js` into `src/lib/*`.
- Add a production Supabase Project URL and anon public key before real GitHub Pages deployment.
- Apply the latest `supabase-schema.sql` in Supabase SQL Editor.
- Test with real Supabase users:
  - first admin bootstrap
  - login screen email/password-only mode
  - signup request mode with name and driver type
  - pending user approval screen
  - approved driver app entry
  - blocked user behavior
  - admin-only member management
  - fixed driver `fixed_routes`
- Test PWA refresh after `CACHE_NAME` bump.

## Checks To Run

```powershell
Get-ChildItem -Recurse -Filter *.js |
  Where-Object { $_.FullName -notmatch '\\.git\\' } |
  ForEach-Object { node --check $_.FullName }
```

## Checks Run In This Pass

- Comment follow-up changes:
  - Admin revenue stats map legacy `kim-gwanhyun` rows to `김관현` instead of `알 수 없는 사용자`.
  - Admin revenue cards display Korean status labels: `승인`, `미승인`, `차단`.
  - My profile settings spacing was cleaned up with grouped fields.
  - Admin fixed-route inputs now include a label and note explaining that fixed drivers see only those routes.
  - Settlement rate calculation now starts with image upload/OCR-prep UI and keeps CSV as a fallback.
  - Real settlement OCR still needs sample settlement images to tune Route / delivery count / amount extraction and show a rate-update diff.
  - Calendar day cells were adjusted so date, revenue/count, and route labels render as separate stacked lines.
  - Daily record unit inputs remain per-date snapshots; editing them updates only that day's saved `unit_snapshot`, not the default route rate.
  - Settlement image rate calculation is admin-only.
  - Schedule manual input label now says text input, with an inline example instead of CSV wording.
  - Schedule OCR helper text now says `근무표 이미지 선택 후 OCR 실행을 누르세요.`
  - Settlement image OCR is now wired through the existing `ocr-schedule` Edge Function using `kind: "settlement"`.
  - Settlement OCR extracts delivery rows, calculates route unit candidates from `amount / deliveryCount`, asks for confirmation, then updates matching default route rates without deleting unobserved routes.
  - Admin features are now gathered under the admin-only bottom `관리` tab.
  - `통계` is driver-facing again: daily/monthly/yearly/total only.
  - `설정` is simplified to profile, rates, schedule import, and data connection/reset.
  - Admin route stats list Route/group totals, delivery count, snapshot-based revenue, average unit, and top user contributions.
- `Get-ChildItem -Recurse -Filter *.js | Where-Object { $_.FullName -notmatch '\\.git\\' } | ForEach-Object { node --check $_.FullName }`
  - Result: passed.
- Searched for removed rate-history references in schema/app files.
  - Result: no remaining `quickflex_route_rate_history` or `rateHistory` references in active code/schema files.
- Opened `file:///C:/Users/jamai/Documents/Codex/2026-04-25/new-chat/index.html` in the in-app browser.
  - Result: module script `./src/main.js?v=1` is present.
  - Result: local `file://` runtime shows the development DB connection overlay, as intended.
  - Result: after adding module imports, the app still renders the calendar shell.

Browser checks:

- Local `file://` or local server should allow the development DB connection screen.
- Production URL with missing public config should show deployment configuration error, not DB input fields.
- Production URL with public config should show Auth first.

## Cautions For Claude/Codex

- Start with `git status --short`; this folder already had dirty files before this pass.
- Do not revert user/prior-agent edits unless the user explicitly asks.
- Read `docs/DEPLOYMENT.md` before deployment/Auth/SW/schema changes.
- `supabase-schema.sql` is the canonical schema. Do not edit `supabase/schema.sql` as a second copy.
- The DB connection UI is development-only. Do not expose it as the normal production flow.
- Always bump `sw.js` `CACHE_NAME` when cached files change.
- Keep `verify_jwt = true` for OCR unless there is a documented temporary exception.
- Member safety comes from Supabase Auth + RLS; frontend approval screens are UX, not the only security layer.
