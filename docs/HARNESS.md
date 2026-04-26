# QuickFlex Sales Harness

This file is the shared working contract for Codex, Claude Code, and future agents. Its purpose is to save tokens, avoid duplicated exploration, and keep changes production-minded.

## Map

- `index.html`: app shell.
- `styles.css`: mobile-first visual system.
- `app.js`: main browser app. It is compact; inspect targeted functions only.
- `supabase-schema.sql`: database schema.
- `supabase/functions/ocr-schedule/index.ts`: Supabase Edge Function HTTP entrypoint.
- `supabase/functions/ocr-schedule/harness.ts`: OCR provider selection and normalization.
- `supabase/functions/ocr-schedule/providers/`: OCR model providers.
- `supabase/functions/ocr-schedule/prompt.ts`: OCR prompt.
- `supabase/functions/ocr-schedule/types.ts`: OCR contracts.
- `supabase/functions/ocr-schedule/utils.ts`: shared OCR helpers.

## Data Rules

- Route rates live in `quickflex_route_rates`.
- Day records live in `quickflex_day_records`.
- Route item snapshots live in `quickflex_day_route_items`.
- Historical records must keep the unit price used on that date, even if the route rate changes later.
- Backup bonus defaults to 30 won per delivery count, but the record screen may override it per day.
- Do not introduce localStorage as the source of truth for production data.

## Route Grouping

When multiple routes share the same three-digit prefix and the same unit price, show them as one input row.

Examples:
- `322A`, `322B`, `322C` with the same unit price should become one row.
- `319A`, `319B` with the same unit price should become one row.
- Internally, grouped routes can use `|` as a separator. Use existing formatting helpers for display.

## OCR Harness

The browser calls only the Edge Function. The Edge Function calls the provider harness.

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

