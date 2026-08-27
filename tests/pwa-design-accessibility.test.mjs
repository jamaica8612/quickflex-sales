import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tagById(id) {
  const match = html.match(new RegExp(`<[^>]+\\bid="${escapeRegExp(id)}"[^>]*>`));
  assert.ok(match, `missing element #${id}`);
  return match[0];
}

function assertAttributes(id, attributes) {
  const tag = tagById(id);
  for (const [name, value] of Object.entries(attributes)) {
    if (value === true) {
      assert.match(tag, new RegExp(`(?:\\s|^)${escapeRegExp(name)}(?:\\s|>|=)`), `#${id} must have ${name}`);
    } else {
      assert.match(tag, new RegExp(`${escapeRegExp(name)}="${escapeRegExp(value)}"`), `#${id} must have ${name}="${value}"`);
    }
  }
}

function inlineScriptContaining(token) {
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) {
    if (match[1].includes(token)) return { source: match[1], index: match.index };
  }
  assert.fail(`missing inline script containing ${token}`);
}

function inlineStyleContaining(token) {
  for (const match of html.matchAll(/<style(?:\s[^>]*)?>([\s\S]*?)<\/style>/g)) {
    if (match[1].includes(token)) return { source: match[1], index: match.index };
  }
  assert.fail(`missing inline style containing ${token}`);
}

function extractFunctionDeclaration(source, name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${name}()`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail(`unterminated ${name}()`);
}

function extractCssBlock(marker) {
  const start = css.indexOf(marker);
  assert.notEqual(start, -1, `missing CSS block ${marker}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < css.length; index += 1) {
    if (css[index] === "{") depth += 1;
    if (css[index] === "}") depth -= 1;
    if (depth === 0) return css.slice(open + 1, index);
  }
  assert.fail(`unterminated CSS block ${marker}`);
}

function customProperties(block) {
  return Object.fromEntries([...block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1], match[2].trim()]));
}

function parseColor(value) {
  const color = value.trim();
  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const normalized = hex[1].length === 3 ? [...hex[1]].map((part) => part + part).join("") : hex[1];
    return {
      r: Number.parseInt(normalized.slice(0, 2), 16),
      g: Number.parseInt(normalized.slice(2, 4), 16),
      b: Number.parseInt(normalized.slice(4, 6), 16),
      a: 1,
    };
  }
  const rgb = color.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
  assert.ok(rgb, `unsupported color ${value}`);
  return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]), a: rgb[4] === undefined ? 1 : Number(rgb[4]) };
}

function composite(foreground, background) {
  const alpha = foreground.a ?? 1;
  return {
    r: foreground.r * alpha + background.r * (1 - alpha),
    g: foreground.g * alpha + background.g * (1 - alpha),
    b: foreground.b * alpha + background.b * (1 - alpha),
    a: 1,
  };
}

