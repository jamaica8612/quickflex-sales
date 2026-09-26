#!/usr/bin/env node
// Release helper for the QuickFlex PWA.
//
// Every release hand-edits the same handful of version strings (PWA `1.0.N`,
// the Android beta download links, and the independent `?v=N` cache-busting
// numbers on 구역노트 assets). This script automates that so a changed asset
// can never quietly keep its old `?v=` number again.
//
// Usage: see printUsage() below, or `node scripts/release.mjs --help`.
// Also documented in scripts/README.md.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();

function abs(...parts) {
  return path.resolve(ROOT, ...parts);
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function relPosix(absPath) {
  return toPosix(path.relative(ROOT, absPath));
}

function readText(absPath) {
  return readFileSync(absPath, "utf8");
}

function writeText(absPath, content) {
  writeFileSync(absPath, content);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Text-like extensions are hashed after normalizing CRLF -> LF, since this
// repo is checked out with CRLF on Windows (core.autocrlf) but git blobs
// (and a Linux/CI checkout) use LF; without normalizing, --check would see a
// "changed" hash on every platform switch even when nothing really changed.
const TEXT_EXTENSIONS = new Set([".js", ".css", ".html", ".json", ".svg", ".webmanifest", ".mjs", ".txt"]);

function hashAsset(absPath) {
  const buf = readFileSync(absPath);
  const ext = path.extname(absPath).toLowerCase();
  const data = TEXT_EXTENSIONS.has(ext) ? Buffer.from(buf.toString("utf8").replace(/\r\n/g, "\n"), "utf8") : buf;
  return createHash("sha256").update(data).digest("hex");
}

// Matches a quoted relative-path specifier immediately followed by an
// integer `?v=` query, e.g. "./styles/noah.css?v=6" or '../lib/x.js?v=3'.
// Deliberately does NOT match dotted PWA versions like `?v=1.0.101` (the
// `\d+` run can't cross the `.`), so PWA-version references never show up
// here as "assets".
const VERSION_REF_RE = /(['"])(\.[^'"?]*)\?v=(\d+)\1/g;

function listJsFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJsFilesRecursive(full));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

function listMjsFilesRecursive(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listMjsFilesRecursive(full));
    else if (entry.name.endsWith(".mjs")) out.push(full);
  }
  return out;
}

// Every file that may reference a `?v=`-versioned asset by a relative
// specifier. Resolution is always relative to the *referencing* file's own
// directory (like a real import/href would resolve), so the same canonical
// asset can be found under "./x", "../lib/x" or "./src/lib/x" depending on
// who's asking.
function listAssetScanFiles() {
  const fixed = ["sw.js", "index.html", "install.html", "intro.html", "route-share.html", "route-share.js"];
  const jsFiles = listJsFilesRecursive(abs("src")).map((p) => relPosix(p));
  const testFiles = listMjsFilesRecursive(abs("tests")).map((p) => relPosix(p));
  const all = [...fixed, ...jsFiles, ...testFiles];
  return [...new Set(all)].map((f) => abs(f)).filter((f) => existsSync(f));
}

// Reads sw.js's SHELL_FILES list and returns the canonical {relPath -> version}
// map. sw.js is treated as the source of truth for "the current version" of
// each asset, since it's what actually drives the PWA's own cache-busting.
function discoverAssetsFromSw() {
  const swPath = abs("sw.js");
  const content = readText(swPath);
  const assets = new Map();
  for (const match of content.matchAll(VERSION_REF_RE)) {
    const [, , specifier, version] = match;
    const resolvedAbs = path.resolve(ROOT, specifier);
    const rel = relPosix(resolvedAbs);
    if (assets.has(rel) && assets.get(rel) !== version) {
      throw new Error(`sw.js lists ${rel} with two different versions (?v=${assets.get(rel)} and ?v=${version}).`);
    }
    assets.set(rel, version);
  }
  return assets;
}

// Scans every file in listAssetScanFiles() for versioned references and
// resolves each one to the canonical asset path it points at.
// Returns Map<relAssetPath, Array<{ file: absPath, version: string }>>.
function scanOccurrences() {
  const occurrences = new Map();
  for (const file of listAssetScanFiles()) {
    const dir = path.dirname(file);
    const content = readText(file);
    for (const match of content.matchAll(VERSION_REF_RE)) {
      const [, , specifier, version] = match;
      const resolvedAbs = path.resolve(dir, specifier);
      if (!existsSync(resolvedAbs)) continue; // not a real project file from this file's perspective
      const rel = relPosix(resolvedAbs);
      if (!occurrences.has(rel)) occurrences.set(rel, []);
      occurrences.get(rel).push({ file, version });
    }
  }
  return occurrences;
}

// ---------------------------------------------------------------------------
// PWA version bump (`--pwa 1.0.102`)
// ---------------------------------------------------------------------------

const PWA_QUERY_FILES = ["index.html", "install.html", "intro.html", "route-share.html", "sw.js", "src/main.js"];

function replaceLiteralAll(absPath, search, replace, { required = true } = {}) {
  const content = readText(absPath);
  const parts = content.split(search);
  const count = parts.length - 1;
  if (required && count === 0) {
    throw new Error(`Expected to find ${JSON.stringify(search)} in ${relPosix(absPath)}, but it wasn't there.`);
  }
  if (count > 0) writeText(absPath, parts.join(replace));
  return count;
}

function bumpPwaVersion(newVersion) {
  if (!/^\d+\.\d+\.\d+$/.test(newVersion)) {
    throw new Error(`--pwa expects a version like 1.0.102, got ${JSON.stringify(newVersion)}.`);
  }
  const manifestPath = abs("manifest.webmanifest");
  const manifestMatch = readText(manifestPath).match(/"version":\s*"([0-9][0-9.]*)"/);
  if (!manifestMatch) throw new Error("Could not find a \"version\" field in manifest.webmanifest.");
  const oldVersion = manifestMatch[1];

  if (oldVersion === newVersion) {
    console.log(`PWA version is already ${newVersion}; nothing to do.`);
    return null;
  }

  const summary = [];
  summary.push({
    file: "manifest.webmanifest",
    count: replaceLiteralAll(manifestPath, `"version": "${oldVersion}"`, `"version": "${newVersion}"`),
  });
  for (const rel of PWA_QUERY_FILES) {
    const count = replaceLiteralAll(abs(rel), `?v=${oldVersion}`, `?v=${newVersion}`);
    summary.push({ file: rel, count });
  }
  // sw.js CACHE_NAME embeds the bare version (no "="), e.g. "...-v1.0.101-...".
  summary.push({
    file: "sw.js (CACHE_NAME)",
    count: replaceLiteralAll(abs("sw.js"), `v${oldVersion}`, `v${newVersion}`),
  });
  summary.push({
    file: "tests/pwa-sales-override.test.mjs",
    count: replaceLiteralAll(abs("tests/pwa-sales-override.test.mjs"), `"${oldVersion}"`, `"${newVersion}"`),
  });
  return { oldVersion, newVersion, summary };
}

// ---------------------------------------------------------------------------
// Android beta version bump (`--android 1.28`)
// ---------------------------------------------------------------------------

const ANDROID_FILES = ["index.html", "install.html", "tests/pwa-sales-override.test.mjs"];

function bumpAndroidVersion(newVersion) {
  if (!/^\d+\.\d+$/.test(newVersion)) {
    throw new Error(`--android expects a version like 1.28, got ${JSON.stringify(newVersion)}.`);
  }
  const installContent = readText(abs("install.html"));
  const installMatch = installContent.match(/android-beta-([0-9]+\.[0-9]+)/);
  if (!installMatch) throw new Error("Could not find an android-beta-X.YY reference in install.html.");
  const oldVersion = installMatch[1];

  if (oldVersion === newVersion) {
    console.log(`Android beta version is already ${newVersion}; nothing to do.`);
    return null;
  }

  const regex = new RegExp(`(Beta |android-beta-|flexnote-beta-)${escapeRegExp(oldVersion)}`, "g");
  const summary = [];
  for (const rel of ANDROID_FILES) {
    const absPath = abs(rel);
    let count = 0;
    const content = readText(absPath).replace(regex, (_full, prefix) => {
      count += 1;
      return `${prefix}${newVersion}`;
    });
    if (count === 0) {
      throw new Error(`Found no "Beta ${oldVersion}" / "android-beta-${oldVersion}" / "flexnote-beta-${oldVersion}" text in ${rel}.`);
    }
    writeText(absPath, content);
    summary.push({ file: rel, count });
  }
  return { oldVersion, newVersion, summary };
}

// ---------------------------------------------------------------------------
// Asset (`?v=N`) version tracking: --init-assets / --check / --bump-assets
// ---------------------------------------------------------------------------

const ASSET_VERSIONS_PATH = () => abs("release", "asset-versions.json");

function loadAssetVersions() {
  const p = ASSET_VERSIONS_PATH();
  if (!existsSync(p)) return null;
  return JSON.parse(readText(p));
}

function writeAssetVersions(assetsMap) {
  const p = ASSET_VERSIONS_PATH();
  mkdirSync(path.dirname(p), { recursive: true });
  const assets = {};
  for (const [relPath, version] of [...assetsMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    assets[relPath] = { version, sha256: hashAsset(abs(relPath)) };
  }
  const payload = { generatedAt: new Date().toISOString(), assets };
  writeText(p, `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

function cmdInitAssets() {
  const assets = discoverAssetsFromSw();
  const payload = writeAssetVersions(assets);
  console.log(`Wrote release/asset-versions.json with ${Object.keys(payload.assets).length} tracked assets.`);
}

function cmdCheck() {
  const problems = [];
  const stored = loadAssetVersions();
  if (!stored) {
    console.error("release/asset-versions.json is missing. Run `node scripts/release.mjs --init-assets` first.");
    process.exitCode = 1;
    return;
  }
  const swAssets = discoverAssetsFromSw();
  const occurrences = scanOccurrences();

  // 1) Every reference to a tracked asset must use the same version sw.js does.
  for (const [relPath, canonicalVersion] of swAssets) {
    for (const ref of occurrences.get(relPath) || []) {
      if (ref.version !== canonicalVersion) {
        problems.push(
          `${relPosix(ref.file)} references ${relPath} as ?v=${ref.version}, but sw.js has ?v=${canonicalVersion} ` +
            `(같은 자산을 서로 다른 버전으로 참조하고 있습니다).`,
        );
      }
    }
  }

  // 2) Content changed but the recorded version didn't move.
  for (const [relPath, info] of Object.entries(stored.assets || {})) {
    const absPath = abs(relPath);
    if (!existsSync(absPath)) {
      problems.push(`${relPath} no longer exists (있던 자산이 없어졌습니다) — remove it from asset-versions.json.`);
      continue;
    }
    const currentVersion = swAssets.get(relPath);
    if (currentVersion === undefined) {
      problems.push(`${relPath} is no longer referenced from sw.js — remove it from asset-versions.json.`);
      continue;
    }
    const currentHash = hashAsset(absPath);
    if (currentHash !== info.sha256 && currentVersion === info.version) {
      problems.push(
        `${relPath} 내용이 바뀌었지만 버전(?v=${info.version})이 그대로입니다 — content changed without a version bump. ` +
          `Run \`node scripts/release.mjs --bump-assets\`.`,
      );
    }
  }

  // 3) New assets that were added but never recorded.
  for (const relPath of swAssets.keys()) {
    if (!stored.assets?.[relPath]) {
      problems.push(`${relPath} is referenced from sw.js but missing from asset-versions.json — run --init-assets or --bump-assets.`);
    }
  }

  if (problems.length) {
    console.error(`release --check failed (${problems.length}):`);
    for (const p of problems) console.error(` - ${p}`);
    process.exitCode = 1;
    return;
  }
  console.log(`release --check passed (${swAssets.size} tracked assets, all consistent).`);
}

