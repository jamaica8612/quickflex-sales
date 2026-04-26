# Agent Guide

This repo is worked on by Codex and Claude Code. Before changing code, read [docs/HARNESS.md](docs/HARNESS.md) and keep edits small.

Core rules:
- Start with `git status --short` and targeted `rg` searches.
- Do not reformat `app.js`; it is intentionally compact and creates noisy diffs.
- Preserve the Supabase database-first flow. Do not add browser-only persistence for production data.
- Keep OCR logic behind the harness in `supabase/functions/ocr-schedule/`.
- Validate browser JavaScript with `node --check app.js` before handoff.

