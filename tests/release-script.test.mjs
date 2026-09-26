import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// These tests exercise scripts/release.mjs against a throwaway temp-directory
// fixture that mirrors the shape of the real PWA (a handful of hand-edited
// version strings plus a small "구역노트-style" ?v=N asset dependency graph).
// They never touch the real repo tree.

const RELEASE_SCRIPT = new URL("../scripts/release.mjs", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

function write(root, relPath, content) {
  const full = path.join(root, ...relPath.split("/"));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function read(root, relPath) {
  return readFileSync(path.join(root, ...relPath.split("/")), "utf8");
}

function run(root, args) {
  const result = spawnSync(process.execPath, [RELEASE_SCRIPT, ...args], { cwd: root, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

// Builds a minimal fixture with:
//  - the standard hand-edited PWA version strings (1.0.101) across the same
//    file set the real project uses
//  - the standard Android beta strings (Beta 1.27 / android-beta-1.27 / flexnote-beta-1.27)
//  - a small ?v=N asset graph: styles/foo.css (v2, unreferenced elsewhere),
//    src/lib/foo.js (v3) imported by sw.js, route-share.js and src/ui/bar.js;
//    src/ui/bar.js (v5) imported by sw.js and src/main.js.
function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "release-script-"));

  write(root, "manifest.webmanifest", JSON.stringify({ name: "Fixture", short_name: "Fixture", version: "1.0.101" }, null, 2) + "\n");

  write(
    root,
    "index.html",
    [
      "<!doctype html>",
      "<html><head>",
      '<link rel="manifest" href="./manifest.webmanifest?v=1.0.101" />',
      '<link rel="stylesheet" href="./styles.css?v=1.0.101" />',
      '<link rel="stylesheet" href="./styles/foo.css?v=2" />',
      "</head><body>",
      '<p class="app-version">Fixture · Beta 1.27</p>',
      '<a href="https://example.com/releases/download/android-beta-1.27/flexnote-beta-1.27.apk">Beta 1.27 APK 받기</a>',
      '<a href="https://example.com/releases/tag/android-beta-1.27">릴리스 정보 보기</a>',
      '<script type="module" src="./src/main.js?v=1.0.101"></script>',
      "</body></html>",
      "",
    ].join("\n"),
  );

  write(
    root,
    "install.html",
    [
      "<!doctype html>",
      "<html><head>",
      '<meta name="description" content="Fixture Beta 1.27 APK 설치 안내" />',
      '<link rel="manifest" href="./manifest.webmanifest?v=1.0.101" />',
      "</head><body>",
      '<span class="eyebrow">Android · Beta 1.27</span>',
      '<a href="https://example.com/releases/download/android-beta-1.27/flexnote-beta-1.27.apk">Beta 1.27 APK 받기</a>',
      '<a href="https://example.com/releases/tag/android-beta-1.27">릴리스 정보</a>',
      "</body></html>",
      "",
    ].join("\n"),
  );

  write(
    root,
    "intro.html",
    '<!doctype html><html><head><link rel="manifest" href="./manifest.webmanifest?v=1.0.101" /></head><body></body></html>\n',
  );

  write(
    root,
    "route-share.html",
    '<!doctype html><html><head></head><body><script type="module" src="./route-share.js?v=1.0.101"></script></body></html>\n',
  );

  write(root, "route-share.js", 'import { helper } from "./src/lib/foo.js?v=3";\nconsole.log(helper());\n');

  write(
    root,
    "sw.js",
    [
      'const CACHE_NAME = "fixture-shell-v1.0.101-x";',
      "const SHELL_FILES = [",
      '  "./src/lib/foo.js?v=3",',
      '  "./src/ui/bar.js?v=5",',
      '  "./styles/foo.css?v=2",',
      '  "./route-share.js?v=1.0.101",',
      '  "./src/main.js?v=1.0.101",',
      '  "./manifest.webmanifest?v=1.0.101",',
      "];",
      "",
    ].join("\n"),
  );

  write(
    root,
    "src/main.js",
    ['import { bar } from "./ui/bar.js?v=5";', 'import { koreanDateKey } from "./lib/work-date.js?v=1.0.101";', "console.log(bar, koreanDateKey);", ""].join("\n"),
  );

  write(root, "src/lib/foo.js", 'export function helper() { return "foo-v1"; }\n');
  write(root, "src/ui/bar.js", ['import { helper } from "../lib/foo.js?v=3";', "export function bar() { return helper(); }", ""].join("\n"));
  write(root, "styles/foo.css", ".foo { color: red; }\n");
  write(root, "styles.css", "body { margin: 0; }\n");

  write(
    root,
    "tests/pwa-sales-override.test.mjs",
    [
      "// fixture stand-in for the real project's release-string assertions",
      'const releaseVersion = "1.0.101";',
      'const html = "Fixture \\u00b7 Beta 1.27 android-beta-1.27/flexnote-beta-1.27.apk";',
      "if (releaseVersion !== \"1.0.101\") throw new Error('mismatch');",
      "",
    ].join("\n"),
  );

  return root;
}

test("--init-assets records every ?v=N asset referenced from sw.js", () => {
  const root = makeFixture();
  try {
    const result = run(root, ["--init-assets"]);
    assert.equal(result.status, 0, result.stderr);
    const stored = JSON.parse(read(root, "release/asset-versions.json"));
    assert.deepEqual(Object.keys(stored.assets).sort(), ["src/lib/foo.js", "src/ui/bar.js", "styles/foo.css"]);
    assert.equal(stored.assets["src/lib/foo.js"].version, "3");
    assert.equal(stored.assets["src/ui/bar.js"].version, "5");
    assert.match(stored.assets["src/lib/foo.js"].sha256, /^[0-9a-f]{64}$/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--check passes right after --init-assets", () => {
  const root = makeFixture();
  try {
    run(root, ["--init-assets"]);
    const result = run(root, ["--check"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /passed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--check fails without release/asset-versions.json", () => {
  const root = makeFixture();
  try {
    const result = run(root, ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--init-assets/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--check catches a changed asset that kept its old ?v= number", () => {
  const root = makeFixture();
  try {
    run(root, ["--init-assets"]);
    // Edit foo.js's content without touching any ?v= reference anywhere.
    write(root, "src/lib/foo.js", 'export function helper() { return "foo-v2, changed but not rebumped"; }\n');
    const result = run(root, ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src\/lib\/foo\.js/);
    assert.match(result.stderr, /bump-assets/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--check catches an importer that references a stale version of an asset", () => {
  const root = makeFixture();
  try {
    run(root, ["--init-assets"]);
    // route-share.js is not itself a tracked asset (only referenced via the
    // dotted PWA version), so hand-editing its foo.js reference isolates the
    // "importers must agree with sw.js" rule from the content-hash rule.
    write(root, "route-share.js", 'import { helper } from "./src/lib/foo.js?v=2";\nconsole.log(helper());\n');
    const result = run(root, ["--check"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /route-share\.js/);
    assert.match(result.stderr, /foo\.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--bump-assets bumps a changed asset, cascades to importers, and repeats until stable", () => {
  const root = makeFixture();
  try {
    run(root, ["--init-assets"]);
    // Change foo.js's content only. bar.js imports foo.js, so once the
    // cascade rewrites bar.js's own import string, bar.js's *own* content
    // changes too and it must also get a fresh version (second iteration).
    write(root, "src/lib/foo.js", 'export function helper() { return "foo-v2"; }\n');

    const result = run(root, ["--bump-assets"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /src\/lib\/foo\.js: \?v=3 -> \?v=4/);
    assert.match(result.stdout, /src\/ui\/bar\.js: \?v=5 -> \?v=6/);

    // foo.js's new version cascaded into every importer.
    assert.match(read(root, "sw.js"), /src\/lib\/foo\.js\?v=4/);
    assert.match(read(root, "route-share.js"), /src\/lib\/foo\.js\?v=4/);
    assert.match(read(root, "src/ui/bar.js"), /lib\/foo\.js\?v=4/);

    // bar.js's own content changed (its import line), so it was re-bumped
    // too, and that new version cascaded into every *its* importers.
    assert.match(read(root, "sw.js"), /src\/ui\/bar\.js\?v=6/);
    assert.match(read(root, "src/main.js"), /ui\/bar\.js\?v=6/);

    // styles/foo.css never changed, so it must keep its original version.
    assert.match(read(root, "sw.js"), /styles\/foo\.css\?v=2/);
    assert.match(read(root, "index.html"), /styles\/foo\.css\?v=2/);

    // The snapshot was refreshed, so re-running --check is clean again.
    const check = run(root, ["--check"]);
    assert.equal(check.status, 0, check.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--bump-assets is a no-op when nothing changed", () => {
  const root = makeFixture();
  try {
    run(root, ["--init-assets"]);
    const result = run(root, ["--bump-assets"]);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No changed assets/);
    assert.match(read(root, "sw.js"), /src\/lib\/foo\.js\?v=3/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--pwa updates every hand-edited PWA version string and is idempotent", () => {
  const root = makeFixture();
  try {
    const result = run(root, ["--pwa", "1.0.102"]);
    assert.equal(result.status, 0, result.stderr);

    assert.match(read(root, "manifest.webmanifest"), /"version": "1\.0\.102"/);
    assert.match(read(root, "index.html"), /manifest\.webmanifest\?v=1\.0\.102/);
    assert.match(read(root, "index.html"), /styles\.css\?v=1\.0\.102/);
    assert.match(read(root, "index.html"), /src\/main\.js\?v=1\.0\.102/);
    assert.match(read(root, "install.html"), /manifest\.webmanifest\?v=1\.0\.102/);
    assert.match(read(root, "intro.html"), /manifest\.webmanifest\?v=1\.0\.102/);
    assert.match(read(root, "route-share.html"), /route-share\.js\?v=1\.0\.102/);
    assert.match(read(root, "sw.js"), /shell-v1\.0\.102-x/);
    assert.match(read(root, "sw.js"), /route-share\.js\?v=1\.0\.102/);
    assert.match(read(root, "sw.js"), /manifest\.webmanifest\?v=1\.0\.102/);
    assert.match(read(root, "src/main.js"), /work-date\.js\?v=1\.0\.102/);
    assert.match(read(root, "tests/pwa-sales-override.test.mjs"), /"1\.0\.102"/);

    // Untouched: the independent ?v=N asset versions.
    assert.match(read(root, "sw.js"), /src\/lib\/foo\.js\?v=3/);

    const again = run(root, ["--pwa", "1.0.102"]);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /already/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--android updates the beta download links and labels", () => {
  const root = makeFixture();
  try {
    const result = run(root, ["--pwa", "1.0.102", "--android", "1.28"]);
    assert.equal(result.status, 0, result.stderr);

    assert.match(read(root, "index.html"), /Fixture · Beta 1\.28/);
    assert.match(read(root, "index.html"), /android-beta-1\.28\/flexnote-beta-1\.28\.apk/);
    assert.match(read(root, "index.html"), /releases\/tag\/android-beta-1\.28/);
    assert.match(read(root, "install.html"), /Android · Beta 1\.28/);
    assert.match(read(root, "install.html"), /android-beta-1\.28\/flexnote-beta-1\.28\.apk/);
    assert.match(read(root, "tests/pwa-sales-override.test.mjs"), /Beta 1\.28 android-beta-1\.28\/flexnote-beta-1\.28\.apk/);

    // Old beta strings are gone.
    assert.doesNotMatch(read(root, "index.html"), /Beta 1\.27/);
    assert.doesNotMatch(read(root, "install.html"), /Beta 1\.27/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--pwa fails clearly when a version string is missing from an expected file", () => {
  const root = makeFixture();
  try {
    // Simulate drift: someone hand-edited src/main.js and it no longer
    // carries the PWA version query string at all.
    write(root, "src/main.js", 'import { bar } from "./ui/bar.js?v=5";\nconsole.log(bar);\n');
    const result = run(root, ["--pwa", "1.0.102"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /src\/main\.js/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--help / no args prints usage without error", () => {
  const root = makeFixture();
  try {
    const result = run(root, []);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /release\.mjs/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