function cmdBumpAssets() {
  const stored = loadAssetVersions();
  if (!stored) {
    throw new Error("release/asset-versions.json is missing. Run --init-assets first.");
  }
  const storedAssets = stored.assets || {};
  const versions = discoverAssetsFromSw();
  const bumped = new Set();
  const log = [];

  let changed = true;
  let iterations = 0;
  while (changed && iterations < 25) {
    changed = false;
    iterations += 1;
    for (const relPath of [...versions.keys()].sort()) {
      if (bumped.has(relPath)) continue;
      const absPath = abs(relPath);
      if (!existsSync(absPath)) continue;
      const baseline = storedAssets[relPath]?.sha256;
      if (baseline === undefined) continue; // newly-added asset: nothing to bump, just record it later
      const currentHash = hashAsset(absPath);
      if (currentHash === baseline) continue; // unchanged

      const oldVersion = versions.get(relPath);
      const newVersion = String(Number(oldVersion) + 1);
      let replacements = 0;
      for (const file of listAssetScanFiles()) {
        const dir = path.dirname(file);
        const content = readText(file);
        let fileChanged = false;
        const nextContent = content.replace(VERSION_REF_RE, (full, quote, specifier, version) => {
          if (version !== oldVersion) return full;
          const resolvedAbs = path.resolve(dir, specifier);
          if (!existsSync(resolvedAbs) || relPosix(resolvedAbs) !== relPath) return full;
          fileChanged = true;
          replacements += 1;
          return `${quote}${specifier}?v=${newVersion}${quote}`;
        });
        if (fileChanged) writeText(file, nextContent);
      }
      versions.set(relPath, newVersion);
      bumped.add(relPath);
      log.push({ relPath, oldVersion, newVersion, replacements });
      changed = true;
    }
  }
  if (iterations >= 25 && changed) {
    throw new Error("Asset version cascade did not stabilize after 25 passes; check for a reference cycle.");
  }

  // Re-discover from sw.js (now updated) and record fresh hashes for everything.
  const finalVersions = discoverAssetsFromSw();
  const payload = writeAssetVersions(finalVersions);
  return { log, trackedCount: Object.keys(payload.assets).length };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`QuickFlex release helper

  node scripts/release.mjs --pwa 1.0.102 [--android 1.28]
      Updates every hand-edited PWA version string (index.html, install.html,
      intro.html, route-share.html, manifest.webmanifest, sw.js, src/main.js,
      tests/pwa-sales-override.test.mjs). Add --android to also bump the
      Android beta download links/labels in index.html, install.html and
      that same test.

  node scripts/release.mjs --check
      Verifies every ?v=N-versioned 구역노트/asset reference is internally
      consistent, and fails if a tracked asset's file content changed
      without its ?v= number moving. Reads release/asset-versions.json.

  node scripts/release.mjs --bump-assets
      Bumps the ?v= number of every asset whose content changed since the
      last release/asset-versions.json snapshot, cascades the new number
      into every importer (and sw.js), and repeats until nothing further
      changes (an importer's own file changes when its import string does).

  node scripts/release.mjs --init-assets
      (Re)generates release/asset-versions.json from the current tree. Use
      this once to bootstrap, or to accept the current state as the new
      baseline after resolving a --check failure by hand.
`);
}

