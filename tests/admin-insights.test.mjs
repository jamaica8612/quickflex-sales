import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/services/admin-insights.js", import.meta.url), "utf8");
const insights = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("every bottom-nav and settings screen has a Korean tab label", () => {
  assert.equal(insights.usageScreenLabel("home"), "매출노트");
  assert.equal(insights.usageScreenLabel("measurement"), "배송노트");
  assert.equal(insights.usageScreenLabel("noah"), "노아");
  assert.equal(insights.usageScreenLabel("routes"), "구역노트");
  assert.equal(insights.usageScreenLabel("stats"), "정산노트");
  assert.equal(insights.usageScreenLabel("record"), "기록 입력");
  assert.equal(insights.usageScreenLabel("inspection"), "일상점검");
  assert.equal(insights.usageScreenLabel("settings"), "설정");
  assert.equal(insights.usageScreenLabel("admin"), "관리자");
  // An unknown screen must not throw and should fall back to the raw name.
  assert.equal(insights.usageScreenLabel("unknown_screen"), "unknown_screen");
  assert.equal(insights.usageScreenLabel(undefined), "");
});

test("summary rows format as '이름 N명 · M회' and tolerate messy RPC values", () => {
  assert.deepEqual(insights.formatUsageScreenSummaryRow({ screen: "noah", user_count: 3, view_count: 12 }), {
    screen: "noah",
    label: "노아",
    userCount: 3,
    viewCount: 12,
    countsText: "3명 · 12회",
  });
  // Zero, negative, missing, and non-numeric counts all clamp to 0 instead of crashing or showing NaN.
  assert.equal(insights.formatUsageScreenSummaryRow({ screen: "routes", user_count: 0, view_count: 0 }).countsText, "0명 · 0회");
  assert.equal(insights.formatUsageScreenSummaryRow({ screen: "routes" }).countsText, "0명 · 0회");
  assert.equal(insights.formatUsageScreenSummaryRow({ screen: "routes", user_count: -4, view_count: "abc" }).countsText, "0명 · 0회");
});

test("formatUsageScreenSummary maps every row and ignores non-array input", () => {
  const rows = insights.formatUsageScreenSummary([
    { screen: "home", user_count: 5, view_count: 20 },
    { screen: "stats", user_count: 2, view_count: 4 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, "매출노트");
  assert.equal(rows[1].countsText, "2명 · 4회");
  assert.deepEqual(insights.formatUsageScreenSummary(null), []);
  assert.deepEqual(insights.formatUsageScreenSummary(undefined), []);
});

test("usage summary window defaults to 30 and only accepts 7 or 30", () => {
  assert.equal(insights.normalizeUsageSummaryWindow(7), 7);
  assert.equal(insights.normalizeUsageSummaryWindow(30), 30);
  assert.equal(insights.normalizeUsageSummaryWindow(14), 30);
  assert.equal(insights.normalizeUsageSummaryWindow(undefined), 30);
  assert.equal(insights.normalizeUsageSummaryWindow(-7), 30);
});

test("fetchUsageScreenSummary calls the admin-only RPC with the requested window and rejects when the client can't call it", async () => {
  const calls = [];
  const db = {
    rpc: async (name, params) => {
      calls.push({ name, params });
      return { data: [{ screen: "home", user_count: 1, view_count: 2 }], error: null };
    },
  };
  const rows = await insights.fetchUsageScreenSummary(db, { windowDays: 7 });
  assert.deepEqual(calls, [{ name: "quickflex_usage_screen_summary", params: { p_window_days: 7 } }]);
  assert.deepEqual(rows, [{ screen: "home", user_count: 1, view_count: 2 }]);

  await assert.rejects(() => insights.fetchUsageScreenSummary(null), /unavailable/);

  const failingDb = { rpc: async () => ({ data: null, error: new Error("admin required") }) };
  await assert.rejects(() => insights.fetchUsageScreenSummary(failingDb), /admin required/);

  const emptyDb = { rpc: async () => ({ data: null, error: null }) };
  assert.deepEqual(await insights.fetchUsageScreenSummary(emptyDb), []);
});

test("pending signups banner is hidden at zero and shows the count and oldest wait otherwise", () => {
  assert.equal(insights.shouldShowPendingSignupsNotice({ pendingCount: 0, oldestWaitingDays: 0 }), false);
  assert.equal(insights.shouldShowPendingSignupsNotice(null), false);
  assert.equal(insights.shouldShowPendingSignupsNotice({ pendingCount: 1, oldestWaitingDays: 1 }), true);

  assert.equal(insights.pendingSignupsBannerText({ pendingCount: 0, oldestWaitingDays: 0 }), "");
  assert.equal(insights.pendingSignupsBannerText(null), "");
  assert.equal(
    insights.pendingSignupsBannerText({ pendingCount: 1, oldestWaitingDays: 1 }),
    "가입 승인 대기 1명 · 가장 오래 1일째",
  );
  assert.equal(
    insights.pendingSignupsBannerText({ pendingCount: 3, oldestWaitingDays: 88 }),
    "가입 승인 대기 3명 · 가장 오래 88일째",
  );
  // Korean person/day counters do not inflect for plurality, but the numerals must still be correct.
  assert.equal(
    insights.pendingSignupsBannerText({ pendingCount: 12, oldestWaitingDays: 0 }),
    "가입 승인 대기 12명 · 가장 오래 0일째",
  );
});

test("settings gear aria-label mentions the pending count only while there is one", () => {
  assert.equal(insights.pendingSignupsGearLabel({ pendingCount: 0 }), "설정");
  assert.equal(insights.pendingSignupsGearLabel(null), "설정");
  assert.equal(insights.pendingSignupsGearLabel({ pendingCount: 1 }), "설정, 가입 승인 대기 1명");
  assert.equal(insights.pendingSignupsGearLabel({ pendingCount: 3 }), "설정, 가입 승인 대기 3명");
});

test("normalizePendingSignups clamps missing or malformed RPC rows to zero", () => {
  assert.deepEqual(insights.normalizePendingSignups(null), { pendingCount: 0, oldestWaitingDays: 0 });
  assert.deepEqual(insights.normalizePendingSignups({}), { pendingCount: 0, oldestWaitingDays: 0 });
  assert.deepEqual(
    insights.normalizePendingSignups({ pending_count: 3, oldest_waiting_days: 88 }),
    { pendingCount: 3, oldestWaitingDays: 88 },
  );
  assert.deepEqual(
    insights.normalizePendingSignups({ pending_count: -1, oldest_waiting_days: "x" }),
    { pendingCount: 0, oldestWaitingDays: 0 },
  );
});

test("fetchPendingSignups reads the first row from the admin-only RPC and rejects without a client", async () => {
  const db = { rpc: async (name) => {
    assert.equal(name, "quickflex_pending_signups");
    return { data: [{ pending_count: 2, oldest_waiting_days: 5 }], error: null };
  } };
  assert.deepEqual(await insights.fetchPendingSignups(db), { pendingCount: 2, oldestWaitingDays: 5 });

  const failingDb = { rpc: async () => ({ data: null, error: new Error("admin required") }) };
  await assert.rejects(() => insights.fetchPendingSignups(failingDb), /admin required/);

  await assert.rejects(() => insights.fetchPendingSignups(null), /unavailable/);
});
