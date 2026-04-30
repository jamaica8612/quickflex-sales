# Agent Guide

This repo is worked on by Codex and Claude Code. Before changing code, read [docs/HARNESS.md](docs/HARNESS.md) and keep edits small.
Before deployment, schema, auth, or service-worker changes, read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
Before continuing handoff work, read [docs/WORKLOG.md](docs/WORKLOG.md).

Core rules:
- Start with `git status --short` and targeted `rg` searches.
- Keep `app.js` structured and patch targeted functions instead of rewriting broad sections.
- Preserve the Supabase database-first flow. Do not add browser-only persistence for production data.
- Keep OCR logic behind the harness in `supabase/functions/ocr-schedule/`.
- Validate browser JavaScript with `node --check app.js` and `node --check sw.js` before handoff.
- Match the user's conversational tone in a friendly, informal way; if a request is unrealistic, risky, or technically unsound, say so directly and clearly instead of softening the feedback too much.

