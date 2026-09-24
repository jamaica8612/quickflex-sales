# QuickFlex Worklog

## 2026-09-22 Beta 1.21 download links (PWA 1.0.88)

- Updated the current Android installation and in-app guide links to Beta 1.21 (`versionCode 143`) and its GitHub release asset.
- Bumped the manifest, shell cache, and page asset versions to 1.0.88 while retaining the current RouteNote dependency cache versions.
- Validation: 28 targeted release/startup tests and syntax checks for 54 JavaScript files passed. This change only updates the Android download links and PWA asset/cache versions; database and Edge Functions are unchanged.

## 2026-09-21 RouteNote interaction release (PWA 1.0.84)

- Prepared Claude PR #4 for production with matching manifest, shell cache and page asset versions.
- Protected an unsaved tip when a retained search query regains focus; declining the existing discard confirmation keeps the form. Hidden sheet back buttons now remain hidden despite icon-button display rules.
- Verification: the incoming PR passed all 377 Node tests on Windows. After release adjustments, 14 relevant route-map and release-contract tests passed; 47 JavaScript syntax checks and all 85 shell asset paths passed. Local 375px testing verified search selection and input retention across keyboard sheet resizing. The search-focus discard confirmation was observed; automated dismissal was blocked by the browser control tool.
- This release changes only the PWA interface and release assets. No database, Edge Function or Android deployment.

## 2026-09-21 구역노트 화면을 RouteNote 조작 방식으로 (PWA 1.0.83, route-notes-2)

- 사용자 판단: 이관해 온 구역노트 화면이 원본 RouteNote보다 답답하다. 색·글꼴·그림자는 플렉스노트 토큰을 그대로 두고, **조작 방식만** RouteNote에서 가져왔다.
- 지도 위 상단: 유리 느낌의 검색 막대(돋보기 · 지우기 버튼)와 검색 결과 목록을 새로 만들었다. 결과에는 `구역`·`메모` 뱃지와 유형 아이콘이 붙고, 구역을 고르면 그 구역을 열고 메모를 고르면 해당 메모로 이동한다. 메모 검색은 지금 열려 있는 구역의 메모까지만 닿는다. 서비스가 회사 전체 팁을 한 번에 내려주지 않으므로 DB·권한은 건드리지 않았다.
- 지도 위 제목 카드(회사명 · 구역노트)를 뺐다. 같은 이름이 하단 탭에 이미 있고, 지도를 가리고 있었다.
- `내 위치`와 `구역 만들기`는 글자 버튼에서 지도 오른쪽 아래 46px 아이콘 버튼으로 옮겼다. 시트 높이에 맞춰 같이 움직인다.
- 바텀시트: 손잡이를 끌어 `접힘(84px) · 절반 · 최대` 세 단계로 맞춘다. 짧게 누르면 접힘↔절반, 손잡이에 초점을 두고 ↑↓ 키로도 바꾼다. 머리글의 접기 버튼은 그대로 두었다. 넓은 화면에서는 기존처럼 오른쪽 고정 패널이며 손잡이는 숨긴다.
- 구역을 열면 시트 머리글이 구역 이름(모노)과 회사명을 들고, 본문에서 같은 이름을 다시 쓰지 않는다. 화면 낭독기를 위해 제목은 `.sr-only`로 남겼다.
- 목록 행·현장 메모·즐겨찾기·공유·수정을 아이콘 카드와 아이콘 버튼으로 바꿨다. 아이콘은 외부 라이브러리 없이 인라인 SVG로 넣었고 모두 `aria-label`과 `title`을 가진다. 메모 유형 아이콘은 다섯 종(주차·출입구·보관·주의·메모)으로 묶고 정확한 뜻은 글자 라벨이 말한다. 주의 계열만 `--red`를 쓴다.
- 검색 중에는 시트를 접어 결과 목록과 겹치지 않게 하고, 검색어를 지우면 다시 펼친다.
- 저장·권한·회사 범위·초안 보호(`isDirty`/`canClose`/`handleBack`) 로직은 그대로다. 데이터, 마이그레이션, Edge Function, 안드로이드는 변경하지 않았다.
- 자산 쿼리 `route-notes.js?v=3`·`route-notes.css?v=3`와 셸 캐시 이름을 올려 설치된 PWA가 새 화면을 받는다.
- 검증: Node 테스트 377개 중 376개 통과. 실패한 `tests/expense-privacy-sql.test.mjs` 1개는 이 변경 전부터 있던 것으로, 테스트가 작성자 PC의 Windows 경로를 가리켜 `main`에서도 같은 오류가 난다. 첫 번째 당사자 JS 전체 `node --check` 통과. Chromium 390px에서 목록·검색 결과·구역 상세·메모 카드·메모 폼·다크 모드와 1280px 넓은 화면을 실제 DOM으로 확인했고, 손잡이 끌기·짧게 누르기·↑↓ 키·접기 버튼이 세 단계를 오가는 것도 확인했다. 실제 네이버 지도 SDK와 실제 휴대폰 검증은 포함하지 않았다.

## 2026-09-19 Design consistency pass (1.0.76)

