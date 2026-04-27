# Claude Code Guide

Use the shared harness workflow in [docs/HARNESS.md](docs/HARNESS.md).
Before deployment, schema, auth, or service-worker changes, read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
Before continuing handoff work, read [docs/WORKLOG.md](docs/WORKLOG.md).

When working in this repo:
- Read only the functions you need instead of loading all of `app.js`.
- Prefer precise patches over broad rewrites.
- Keep route-rate history and daily records in Supabase.
- Keep OCR provider changes inside `supabase/functions/ocr-schedule/providers/`.
- After code changes, report the exact files changed and the checks run.

