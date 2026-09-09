# Existing manual sales followed by automatic work (2026-09-09)

Pre-fix source-based reproduction, not a claim that the user's production rows were inspected:

- Manual 120 parcels followed by automatic day work 40 parcels: the persisted manual
  route rows are unchanged, but `normalizeRecordShape` removes manual rows whenever an
  automatic work exists. The displayed total is 40 rather than 160.
- Automatic night 120 plus automatic day 40: both work receipts survive and the date
  projection totals 160. This case does not reproduce the missing baseline.
- The team finalizer and an identical retry preserve the manual row ID, price, quantity
  and timestamp. The legacy pre-team finalizer had a separate same-work baseline check;
  applying its assumptions to distinct night/day work would not be safe.

Manual route rows do not currently carry work-shift or work identity. Existing daily
sales overrides also represent full-day corrections, so automatically adding all old
manual rows could double-count corrected dates. The user confirmed separate manually
recorded night work followed by measured day work. Version 1.0.50 now preserves the manual
contribution in normal totals, edit drafts and administrator statistics; a full-day override
replaces both sources and never adds manual quantities twice. Original rows remain untouched.

Regression checks: manual120 + automatic40 = 160; a full-day correction to165 followed by
another20 = 185, including exact retries. Manual backup pay is added once when producing an
inclusive override unit. Grouped manual counts remain grouped; saving a corrected A/B-only
snapshot requires explicit per-route quantities rather than an invented split.

Fixtures: `tests/pwa-manual-baseline.test.mjs` and the manual-baseline
preservation / night-day cases in `tests/team-sales-sql.test.mjs` (local PGlite).

All 161 PWA/SQL tests and JavaScript syntax/diff checks passed. No server migration needed.
