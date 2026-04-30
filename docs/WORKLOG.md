# QuickFlex Worklog

Last updated: 2026-04-30 (number polish and light button cleanup)

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
