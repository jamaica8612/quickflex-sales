import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const admin = readFileSync(new URL("../src/ui/admin.js", import.meta.url), "utf8");
const stats = readFileSync(new URL("../src/ui/stats.js", import.meta.url), "utf8");
const ocr = readFileSync(new URL("../src/ui/ocr.js", import.meta.url), "utf8");

test("blocking overlays and the DB sheet expose modal semantics and start inert", () => {
  for (const id of ["setupOverlay", "authOverlay", "pendingOverlay"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*aria-hidden="true"[^>]*inert`));
  }
  assert.ok((html.match(/role="dialog" aria-modal="true" aria-labelledby=/g) || []).length >= 4);
  assert.match(html, /id="dbSheet"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-hidden="true"[^>]*inert/);
  assert.match(main, /function bindModalAccessibility\(\)[\s\S]*event\.key !== "Tab"[\s\S]*!layer\.contains\(document\.activeElement\)/);
  assert.match(main, /return \[el\.pendingOverlay, el\.authOverlay, el\.setupOverlay, el\.dbSheet\]/);
  assert.match(main, /function closeSheet\(\)[\s\S]*updateModalLayer\(el\.dbSheet, false\)/);
  assert.match(main, /showDeploymentConfigError\(\)[\s\S]*updateModalLayer\(el\.setupOverlay, true/);
});

test("login inputs have programmatic labels, names and assertive error regions", () => {
  assert.match(html, /<label for="authEmail">이메일<\/label>/);
  assert.match(html, /id="authEmail" name="email"[^>]*required/);
  assert.match(html, /<label for="authPassword">비밀번호<\/label>/);
  assert.match(html, /id="authPassword" name="password"[^>]*required/);
  assert.match(html, /id="authError"[^>]*role="alert"[^>]*aria-live="assertive"/);
  assert.match(html, /id="setupError"[^>]*role="alert"[^>]*aria-live="assertive"/);
});

test("controls publish their visual selection state to assistive technology", () => {
  assert.match(html, /id="homeOffToggle"[^>]*role="checkbox"[^>]*aria-checked="false"/);
  assert.match(main, /homeOffToggle\.setAttribute\("aria-checked"/);
  assert.match(main, /inspection-choice[\s\S]*aria-pressed=/);
  assert.match(stats, /setAttribute\("aria-selected"/);
  assert.match(stats, /panel\.hidden = !selected/);
  assert.match(admin, /\["ArrowLeft", "ArrowRight", "Home", "End"\]/);
  assert.match(main, /button\.disabled = navDisabled/);
  assert.match(main, /setAttribute\("aria-current", "page"\)/);
});

test("toasts announce errors assertively for long enough to read", () => {
  assert.match(main, /setAttribute\("role", isError \? "alert" : "status"\)/);
  assert.match(main, /setAttribute\("aria-live", isError \? "assertive" : "polite"\)/);
  assert.match(main, /isError \? 5500 : 3200/);
});

test("canvas content has text alternatives and signature has a keyboard path", () => {
  assert.match(html, /id="statsChart"[^>]*role="img"[^>]*aria-describedby="statsChartSummary"/);
  assert.match(main, /canvas\.setAttribute\("aria-label", chartSummary\)/);
  assert.match(html, /id="profileSignatureAlternative"[^>]*type="checkbox"/);
  assert.match(main, /createAccessibleSignatureData/);
  assert.match(main, /const signatureData = useAccessibleAlternative\s*\? createAccessibleSignatureData/);
  assert.match(main, /signature_data: signatureData/);
});

test("rate editing and OCR deletion use separate labelled buttons", () => {
  assert.match(main, /class="rate-chip-select"/);
  assert.doesNotMatch(main, /class="rate-chip"[^>]*role="button"[^>]*tabindex/);
  assert.match(main, /구역 삭제/);
  assert.match(main, /data-action="off"[\s\S]*aria-pressed=/);
  assert.match(ocr, /focusTarget\?\.focus\(\)/);
});

test("calendar cells announce date state and recorded content", () => {
  for (const token of ["valueLabel", "routeLabel", "inspectionLabel", "holidayName", "선택됨"]) {
    assert.match(main, new RegExp(token));
  }
  assert.match(main, /cell\.setAttribute\("aria-label", labels\.join\(" · "\)\)/);
  assert.match(main, /cell\.setAttribute\("aria-current", "date"\)/);
});
