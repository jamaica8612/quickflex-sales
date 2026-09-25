import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Regression coverage for the record header: #backToCalendar and #prevDay used
// to be two identical round "‹" buttons side by side, so drivers tapped the
// wrong one. #prevDay/#nextDay must now be grouped with the date text (date
// navigation) using a lighter/smaller style, distinct from the back control,
// and every icon-only control in this header must have an accessible name.
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function recordHeaderMarkup() {
  const start = html.indexOf('<section class="view view-record">');
  assert.notEqual(start, -1, "missing view-record section");
  const end = html.indexOf("</header>", start);
  return html.slice(start, end);
}

test("prevDay/nextDay are grouped with the date text instead of sitting beside the back button", () => {
  const header = recordHeaderMarkup();
  const backIndex = header.indexOf('id="backToCalendar"');
  const dateNavIndex = header.indexOf('class="sub-title date-nav"');
  const prevIndex = header.indexOf('id="prevDay"');
  const dateTitleIndex = header.indexOf('id="selectedDateTitle"');
  const nextIndex = header.indexOf('id="nextDay"');
  assert.ok(backIndex !== -1 && dateNavIndex !== -1 && prevIndex !== -1 && dateTitleIndex !== -1 && nextIndex !== -1);
  assert.ok(backIndex < dateNavIndex, "back control must come before the date-nav group");
  assert.ok(dateNavIndex < prevIndex && prevIndex < dateTitleIndex && dateTitleIndex < nextIndex,
    "prev/next must flank the date text inside the same date-nav group");
  assert.match(header, /class="round-btn date-nav-btn" id="prevDay"/);
  assert.match(header, /class="round-btn date-nav-btn" id="nextDay"/);
  assert.doesNotMatch(header.slice(backIndex - 60, backIndex + 40), /date-nav-btn/, "back control keeps its own, more prominent style");
});

test("every icon-only control in the record header and its add-route button has an accessible name", () => {
  const header = recordHeaderMarkup();
  assert.match(header, /id="backToCalendar" aria-label="달력으로"/);
  assert.match(header, /id="prevDay"[^>]*aria-label="이전 날짜"/);
  assert.match(header, /id="nextDay"[^>]*aria-label="다음 날짜"/);
  assert.match(header, /id="offToggle" type="checkbox" aria-label="[^"]+"/, "the visually-hidden off-toggle checkbox needs its own aria-label");
  const addRoute = html.match(/<button id="addRoute"[^>]*>/);
  assert.ok(addRoute, "missing #addRoute button");
  assert.match(addRoute[0], /aria-label="구역 추가"/);
});