function luminance(color) {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrast(foreground, background) {
  const first = foreground.a < 1 ? composite(foreground, background) : foreground;
  const lighter = Math.max(luminance(first), luminance(background));
  const darker = Math.min(luminance(first), luminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function assertContrast(label, foreground, background, minimum) {
  const ratio = contrast(foreground, background);
  assert.ok(ratio >= minimum, `${label}: ${ratio.toFixed(3)}:1 is below ${minimum}:1`);
}

function leafCssRulesFor(selector) {
  const rules = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selectors = match[1].split(",").map((item) => item.trim());
    if (selectors.includes(selector)) rules.push(match[2]);
  }
  return rules;
}

function dimensionFloor(selector) {
  const declarations = leafCssRulesFor(selector).join("\n");
  const widthValues = [...declarations.matchAll(/(?:^|[;\s])(?:min-)?width\s*:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
  const heightValues = [...declarations.matchAll(/(?:^|[;\s])(?:min-)?height\s*:\s*([\d.]+)px/g)].map((match) => Number(match[1]));
  return {
    width: widthValues.length ? Math.max(...widthValues) : 0,
    height: heightValues.length ? Math.max(...heightValues) : 0,
  };
}

function hasMinimumHitTarget(selector, minimum = 44) {
  const direct = dimensionFloor(selector);
  if (direct.width >= minimum && direct.height >= minimum) return true;
  for (const pseudo of [`${selector}::before`, `${selector}::after`]) {
    const expanded = dimensionFloor(pseudo);
    if (expanded.width >= minimum && expanded.height >= minimum) return true;
    const declarations = leafCssRulesFor(pseudo).join("\n");
    const inset = declarations.match(/inset\s*:\s*-([\d.]+)px/);
    if (inset) {
      const growth = Number(inset[1]) * 2;
      if (direct.width + growth >= minimum && direct.height + growth >= minimum) return true;
    }
  }
  return false;
}

test("saved theme is applied before CSS and synchronized with browser chrome and body", () => {
  const bootstrap = inlineScriptContaining("quickflex-theme-default-dark-gold-v1");
  const stylesheetIndex = html.indexOf('<link rel="stylesheet"');
  assert.ok(bootstrap.index < stylesheetIndex, "theme bootstrap must precede the stylesheet");

  const initialThemeStyle = inlineStyleContaining("#0A0E17");
  assert.ok(initialThemeStyle.index > bootstrap.index, "initial theme paint CSS must follow the saved-theme bootstrap");
  assert.ok(initialThemeStyle.index < stylesheetIndex, "initial theme paint CSS must precede the external stylesheet");
  for (const selector of ['html[data-theme="dark"]', 'body[data-theme="dark"]', 'html[data-theme="light"]', 'body[data-theme="light"]']) {
    assert.ok(initialThemeStyle.source.includes(selector), `initial theme paint CSS is missing ${selector}`);
  }
  assert.match(initialThemeStyle.source, /html\[data-theme="dark"\][\s\S]*background\s*:\s*#0A0E17[\s\S]*color-scheme\s*:\s*dark/i);
  assert.match(initialThemeStyle.source, /html\[data-theme="light"\][\s\S]*background\s*:\s*#EAECEF[\s\S]*color-scheme\s*:\s*light/i);

  const runBootstrap = (stored = {}) => {
    const values = new Map(Object.entries(stored));
    const meta = { content: "", setAttribute(name, value) { if (name === "content") this.content = value; } };
    const document = {
      documentElement: { dataset: {} },
      querySelector(selector) { return selector === 'meta[name="theme-color"]' ? meta : null; },
    };
    const localStorage = {
      getItem(key) { return values.has(key) ? values.get(key) : null; },
      setItem(key, value) { values.set(key, value); },
    };
    vm.runInNewContext(bootstrap.source, { document, localStorage });
    return { document, meta, values };
  };

  const firstVisit = runBootstrap();
  assert.equal(firstVisit.document.documentElement.dataset.theme, "dark");
  assert.equal(firstVisit.meta.content, "#10141F");
  assert.equal(firstVisit.values.get("quickflex-theme"), "dark");

  const lightVisit = runBootstrap({ "quickflex-theme-default-dark-gold-v1": "1", "quickflex-theme": "light" });
  assert.equal(lightVisit.document.documentElement.dataset.theme, "light");
  assert.equal(lightVisit.meta.content, "#F7F7F8");

  const bodySync = inlineScriptContaining("document.body.dataset.theme");
  assert.ok(bodySync.index > html.indexOf("<body>"));
  assert.ok(bodySync.index < html.indexOf('<div class="app"'));
  const document = { documentElement: { dataset: { theme: "dark" } }, body: { dataset: {} } };
  vm.runInNewContext(bodySync.source, { document });
  assert.equal(document.body.dataset.theme, "dark");

  const applyTheme = extractFunctionDeclaration(main, "applyTheme");
  assert.match(applyTheme, /document\.documentElement\.dataset\.theme = t/);
  assert.match(applyTheme, /document\.body\.dataset\.theme = t/);
  assert.match(applyTheme, /meta\[name="theme-color"\][\s\S]*#10141F[\s\S]*#F7F7F8/);
  assert.match(applyTheme, /setAttribute\("aria-pressed", String\(selected\)\)/);
});

test("light and dark design tokens meet text and control-boundary contrast floors", () => {
  const light = customProperties(extractCssBlock(":root"));
  const dark = customProperties(extractCssBlock('html[data-theme="dark"], body[data-theme="dark"]'));
  for (const token of ["shell-bg", "bg", "panel", "panel2", "line-strong", "text", "soft", "red", "gold", "primary-dark", "button-success-text"]) {
    assert.ok(dark[token], `dark theme is missing --${token}`);
  }

  const darkShell = parseColor(dark["shell-bg"]);
  const darkPanel = parseColor(dark.panel);
  const darkPanel2 = parseColor(dark.panel2);
  assert.ok(luminance(darkShell) < 0.02, "dark shell must remain genuinely dark");
  assertContrast("dark body text", parseColor(dark.text), parseColor(dark.bg), 4.5);
  assertContrast("light soft text", parseColor(light.soft), parseColor(light.panel), 4.5);
  assertContrast("dark soft text on panel", parseColor(dark.soft), darkPanel, 4.5);
  assertContrast("dark soft text on panel2", parseColor(dark.soft), darkPanel2, 4.5);

  const darkDangerBackground = composite(parseColor(dark["red-bg"]), darkPanel2);
  assertContrast("dark danger action", parseColor(dark.red), darkDangerBackground, 4.5);
  assertContrast("dark error toast", parseColor(dark.red), parseColor("#111827"), 4.5);

  const renderedInputBorder = composite(parseColor(dark["line-strong"]), darkPanel2);
  assertContrast("dark input border", renderedInputBorder, darkPanel2, 3);
  assert.match(css, /html\[data-theme="dark"\] input[\s\S]*?border-color:\s*var\(--line-strong\)/);

  assert.match(extractCssBlock(".inspection-good-button"), /background:\s*#45B95E[\s\S]*color:\s*var\(--button-success-text\)/i);
  assertContrast("inspection all-good button", parseColor(dark["button-success-text"]), parseColor("#45B95E"), 4.5);

  const activeDarkSelectors = css.slice(css.indexOf('html[data-theme="dark"] .mode-btn.active'), css.indexOf("* { box-sizing"));
  assert.match(activeDarkSelectors, /html\[data-theme="dark"\] \.stats-chart-toggle button\.active/);
  assert.match(activeDarkSelectors, /color:\s*var\(--primary-dark\)/);
  assertContrast("dark active stats toggle", parseColor(dark["primary-dark"]), parseColor(dark.gold), 4.5);
});

test("blocking overlays, forms, sheets and live regions keep accessible HTML structure", () => {
  for (const id of ["setupOverlay", "authOverlay", "pendingOverlay", "updateNoticeOverlay", "salesOverrideOverlay"]) {
    assertAttributes(id, { "aria-hidden": "true", inert: true });
  }
  for (const id of ["setupTitle", "authTitle", "pendingTitle", "updateNoticeTitle", "salesOverrideTitle", "dbSheetTitle"]) {
    assert.match(html, new RegExp(`role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="${id}"[^>]*tabindex="-1"`));
  }
  assertAttributes("dbSheet", { role: "dialog", "aria-modal": "true", "aria-hidden": "true", inert: true });
  assertAttributes("dbOverlay", { "aria-hidden": "true" });

  for (const id of ["setupUrl", "setupKey", "authEmail", "authPassword", "authName", "authDriverType", "salesOverrideReason", "supabaseUrl", "supabaseAnonKey"]) {
    assert.match(html, new RegExp(`<label\\s+for="${id}"`), `#${id} needs an explicit label`);
    assert.match(html, new RegExp(`<[^>]+\\bid="${id}"`), `label target #${id} is missing`);
  }

  for (const id of ["setupError", "authError"]) {
    assertAttributes(id, { role: "alert", "aria-live": "assertive", "aria-atomic": "true" });
  }
  assertAttributes("dbStatus", { role: "status", "aria-live": "polite" });
  assertAttributes("salesOverrideStatus", { role: "status", "aria-live": "polite", "aria-atomic": "true" });
  assertAttributes("statsChartTooltip", { role: "status", "aria-live": "polite", hidden: true });
  assertAttributes("toast", { role: "status", "aria-live": "polite" });
});

test("modal lifecycle traps focus, publishes state and restores the opener", () => {
  const syncModalBackground = extractFunctionDeclaration(main, "syncModalBackground");
  assert.match(syncModalBackground, /setAttribute\("aria-hidden", String\(!available\)\)/);
  assert.match(syncModalBackground, /toggleAttribute\("inert", !available\)/);
  assert.match(syncModalBackground, /child\.toggleAttribute\("inert", Boolean\(active\)\)/);
  assert.match(syncModalBackground, /openDbSettings[\s\S]*setAttribute\("aria-expanded", String\(active === el\.dbSheet\)\)/);

  const updateModalLayer = extractFunctionDeclaration(main, "updateModalLayer");
  assert.match(updateModalLayer, /modalReturnFocus\.set\(layer, current\)/);
  assert.match(updateModalLayer, /requestAnimationFrame/);
  assert.match(updateModalLayer, /target\?\.focus\?\.\(\)/);
  assert.match(updateModalLayer, /returnTarget\?\.isConnected[\s\S]*returnTarget[\s\S]*fallback/);

  const bindModalAccessibility = extractFunctionDeclaration(main, "bindModalAccessibility");
  assert.match(bindModalAccessibility, /event\.key === "Escape"[\s\S]*closeSheet\(\)/);
  assert.match(bindModalAccessibility, /event\.key !== "Tab"/);
  assert.match(bindModalAccessibility, /document\.activeElement === first[\s\S]*last\.focus\(\)/);
  assert.match(bindModalAccessibility, /document\.activeElement === last[\s\S]*first\.focus\(\)/);

  for (const name of ["showSetup", "showAuth", "showPending", "openSheet", "closeSheet"]) {
    assert.match(extractFunctionDeclaration(main, name), /updateModalLayer\(/, `${name} must update modal accessibility state`);
  }
});

test("error announcements, signatures and rate controls expose separate accessible actions", () => {
  const toast = extractFunctionDeclaration(main, "toast");
  assert.match(toast, /type === "error"/);
  assert.match(toast, /setAttribute\("role", isError \? "alert" : "status"\)/);
  assert.match(toast, /setAttribute\("aria-live", isError \? "assertive" : "polite"\)/);
  assert.match(toast, /setAttribute\("aria-atomic", "true"\)/);

  assertAttributes("profileSignatureCanvas", { role: "img", "aria-labelledby": "profileSignatureTitle", "aria-describedby": "profileSignatureHelp" });
  assertAttributes("profileSignatureAlternative", { name: "profileSignatureAlternative", type: "checkbox" });
  const saveSignature = extractFunctionDeclaration(main, "saveInspectionSignature");
  assert.match(saveSignature, /profileSignatureAlternative\?\.checked/);
  assert.match(saveSignature, /createAccessibleSignatureData/);
  assert.match(saveSignature, /isValidSignatureData\(signatureData\)/);
  assert.match(saveSignature, /signature_data: signatureData/);

  const renderRates = extractFunctionDeclaration(main, "renderRates");
  assert.match(renderRates, /<div class="rate-chip" role="group"/);
  assert.match(renderRates, /<button class="rate-chip-select"[^>]*aria-label=/);
  assert.match(renderRates, /<button class="rate-delete"[^>]*aria-label=/);
  assert.doesNotMatch(renderRates, /class="rate-chip"[^>]*(?:role="button"|tabindex=)/);
  assert.match(renderRates, /querySelectorAll\("\.rate-chip-select"\)[\s\S]*addEventListener\("click", selectRate\)/);
  assert.match(renderRates, /querySelectorAll\("\.rate-delete"\)[\s\S]*event\.stopPropagation\(\)/);
});

test("stats canvas summaries, toggle state and disabled range navigation stay synchronized", () => {
  assertAttributes("statsChart", { role: "img", "aria-describedby": "statsChartSummary" });
  assertAttributes("statsChartTooltip", { role: "status", "aria-live": "polite", hidden: true });
  assert.match(main, /canvas\.setAttribute\("aria-label", emptySummary\)[\s\S]*statsChartSummary\.textContent = emptySummary/);
  assert.match(main, /canvas\.setAttribute\("aria-label", chartSummary\)[\s\S]*statsChartSummary\.textContent = `\$\{chartSummary\}/);
  const syncStatsChartToggle = extractFunctionDeclaration(main, "syncStatsChartToggle");
  assert.match(syncStatsChartToggle, /querySelectorAll\("button\[data-metric\]"\)/);
  assert.match(syncStatsChartToggle, /setAttribute\("aria-pressed", String\(selected\)\)/);

  const syncStatsRangeButtons = extractFunctionDeclaration(main, "syncStatsRangeButtons");
  assert.match(syncStatsRangeButtons, /const navDisabled = state\.statsRangeMode !== "thisMonth"/);
  assert.match(syncStatsRangeButtons, /button\.disabled = navDisabled/);
  assert.match(syncStatsRangeButtons, /setAttribute\("aria-disabled", String\(navDisabled\)\)/);
});

test("off toggles remain focusable while visually hidden", () => {
  const rules = leafCssRulesFor(".off-toggle input");
  assert.ok(rules.length, "missing .off-toggle input rule");
  const declarations = rules.join("\n");
  assert.doesNotMatch(declarations, /display\s*:\s*none/i, "display:none removes the checkbox from keyboard and accessibility navigation");
  assert.match(declarations, /(?:position\s*:\s*absolute|opacity\s*:\s*0|clip(?:-path)?\s*:)/i, "off toggle needs a visually-hidden technique");
  assert.match(css, /\.off-toggle input:focus-visible\s*\+\s*span\s*\{[^}]+(?:outline|box-shadow)\s*:/s, "the visible proxy needs a keyboard focus indicator");
});

test("compact destructive and OCR draft controls retain a 44px hit target", () => {
  for (const selector of [".rate-delete", ".del-btn", ".draft-chip button", ".draft-add-input", ".draft-add-btn", ".draft-off-btn"]) {
    assert.ok(hasMinimumHitTarget(selector), `${selector} needs a direct or pseudo-element 44px by 44px hit target`);
  }
});