- Shared tokens with the Android app: `--warn` (warning no longer reuses the gold accent), `--red-border`, a radius scale (`--r-xs`…`--r-full`) and a type scale (`--fs-caption` 11px … `--fs-headline` 24px). Hardcoded font sizes and radii in styles.css and styles/*.css now use them; nothing renders below 11px except calendar route labels (`--fs-cell` 9px, kept small on purpose). styles/startup.css stays self-contained.
- One selected state for toggles (stats tabs, range tabs, theme, chart, calendar amount/count, expense chips): raised surface with a thin outline. Gold fill is reserved for action buttons.
- Compact calendar and expense controls keep their look but get 44px hit areas; the calendar amount/count toggle keeps its width so it no longer overlaps the next-month button.
- Empty states read as sentences, not hero numbers: measurement "등록된 구역 없음" and stats "비교할 이전 기록 부족".
- Fixed: `.sr-only` was never defined, so the expense month label showed on screen. Danger colours unified on `--red`. Removed dead admin-* CSS and the localhost-only dark palette preview.
- Verification: PWA Node tests 179 passed (pwa-exports needs node_modules). Browser check against a local mock at 360/375px in dark.

## 2026-09-19 Startup entrances rotate (1.0.75)

- The startup splash keeps one look (same background, truck colour, name and loading dots per theme) and now picks one of four entrances per launch: brake (existing), arrive (road draws, truck leans in and straightens), build (logo layers slide in, wheels pop) and sheen (truck lifts, one light sweep). The previous entrance is never repeated; blocked storage still picks one.
- The faint two-line trail runs with every entrance. All entrances finish inside the existing 760 ms minimum; reduced motion shows the finished splash with no movement.
- Truck SVG split into named layers (top, body, cab, two wheels) with a clipped sheen band; animation moved to an inner `.startup-vehicle` so the arrive road stays still. Bumped startup.css/js queries and the release to 1.0.75.
- Verification: 272 Node tests passed, including two new startup rotation tests. Browser check against a local mock confirmed each entrance mid-frame and end state in light and dark.

## 2026-09-16 Measurement route display and native theme (1.0.65)

- Deduplicate repeated route names in the measurement bridge while preserving saved sales rows, quantities and exact work date.
- Send the displayed light/dark choice to the trusted Android bridge on theme changes and measurement entry; normal browsers retain the existing visible theme when native or storage is unavailable.
- Integrated production settings-panel commit 327bb7e before preparing this release. Bumped shell cache, manifest and asset queries to 1.0.65 and prepared Beta 1.10 installation links.
- Verification: all 243 Node tests passed (zero failures/skips), including native theme, manual work-date and deduplicated route display with saved rows/totals preserved. Syntax checks passed for 39 browser JavaScript files and changed test sources; diff whitespace checks passed. Browser/device checks remain outside this preparation. No commit, push, publication or database changes performed during preparation.

## 2026-09-15 Measurement access follows PWA approval (1.0.62)

- All approved members may use measurement; no separate beta enrollment checkbox. The PWA validates the fresh matching profile's approved status and retains account-change/error guards. The administrator UI explains that approval also opens measurement.
- Migration `20260915114110_quickflex_measurement_for_all_approved` derives the existing `beta_enabled` compatibility field AFTER bootstrap/self-update guards. Installed Beta 1.09 APKs remain compatible without a new APK. The existing RPC shape remains valid for old PWA clients.
- Production verification at 20:41 KST: 30 approved profiles enabled, 6 pending profiles disabled, zero inconsistent flags; all three profile triggers and RLS enabled. No status, role, sales, or work result changes. Diagnostic consent, client logging and Oracle allowlists remain unchanged.
- Focused verification: 30 tests passed (5 PostgreSQL security/lifecycle cases, 6 client/access cases, 19 PWA/guide/font cases); JavaScript syntax and diff checks passed. Independent review found no blocker; database security advisors added no findings compared with the existing baseline.
- The CLI-generated migration was renamed to the actual production migration version after applying it through the Supabase connector. No physical phone install/restart.

## 2026-09-14 Branded startup and session restoration

- Added the approved F-truck braking motion, Korean name and tagline (10px gap), light blue logo, and dark charcoal gradient. Bundled two OFL font subsets totaling 12,892 bytes. No full video or additional runtime dependency.
- Hide/inert the app from the first HTML paint until the existing session/profile/record flow has selected login, password recovery, pending approval, or the ready home screen. Keep current account-epoch and RLS guards. Startup failures and a 15-second timeout expose retry without exposing unverified data.
- Isolated from concurrent Android/design changes on `codex/branded-startup`, based on production `1db4d61`, then rebased onto usage-guide release `2ba044f`. This updates the hosted screen inside the Android app; it does not change the APK version.
- Validation: 232 Node tests passed, including 10 new startup lifecycle tests; JavaScript syntax checks passed. Isolated browser fixtures verified approved dark/light transitions with zero login/body flash frames, signed-out login, module failure and retry. No real account data or financial writes used in tests. Physical-device startup verification is not included in this release check.

## 2026-09-14 Galaxy A34 installation guide

- Rebuilt install.html with 13 reviewed Galaxy A34 / Android 16 screenshots, enlargement dialogs, and one-column layout up to 760px.
- Captured a fresh Chrome installation of Beta 1.05 (127), Google Play Protect pause/authentication and restoration, Samsung's separate two-stage warning, restricted-settings permission, and accessibility activation.
- A34 final state: FlexNote data connection enabled; Play Protect scan enabled again; Chrome unknown-source installation permission disabled again. Other accessibility services were preserved. Login and delivery collection were outside this guide verification.
- Updated the service-worker cache and precached guide screenshots. APK, account gates, sales data, and other-session icon changes are outside this change.
- Validation: 14 targeted tests passed; app.js/sw.js and inline-script syntax checked; image loading, dark/light mobile layouts, enlargement, Escape/focus return, and diff checks passed.


Last updated: 2026-09-12 (overnight measurement entry / PWA 1.0.51)

## 2026-09-12 Overnight Measurement Entry (1.0.51)

- Automatic entry uses the current local clock, not a stale calendar selection: night work before noon belongs to today; noon onward belongs to tomorrow. Day work belongs to today.
- Recalculate automatic dates on measurement entry/refresh while preserving an explicitly edited measurement date and passing that exact date to Android. Android still gives same-owner active work priority.
- Register the date helper in the offline shell and bump the visible version, asset queries and cache to 1.0.51. No database, authentication or sales changes.
- Validation: 162 Node tests passed, including midnight/noon/month/year boundaries and the native manual-date bridge; JavaScript syntax and diff checks passed. Actual phone UI testing is still pending.

## 2026-09-09 Manual Night Sales And Measurement Entry (1.0.50)

- Preserve existing manual sales when separate automatic work arrives on the same date,
  including ordinary edit drafts and administrator totals. Full-day overrides still replace
  the whole date. Keep automatic-only basis counts so late work preserves the manual delta.
- Night measurement entry defaults to the selected date plus one day, day entry to the
  selected date, as explicitly requested. Keep manual date edits and resumed active work.
- 161 PWA/SQL tests passed, including manual120+auto40=160 and corrected165+late20=185;
  JavaScript syntax and diff checks passed. No production data rewrite or schema migration.
- Paired Android test92 includes delivery-success counting, separate return pickup quantities,
  missing-rate entry without automatic retry, and consistent full-day sales corrections.

## 2026-09-06 Restore PWA Typography (1.0.49)

- At the user's request, remove the Outfit experiment and restore the pre-1.0.48 Pretendard UI / Wanted Sans amount fonts, including the original chart and print font stacks. No layout, data or counting changes.
- Remove only the Outfit font, license and source files introduced by `803c455`; that commit preserves them if needed. Retain font regression tests for the restored families and offline shell.
- Bump the visible version, asset queries and service-worker cache to `1.0.49` so existing installations receive the rollback.

## 2026-09-06 PWA English And Digit Typography (1.0.48)

- Apply Outfit only to ASCII English letters and digits in the PWA, introduction, chart labels and printable inspection text. Preserve the existing Pretendard/Wanted Sans Korean and punctuation fallbacks, weights, sizes, layout and data logic. Leave saved signature generation unchanged.
- Bundle the unmodified Google Fonts Latin variable WOFF2 with its SIL OFL 1.1 license and source/hash record. Cache the font locally with the shell for offline use; no runtime Google Fonts request is required.
- Bump the PWA version and shell cache to `1.0.48`. No Android source/APK or database changes. The native measurement screen stays unchanged; the Android sales WebView uses the same published PWA.
- Validation: all 154 PWA/SQL tests, including five new font/character-range/offline-cache checks, JavaScript syntax checks and `git diff --check` passed. The font binary header, declared file length and official download hash are verified.

## 2026-09-06 Team Sales And Shared Pace (test73 / 1.0.47)

- No headcount or team-leader selection. New Android work submits immutable phone-local evidence; sales merge by account and the chosen work date.
- Deduplicate known invoice hashes and collected fresh-bag serials across work submissions. Unknown invoices stay separate; neither routes nor shared Coupang counters prove cross-phone identity.
- Keep per-work manual adjustments and date-level sales corrections as differences from the observed quantities. A60 corrected to65 followed by B40 remains105; new colleague routes keep their dated rates.
- Returns and cancellations remain inclusive delivery revenue with deduplicated annotations. Preserve all legacy receipts; evidence-free historical or already-running work is not retroactively deduplicated.
- Make automatic-date fresh-bag edits retry-safe and preserve late colleague contributions, including the open form draft. Existing manual-day saves reject a newly automatic date and retain the established refresh flow.
- Android personal stops/items/rates use local completion evidence, not shared counter increases. Keep the existing speed-centered gauge: its large household/hour number and `예상 완료` use shared progress, with `남은 가구` alongside the forecast. Show the personal count/rate only as small text, e.g. `52가구 · 39 가구/시간`; never label it `내 타수` or `타`. Never add two phones' common counters together. Existing measurement pause/resume behavior is retained with separately persisted shared progress.
- Validation: all 149 PWA/SQL tests, JavaScript syntax checks, all 466 Android unit tests, `assembleDebug`, `assembleDebugAndroidTest`, and diff checks. PostgreSQL tests run locally with PGlite. UI test sources compile, but no device is attached: no physical two-phone, instrumented UI, or true simultaneous production transaction test has been performed.
- Supabase/Postgres guidance informed owner-scoped permissions, immutable retry verification and account/date transaction locks. Applied only `20260906022033_team_sales_ledger.sql` (CLI-created file renamed to the server-assigned migration version). Existing receipt, route, override and daily-record checksums are unchanged, and legacy finalizer/lease function hashes are unchanged. All 10 new views use security-invoker mode; anonymous RPC execution and direct client ledger writes are denied. The advisor reports the three intentionally authenticated write endpoints; each checks approval and derives its owner from `auth.uid()`.
- Paired release: Android `2.0-test73` / versionCode `90`, PWA version and cache `1.0.47`. The APK signature matches test72 for in-place updates. Database migration is applied before publishing clients. Do not reapply the full canonical schema. All participating phones must use the new app and start new work before relying on cross-phone deduplication; old clients do not understand team projections.

## 2026-09-05 Work-date And Daily Fresh-bag Mode Hardening

- Default the measurement work date to the previous date from 00:00 through 06:59 while keeping the date input freely editable.
- Snapshot `freshbag_mode` on each day record so later profile-setting changes do not recalculate historical sales.
- Preserve and reopen same-owner active Android work from local state even when remote work-date synchronization fails.
- Show confirmed route quantities consistently against the completed-item total while keeping pending confirmation visible.
- Removed the automatic discard that previously closed an unfinished work merely because another date was selected.
- PWA version/cache `1.0.46`; paired Android release `2.0-test71`.
- Validation: all 130 Node tests, JavaScript syntax checks, Android `testDebugUnitTest`, `assembleDebug`, and diff checks passed.

## 2026-09-05 Detailed-route Cancellation Annotations

- Display inclusive quantities with cancellation annotations, e.g. `310D01 10건, 취소 1건`, in selected-date sales, user route statistics, and administrator route statistics.
- Persist `p_routes[*].cancellation_detail_counts` at the immutable receipt's `canonical_payload.cancellation_detail_counts`; repeated uploads must preserve the same metadata.
- Keep delivery totals and revenue unchanged. Missing legacy attribution stays unknown; metadata-only detail routes do not fabricate delivery quantities.
- Apply only migration `20260905043306_record_cancellation_detail_counts.sql`. It was created using the CLI and renamed to the server-assigned version after deployment. Do not reapply the full canonical schema: its historical base finalizer predates the deployed removal of lease restrictions.
- Database migration deployed and verified: base and auxiliary finalizers unchanged, authenticated owner-scoped access retained, anonymous execution denied, receipt RLS enabled.
- PWA version/cache `1.0.45`; paired Android release `2.0-test70` carries attribution through finish and the durable Room outbox.
- Validation: all 126 Node tests, syntax checks and diff checks passed. The 14 PostgreSQL behavior tests also passed using a read-only copy of the production base finalizer.

## 2026-09-03 Fresh-bag Sales And Return Count

- Added immutable Android work receipt fields for unique fresh-bag counts and return counts.
- Applied automatic fresh-bag counts to the daily fresh-bag sales input without lowering a larger manually entered value.
- Kept return items inside ordinary delivery counts and route revenue while displaying `반품 N개` separately.
- Added the return count to the selected-date detail and daily statistics only when it is greater than zero.
- Bumped the PWA shell and visible version to `v1.0.43`.
- Verified JavaScript syntax, all 100 Node tests, and database RLS/function privileges.

## 2026-04-30 Number Polish And Light Button Cleanup (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `styles.css`
  - Removed the temporary `scaleX(.94)` number squeeze and let `Wanted Sans Variable` render numeric UI naturally.
  - Cleaned up light-mode secondary button colors on record/settings views, softened total cards, reduced daily stat chip/card density, and removed the hard divider under the home header summary.
- `src/main.js`
  - Fixed duplicated `건건` text in stats daily detail rows.
  - Added green synced-state styling hook for the settings header badge.
  - Added spacing-friendly admin summary text formatting between profile names and driver type labels.
- `index.html`
  - Returned the goal save button to the same row as the goal amount input and bumped asset query versions to `v=46`.
- `sw.js`
  - Bumped shell cache to `quickflex-shell-v72` so updated font and style assets refresh cleanly.

## 2026-04-30 Stats And Settings Light Polish (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `src/main.js`
  - Changed home and stats daily average values to compact `만원` formatting.
- `index.html`
  - Moved the goal save button into its own action row below the goal input.
  - Bumped `styles.css` and `src/main.js` to `v=41`.
- `styles.css`
  - Rounded the home summary card cleanly on all sides and softened the settings/stats light-mode controls to match the reference.
  - Reduced visual weight across stats range tabs, stats list rows, settings section controls, and the home off button.
  - Changed stats and settings navigation buttons to white or light gray where requested.
  - Restyled schedule upload/OCR buttons to light gray and separated the goal save button sizing from the inline input row.
- `sw.js`
  - Bumped cache to `quickflex-shell-v70`.

---

## 2026-04-30 Wanted Sans Numeric Pass (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `assets/fonts/WantedSansVariable.woff2`
  - Added the local Wanted Sans variable webfont from the official `wanteddev/wanted-sans` project.
- `styles.css`
  - Added local `@font-face` for `Wanted Sans Variable`.
  - Added `--font-numeric` and applied it to the largest revenue figures, progress percentage, summary stats, calendar day numbers, calendar compact values, and the home dock amount.
  - Kept the main UI text on Pretendard and moved numeric tightening to the number-only font stack.
- `index.html`
  - Bumped `styles.css` to `v=39` and `src/main.js` to `v=39`.
- `sw.js`
  - Added `./assets/fonts/WantedSansVariable.woff2` to `SHELL_FILES` and bumped cache to `quickflex-shell-v68`.

### Notes

- Source reference: `wanteddev/wanted-sans` webfont docs and latest release `v1.0.3`.

---

## 2026-04-30 Letter-Spacing Tune-Up And Calendar Bold Removal (Claude)

Workspace: `C:\work\quickflex-sales`

### User Request

핸드오프 mock 대비 현재 앱이 "엉성"해 보이는 이유로 자간과 캘린더 셀의 굵기 두 가지를 지목.

### Changed Files

- `styles.css`
  - `.summary-row strong` / `.summary-card.compact strong` — 글자를 가로로 찌그러뜨리던 `transform: scaleX(.94)` 제거하고 `letter-spacing: -0.6px` 로 자연스럽게 좁힘. 정산 예상액 큰 숫자의 핸드오프 대비 위화감 핵심 원인.
  - `h1` — `letter-spacing: -0.3px`.
  - `.calendar-toolbar strong` — `letter-spacing: -0.3px`.
  - `.total-card strong` — `letter-spacing: -0.5px`.
  - `.day-value` — `font-weight: 850 → 600`, `letter-spacing: -0.2px`. 캘린더 셀 매출과 휴무 텍스트(`.day-cell.off .day-value` 가 동일 selector 상속) 가 동시에 라이트 톤으로 정돈됨.
  - `.day-number` — `font-weight: 800 → 700`.
- `index.html`
  - `styles.css?v=37` → `v=38`.
- `sw.js`
  - `CACHE_NAME` `quickflex-shell-v66` → `v67`.

### Checks Run

Browser QA (`http://localhost:5500`):
- 정산 예상액 글자 찌그러짐 사라짐 확인.
- 캘린더 매출/휴무 텍스트 라이트 톤 확인.
- 콘솔 에러 0.

---

## 2026-04-30 Progress And Numeric Spacing Follow-Up (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `src/main.js`
  - Restored calendar compact revenue to decimal `만` display, such as `37.1만`.
  - Changed home and stats progress percentages to whole-number display.
- `styles.css`
  - Tightened the visual width of the largest revenue numbers and home dock amount using horizontal numeric scaling while keeping `letter-spacing: 0`.
- `index.html`
  - Bumped `styles.css` and `src/main.js` to `v=37`.
- `sw.js`
  - Bumped cache to `quickflex-shell-v66`.

---

## 2026-04-30 Home Calendar Trim And Metric Polish (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `src/main.js`
  - Trimmed the home calendar to the final visible week of the settlement period instead of always rendering six weeks.
  - Changed compact calendar revenue from decimal `만` units to rounded integer `만` units.
- `styles.css`
  - Moved the meter helper label visually below the progress graph, removed the selected-date circle treatment, and tightened large numeric display with tabular numerals, size, and line-height while keeping letter spacing at `0`.
  - Removed the fixed calendar grid minimum height so the extra final row no longer leaves blank space.
- `index.html`
  - Bumped `styles.css` and `src/main.js` to `v=36`.
- `sw.js`
  - Bumped cache to `quickflex-shell-v65`.

### Notes

- Negative letter spacing was avoided; numeric density is handled through font sizing, line-height, and tabular numerals.

---

## 2026-04-30 Home Calendar Visual Polish (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `src/main.js`
  - Simplified home period text to `정산기간 4/26 - 5/25`.
  - Changed calendar revenue cells to compact `13.5만` style and home dock dates to `MM/DD`.
  - Removed the top holiday short badge from calendar cell markup while keeping the holiday name below when appropriate.
- `styles.css`
  - Lightened the light-mode home header background, enlarged the driver name, tightened the period spacing, reduced calendar value/off-day sizes, made calendar nav buttons white, and made the home dock off button smaller with a white background.
- `index.html`
  - Bumped `styles.css` and `src/main.js` to `v=35`.
- `sw.js`
  - Bumped cache to `quickflex-shell-v64`.

### Notes

- Letter spacing remains non-negative per frontend layout rules; visual density is handled through font sizing and abbreviated labels.

---

## 2026-04-30 Unified Light Button Color (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `styles.css`
  - Unified light-mode action button backgrounds to `#1A73E8` with white text.
  - Changed previous light-mode save/delete/secondary action overrides away from green/red/gray and back to the single main blue.
  - Kept inactive segmented controls visually neutral so selected/unselected states remain readable.
- `index.html`
  - Bumped `styles.css` to `v=34`.
- `sw.js`
  - Bumped cache to `quickflex-shell-v63`.

### Notes

- Dark-mode navy/yellow styling remains unchanged.

---

## 2026-04-30 Light Button Palette Polish (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `styles.css`
  - Set the light-mode main action color to `#1A73E8`.
  - Set light-mode save/complete actions to `#28A745`, delete/danger actions to `#DC3545`, and secondary actions to `#F1F3F5` with `#212529` text.
  - Kept the dark-mode navy/yellow styling intact.
- `index.html`
  - Bumped `styles.css` to `v=33`.
- `sw.js`
  - Bumped cache to `quickflex-shell-v62`.

### Notes

- This is a light-mode visual-only button palette update.

---

## 2026-04-30 Dark Gold Visual Polish (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `styles.css`
  - Shifted the app toward the provided clean mockup: dark navy surfaces, yellow primary accent, compact header/summary/calendar typography, and zeroed display letter spacing.
  - Reduced several label sizes and heavy weights so the dashboard reads closer to the reference.
- `src/main.js`
  - Added a one-time dark-gold default migration so existing local browsers see the redesigned dark theme once, while future manual theme choices remain saved.
- `index.html`
  - Bumped `styles.css` to `v=32` and `src/main.js` to `v=34`.
- `sw.js`
  - Bumped cache to `quickflex-shell-v61`.

### Notes

- The first load after this redesign defaults to dark-gold once; users can switch themes afterward and that choice is respected.

---

## 2026-04-30 Pretendard Self-Host And Wanted DS Polish (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `assets/fonts/PretendardVariable.woff2`
  - Added the local web variable font from `Pretendard-1.3.9.zip`.
- `styles.css`
  - Added local `@font-face` for Pretendard with `font-display: swap`.
  - Aligned light/dark color tokens, primary blue, control heights, card radius, input treatment, and key dashboard surfaces to `퀵플렉스 Redesign.html`.
- `index.html`
  - Removed the jsDelivr Pretendard stylesheet and bumped `styles.css` to `v=31`.
- `sw.js`
  - Added the local font asset to `SHELL_FILES` and bumped cache to `quickflex-shell-v59`.

### Notes

- Static UI/PWA asset changes only. No Supabase, OCR, Auth, schema, or data-flow changes.

---

## 2026-04-30 Wanted Design Token Pass (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `styles.css`
  - Shifted the app foundation toward the public Wanted Design Library direction: neutral gray surfaces, blue primary action color, tighter border hierarchy, and light/dark theme token pairing.
  - Kept existing CSS variable names to avoid broad component rewrites.
  - Added focused input rings and fixed toast text contrast in light mode.
- `index.html`
  - Bumped `styles.css` asset query to `v=30`.
- `sw.js`
  - Bumped cache to `quickflex-shell-v58`.

### Notes

- The shared Figma page needs authenticated/API access for exact variable export, so this pass maps the public Wanted foundation direction into the existing QuickFlex CSS tokens.

---

## 2026-04-30 Dark Tone And Typography Polish (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `styles.css`
  - Raised the dark-mode amber from `#D6A545` to `#E0B24D` so it feels warmer without returning to neon yellow.
  - Reduced the `오늘` pill to 36px height and 13px text.
  - Softened several heavy UI font weights around settings details, OCR draft chips, work/off buttons, output pills, and CTAs.
  - Changed route-rate delete buttons to the same quiet, backgroundless `x` treatment used in schedule draft chips.
  - Reduced mobile record date title from 24px to 20px to avoid clipping.
- `index.html`
  - Bumped `styles.css` asset query to `v=29`.
- `sw.js`
  - Bumped cache to `quickflex-shell-v57`.

### Checks Run

```powershell
node --check app.js
node --check sw.js
node --check src/main.js
git diff --check
```

Browser QA:
- Local `http://localhost:5500/index.html`.
- Verified dark amber tone, smaller Today button, quieter route delete x, refined settings/draft text weights, and console errors 0.

---

## 2026-04-30 Calendar Holiday And Dark Tone Polish (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `src/main.js`
  - Added Korean holiday lookup for fixed-date holidays and 2026 lunar/substitute/election holidays.
  - Calendar cells now show a small holiday badge and use the holiday name when the cell has no route/value text.
- `styles.css`
  - Softened dark-mode yellow from bright `#FFC226` to muted amber `#D6A545`.
  - Dark-mode primary buttons now use dark text on amber for a calmer look.
  - Route delete buttons changed from red to a quieter gray chip and reduced from 20px to 18px.
  - Added calendar holiday badge styling.
- `index.html`
  - Bumped `styles.css` and `src/main.js` asset query versions.
- `sw.js`
  - Bumped cache to `quickflex-shell-v56`.

### Checks Run

```powershell
node --check app.js
node --check sw.js
node --check src/main.js
git diff --check
```

Browser QA:
- Local `http://localhost:5500/index.html`.
- Verified May 2026 holiday labels, muted dark amber theme, quiet route delete button, and console errors 0.

---

## 2026-04-30 Gray+Yellow Redesign Finish (Codex)

Workspace: `C:\work\quickflex-sales`

### Changed Files

- `index.html`
  - Added the `이번 정산기간` badge beside the home summary label to better match the handoff alignment.
- `styles.css`
  - Changed Claude's blue primary tokens to a softer charcoal/gray light theme.
  - Kept dark mode as a yellow-accent theme using `--gold: #FFC226`.
  - Added `--primary-border` so pills, selected states, and totals stay visually consistent across light/dark.
  - Fixed hidden chart tooltip styling with `.stats-chart-tooltip[hidden]`.
- `src/main.js`
  - Added a subtle canvas fill gradient under the stats chart line while preserving the existing stats data flow.

### Checks Run

```powershell
node --check app.js
node --check sw.js
node --check src/main.js
git diff --check
```

Browser QA:
- Local server at `http://localhost:5500/index.html`.
- Verified light gray theme, dark yellow theme toggle, 26→25 settlement header, Today button month reset, stats quick tabs/chart, calendar route surface, admin view shell, and console errors 0.

---

## 2026-04-30 White+Blue Redesign Pass (Claude)

Workspace: `C:\work\quickflex-sales`
Source design: `C:\Users\jamai\Downloads\퀵플-handoff.zip` (`퀵플렉스 Redesign.html`)

### Goal

Wanted DS 풍 white + blue 라이트 테마로 앱 전체(홈/기록/통계/설정) 톤 전환 + 라이트/다크 토글.
디자인 핸드오프 README 지시("Match the visual output; don't copy the prototype's internal structure")에 따라 React mock 마크업/JS는 무시하고 기존 셀렉터에 새 색·폰트·아이콘만 매핑.

### Changed Files

- `index.html`
  - Pretendard Variable CDN `<link>` 추가.
  - 하단 네비 4탭(`달력/통계/관리/설정`)에 22×22 SVG 아이콘 추가, 텍스트 라벨은 아래에.
  - 모든 round-btn(prev/next/back, 8개)의 `‹ ›`를 16×16 chevron SVG로 교체.
  - `#openSettings` 톱니 글자 → gear SVG.
  - `#addRoute` 구역 추가 버튼 앞에 plus SVG.
  - 설정에 신규 섹션 `<h2>화면</h2>` + `.theme-toggle`(라이트/다크 버튼 + sun/moon SVG) 추가.
  - 캐시 쿼리 `styles.css?v=26→27`, `src/main.js?v=30→31`.
- `styles.css`
  - `:root` 토큰을 light+blue로 교체 (변수명 `--gold`/`--red`/`--panel`/... 보존, 값만 교체).
  - `html[data-theme="dark"], body[data-theme="dark"]` 오버라이드 블록 신설.
  - body font-family 에 `Pretendard Variable` 우선.
  - `.app/.home-header/.summary-card/.summary-meter/.icon-btn/.round-btn/.today-btn/.mode-btn.active/.day-cell/.day-value/.day-routes/.day-dock/.ghost-pill/.primary-pill/.full-btn/.entry-row output/.calc-row output/.total-card/.readonly-value/.mode-option(checked)/.rate-editor button/.rate-delete/.text-example/.daily-metrics span/.bottom-nav/.nav-tab/.stats-summary-card/.stats-tab.active/.stats-range-tabs > button.active/.stats-chart-card/.stats-chart-tooltip/.revenue-list .rev-row/.revenue-list .rev-sum/.goal-save-btn/.overlay/.auth-card` 등 색·그림자·border 재배색.
  - 신규 `.theme-toggle` 스타일.
  - sub-header `backdrop-filter` 제거 (라이트 톤에서 어색).
- `src/main.js`
  - 상단에 `THEME_KEY/applyTheme()` 추가 (라이트=기본, dark/light 토글, localStorage 저장, 호출 시 `renderStats()` 자동 재호출로 차트도 즉시 재도색).
  - bindEvents 영역에 `[data-theme-set]` 클릭 바인딩 추가.
  - `renderStatsChart`의 grid/선/점 색을 `getComputedStyle`로 `--gold/--line/--muted/--soft` CSS 변수에서 읽도록 변경.
- `sw.js`
  - `CACHE_NAME` `quickflex-shell-v54` → `quickflex-shell-v55`.

### Preserved (regression-safe)

- 정산 사이클 26→25 (`periodBounds`) — redesign mock의 `3/21~4/20`은 무시.
- 목표 DB-first (`getGoal()` → `state.profile.goal_amount`) — 변경 없음.
- 라우트 컴팩션 `319ABC`, 단가 미정 0원, 휴무일 라우트 숨김.
- 비밀번호 찾기, 탈퇴 요청, OCR 메시지, OCR 보정 묶음.
- 관리자(view-admin) 5탭, Supabase 연결 시트, auth/pending/setup overlay.
- 통계 강화 기능 전부 유지(빠른 선택 5종 / Canvas 그래프 / 매출 라우트 체크박스 / 일간 카드 펼침) — 색만 blue로 변경.
- 고정/백업기사 분기, 사용자 본인 라우트만 삭제, 설정 순서.

### Checks To Run

```powershell
node --check app.js
node --check sw.js
node --check src/main.js
git diff --check
```

브라우저:
- 통계 화면 진입 → 흰 카드 + blue 강조, 빠른 선택 active blue pill, 그래프 선 blue.
- 설정 → 화면 → 다크 클릭 → 즉시 dark 전환, 새로고침 후에도 유지(`localStorage.quickflex-theme`).
- 26→25 사이클 헤더(`2026.04.26 ~ 2026.05.25`).
- 캘린더 선택/오늘/휴무 셀 색.
- 기록 화면 합계 카드 blue, 저장 버튼 blue 그림자.
- 콘솔 에러 0건. 네트워크 탭 `styles.css?v=27`, `main.js?v=31`, Pretendard CDN 200, sw.js v55.

### Hand-off Note

토큰 한도 등으로 Claude가 끝내지 못하면 Codex가 본 파일과 `C:\Users\jamai\.claude\plans\github-jamaica8612-quickflex-sales-fizzy-rain.md`를 참조해 잔여 작업을 마무리 가능. 디자인 토큰/SVG path는 위 plans 문서에 그대로 적혀 있음.

---

## 2026-04-30 Claude Design Handoff (Codex)

Workspace: `C:\work\quickflex-sales`
Production URL: `https://jamaica8612.github.io/quickflex-sales/`

### User Request

The user plans to ask Claude to redesign the whole app UI so it feels consistent with the project. Claude should continue from this local folder and keep the current feature behavior intact while changing the visual design.

### Current Frontend State

- Entry point: `index.html` loads `./src/main.js?v=30`.
- Service worker cache: `sw.js` uses `quickflex-shell-v54`.
- Main runtime still lives mostly in `src/main.js`; `app.js` is only a compatibility bootstrap.
- Visual system is mainly in `styles.css`. For a design pass, expect most edits to be `styles.css` plus small markup adjustments in `index.html` or targeted render functions in `src/main.js`.
- Production Supabase public config is in `src/config.js`; do not move secrets into frontend files.

### Recent Feature Updates To Preserve

- Goal amount is now database-first:
  - `quickflex_profiles.goal_amount integer not null default 6000000`.
  - `getGoal()` reads from `state.profile.goal_amount`, not browser localStorage.
  - Saving the monthly goal updates `quickflex_profiles.goal_amount`.
  - Legacy `quickflex_route_rates.route = '__GOAL__'` values are migrated once into the profile goal if needed.
- Login/profile creation now uses RPC:
  - `public.quickflex_ensure_profile(profile_email, profile_display_name, profile_driver_type)`.
  - The SQL body must include the full `$function$ ... $function$` block and the grant.
  - This was added to avoid RLS errors when a new login needs its first `quickflex_profiles` row.
- Home goal meter layout was adjusted:
  - The goal-vs-progress text belongs above the meter text area, while the percent value stays on the right side of the bar.
- Calendar Today button behavior:
  - Pressing `오늘` should move the calendar back to today's settlement month and select today.
- Route/rate management:
  - Users can delete only their own personal route-rate rows.
  - Inherited/admin default routes should not show a delete button.
  - Deleting a personal route does not change older daily records because historical revenue uses `unit_snapshot`.
  - Unknown custom backup routes ask for confirmation using the "새 업무 구역" wording before saving as a personal route.
  - Fixed drivers must still be limited to admin-assigned `fixed_routes`.
- Settings order:
  - `스케줄 가져오기` is intentionally placed directly under the name/profile save area.
- Stats design was recently made more consistent with the project, but the user still wants Claude to do a broader UI redesign.

### Database / Supabase Notes

- Canonical schema file: `supabase-schema.sql`.
- `supabase/schema.sql` is intentionally only a pointer.
- If applying DB SQL manually, copy the latest `supabase-schema.sql` from top to bottom. Do not stop at:
  `set search_path = public`
  because `quickflex_ensure_profile` needs the following `$function$` body.
- First profile bootstrap still makes the first inserted profile an approved admin.
- RLS is expected to stay enabled. Do not add browser-only persistence for production data.

### Design Constraints For Claude

- Keep the app mobile-first; the main tested viewport has been around 708 x 1104.
- Do not turn the app into a landing page. The first screen after login should remain the usable app.
- Preserve bottom navigation views: `달력`, `통계`, `관리`, `설정` where admin visibility still depends on role.
- Avoid broad rewrites of `src/main.js`; patch targeted render functions only when markup structure must change.
- If cached assets change, bump both:
  - `sw.js` `CACHE_NAME`
  - `index.html` asset query for `src/main.js` if JS changed
- After frontend changes, run:

```powershell
node --check app.js
node --check sw.js
node --check src/main.js
git diff --check
```

### Suggested Design Starting Points

- `styles.css`: primary visual redesign surface.
- `index.html`: app shell, bottom nav, settings sections, modal/static markup.
- `src/main.js` targeted areas:
  - summary card and meter rendering
  - calendar cells and selected-day dock
  - settings route-rate chips and delete controls
  - stats screen period controls and chart sections
  - admin cards and route bundle cards

### Last Known Checks

- Before this handoff, the working tree was clean.
- Latest pushed commit before this note: `87cd0a3 Fix ensure profile SQL function body`.
- Recent validation passed: `node --check app.js`, `node --check sw.js`, `node --check src/main.js`, `git diff --check`.

## 2026-04-27 OCR UX Account Off-Day Pass (Codex)

Workspace: `C:\Users\jamai\Documents\Codex\2026-04-25\new-chat`

### Changed Files

- `index.html`
  - Added a `탈퇴 요청` button under data reset.
- `src/main.js`
  - Shortened the record screen date title to `26년 MM월 DD일` so it stays on one line on mobile.
  - Off-day calendar cells now hide route labels, and toggling a day to off clears route rows.
  - Fixed-driver off-to-work toggles now restore that driver's assigned fixed routes instead of showing an empty `+ 추가` state.
  - OCR high-demand/503 failures now show a softer Korean message that explains the server is temporarily busy.
  - `탈퇴 요청` clears the user's route/rate/day data, marks the profile display name with `[탈퇴요청]`, and logs out. Supabase Auth user deletion still needs admin/server-side handling.
- `styles.css`
  - Made off-day labels larger and kept the record title one-line.
  - Added subtle danger styling for account deletion.
- `sw.js`
  - `CACHE_NAME` bumped to `quickflex-shell-v17`.

### Notes

- OCR recognition issues are mostly caused by small table text, screenshot compression, and temporary Gemini 503/high-demand responses. Frontend wording is improved here; a stronger OCR improvement pass should add image preprocessing and/or a more table-oriented backend parser.

---

## 2026-04-27 Auth Calendar Intro Polish Pass (Codex)

Workspace: `C:\Users\jamai\Documents\Codex\2026-04-25\new-chat`

### Changed Files

- `index.html`
  - Added a `비밀번호 찾기` action to the login modal.
- `src/main.js`
  - Added Supabase password reset email flow.
  - Added password recovery mode for reset-link redirects.
  - When a single-route daily unit price is changed, the app now asks whether to update the default route rate or keep the change for that date only.
- `styles.css`
  - Calendar revenue text is smaller/tighter and no longer ellipsizes.
  - Added styling for the login reset link.
- `intro.html`
  - Added a blurred schedule-image style mock so users can intuitively understand schedule upload without exposing readable table text.
  - Updated Android home-screen guidance to steer users to the HTTPS online URL in Chrome and suggest browser bookmark fallback if install is blocked.
- `sw.js`
  - `CACHE_NAME` bumped to `quickflex-shell-v16`.

---

## 2026-04-27 Unknown Route Rate Display Pass (Codex)

Workspace: `C:\Users\jamai\Documents\Codex\2026-04-25\new-chat`

### Changed Files

- `src/main.js`
  - Unknown route rates now display as `0원` instead of `단가 미정`.
  - Data model still stores unknown rates as `current_unit = 0`.

---

## 2026-04-27 Fixed Driver Settings And Stats Polish Pass (Codex)

Workspace: `C:\Users\jamai\Documents\Codex\2026-04-25\new-chat`

### Changed Files

- `index.html`
  - Fixed-driver route list in Settings is now read-only text plus a hidden field for compatibility.
  - Removed the explanatory fixed-route hint from the driver-facing Settings view.
  - Schedule image/text import section is no longer backup-only, so fixed drivers can upload work schedule images too.
- `src/main.js`
  - Driver self-save no longer updates `fixed_routes`; that remains an admin-managed field.
  - Schedule import for fixed drivers uses the admin-assigned fixed routes for work days and still supports off days from OCR/text.
  - Daily stats cards now render route preview, revenue, and metric chips instead of a flat text line.
- `styles.css`
  - Added read-only value styling and polished daily stat cards.
- `sw.js`
  - `CACHE_NAME` bumped to `quickflex-shell-v15`.

---

## 2026-04-27 Route Master Display Pass (Codex)

Workspace: `C:\Users\jamai\Documents\Codex\2026-04-25\new-chat`

### Changed Files

- `styles.css`
  - Calendar route labels are now single-line with ellipsis instead of wrapping inside a day cell.
- `src/main.js`
  - Added a default route master so backup drivers can see routes even before a unit price is known.
  - Routes with unknown unit price are kept as `0` in DB and shown as `단가 미정` in settings.
  - Included the missing route set called out by the user, including `302A`, `302D`, `428C`, `428D`, `304A`, `304B`, `304D`, `311A`, `311B`, `313A`, `314C`, `314D`, `310A`, `324A`, `324B`, `407A`, `407C`, and `410A`-`410D`.
- `sw.js`
  - `CACHE_NAME` bumped to `quickflex-shell-v14`.

### Notes

- Known route with no confirmed settlement unit is intentionally stored with `current_unit = 0`. The daily entry unit input stays blank until a real unit is set.

---

## 2026-04-27 Settlement Rate Sync Pass (Codex)

Workspace: `C:\Users\jamai\Documents\Codex\2026-04-25\new-chat`

### Changed Files

- `src/main.js`
  - Settlement rate import now separates new routes, changed routes, and unchanged routes.
  - New routes from a settlement sheet are automatically prepared as default route rates.
  - If an existing route has a different calculated unit price, the app asks whether to update to the settlement rate or keep the existing rate.
  - Admin settlement import writes selected default rates for approved backup drivers so backup users can see all route options.
  - When an admin approves/saves a backup driver, the current default route rates are also seeded to that driver.
- `supabase-schema.sql`
  - Route-rate RLS insert/update/delete policies now allow approved admins to manage route rates for other users.
- `sw.js`
  - `CACHE_NAME` bumped to `quickflex-shell-v13`.

### Deployment Note

- The schema policy changes must be applied to Supabase before admin can write route rates for other backup drivers. Without this SQL update, the frontend may show an RLS permission error when seeding rates for other users.

---

## 2026-04-27 Calendar Route Display Pass (Codex)

Workspace: `C:\Users\jamai\Documents\Codex\2026-04-25\new-chat`

### Changed Files

- `src/main.js`
  - Added compact route display for calendar cells.
  - Same 3-digit route prefixes now collapse into one label:
    - `319A + 319B + 319C` -> `319ABC`
    - `316A + 316B + 313A` -> `316AB 313A`
  - Calendar cells now compact all route rows for the day together, not one row at a time.
  - Day route items now persist when a route exists even if delivery count/unit price is still `0`, so schedule-only rows do not disappear just because the default rate is missing.
- `sw.js`
  - `CACHE_NAME` bumped to `quickflex-shell-v12`.

### Notes

- This fixes future schedule imports/saves. If an old day already lost its routes in the database because the previous save skipped zero-rate rows, the app cannot infer those vanished rows; re-import the schedule or add the routes once.

---

## 2026-04-27 Intro Copy Privacy Pass (Codex)

작업 폴더: `C:\Users\jamai\Documents\Codex\2026-04-25\new-chat`

### Changed Files

- `intro.html`
  - Changed hero copy from `쿠팡 퀵플렉스` to `형제물류 1캠프`.
  - Removed the top trust badges.
  - Removed public-facing admin feature section because admin is owner-only.
  - Replaced `unit snapshot` with Korean-only wording.
  - Replaced real-looking route/rate examples with generic `A구역/B구역/기본단가` examples.
  - Removed footer text.
- `sw.js`
  - `CACHE_NAME` bumped to `quickflex-shell-v11`.

### Checks To Run

- Confirm online `intro.html` no longer shows admin features or real route/rate examples.

---

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

## 2026-08-09 Daily Inspection

- Added an `오늘 일상점검` entry card above the home calendar and a dedicated 11-item inspection screen.
- Added app-backed normal/defect/no-operation records, defect/action notes, signer metadata, and monthly print/PDF output.
- Added profile fields for business name and vehicle number used by the printed form.
- Added `quickflex_daily_inspections` with QuickFlex-prefixed naming, strict JSON result validation, RLS, and least-privilege grants.
- Anonymous access is revoked. Approved drivers can read/write only their own records; approved admins can read all records but cannot write another user's records.
- Migrated existing paper records for all 36 approved QuickFlex users from 2026-06-30 through 2026-08-08 as 1,440 locked `legacy_paper` all-normal records. Pending and blocked profiles were excluded; 2026-08-09 onward remains user-entered per account.
- Tightened QuickFlex helper-function execution so anonymous users cannot call QuickFlex security-definer helpers.
- Bumped the shell and visible app version to v1.0.8 after mobile text-scaling hardening.
- Added a database-backed one-time v1.0.9 update notice. It starts with the route-rate update message, lists the daily-inspection release details, and keeps rate acceptance separate so declined users can still apply rates later from Settings.
- Updated v1.0.10 user-facing copy so historical inspection records appear only as `점검 완료`; paper-migration provenance remains internal and is not shown in the popup, checklist, or printed form.
- Split the monthly inspection action into `월간 출력` and `PDF 저장`. Printing keeps the browser print flow, while PDF saving downloads a landscape A4 file named for the selected month.
- Added a concise `운행 전 작성 의무` label on the home inspection card and an in-screen notice that non-compliance may result in a 500,000 won administrative fine.
- Compressed the home inspection entry to a single-line 50px-class bar so it no longer pushes the calendar down; descriptive and timestamp text remain in state but are hidden on the home card.
- Fixed accepted rate updates so zero-count schedule records on the acceptance date and later also receive the new unit price, while completed or count-entered records keep their saved snapshot.
- Added subtle calendar inspection markers: green for a completed inspection and gray for a no-operation record, with an accessible date-cell label and immediate refresh after saving.
- Linked the inspection entry to the calendar-selected date, returned to that date on the calendar after save/no-operation completion, disabled future-date entry, and reduced inspection dots from 6px to 4px.
- Unlocked the pre-completed inspection records so users can correct checklist results, notes, or no-operation status. Saving a correction converts that date to a normal app-authored record that remains editable.
- Hid the calendar inspection dot for no-operation records; only completed vehicle inspections now receive the green marker.
- Added an owner-only reusable inspection signature, stored separately under strict RLS. New completed/no-operation records snapshot that signature, and monthly print/PDF output renders a real signature image in each recorded date column (with the registered signature as the fallback for earlier completed records).

## 2026-09-01 Save Atomicity And Diagnostic Retention

- Replaced the PWA manual-date `DELETE`/`INSERT` sequence with the authenticated `quickflex_replace_manual_day_record` RPC so a network interruption cannot leave a date without its prior route rows.
- Serialized manual replacement against Android immutable work finalization and retained the existing `55000` conflict path when an automatic receipt wins the race.
- Added a private daily retention job that removes measurement diagnostics older than 14 days. Normal users cannot execute the cleanup function.
- Bumped the PWA shell and visible version to `v1.0.42`; update-notice UI remains Android-runtime-only.
- Verified JavaScript syntax and all 98 Node tests. The migration is prepared but must be applied with the matching frontend release; the RPC-using frontend must not be deployed before the database migration.

## 2026-09-13 Driver Statistics Refresh

- Reordered the report around cumulative revenue, equal-workday comparison, typical daily revenue, weekday averages, and reconciliation. Preserved the selected original charcoal/brass palette.
- Collapsed volume/unit/extra comparisons, route details, date records and the trend chart; route details are hidden when no route actuals exist. No profile route registration is required to count a worked day.
- Added pure stats-insights calculations and regression tests for schedule uncertainty, revenue-only records, weighted delivery units and median/IQR. Schedule-based projection is optional and never fills unknown future workdays.
- Reconciliation now sums canonical day totals instead of rounded per-route subtotals. No persisted accounting, collection, auth or input contracts changed.
- Validation: 140 non-SQL tests passed in the actual worktree; 36 SQL tests passed against identical schema/migration copies in an isolated PGlite 0.5.8 staging runtime. JavaScript syntax and diff whitespace checks passed. Source-worktree dependencies were not installed or modified.
- Browser review: original dark and light themes, 360/390px widths without horizontal overflow, previous/custom/empty ranges, route hiding, disclosure behavior and keyboard chart selection verified. Final side browser shows the original dark statistics page without the palette-preview toolbar. No deployment requested.

## 2026-09-13 Statistics Visual Polish

- Reduced weekday bars from full-column width to a maximum of 18px and added subtle vertical gradients to weekday and trend bars.
- Removed the duplicate amount beside the reconciliation heading. Reconciliation rows now share a 44px height with 13px labels, 16px values and 12px units; only the final total uses the accent color.
- Standardized disclosure height, daily metadata/detail typography, weekday samples and the trend canvas font. Removed the empty review placeholder's extra grid spacing.
- Validation: 39 related tests, JavaScript syntax checks, dark/light browser inspection, 360px no-overflow and daily detail review, and keyboard chart navigation passed. No data or accounting calculations changed.

## 2026-09-13 Trend Line Chart

- Replaced the trend bars with a 2.4px line, lightly shaded area and theme-colored outlined points. The average label sits above the plot; numeric axis labels remain 11px.
- Connect only contiguous worked buckets. Actual recorded zero values remain on the baseline; off/missing/schedule-only gaps are not presented as zero-revenue work. Their tooltip reports the record state.
- Kept full totals/peak descriptions on the canvas accessibility label and shortened the visible interaction hint.
- Validation: 40 related tests, including a rendered-path regression for actual-zero and missing-day gaps; syntax checks; dark/light visual review, 360px no overflow, quantity/long-range charts and keyboard off-day tooltip. No accounting or stored records changed.

## 2026-09-13 Compact Revenue Flow

- Moved the revenue flow above daily patterns as an always-visible 112px graphic, without a surrounding card, axes, average line, markers, metric selection or tooltip interaction.
- Exclude off/missing/schedule-only buckets from the horizontal sequence and join worked records continuously; preserve genuine zero-revenue work. Use a soft curve through recorded values and a faint theme-colored fill.
- Keep an accessible text alternative and an honest empty state; redraw for viewport changes. Updated the design rules and offline cache key.
- Validation: 27 related tests passed, including dense worked-record spacing, recorded zero and empty-state regression; JavaScript syntax and diff checks passed. Dark/light side-browser review and 360px layout passed without horizontal overflow. No stored data or accounting changes.

## 2026-09-13 Revenue Flow Context

- Kept the compact curve and added first/latest dates and approximate revenue below it, with first-workday change above daily charts. Zero baselines use an amount change instead of an undefined percentage.
- Weekly/settlement views identify the aggregation and show the actual bucket date ranges; they do not compare incomplete bucket totals as a percentage. Empty/single-record states remain truthful.
- Validation: 28 related tests, main/bootstrap/service-worker syntax and diff checks passed. Dark/light and 360px browser review, daily/annual labels and no horizontal overflow verified. No stored data or accounting changes.


## 2026-09-13 - Expenses, exports, calendar and private records
- Added receipt-first expenses, owner-only backend/RLS migrations, XLSX/evidence ZIP, Google calendar implementation, and compact Settings groups. Retired other-user sales and record-deletion UI.
- Validation: 194 Node tests; isolated browser fixture for receipt draft, confirmed expense, refund, trash/restore, and account reset; 360px dark/light UI checks.
- Production deployment was initially held for explicit project approval, then completed after the user approved (see following entry). Google OAuth secrets/worker setup remain required.
- See docs/expense-rollout-review.md for exact scope and verification boundaries.

## 2026-09-13 - Approved expense and calendar backend deployment

- Applied expense/privacy and calendar migrations to the configured Supabase project xrrdokcjhjqdfvwtbenl, plus a follow-up for four FK indexes and calendar sequence privilege revocation. Deployed calendar-sync ACTIVE version 1 with custom JWT/worker authentication.
- Verified owner RLS, private receipts bucket, narrow member RPCs, removed admin read/delete bypasses, and no browser access to calendar tables/sequences. Existing record counts stayed 1402/1995/6/36.
- Verified real PWA expense reads and export preview: settlement sales 4,616,185 KRW across 16 workdays, no expenses/receipts. HTTP anonymous status/worker requests return 401; OPTIONS 200, malformed callback 400, unsupported method 405.
- Added a passing PGlite sequence privilege regression. Fixed cramped checkbox/filter labels and made calendar connection failures visible with a retry action. Refreshed the offline cache key.
- Registered the production PWA and current local preview origins for calendar CORS/callback validation. Google OAuth client, encryption key, worker secret/scheduler and real Google/Samsung/receipt-binary integration tests remain outstanding. No real test financial rows or Google events were created.


## 2026-09-13 - Google Calendar live setup and reconnect completion
- Enabled Calendar API, configured the dedicated web OAuth client and exact callback, and saved four server-only secrets. The worker secret is read from Vault by an active five-minute Supabase Cron job; no secret values are in source or documentation.
- Deployed calendar-sync version 4 with the existing custom callback/user/worker authentication. Reconnection verifies access to the existing app-created calendar before persisting refreshed credentials and preserves its ID and mappings.
- A real work/off snapshot produced 26 events in the dedicated Google calendar. Identical requeue, disconnect/reconnect, and a subsequent sync preserved the events without duplicates; revenue and route export stayed OFF.
- Added pending/failed/conflict reporting, bounded polling, panel reopen refresh, and lifecycle guards. Live pending-to-success UI verification preserved the focused date input.
- Calendar tests: 13/13 passed; JS/TS syntax checks and diff whitespace check passed. Follow-up UI tests: 5/5 passed. Dark/light calendar panel verified at 360px and 614px; primary/secondary button roles and light-mode surface colors corrected locally.
- Google remains External Testing. Public operator/contact are supplied, and a privacy-page draft is ready for the design-audit/site-deployment phase. Public Google availability and physical Samsung Calendar display are not yet verified. External edit/delete conflicts are covered only by targeted code/status tests, not a live destructive scenario.


## 2026-09-13 - Final design audit before Pages release

- Standardized home/record tabular numerals and smaller units, settings input sizes, mobile record date heading and neutral secondary buttons in light mode.
- Published-contact privacy policy and introduction links are prepared. DESIGN-RULES.md remains the only design authority; HANDOFF.md is marked historical.
- Validation: npm ci completed; full Node suite 207/207 passed with no skips, syntax and diff checks passed. Inspected actual dark/light browser screens at 360px and 614px. Detailed scope and remaining Google public/Samsung boundaries: docs/design-audit-2026-09-13.md.

## 2026-09-13 - Landscape calendar and persistent selected-day panel

- Replaced conflicting wide-home layouts with a compact full-width summary, left calendar, right selected-day panel and vertical navigation. Enabled at landscape widths of 768px or desktop widths of 1100px; portrait keeps the existing single-column flow.
- Off, missing, scheduled, manual-revenue and automatic-record days retain the same panel. Existing record/off actions are reused within it; calculation, settlement ranges, storage and financial records are unchanged.
- Calendar cell tracks preserve route labels without vertical clipping. Paired panel actions share 44px height, 13px type and weight 600. Documented responsive rules and refreshed the service-worker cache name.
- Validation: full Node suite 209/209 passed, followed by 17/17 focused accessibility/design/day-state checks. app.js, src/main.js and sw.js syntax and git diff whitespace checks passed.
- Actual browser inspection covered dark/light landscape at 768x600, 960x720 and 1280x960, plus light portrait at 360x900 and 800x1100. Checked no horizontal overflow, route label clipping, manual/automatic/planned/off states and record-editor return without saving. No physical-device verification or financial writes were performed in this layout task. Private screenshots remain outside the release.

- Integration check: latest usage-guide changes preserved. Combined suite: 234/235 passed initially; the guide cache-name suffix check was fixed without changing test expectations, then all 13 startup/usage-guide tests passed.

## 2026-09-15 - Measurement menu opening notice (PWA 1.0.63)

- Reused the accessible update dialog for a new approved-member announcement in browsers, installed PWAs and the native wrapper. Pending, blocked, signed-out and mismatched accounts cannot receive it.
- Added measurement-menu navigation and dismissal actions. Both acknowledge this notice per account/device; navigation never launches or starts measurement. The existing nonblocking own-profile audit remains unchanged.
- Added concise Android installation, final-count review and beta-accuracy guidance. Preserved existing themes, focus trapping and return focus; added Escape dismissal and short-landscape scrolling.
- Validation: 56 focused notice, approval, startup, native-back, accessibility, cache, font and guide tests passed; JavaScript syntax and diff whitespace checks passed. Local previews verified dark/light 375px portrait and 812x375 landscape. No APK, counting, financial-data or database-schema changes.

## 2026-09-16 - Measurement route display deduplication (local only)

- `renderMeasurementBridge()` normalizes and deduplicates the displayed route list using the existing route helper. Repeated 303A entries display once; stored rows and quantities stay intact.
- Syntax checks passed for src/main.js, app.js and sw.js; three focused route assertions and diff checks passed. Browser/device checks and unrelated export tests were not run.
- No version change, push or deployment. Details: docs/measurement-route-display-20260916.md.

## 2026-09-16 - Refined measurement standby release (PWA 1.0.66 / Android Beta 1.11)

- Updated the current installation links and release labels to Android Beta 1.11; bumped the manifest, asset queries and service-worker cache to PWA 1.0.66.
- This frontend release only changes release metadata. The refined standby/home layout ships in the Android APK; counting, financial records, authentication and database behavior are unchanged.
- Validation: all 243 Node tests passed, 39 first-party JavaScript files passed syntax checks, and diff whitespace checks passed. Version assertions now check the new published version and APK path without weakening the tests.
- Prepared locally; publish the APK before pushing the Pages update. No physical-device installation or new browser-flow test was performed for this metadata-only update.
## 2026-09-16 - Measurement route layout release (PWA 1.0.68 / Android Beta 1.12)

- Preserved the already-published PWA 1.0.67 expense layout changes from main. Updated installation links and labels to Android Beta 1.12, with PWA 1.0.68 manifest, asset queries and service-worker cache.
- This change only updates release metadata. The measurement route layout ships in the Android APK; counting, settlement, authentication and backend behavior remain unchanged.
- Validation: 243 Node tests passed, 41 first-party JavaScript files passed syntax checks, and diff whitespace checks passed. Release version and APK path assertions were advanced without weakening their checks.
- Prepared locally; publish the APK before pushing the Pages update. No physical-device installation was performed by this frontend task.

## 2026-09-16 - Registered schedule correction takes priority (local)

- Exclude a built-in completion pattern when it shares two or more routes with an active registered pattern. These are the same two-route completion anchors; differing trailing routes no longer cause both patterns to apply.
- Reproduction: registered 316A/316B/313C plus observed 316A/316B now yields 316AB 313C, without the legacy fallback adding 313A.
- Keep unrelated defaults, inactive-pattern behavior, trusted multi-route completion and explicitly observed routes. No database writes or historical schedule changes.
- Six regression cases and full Node suite 249/249 passed; src/main.js syntax and diff checks passed. Not deployed.

## 2026-09-16 - Schedule input safeguards (PWA 1.0.69)

- Registered correction patterns override built-in patterns with the same two-route anchors. Covers 316AB313C versus old 316AB313A and 405AC versus old 405AC410B.
- Completion uses only original observed routes, so an inferred route cannot trigger another pattern. Compact registered patterns normalize before comparison; admin save/bulk input expands compact route groups.
- Shared schedule parser preserves all suffixes in CSV/JSON and adjacent text such as 316AB313C. Valid unlisted four-character routes are retained instead of fuzzy replacement/deletion.
- Nonempty failed OCR input stays unresolved rather than becoming fixed routes. Empty fixed-driver workdays retain their existing configured-route behavior. Empty unresolved workdays block the entire apply operation before any record writes and show a correction hint.
- Manual OCR additions reject invalid input and deduplicate routes. Historical schedules, financial records and server schema are unchanged; no database migration or Edge Function deployment.
- Validation: all 261 Node tests passed; 39 first-party JavaScript syntax checks and diff check passed. Regression tests cover both known conflicts, cascading/order behavior, CSV/JSON/admin parsing, unknown valid routes, fixed-driver behavior and blocked partial writes. No production financial or schedule test rows were written.

## 2026-09-17 - Android logging release links (PWA 1.0.70 / Android Beta 1.13)

- Prepared from published main in an isolated worktree, preserving the uncommitted measurement feedback feature in its original workspace.
- Updated only installation labels, APK/release links, manifest version, asset queries and shell cache for Android Beta 1.13 (versionCode 135). No PWA feature, data or backend changes.
- Validation: 14 release/record contract tests passed; app.js and sw.js syntax checks and diff whitespace check passed. No browser behavior changed or device installation performed by this metadata task.
- Publish and verify the APK before pushing this Pages update. This entry describes local preparation, not completed deployment.


## 2026-09-18 - Android Beta 1.14 release links (PWA 1.0.71)

- Updated installation labels and APK/release links for Android Beta 1.14 (versionCode 136); bumped manifest, asset queries and service-worker shell cache to PWA 1.0.71.
- Metadata-only PWA preparation. Android APK publication and Pages deployment are handled separately; verify the APK is published before deploying these links.

## 2026-09-19 - Ocean icon assets and Android Beta 1.15 links (PWA 1.0.72)

- Prepared on `codex/beta115-ocean-icon-release` from main `5014e3836c5f4b71ca7d35dd0abb31b2c074e59e`. Preserved the approved ocean icon PNG/SVG files and advanced icon cache queries to `v=4`.
- Updated the manifest, asset queries, shell cache and installation links to PWA 1.0.72 / Android Beta 1.15 (versionCode 137).
- Measurement entry now opens the app when the exact Android package is confirmed or the trusted native bridge is present. If detection is unavailable or inconclusive, the primary button opens installation guidance; Android users also have an explicit "already installed" app-open action. The intent contains only work date and shift, with an absolute installation-page fallback. Old APKs and unsupported browsers can return inconclusive results even when installed.
- Kept approval/account checks for app launch and the existing native payload. Date changes, off days, pending detection, native mode and desktop rendering share the same button-state rules. No database, historical business data, auth policy or backend changes.
- Validation: all 270 Node tests passed, including real launch-function and rerender-state tests; JavaScript syntax and diff whitespace checks passed. Isolated Edge/Playwright checks using actual measurement markup, styles and state functions passed at 375px in light/dark and 1280px desktop: no overflow, 44px targets, keyboard focus, installed/download/native/pending/off states. This does not claim an end-to-end real browser installation-detection test. The signed APK was installed over Beta 1.14 on the connected S23+; version 137, accessibility service and deep-link resolution were verified. Evidence is retained in the release audit.
- Publish and verify `android-beta-1.15/flexnote-beta-1.15.apk` before updating Pages. Target: `https://jamaica8612.github.io/quickflex-sales/`. Unrelated `artifacts/measurement-open-notice/` stays untracked.

## 2026-09-19 - Ocean icon on the startup screen (PWA 1.0.73)

- Updated the startup screen's inline truck to the exact approved F-truck symbol paths, including the upright tail, chassis, wheel-hub cutouts and 62% body opacity. Retained the existing blue/light and white/dark theme colors and original SVG frame.
- Kept the existing 760ms drive-in, overshoot, brake tilt, rebound and stop animation, trail, text and reduced-motion behavior. Startup authentication/retry behavior is unchanged.
- Advanced the shell cache and PWA asset references to 1.0.73. Android remains Beta 1.15; no native or business-data changes. Approved icon asset files remain unchanged.
- Validation: all 24 relevant startup/release tests passed; JavaScript syntax and whitespace checks passed. Inline path geometry and cutout rules match the approved symbol exactly, with existing theme color handling. The animation CSS and startup lifecycle script are unchanged.

## 2026-09-19 - Flowing loading dots (PWA 1.0.74)

- Applied the selected third loading design: three small dots move and brighten in sequence, using the existing theme's muted color. Kept the one-second reveal delay, startup layout, truck brake animation, text and login lifecycle.
- Errors hide the dots and expose the existing retry message; reduced-motion mode shows three stationary dots. No new icons, fonts or dependencies.
- Advanced the PWA shell/assets to 1.0.74 and startup CSS query to `v=2`, including its precache entry. Android remains Beta 1.15.
- Validation: all 24 relevant startup/release tests, bootstrap/service-worker syntax checks and diff whitespace checks passed.

## 2026-09-20 - Diagnosis safeguards and design integration (PWA 1.0.77 / Android Beta 1.16)

- Preserve published 1.0.76 design and integrate diagnosis fixes: unsaved-input protection, checked manual saves, OCR access/quota and parsing, expense refund invariants, workbook paths/dates/period totals, auth recovery and calendar queue handling.
- Keep record-edit actions at 44px and retain their arrow; use the common status typography. Android preserves stable route identities while aligning component styling and integrating recovery/pending/finish fixes.
- Applied only the intended migration, aligned local version with remote 20260920012920, and deployed OCR v35 / Calendar v6. Verified RPC restrictions, private-table RLS, unauthenticated denial and no new security warnings.
- Release sequence publishes APK before frontend download links. See docs/diagnosis-design-release-20260920.md for checks, deployment evidence and remaining scope.

## 2026-09-20 - Phone progress and cancellation-bearing detail recovery

- Added owner-only, opt-in multi-phone live progress RPCs without connecting them to sales or finance. Android Beta 1.17 is prepared in `C:\work\quickflex-team-live-android-20260920`; official APK/update links remain unchanged.
- Recovered absent detailed-route quantities only from a work's complete, unambiguous evidence. Supplied detail values and source receipts remain authoritative.
- Applied migrations `20260920021710` and `20260920021733` to the linked production project. Verified the reported 2026-09-19 calendar row shows 316C01 137 with cancellation 1 and 316C02 59; financial and source fingerprints stayed unchanged.
- Relevant tests: 45 passed; JS syntax and diff checks passed. Deployment details: [team-progress-deployment-20260920.md](team-progress-deployment-20260920.md).

## 2026-09-20 - Native session recovery (PWA 1.0.78 prepared, unpublished)

- Retain a native session request in memory until the DB and bridge are ready, and request current-session sync on visibility/native resume. Coalesce concurrent reads through the existing promise and serialize token imports with auth-epoch and credential guards.
- Discard pending intent on logout/account changes; ignore late session/refresh responses for another account. Best-effort event requests handle rejected promises without an unhandled rejection.
- Prepare the 1.0.78 asset/cache version. Official Android download links remain Beta 1.16; do not switch them before the revised Beta 1.17 APK is published.
- The paired Android worktree `C:\work\quickflex-team-live-android-20260920` rechecks existing work identity and requests session recovery in place. New APK: `artifacts/beta-1.17/QuickFlex-Beta-1.17-session-fix.apk`, versionCode 139, SHA-256 `cda0e322acbdc4dfde40941a40cafaf586a4d99e1fdb752817bbab73f5c81bd2`.
- Validation: all 326 Node tests passed with `node --test --test-concurrency=1 tests/*.test.mjs`; serial execution avoids the SQL test processes' parallel memory exhaustion. Auth tests execute the actual session-sync functions for concurrency and late-result isolation. JS syntax and diff checks passed. Android: 1,338 passed / 9 existing log-dependent skips / 0 failures; debug, lint and signed release build passed.
- This fixes confirmed synchronization gaps in the source. The user's specific device incident has not been reproduced on a phone.

## 2026-09-21 - Beta 1.18 link preparation (PWA 1.0.79)

- Prepared the official Android labels and download/release links for Beta 1.18 (`android-beta-1.18/flexnote-beta-1.18.apk`) and advanced the manifest, asset queries, and service-worker shell cache to PWA 1.0.79.
- This frontend-only preparation is held until the matching APK is published and verified. No database, auth, Edge Function, or browser behavior changes are included.

## 2026-09-21 - Beta 1.19 link preparation (PWA 1.0.80, unpublished)

- Prepared the official Android labels and download/release links for Beta 1.19 (`android-beta-1.19/flexnote-beta-1.19.apk`, versionCode 141) and advanced the manifest, asset queries, and service-worker shell cache to PWA 1.0.80. The existing `native-session-recovery-1-usage-guide-1` cache suffix remains unchanged.
- This metadata-only preparation remains unpublished until the matching APK and GitHub Release asset are publicly verified. No database, auth, Edge Function, or browser behavior changes are included.
- Verification: `node --check app.js`, `node --check sw.js`, and all first-party `src/**/*.js` checks passed. The focused PWA release contracts passed: 19 tests across `pwa-sales-override`, `pwa-fonts`, and `pwa-usage-guide`; `git diff --check` passed.

## 2026-09-20 - Authorized Beta 1.17 / PWA 1.0.78 publication

- User authorized publication after the revised APK and tests were complete. Advance visible Android labels and download/release links to `android-beta-1.17/flexnote-beta-1.17.apk`.
- Publish exactly one APK asset before advancing Pages main. The automatic updater reads the non-draft GitHub Releases list, selects Beta 1.17, and validates the downloaded package/version/signature before installation.
- Release artifact is byte-identical to the verified session-fix APK above: 15,007,252 bytes, versionCode 139, SHA-256 `cda0e322acbdc4dfde40941a40cafaf586a4d99e1fdb752817bbab73f5c81bd2`; signer matches Beta 1.16. Android source commit: `17ccffb`.
- Rechecked production migration history: both `20260920021710` and `20260920021733` are present. This publication does not reapply migrations or redeploy unrelated server functions.

## 2026-09-21 - Company route notes (local only, not deployed)

- Added the company-wide Route Notes tab, personal favorites, calendar route shortcuts, and moved Expenses under More without replacing measurement or personal financial data.
- Approved members can write freeform tips, with optional coordinates/photos. Only the author may edit/delete tips or photos, including when another member is a company admin. The DB stamps the author display name and rejects client changes. Company admins/editors manage zone boundaries.
- Added additive company-scoped RLS, a private photo bucket, revision conflict detection, account-epoch guards, and local synthetic UI fixtures. Original RouteNote data was not copied and no remote schema/storage writes, pushes or deployment ran.
- Work split: Terra agents handled UI/map, service and PGlite coverage; the primary agent integrated menus/auth, designed and reviewed permissions, hardened partial failure/account switching, and verified the result.
- Validation: all 348 Node tests passed serially; 44 first-party JS syntax checks and diff checks passed. Chrome 375px DOM verified favorites, freeform creation/editing, author labels/controls and no horizontal overflow. Screenshot capture and later deletion-dialog browser calls timed out; map/visual and remaining viewport QA are explicitly outstanding.
- Deployment and existing-data import checklist: docs/COMPANY-ROUTE-NOTES.md. Branch: codex/company-route-notes-20260921. Existing release versions and Android source unchanged.

## 2026-09-21 - RouteNote data import, menus and expiring sharing (app unpublished)

- With the user's data-import authorization, applied the additive company and provenance migrations and copied 35 active source zones, 138 tips and 70 photos. Three tips without a source zone belong to one additional unassigned zone. Preserved the source service and privately archived 305 original rows; 70 source/destination file hashes and six source/archive table fingerprints matched.
- Exact confirmed-email matching links 31 tips to their existing authors. The other 107 retain their original author names and remain read-only until identity is confirmed. No name-only or administrator fallback ownership was assigned.
- Bottom navigation is 매출 / 배송 / 구역 / 지출 / 더보기; full screen names are 매출노트 / 배송노트 / 구역노트 / 지출노트. Statistics opens from More. The revenue title remains visible beside the existing profile information.
- Added the fixed-driver 내 구역 default from explicit assigned route codes, retaining all zones, favorites and search. The new PWA excludes comments, realtime location sharing and periodic GPS tracking; manual one-shot location lookup remains.
- Implemented login-free single-zone sharing with a 1–30 day expiry, creator-controlled extension/revocation, hashed tokens, restricted media signing and expiry cleanup. The user selected expiring links only, so permanent personal copies are excluded. Sharing SQL, Edge Function and PWA changes remain local and undeployed; no push or Android change ran.
- Validation: all 374 Node tests passed serially with zero skips; 50 JavaScript syntax checks, canonical-schema inclusion and diff checks passed. The actual imported dataset passed two idempotent PGlite imports and remote RLS/storage verification. New Chrome/IAB navigation attempts timed out, so current browser layout, live map and mobile QA remain outstanding. See COMPANY-ROUTE-NOTES.md and ROUTENOTE-IMPORT-20260921.md.

## 2026-09-21 - Authorized route-note publication (PWA 1.0.81)

- User authorized deployment after implementation and data import. Publish the menu, company route notes, fixed-driver filter and expiring public-share page; preserve Android Beta 1.19 and the existing personal sales/counting/measurement behavior.
- Applied `route_note_shares` to project `xrrdokcjhjqdfvwtbenl` and deployed only the new `route-note-share` Edge Function. Aligned the three local migration filenames with their actual remote versions: `20260921110850`, `20260921110900`, `20260921114325`.
- Live backend validation: an approved member can create a link; anonymous Edge POST returns exactly one zone with tips and signed photos. Two signed photos were fetched successfully, the response has the expected CORS and `no-store` headers, and internal ownership/provenance fields are absent. Security advisors have no additions (six pre-existing notices remain).
- Raised PWA manifest, cached asset references and the service-worker cache to 1.0.81. The 374-test release run passed 373 checks and caught one stale introduction-page manifest version; fixed both introduction/install manifest references and all 19 focused release/font/guide checks then passed. All 50 JavaScript syntax checks passed. Actual browser/map/phone verification remains distinct from these API and automated checks.

## 2026-09-21 - Existing-browser config cache correction (PWA 1.0.82)

- Pages deployed revision `837ace8` successfully and 13 live files matched the release. Real Chrome verification then exposed a stale `config.js?v=10` module without the newly required `ROUTE_NOTES_CONFIG` export, which prevented startup on an existing browser.
- Advance both route-note entrypoints to config revision 11, precache that exact URL, and bump PWA/main/shared-page URLs to 1.0.82 so existing caches can recover. Added a regression check for the previously cached configuration URL and matching public-page/offline dependencies.
- Published `299a5e3`; actual existing-session Chrome startup recovered and displayed 매출 / 배송 / 구역 / 지출 / 더보기, working search and 32 zone rows. Public share rendered the selected zone/tips/photos; after creator revocation the Edge endpoint returned 404 and the browser showed the unavailable-link screen. The temporary verification share was removed.
- Compared full data fingerprints before/after the additive release: all 1,481 day records, 2,113 day-route rows and 2,240 route-rate rows were unchanged. The user's follow-up removed only empty note zones 218/222/300A/300B after a private backup; all 138 tips and 70 photos remain.

## 2026-09-21 - Map-first route notes (PWA 1.0.83)

- User requested the map as the main surface and removal of the Naver zoom buttons that overlapped menus. The route tab now keeps one map with floating search/filter/manual-location controls and a collapsible result/detail/tip/share panel; Naver zoom controls are disabled while native map gestures remain enabled.
- Preserve company/fixed-route/favorite filters, original safe zone colors, author-only editing, unsaved-input confirmation, and optional-coordinate freeform tips. Geometry fitting accounts for the visible controls/panel. Map SDK render failures remain isolated from list/detail/CRUD; a real localhost SDK rejection exposed and verified this fallback.
- Split map adapter and UI/CSS between two Terra agents; the primary agent reviewed state/reset/edit guards, retained manual location, verified actual browser workflows and prepares the publication. Cache-version the changed UI/map/style assets for existing installations.
- Validation: all 377 Node tests passed; syntax and diff checks passed. Local Chrome at 375px verified no horizontal overflow, 44px filters, author names with only the current author's edit button, coordinate-free tip save and usable details after SDK failure. The local domain is not authorized for map tiles, so live map placement is checked on the deployed domain separately.

## 2026-09-22 - Approved route-note usability implementation (unreleased)

- After the user reviewed the standalone preview, implement a searchable zone chooser, selected-zone-only boundaries/pins, and a compact default memo sheet. Keep company-wide search, own-tip editing, reference photos, and existing shares. Lazy-load the map after selection and preserve its viewport while opening notes.
- Preserve the same editor form while switching between map location selection and continued writing. Recompute panel height on viewport changes without forcing a deliberately collapsed editor open. Confirm draft cancellation, restore focus after collapse, and provide explicit map retry.
- Add the PWA `set_route_notes_active` bridge message only after accepted navigation, clear it on account reset, and resync it on resume. Matching Android source is `C:\work\quickflex-finish-review-20260921`, commit `b13d7d0`; route notes disable native pull-to-refresh while other views retain it. Native measurement/counting code is unchanged.
- Validation: the existing 382-test Node suite and six additional focused controller tests passed, Android debug build/unit tests and instrumentation-test compilation passed. Browser example-data checks covered compact layout and retained input across map/form and shorter viewport states. Actual phone gestures/IME remain unverified because ADB has no connected device. See `docs/route-notes-apk-usability-20260922.md` for exact limits and final focused controller checks.
- No push, production deployment, APK installation, schema or company-data changes. PWA cache/module revisions and APK release version must be advanced together when publication is requested. The map remains the Naver JavaScript Web Dynamic Map inside WebView.

## 2026-09-22 - Authorized usability release (PWA 1.0.85 / Android Beta 1.20)

- The user authorized publication of the reviewed route-note changes. Advance the PWA manifest and shell to 1.0.85, route-note UI/CSS to revision 4 and the map adapter to revision 3 in both signed-in and public-share entrypoints. Install pages point to Android Beta 1.20 (versionCode 142).
- Release validation: all 50 focused PWA checks passed after version changes, all 50 browser JavaScript files passed syntax checks, and the diff check passed. The earlier implementation run passed the existing 382-test suite plus six new controller regression checks.
- Android source and signing verification are tracked in `C:\work\quickflex-finish-review-20260921\docs\beta-1.20-release.md`. Publication and downloaded-artifact evidence is kept in `C:\work\quickflex-route-ui-preview-20260921\release-20260922-beta120`. No database, Edge Function or stored company data changes are needed for this release. Actual Android gesture/IME verification requires a connected phone.

## 2026-09-22 - Route-note theme, focused tips, member zones and full screen (unreleased)

- Keep route notes and their share dialog light under the app's dark theme. Share the SVG icon family between note cards and map markers; reduce boundary weight/fill while preserving original geometry and colors. Marker/search selection opens only that tip and its photos/author, with a return to all notes. Move zone sharing onto the map, available in both compact and full-screen views.
- Add full-screen entry beside search, hide the app bottom navigation, resize the map, and support exit/native back. Preserve draft input when choosing a location, resuming writing or leaving full screen; return keyboard focus to a visible control. A selected single-tip sheet uses a compact height.
- Allow every approved company member to create zones. Authors may edit their zones; existing editor/admin boundary maintenance remains. Only a zone's author may delete it, and remaining tips/reference photos block deletion in both service and database. Tip/photo author-only permissions remain. Prevent company-local duplicate names after Unicode NFKC, whitespace and case normalization, including concurrent creates/renames.
- Prepare `20260921220942_route_note_member_zones.sql` and append the exact migration to the canonical schema. Read-only production preflight found 32 zones and zero duplicate normalized names and confirmed existing foreign-key names. No production DDL, data mutation, push or deployment. Existing imported content remains. Apply the migration before publishing the PWA; advance release version references then.
- Validation: 80 focused Node tests passed, including actual PGlite RLS/unique/FK enforcement and repeat migration application. Ten changed/required JavaScript files passed syntax checks; all 87 cached asset paths exist, the canonical schema includes the exact migration, and the diff check passed. Edge checks using the app shell hierarchy, example data and a DOM map SDK fixture passed at 390×844, 375×667, 844×390 and 1280×800: light route UI under dark app theme, keyboard marker activation, single-tip detail, map sharing, full-screen/navigation restoration, preserved editor input and no horizontal overflow/page errors. Actual Naver SDK/tiles and physical Android gestures/IME remain unverified.

## 2026-09-22 - Authorized PWA 1.0.86 and route-note permissions release

- The user authorized publication and confirmed that full screen should work in the PWA. Advance the manifest, shell and entrypoint references to 1.0.86. Android remains Beta 1.20; no APK build or installation is needed for this update. Publication targets the existing GitHub Pages `main` branch.
- Apply the reviewed member-zone migration to the configured production project. Align its local filename with the provider-recorded version `20260921224120_route_note_member_zones.sql`. Verify enabled RLS, approved-company creation, creator-only deletion, valid normalized unique index, normalization behavior, anonymous execute denial and both `ON DELETE RESTRICT` foreign keys.
- Production zones (32), tips (140), tip photos (2) and zone reference photos (68) have identical counts and content hashes before/after the migration. No existing content was modified. Security advisors report no new findings; pre-existing project-wide notices are outside this release.
- Release validation: 94 focused Node tests passed, 48 browser JavaScript files passed syntax checks, all 87 cached asset paths exist, and the diff check passed. The earlier four-viewport browser checks remain valid; physical-phone gestures/IME still require device verification. Live Pages revision and response checks follow publication.


## 2026-09-22 - RouteNote interview and mixed boundary editor (local, unreleased)

- The user stopped publication to inspect the original RouteNote and interview first. Confirmed: postcode-first boundaries plus manual pieces in one zone, imported boundary editing, undo/redo, multiple route groups without a four-group cap, many-to-many postcode/detail-code use within one zone, cross-zone detail-code uniqueness, no tags/files, author-owned common description/photo tips, and located tips inside the selected boundary.
- Read original ZoneForm/MapContainer/TipForm and postcode function without editing the original repository. Primary implemented map point menu, SVG types, boundary display/editor adapter, controller integration, cache assets and QA; two Sol agents implemented the isolated editor/model and backend rules/tests.
- Prepare NEW migration `20260921233040_route_note_detail_codes_and_points.sql`, exact canonical appendix and approved-member `route-note-postcode` function. Read-only production preflight: 32 zones, 59 distinct detail-code claims, zero cross-zone collisions; 31 valid hex colors and one NULL. Earlier member-zone migration remains applied, unchanged. No new remote mutation, commit, push, PWA publication or APK changes.
- Automated validation: 101 focused Node tests pass; 52 first-party browser JS syntax checks and diff check pass. Broader run: 413 pass; existing export test cannot import missing `exceljs` (and local `fflate` is also absent). Do not report the entire suite as passing. Deno is unavailable, so Edge runtime/deployment validation remains pending.
- Browser QA on example data: 390×844, 375×667, 844×390, 1280×800 pass with no overflow/page errors. Retain title/photo inputs while moving between map and form, allow null-location common tips and reject outside picks. Real Naver SDK in fresh Edge, with Pages first-party URLs intercepted to local fixture assets, successfully opens a tip form from a polygon click and moves a vertex through numeric edit and actual pointer drag. Map tiles were observed. No production content was published/modified by this check; physical Android gestures/IME remain untested.

- Final Edge follow-up extracts the projection geometry guard into `geometry.js`; three postal tests cover membership/error handling plus multipart/hole/closure/coordinate-limit behavior. The latest focused total is 102 passing checks (101-check run plus the additional geometry case). Edge entrypoint/helper syntax checks pass; Deno type/runtime check still pending. All 92 precached local assets exist.

## 2026-09-22 - Approved mixed-boundary release (PWA 1.0.86)

- User explicitly authorized deployment. Confirmed origin/main and live manifest are still 1.0.85, so the prepared 1.0.86 is the next publication; no extra version increment is needed.
- Applied detail-code and point migration as provider version `20260921233040`; aligned local filename and references. Deployed `route-note-postcode` v1 ACTIVE with verify_jwt=true and its own approved-profile/company guard.
- Immediately before/after server deployment, zones 32, tips 139, tip photos 2 and zone photos 68 have identical content hashes. The private code registry has 59 claims, enabled RLS, no authenticated direct INSERT, two enabled triggers and validated color constraint. Security advisors add one expected INFO for the private deny-all code registry (RLS with no client policies); the previous 59 findings are unchanged. No direct client grants were added.
- Publication includes the reviewed route-note UI, map, editor, light styles, author controls, full-screen/share, cache assets and version references; Android stays Beta 1.20. Existing data is not rewritten. Live Pages commit, byte comparison and browser-update verification follow publication.

## 2026-09-22 - Existing-browser route module cache recovery (PWA 1.0.87)

- Pages published 0c47b5e and all 20 changed public assets matched. The existing signed-in Chrome session then exposed a stale unversioned lib/route-notes.js missing routeNoteZoneNameKey, which prevented module startup.
- Version the shared route library and service, propagate the changed imports through editor/UI/main, precache the exact URLs, and publish 1.0.87. The service revision also ensures existing clients receive postcode lookup, boundary validation and author/duplicate handling instead of cached old service methods. No further database or Edge changes are required.

## 2026-09-22 - Restore original RouteNote zone labels (PWA 1.0.89)

- The user reported that zone labels no longer matched RouteNote. Compared the original `MapContainer.jsx` and `geoUtils.js`: replace the port's rounded selectable badges with the original 16px, weight-700 dark text, white text shadow and centered anchor. Label text lets map taps pass through; the zone chooser and polygon interactions remain available.
- Match RouteNote's per-code, shared-outer-edge clustering and coordinate-average placement. Distant pieces of the same code receive separate labels, and unlabeled pieces fall back to the zone name. Preserve stored geometry, holes and the existing thin boundary strokes. Use the same labels in signed-in, editor and read-only share maps.
- A bounded Sol subtask updated map/geometry tests while the primary handled implementation and release. All 106 focused route/PWA tests pass; the expanded dependency-cache test also passes. Real Naver SDK verification with isolated example data at 390x844 and 1280x800 confirmed three labels for joined/disconnected pieces, exact computed label styles, click-through to the tip location menu, dark-theme readability, read-only labels, no overflow and no page errors.
- Version map, geometry, shared CSS and all importing entrypoints; advance shell/manifest to 1.0.89. All 92 precache paths exist. Publish to the existing Pages main branch. No database, stored zone/tip/photo content or APK changes are required.

- Publication preflight encountered the concurrent Beta 1.21 links release (9340710, PWA 1.0.88). Rebased onto it, retained its APK links and tests, and chose 1.0.89 for this follow-up.

## 2026-09-22 - Transparent map tip icons (PWA 1.0.90)

- User authorized cleaner cutout-style icons. Remove the white tile/border/shadow from map tip markers and picked-location markers. Keep the existing SVG meanings and blue/red semantics; use consistent 30px icons with a thin white contour for map readability, a selected-state dot and the existing 44px transparent hit area. Honor reduced motion and preserve keyboard focus/activation.
- The shared map stylesheet applies to the signed-in map and public shares. Advance its URL to revision 3 and PWA shell/page versions to 1.0.90; no map/controller logic, saved content, backend or APK changes.
- Real Naver SDK example-data checks pass at 390x844, 375x667, 844x390 and 1280x800: transparent normal/selected backgrounds, all 20 typed SVG icons, six red warning types, 44px hit targets, keyboard selection, reduced-motion handling, dark-theme readability, no overflow or page errors. Reviewed icon-gallery, selected-tip and map screenshots. Existing focused map/controller/release tests and required syntax/diff checks pass.

## 2026-09-23 - Beta 1.22 download links (PWA 1.0.91)

- Point the existing download and release links to Android Beta 1.22. The native update improves bounded single-card capture and fixed rejection diagnostics without relaxing exact-identity or duplicate-counting safeguards. No business data, database, route-note UI, or web application logic changes.
- Advance the manifest, shell cache and matching entrypoint URLs to 1.0.91 so existing browsers receive the new installation guidance. Preserve the latest 1.0.90 map icon work.

## 2026-09-23 - Route-note market annex maps and Beta 1.23 links (PWA 1.0.92)

- Restore the original 311CD322D agricultural-market layouts for 청과물동, 무배추동 and 양념동 as searchable, zoomable building tabs inside the route-note market tip.
- Keep the current route-note visual language while aligning the zone bar, Pretendard Korean typography and distinct map marker icons.
- Point Android installation and update guidance to Beta 1.23, whose Korean UI font is Pretendard while numeric and route-code fonts remain unchanged.
- Validation: 29 focused release, update-notice and measurement-launch tests pass; required app/service-worker syntax checks pass, all 92 precache paths exist, and diff checks pass. Android build/signing and public download verification are tracked in the native release record.

## 2026-09-23 - Unified tab headers, Noah tab and expenses inside 매출노트 (PWA 1.0.94)

- User-approved navigation: 매출노트 · 배송노트 · 노아 · 구역노트 · 정산노트. The 더보기 bottom sheet is removed; every tab header has a gear that opens 설정, which already holds 사용법 and the admin section. The settings page title is 설정 and its duplicate 통계 row is gone.
- Tab first screens share one header (22px title, one-line subtitle, right-side actions). 매출노트 shows the settlement period as its subtitle and the daily inspection as a small header pill (gold dot while pending, muted 점검 완료 when done); the profile-name line is removed.
- 지출노트 lives inside 매출노트 behind a 매출 | 지출 switch; the expenses view keeps its controller, export button and data. The settlement card adds `지출 … · 남는 돈 …` for the same period (confirmed expenses minus refunds), cached per account and period and refreshed after leaving the expenses view.
- 통계 is renamed 정산노트 and is a tab; native back from 정산노트 and 노아 now returns home.
- 노아 is a UI shell only: intro, suggested questions and an input that answers "준비 중". No AI backend, network call or data access yet.
- Route-note tip icons are unchanged (icon refresh postponed by the user). No schema, backend or APK changes.
- Validation: 430/431 Node tests pass; the remaining `expense-privacy-sql` failure is pre-existing on main. 390x844 captures checked for all tabs.

## 2026-09-24 - 한국 업무일 판단 통일 (PWA 1.0.95)

- `src/lib/work-date.js`의 순수 함수 `resolveWorkDates({ now, workShift, dayState })`를 배송노트·매출노트·노아의 기준으로 사용한다. 실제 한국 날짜와 업무일을 구분하며, 일상점검은 기존 운행 시작 날짜를 유지한다.
- 주간은 항상 한국 오늘이다. 야간은 (a) 같은 계정의 유효한 진행 중 측정 업무일, (b) 오늘 자동 마감 완료면 내일, (c) 오늘 휴무 또는 실제 근무표 구역과 자동 기록이 모두 없으면 내일, (d) 오늘 실제 근무표가 있고 미마감이면 오늘, (e) 근거 부족이면 정오 전 오늘·정오부터 내일(`reason=clock`) 순서다. 고정 구역을 화면에 채운 결과는 근무표 증거가 아니다.
- 반환값의 `activeWorkDate`는 시작할 실효 업무일이며 `nextWorkDate`와 같다. 야간 `previousWorkDate`는 그 직전 달력 업무일(오늘 마감 시 오늘)이다. 마지막 매출이 존재하는 날짜를 검색하는 의미는 아니다. 주간의 세 날짜는 모두 오늘이다. 조회 실패와 확인된 빈 근무표를 구분하며 기존 성공 스냅샷·계정 격리를 유지한다.
- 배송노트는 사용자가 고른 날짜를 보존하고 `9/25 업무로 시작`을 크게 표시한다. 매출노트의 야간 `오늘` 버튼과 작은 `오늘 업무` 표시는 다음 업무일을 가리킨다. 실제 달력 오늘 표시는 그대로 둔다. 근무표 저장과 앱 복귀 시 표시도 갱신한다.
- 노아는 서버가 프로필 근무조·오늘 기록·실제 구역·자동 마감·유효 lease를 읽는다. 매출/완료는 직전 업무일, 구역/팁/출근 준비는 다음 업무일을 사용하고, 애매한 질문은 날짜를 되묻고 답에 기준일을 밝힌다. 서버 규칙 사본은 PWA 파일과 바이트 및 결과 일치 테스트로 묶는다. DB 스키마·원장·팀 합산 변경은 없다.
- 배포 순서: PWA와 노아 검증 및 main 반영 → Noah Edge Function 재배포와 Pages 확인 → 머지된 규칙을 확인해 Android 적용/빌드. PWA 버전·캐시·진입 URL은 1.0.95로 올린다.
- 검증: npm ci 후 전체 Node 테스트 481/481 통과(건너뛰기 없음, expense-privacy-sql 포함). app.js/sw.js와 vendor 제외 src JavaScript 54개 및 Noah JavaScript 구문 통과, Deno Edge 엔트리 타입 검사 통과, SHELL_FILES 101개 실제 파일 확인, diff 검사 통과.
- 배포 확인: Pages에서 1.0.95 및 공개 파일 9개 일치, 실제 오늘과 다음 업무일 표시·수동 날짜 유지 확인. 실서비스 질문에서 노아가 예정 구역을 완료 원장에서만 찾는 문제를 발견해 sales_days/sales_manual_items 근무표 우선 조회 지시와 테스트를 보강했다(Edge 후속 배포, PWA 자산 변경 없음).
- Noah 최종 운영 검증(v6, JWT 검증 유지): '오늘 구역'은 다음 업무일의 실제 근무표, '오늘 매출'은 직전 업무일의 완료 매출을 기준으로 응답했다. 문맥의 실제 날짜를 도구 from/to 예시에 명시해 완료 기록과 예정 근무표를 혼동하지 않게 했다. 후속 handler/문맥 테스트 15개 및 Deno 타입 검사 통과.
- 모호한 '오늘 일' 질문에는 자료를 추정해 덧붙이지 않고 두 기준일 중 어느 쪽인지 확인만 하도록 명시했다. 근무표의 0건 항목이 완료 실적으로 해석되지 않도록 읽기 도구 설명도 보완했다. Noah 관련 회귀·규칙 일치 테스트 45/45 통과.

## 2026-09-24 - Noah 공개·스트리밍·기기 대화 기록 (PWA 1.0.96, 배포 완료)

- 노아 첫 사용 고지를 승인된 프로필에 한 번만 기록하고, 피드백은 원문 없이 평점·조회 자료·제안 여부·응답 시간·모델만 새 `quickflex_noah_private.feedback` RPC로 저장하도록 했다. `privacy.html`에는 OpenAI 전달·store:false·미국 처리와 기기 보관을 추가했으며 법적 확인이 필요한 보관·국외 처리 문구는 TODO로 남겼다.
- 노아 탭의 브리핑 카드는 AI 호출 없이 다음 업무일·구역·팁 수·목표 필요 매출을 계산하고, 답변 아래에는 실제 조회 결과에서 만든 허용된 화면 이동 링크를 표시한다. 진행 상태와 최종 문장은 SSE로 보내며 실패 시 JSON 응답으로 되돌아간다. `NOAH_MODEL`과 선택적 `NOAH_MODEL_FAST`를 지원한다.
- 대화는 계정별 IndexedDB(실패 시 localStorage)에 최근 20개·7일만 저장하고 로그아웃·계정 전환·초기화·탈퇴·대화 지우기 때 삭제한다. 복원된 변경 제안은 지난 제안으로만 표시해 확인 버튼을 제공하지 않는다. `assets/noah/noah-avatar-v1.webp`를 노아 아바타로 추가했다.
- 변경 파일: `src/ui/noah.js`, `src/services/noah.js`, `src/lib/noah-{brief,history,links}.js`, `styles/noah.css`, `src/main.js`, 계정·설정·구역노트 연결부, `supabase/functions/noah/{index.ts,handler.js,data-tools.js}`, `supabase/migrations/20260924081941_noah_notice_feedback.sql`, `supabase-schema.sql`, `privacy.html`, `docs/{NOAH,HARNESS}.md`, PWA 진입점·서비스워커·버전, Noah fixture와 회귀 테스트.
- 실행한 검증: 전체 Node 테스트 507/507 통과(집중 Noah/PWA/SQL 72/72와 PGlite 피드백·고지·쿼터 검증 포함), 변경 JavaScript 10개 `node --check` 통과, `SHELL_FILES` 104개 실제 파일 확인, `git diff --check` 통과. 로컬에 Deno 실행 파일이 없어 `deno check`는 실행하지 못했다. 배포 순서는 새 마이그레이션만 적용 → `noah` 함수 배포 → PWA 배포이며 다른 마이그레이션·함수는 함께 배포하지 않는다.
- 실제 반영: Supabase 프로젝트 `xrrdokcjhjqdfvwtbenl`에 새 마이그레이션이 provider 버전 `20260924084045`로 적용됐고 `feedback` RLS 및 고지·피드백 RPC를 확인했다. `noah` Edge Function v8을 `verify_jwt=true`로 배포했으며, GitHub Pages Actions run `35976845371`이 성공했다. 라이브 PWA에서 1.0.96 노아 탭, 다음 업무일 브리핑, OpenAI 고지, 생성 아바타를 확인했다.
