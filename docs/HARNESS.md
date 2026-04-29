# QuickFlex Sales Harness

This file is the shared working contract for Codex, Claude Code, and future agents. Its purpose is to save tokens, avoid duplicated exploration, and keep changes production-minded.

## Map

- `index.html`: app shell.
- `styles.css`: mobile-first visual system.
- `src/main.js`: main browser app. Inspect targeted functions only.
- `app.js`: compatibility bootstrap for older script references.
- `supabase-schema.sql`: database schema.
- `supabase/functions/ocr-schedule/index.ts`: Supabase Edge Function HTTP entrypoint.
- `supabase/functions/ocr-schedule/harness.ts`: OCR provider selection and normalization.
- `supabase/functions/ocr-schedule/providers/`: OCR model providers.
- `supabase/functions/ocr-schedule/prompt.ts`: OCR prompt.
- `supabase/functions/ocr-schedule/types.ts`: OCR contracts.
- `supabase/functions/ocr-schedule/utils.ts`: shared OCR helpers.

## Data Rules

- Users are Supabase Auth users. Profile and driver settings live in `quickflex_profiles`.
- `quickflex_profiles.driver_type` is either `backup` or `fixed`.
- `backup` drivers can add many routes and use backup bonus.
- `fixed` drivers use `fixed_routes`, hide backup bonus, and should see only their assigned routes on the record screen.
- Route rates live in `quickflex_route_rates`.
- Route rate history is not used. Keep one current default unit price per Route in `quickflex_route_rates`.
- Day records live in `quickflex_day_records`.
- Route item snapshots live in `quickflex_day_route_items`.
- Historical records must keep the unit price used on that date, even if the route rate changes later.
- Backup bonus defaults to 30 won per delivery count, but the record screen may override it per day.
- Do not introduce localStorage as the source of truth for production data.
- localStorage may store only the Supabase project URL and anon key for the current browser.

## Auth and RLS

- All production data rows use `user_id = auth.uid()::text`.
- RLS must remain enabled on profile, rate, day, and item tables.
- The first created profile is bootstrapped as `admin` and `approved`.
- Later users start as `pending`; admins approve or block them.
- Users may edit their own display name, driver type, and fixed routes. They must not be able to approve themselves.
- Admins may read all users' rates, records, and route item snapshots for revenue review.
- Admin writes should stay limited to profile approval/type changes; do not let admins edit another driver's sales records from the admin dashboard.

## Route Grouping

When multiple routes share the same three-digit prefix and the same unit price, show them as one input row.

Examples:
- `322A`, `322B`, `322C` with the same unit price should become one row.
- `319A`, `319B` with the same unit price should become one row.
- Internally, grouped routes can use `|` as a separator. Use existing formatting helpers for display.

## OCR Harness

Schedule OCR runs as **client-side table segmentation + server-side Google Cloud Vision** for the cells that actually need OCR. The Edge Function (`supabase/functions/ocr-schedule`) supports two request modes:

- `mode: "cells"` (default browser path) — body carries `cells: [{ id, base64, mimeType }]`. Server calls Cloud Vision `images:annotate` (`TEXT_DETECTION`) in batches of up to 16 with `Promise.all`, returns `{ provider, results: [{ id, text, confidence }] }`.
- Default (no `mode`) — legacy full-image flow that calls the provider harness (Gemini, etc.).

Client rules (mobile memory safety + cost control):
- Always run OpenCV on a downscaled analysis canvas (max width ~900px); never on the original image.
- Wrap every `cv.Mat` in `try/finally` and `delete()` all intermediates (`gray`, `binary`, `horizontal`, `vertical`, `grid`, `contours`, `hierarchy`, etc.).
- Reuse a module-scoped analysis canvas and a single cell-crop canvas; do not `createElement` a canvas per cell.
- Validate the entered driver name client-side before sending anything to Cloud Vision (Vision is paid).
- OCR the name column once (one batch call), then OCR only the matched row's date cells (one batch call). Two round-trips total.
- Decide off-days client-side by average pixel color (pink/red) and skip OCR for those cells entirely.
- Yield to the UI between heavy stages (`requestIdleCallback` or `setTimeout 0`).
- Wrap stages with `console.time("detectTable" | "ocrNames" | "ocrSchedule")` for mobile profiling.

Server rules:
- Read the API key from `GOOGLE_CLOUD_VISION_API_KEY` (fallback `CLOUD_VISION_API_KEY`); never accept the key from the request body.
- Send `languageHints: ["ko", "en"]` and use `TEXT_DETECTION` (single line per cell).
- Per-batch failures must not crash the entire response; missing cells return `text: ""`.

Provider contract:

```ts
interface ScheduleOcrProvider {
  name: string;
  model: string;
  extractSchedule(input: OcrProviderInput): Promise<OcrProviderOutput>;
}
```

Rules:
- Add or change model-specific code only in `providers/`.
- Keep parsing cleanup in `utils.ts`.
- Keep prompt wording in `prompt.ts`.
- Keep the HTTP request and response shape stable unless the browser app also needs a coordinated change.
- Current default provider is Gemini. Optional secrets are `OCR_PROVIDER` and `GEMINI_MODEL`.
- The same Edge Function accepts `kind: "settlement"` for settlement-table OCR. It should extract delivery rows only and calculate default route-rate candidates on the browser side after user confirmation.

Deploy OCR after Edge Function changes:

```powershell
npx supabase functions deploy ocr-schedule
```

Useful secrets:

```powershell
npx supabase secrets set OCR_PROVIDER=gemini
npx supabase secrets set GEMINI_MODEL=gemini-2.5-flash
```

## Low-Token Workflow

1. Run `git status --short`.
2. Use `rg` to find the exact function or string.
3. Read the smallest useful slice.
4. Patch only the owned area.
5. Run focused checks.
6. Summarize changed files and remaining risks.

Avoid:
- Full-file rewrites of `app.js`.
- Large pasted logs.
- Reformat-only commits.
- Committing secrets, Supabase temp files, or logs.

## Checks

Browser app:

```powershell
node --check app.js
```

Diff hygiene:

```powershell
git diff --check
```

Before deployment, make sure GitHub Pages and Supabase Edge Functions are treated separately. Pushing frontend code does not redeploy the OCR function.

