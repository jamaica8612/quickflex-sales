import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("styles.css");
const startup = read("styles/startup.css");
const intro = read("intro.html");
const install = read("install.html");
const privacy = read("privacy.html");
const accountDeletion = read("account-deletion.html");
const main = read("src/main.js");
const worker = read("sw.js");

test("PWA uses Pretendard for Korean while preserving numeric and code fonts", () => {
  for (const source of [css, intro, main, worker]) assert.doesNotMatch(source, /Outfit/);
  assert.match(css, /--font-ui:\s*"Pretendard Variable", Pretendard,/);
  assert.match(css, /--font-numeric:\s*"Archivo", "Pretendard Variable", Pretendard,/);
  assert.match(css, /--font-amount:\s*"Archivo", "Pretendard Variable", Pretendard,/);
  assert.match(css, /--font-code:\s*"JetBrains Mono", "Pretendard Variable", Pretendard,/);
  assert.match(startup, /font-family:"Pretendard Variable",Pretendard,sans-serif/);
  for (const page of [install, privacy, accountDeletion]) {
    assert.match(page, /font-family: "Pretendard Variable"/);
    assert.doesNotMatch(page, /IBM Plex Sans KR/);
  }
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
