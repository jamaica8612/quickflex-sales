import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("styles.css");
const intro = read("intro.html");
const main = read("src/main.js");
const worker = read("sw.js");

test("PWA follows the documented font system and preserves legacy intro fonts", () => {
  for (const source of [css, intro, main, worker]) assert.doesNotMatch(source, /Outfit/);
  assert.match(css, /--font-ui:\s*"IBM Plex Sans KR",/);
  assert.match(css, /--font-numeric:\s*"Archivo",/);
  assert.match(css, /--font-amount:\s*"Archivo",/);
  assert.match(css, /--font-code:\s*"JetBrains Mono",/);
  assert.match(intro, /--font-ui:\s*"Pretendard Variable", Pretendard,/);
  assert.match(intro, /--font-numeric:\s*"Wanted Sans Variable", "Pretendard Variable", Pretendard,/);
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
