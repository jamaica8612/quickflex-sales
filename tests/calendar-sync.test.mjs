import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  DEFAULT_CALENDAR_SYNC_SETTINGS,
  buildCalendarDesiredEvent,
  expandCalendarSyncRange,
  nextDateKey,
  normalizeCalendarSyncDays,
} from "../src/lib/calendar-sync.js";
import {
  decryptCalendarToken,
  encryptCalendarToken,
  newOpaqueState,
  sha256Base64Url,
} from "../supabase/functions/calendar-sync/security.js";

test("all-day event keeps the supplied work date and leaves revenue off by default", () => {
  const event = buildCalendarDesiredEvent({
    date: "2026-09-13", worked: true, hasSchedule: true, off: false,
    revenue: 294735, routeLabel: "310C01", workShift: "night",
  }, DEFAULT_CALENDAR_SYNC_SETTINGS);
  assert.deepEqual(event.start, { date: "2026-09-13" });
  assert.deepEqual(event.end, { date: "2026-09-14" });
  assert.equal(event.title, "배송 근무");
  assert.equal(event.workShift, "night");
});

test("revenue display is opt-in and can be removed while the work event remains", () => {
  const day = { date: "2026-09-13", worked: true, hasSchedule: true, off: false, revenue: 0, routeLabel: "310C01" };
  assert.equal(buildCalendarDesiredEvent(day, { includeWork: true, includeOff: true, includeRoute: true, includeRevenue: true }).title, "배송 근무 · 310C01 · 0원");
  assert.equal(buildCalendarDesiredEvent(day, { includeWork: true, includeOff: true, includeRoute: true, includeRevenue: false }).title, "배송 근무 · 310C01");
});

test("revenue-only days distinguish missing amounts from a real zero", () => {
  const settings = { includeWork: true, includeOff: true, includeRoute: false, includeRevenue: true };
  const zero = buildCalendarDesiredEvent({ date: "2026-09-13", worked: false, hasSchedule: false, off: false, revenue: 0 }, settings);
  const missing = buildCalendarDesiredEvent({ date: "2026-09-14", worked: false, hasSchedule: false, off: false, revenue: null }, settings);
  assert.equal(zero.title, "매출 · 0원");
  assert.equal(missing, null);
});

test("off-day title uses the approved neutral label", () => {
  const event = buildCalendarDesiredEvent({
    date: "2026-09-13", worked: false, hasSchedule: false, off: true, revenue: null,
  }, DEFAULT_CALENDAR_SYNC_SETTINGS);
  assert.equal(event.title, "휴무");
});

test("server creates the FlexNote calendar and protects custom calendar names", () => {
  const source = fs.readFileSync(new URL("../supabase/functions/calendar-sync/index.ts", import.meta.url), "utf8");
  assert.match(source, /const CALENDAR_SUMMARY = "플렉스노트";/);
  assert.match(source, /const LEGACY_CALENDAR_SUMMARY = "퀵플렉스 근무";/);
  assert.match(source, /String\(calendar\?\.summary \|\| ""\) === LEGACY_CALENDAR_SUMMARY/);
  assert.doesNotMatch(source, /calendar\?\.summary[\s\S]{0,80}(includes|startsWith)\(/);
  assert.match(source, /method: "PATCH", body: JSON\.stringify\(\{ summary: CALENDAR_SUMMARY \}\)/);
  assert.match(source, /method: "POST", body: JSON\.stringify\(\{ summary: CALENDAR_SUMMARY, timeZone: "Asia\/Seoul" \}\)/);
});

test("brand title changes the payload hash without changing the date-based event identity", async () => {
  const date = "2026-09-13";
  const newEvent = buildCalendarDesiredEvent({ date, worked: true, hasSchedule: true, off: false, revenue: null });
  const legacyEvent = { ...newEvent, title: "퀵플렉스 근무" };
  assert.notEqual(await sha256Base64Url(JSON.stringify(newEvent)), await sha256Base64Url(JSON.stringify(legacyEvent)));

  const source = fs.readFileSync(new URL("../supabase/functions/calendar-sync/index.ts", import.meta.url), "utf8");
  assert.match(source, /sha256Hex\(`\$\{userId\}:\$\{date\}`\)/);
  assert.match(source, /google_event_id: mapping\.google_event_id, google_etag:/);
  assert.match(source, /mapping\.last_payload_hash === desiredHash/);
});

test("calendar snapshots reject invalid money and deduplicate a date", () => {
  const days = normalizeCalendarSyncDays([
    { date: "2026-09-13", revenue: 1, worked: true },
    { date: "2026-09-13", revenue: null, off: true },
    { date: "not-a-date", revenue: 1 },
    { date: "2026-09-14", revenue: -1 },
  ]);
  assert.deepEqual(days, [{ date: "2026-09-13", revenue: null, off: true, worked: false, hasSchedule: false, routeLabel: "", workShift: "day" }]);
  assert.equal(nextDateKey("2026-12-31"), "2027-01-01");
  assert.equal(expandCalendarSyncRange(days, "2026-09-13", "2026-09-15").length, 3);
});

test("OAuth states are opaque and server token ciphertext round-trips only with its key", async () => {
  const key = new Uint8Array(32);
  crypto.getRandomValues(key);
  const keyBase64 = Buffer.from(key).toString("base64url");
  const first = newOpaqueState();
  const second = newOpaqueState();
  assert.notEqual(first, second);
  assert.notEqual(await sha256Base64Url(first), await sha256Base64Url(second));

  const token = { access_token: "access", refresh_token: "refresh", expires_at: "2026-09-13T00:00:00.000Z" };
  const ciphertext = await encryptCalendarToken(token, keyBase64);
  assert.match(ciphertext, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.equal(ciphertext.includes("refresh"), false);
  assert.deepEqual(await decryptCalendarToken(ciphertext, keyBase64), token);
  await assert.rejects(() => decryptCalendarToken(ciphertext, Buffer.from(new Uint8Array(32).fill(7)).toString("base64url")));
});
