# Design QA — bottom navigation and route-note UX

## Source of visual truth

- Interaction and information architecture requirements: `C:\Users\jamai\Downloads\플렉스노트 UIUX 개선 요청 (2).zip` (latest attachment).
- Visual language: the existing QuickFlex PWA was intentionally retained, per request.
- Baseline capture: `C:\Users\jamai\AppData\Local\Temp\quickflex-design-baseline-20260923\source-route-notes.png`.
- Implementation capture: `C:\Users\jamai\AppData\Local\Temp\quickflex-design-baseline-20260923\implementation-route-notes.png`.
- Full comparison: `C:\Users\jamai\AppData\Local\Temp\quickflex-design-baseline-20260923\comparison-route-notes.png`.

The attachment contains written UI/UX specifications rather than raster mockups. The current PWA capture is therefore the source of truth for visual styling, while the attachment is the source of truth for menu structure and route-note behavior.

## Viewport and state

- Baseline and implementation were rendered in the same browser session at a 1280 × 720 CSS viewport and the same device density.
- Captures are both 1265 × 712 pixels; no density normalization was required.
- Baseline state: route-note zone list fixture before the change.
- Implementation state: the same zone list fixture with the new terminology and navigation behavior.
- Live implementation states were additionally captured at 956 × 1144 pixels for the route map and More menu, and 941 × 1127 pixels for the zone editor.

## Findings by priority

- P0: none.
- P1: none.
- P2: none.
- P3: none requiring follow-up.

## Required-surface review

### Typography

- Existing numeric and Latin type behavior remains unchanged.
- Korean copy continues to use the locally configured Pretendard stack.
- New labels use the established title, body, caption, and control hierarchy.

### Spacing and alignment

- The four-item bottom navigation preserves the current bar height and touch-target rhythm.
- Route map controls, compact tip popover, writing sheet, and editor sheet align to the existing mobile spacing system.
- No clipping or control overlap was found in the captured states.

### Colors, borders, and elevation

- Existing background, surface, border, accent, and muted text tokens were retained.
- New sheets and floating controls use the same radius, border, shadow, and selected-state treatment as the current PWA.

### Imagery and map surfaces

- The Naver map remains the live spatial surface; no placeholder artwork was introduced.
- Selected pins are emphasized and unrelated pins are visually reduced without obscuring the map.

### Copy and states

- User-facing terminology was consistently changed from “메모” to “팁”.
- Zone count, public count, and owned count are shown together.
- The sharing switch is visible but disabled because the current data model has no private-note field; the UI does not imply unsupported privacy behavior.
- Empty, loading, error, selected-pin, placement, search, full-screen, editor, and back-navigation paths were checked.

## Full-view comparison

The baseline and implementation zone-list captures match in overall visual tone, hierarchy, density, and component styling. The observed differences are intentional: updated terminology, revised entry points, and the four-item bottom navigation.

## Focused-region checks

- Live route map: `C:\Users\jamai\AppData\Local\Temp\quickflex-design-baseline-20260923\implementation-live-map.png`.
- More menu: `C:\Users\jamai\AppData\Local\Temp\quickflex-design-baseline-20260923\implementation-more-menu.png`.
- Zone editor: `C:\Users\jamai\AppData\Local\Temp\quickflex-design-baseline-20260923\implementation-zone-editor.png`.

Separate captures were used because these surfaces are modal or stateful and cannot all appear in one full-page frame.

## Primary interactions exercised

- Four bottom tabs and More-menu destinations.
- Zone selection and live map loading.
- Compact pin selection and detail expansion.
- Tip placement crosshair and cancellation without saving.
- Zone editor open, postal-code mode, and close without saving.
- Native-back priority for sheets and overlays.

## Technical verification

- 34 changed-surface tests passed in the final focused run.
- JavaScript syntax checks passed for the main shell, route notes, zone editor, map helper, and service worker.
- `git diff --check` passed.
- Browser console errors and warnings: none in the exercised live states.
- The broader repository test run is partially blocked by locally missing optional test dependencies (`@electric-sql/pglite` and `exceljs`); no affected-surface failure remains.

## Implementation checklist

- [x] Existing visual design preserved.
- [x] Bottom navigation changed to 매출노트 / 배송노트 / 구역노트 / 더보기.
- [x] Secondary destinations moved into More.
- [x] Route-note list, map, tip writing, search, selection, and zone editing flows updated.
- [x] Responsive mobile layout checked.
- [x] Keyboard and native-back paths retained.
- [x] No data was saved during QA.
- [x] No deployment was performed.

## 311CD322D agricultural-market follow-up

- Restored the previously separate agricultural-market route map as a dedicated virtual tip and map marker inside `311CD322D`.
- Preserved all 1,947 source cells across 35 rows and removed the source workbook's local filesystem path from the bundled asset.
- Verified the dedicated full-screen map at the local PWA URL: section shortcuts, 100% to 110% zoom, and a `매점` search returning three highlighted matches all worked.
- Confirmed the route code uses the code-font stack while Korean labels use Pretendard, and the top-bar label remains vertically centered.
- Confirmed the marker renders with the Phosphor warehouse glyph and opens only the dedicated market map.
- 32 focused route-note, market-map, font, release, and editor tests passed; JavaScript syntax checks and `git diff --check` also passed.
- No remote database write or deployment was performed.

final result: passed