function main() {
  const args = process.argv.slice(2);
  try {
    if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
      printUsage();
      return;
    }
    if (args.includes("--check")) return cmdCheck();
    if (args.includes("--init-assets")) return cmdInitAssets();
    if (args.includes("--bump-assets")) {
      const { log, trackedCount } = cmdBumpAssets();
      if (log.length === 0) {
        console.log(`No changed assets. release/asset-versions.json refreshed (${trackedCount} tracked).`);
      } else {
        for (const entry of log) {
          console.log(`${entry.relPath}: ?v=${entry.oldVersion} -> ?v=${entry.newVersion} (${entry.replacements} reference(s) updated)`);
        }
        console.log(`release/asset-versions.json refreshed (${trackedCount} tracked).`);
      }
      return;
    }

    const pwaIndex = args.indexOf("--pwa");
    if (pwaIndex !== -1) {
      const newPwa = args[pwaIndex + 1];
      const pwaResult = bumpPwaVersion(newPwa);
      if (pwaResult) {
        console.log(`PWA version: ${pwaResult.oldVersion} -> ${pwaResult.newVersion}`);
        for (const s of pwaResult.summary) console.log(`  ${s.file}: ${s.count} occurrence(s)`);
      }
      const androidIndex = args.indexOf("--android");
      if (androidIndex !== -1) {
        const newAndroid = args[androidIndex + 1];
        const androidResult = bumpAndroidVersion(newAndroid);
        if (androidResult) {
          console.log(`Android beta: ${androidResult.oldVersion} -> ${androidResult.newVersion}`);
          for (const s of androidResult.summary) console.log(`  ${s.file}: ${s.count} occurrence(s)`);
        }
      }
      return;
    }

    printUsage();
    process.exitCode = 1;
  } catch (err) {
    console.error(`release.mjs error: ${err.message}`);
    process.exitCode = 1;
  }
}

const isMain = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] || "").href;
  } catch {
    return false;
  }
})();
if (isMain) main();

export {
  bumpPwaVersion,
  bumpAndroidVersion,
  discoverAssetsFromSw,
  scanOccurrences,
  cmdCheck,
  cmdBumpAssets,
  cmdInitAssets,
  hashAsset,
};
