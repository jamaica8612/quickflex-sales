import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("styles.css");
const intro = read("intro.html");
const main = read("src/main.js");
const worker = read("sw.js");
const fontPath = "assets/fonts/OutfitLatinVariable.woff2";

test("Outfit is a bundled, unmodified WOFF2 font with its redistribution license", () => {
  const font = readFileSync(new URL(`../${fontPath}`, import.meta.url));
  assert.equal(font.subarray(0, 4).toString("ascii"), "wOF2");
  assert.equal(font.readUInt32BE(8), font.length, "WOFF2 declared size matches the file");
  assert.equal(createHash("sha256").update(font).digest("hex"),
    "6c18d579fd87c3776be068b762cbc83fde3acb543d49eabd3ade842eb987e887");
  const license = read("assets/fonts/Outfit-OFL.txt");
  assert.match(license, /Copyright 2021 The Outfit Project Authors/);
  assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
  assert.match(license, /PERMISSION & CONDITIONS[\s\S]*TERMINATION[\s\S]*DISCLAIMER/);
});

for (const [name, source] of [["main PWA", css], ["intro", intro]]) {
  test(`${name} uses Outfit only for English letters and digits`, () => {
    const faces = [...source.matchAll(/@font-face\s*\{([^}]+)\}/g)]
      .filter((match) => /font-family:\s*"Outfit"\s*;/.test(match[1]));
    assert.equal(faces.length, 1);
    const face = faces[0][1];
    assert.match(face, /font-weight:\s*100 900\s*;/);
    assert.match(face, /font-display:\s*swap\s*;/);
    assert.ok(face.includes(`url("./${fontPath}")`));
    const ranges = face.match(/unicode-range:\s*([^;]+);/)[1].split(",")
      .map((range) => {
        const match = range.trim().match(/^U\+([\dA-F]+)-([\dA-F]+)$/i);
        assert.ok(match, `explicit supported character range: ${range}`);
        return [Number.parseInt(match[1], 16), Number.parseInt(match[2], 16)];
      });
    const accepts = (character) => ranges.some(([start, end]) => {
      const code = character.codePointAt(0);
      return code >= start && code <= end;
    });
    const allowed = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    for (let code = 0; code <= 0x7f; code += 1) {
      const character = String.fromCodePoint(code);
      assert.equal(accepts(character), allowed.includes(character), `ASCII ${code}`);
    }
    for (const character of "가구시간배송완료원₩·,./-%") {
      assert.equal(accepts(character), false, `${character} must keep its existing font`);
    }
    assert.match(source, /--font-ui:\s*"Outfit", "Pretendard Variable", Pretendard,/);
  });
}

test("amounts, charts and print keep their Korean fallbacks after Outfit", () => {
  assert.match(css, /--font-numeric:\s*var\(--font-ui\);/);
  assert.match(css, /--font-amount:\s*"Outfit", "Wanted Sans Variable", var\(--font-ui\);/);
  assert.match(intro, /--font-numeric:\s*"Outfit", "Wanted Sans Variable", "Pretendard Variable", Pretendard,/);
  assert.match(css, /\.inspection-print-sheet\s*\{[^}]*font-family:\s*"Outfit", "Pretendard Variable", sans-serif;/);
  for (const size of [9, 10]) {
    assert.ok(main.includes(`ctx.font = "${size}px 'Outfit', 'Pretendard Variable', Pretendard, system-ui, sans-serif";`));
  }
});

test("the offline shell includes all font files and the current manifest version", () => {
  const shell = worker.match(/const SHELL_FILES = \[([\s\S]*?)\];/)[1];
  for (const path of [fontPath, "assets/fonts/PretendardVariable.woff2", "assets/fonts/WantedSansVariable.woff2"]) {
    assert.ok(shell.includes(`"./${path}"`));
    assert.ok(existsSync(new URL(`../${path}`, import.meta.url)));
  }
  const { version } = JSON.parse(read("manifest.webmanifest"));
  assert.ok(worker.includes(`quickflex-shell-v${version}`));
  assert.ok(shell.includes(`manifest.webmanifest?v=${version}`));
  assert.ok(intro.includes(`manifest.webmanifest?v=${version}`));
});
