import assert from "node:assert/strict";
import test from "node:test";
import { eunNeunParticle, formatMonthDayFull, formatMonthDayShort } from "../src/lib/date.js";

// Item 8: unify visible date formats. Full form drops the year and zero
// padding, and uses a short weekday in parentheses; short form is a bare
// non-padded "M/D" for compact spots like the sticky bar and chips.
test("formatMonthDayFull drops the year and zero-padding, using a short weekday in parens", () => {
  assert.equal(formatMonthDayFull("2026-09-18"), "9월 18일 (금)");
  assert.equal(formatMonthDayFull("2026-01-05"), "1월 5일 (월)");
});

test("formatMonthDayShort renders a bare non-padded M/D with no leading zeros", () => {
  assert.equal(formatMonthDayShort("2026-09-25"), "9/25");
  assert.equal(formatMonthDayShort("2026-01-05"), "1/5");
});

// The topic particle (은/는) after a day number depends on how the last
// digit is read aloud in Korean: 0,1,3,6,7,8 end in a consonant sound (은),
// 2,4,5,9 end in a vowel sound (는).
test("eunNeunParticle picks 은 for day numbers ending in 0,1,3,6,7,8", () => {
  for (const day of [10, 1, 3, 26, 7, 8, 30]) {
    assert.equal(eunNeunParticle(day), "은", `day ${day} should take 은`);
  }
});

test("eunNeunParticle picks 는 for day numbers ending in 2,4,5,9", () => {
  for (const day of [2, 24, 25, 9, 22]) {
    assert.equal(eunNeunParticle(day), "는", `day ${day} should take 는`);
  }
});
