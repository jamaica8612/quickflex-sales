# scripts/release.mjs

Plain Node (no dependencies) helper that automates the hand-edited strings in
a QuickFlex PWA release: the `1.0.N` PWA version, the Android beta download
links, and the independent `?v=N` cache-busting numbers on 구역노트 (route
notes) and other shell assets.

## Bumping the PWA version

```
node scripts/release.mjs --pwa 1.0.102
node scripts/release.mjs --pwa 1.0.102 --android 1.28
```

Updates every occurrence of the current PWA version string in:
`index.html`, `install.html`, `intro.html`, `route-share.html`,
`manifest.webmanifest` (`"version"`), `sw.js` (`CACHE_NAME` and its `?v=`
entries), `src/main.js`, and `tests/pwa-sales-override.test.mjs`. The current
version is read from `manifest.webmanifest`, so you never type it twice.

Adding `--android 1.28` also rewrites the Android beta download links and
"Beta X.YY" labels in `index.html`, `install.html`, and
`tests/pwa-sales-override.test.mjs`. The current Android version is detected
from `install.html`.

Every replacement is verified: if an expected string isn't found in a file
(drift — someone renamed something, or a file moved), the script fails
loudly instead of silently skipping it. Running the same version twice is a
harmless no-op.

This command never touches the independent `?v=N` asset versions below.

## Keeping 구역노트/asset `?v=` numbers honest

Several JS/CSS files are cache-busted independently of the PWA version (e.g.
`route-notes.js?v=3`, `route-note-map.js?v=10`, `route-notes.css?v=10`).
Historically these were bumped by hand and it was easy to change a file and
forget to bump (or cascade) its number — "only caught by hand" after the
fact.

`release/asset-versions.json` is a committed snapshot mapping every such
asset (as listed in `sw.js`'s `SHELL_FILES`) to its current `{ version,
sha256 }`.

```
node scripts/release.mjs --check
```

Recomputes every tracked asset's hash and fails with a clear message when:
- a file's content changed but its `?v=` number didn't move, or
- two files reference the same asset with two different `?v=` numbers
  (e.g. `sw.js` says `?v=4` but an importer still says `?v=3`), or
- an asset was added to `sw.js` but never recorded, or one was removed but
  is still recorded.

Run this in CI / before opening a release PR.

```
node scripts/release.mjs --bump-assets
```

Bumps the `?v=` number of every asset whose content changed since the last
snapshot, and cascades the new number into every place that imports it
(`sw.js`, the root HTML pages, `route-share.js`, everything under `src/`,
and `tests/`). Because rewriting an importer's own import string changes
*that file's* content too, and that file may itself be a tracked asset, the
cascade repeats until nothing further changes (an asset can only bump once
per run; the loop has a safety cap at 25 passes). It finishes by recomputing
every hash and rewriting `release/asset-versions.json`.

```
node scripts/release.mjs --init-assets
```

(Re)generates `release/asset-versions.json` from the current tree — how the
file was first created, and also how to reset the baseline after resolving
a `--check` failure by hand.

## Tests

`tests/release-script.test.mjs` exercises all four commands against a
throwaway temp-directory fixture (`node:fs.mkdtempSync`) that mirrors the
real project's file layout in miniature — it never touches the real repo
tree. Run it along with everything else via `node --test tests/*.test.mjs`.
