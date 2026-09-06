import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("styles.css");
const intro = read("intro.html");
const main = read("src/main.js");
const worker = read("sw.js");

test("PWA restores Pretendard UI and Wanted Sans amounts without Outfit", () => {
  for (const source of [css, intro, main, worker]) assert.doesNotMatch(source, /Outfit/);
  assert.match(css, /--font-ui:\s*"Pretendard Variable", Pretendard,/);
  assert.match(css, /--font-numeric:\s*var\(--font-ui\);/);
  assert.match(css, /--font-amount:\s*"Wanted Sans Variable", var\(--font-ui\);/);
  assert.match(intro, /--font-ui:\s*"Pretendard Variable", Pretendard,/);
  assert.match(intro, /--font-numeric:\s*"Wanted Sans Variable", "Pretendard Variable", Pretendard,/);
  for (const size of [9, 10]) {
    assert.ok(main.includes(`ctx.font = "${size}px 'Pretendard Variable', Pretendard, system-ui, sans-serif";`));
  }
});

test("restored fonts remain bundled in the new offline shell", () => {
  const shell = worker.match(/const SHELL_FILES = \[([\s\S]*?)\];/)[1];
  for (const path of ["assets/fonts/PretendardVariable.woff2", "assets/fonts/WantedSansVariable.woff2"]) {
    assert.ok(shell.includes(`"./${path}"`));
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)));
  }
  const { version } = JSON.parse(read("manifest.webmanifest"));
  assert.ok(worker.includes(`quickflex-shell-v${version}`));
  assert.ok(shell.includes(`manifest.webmanifest?v=${version}`));
  assert.ok(intro.includes(`manifest.webmanifest?v=${version}`));
});
