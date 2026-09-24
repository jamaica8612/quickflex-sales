import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readNoahWorkDateContext } from "../supabase/functions/noah/work-date-context.js";
import { createNoahHandler, noahWorkDateInstructions } from "../supabase/functions/noah/handler.js";

const owner = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-09-24T01:00:00.000Z"); // 10:00 KST
const today = "2026-09-24";

function fixture(overrides = {}) {
  const calls = [];
  const defaults = {
    quickflex_day_records: { data: null, error: null },
    quickflex_day_route_items: { data: [], error: null },
    quickflex_sales_work_results: { data: [], error: null },
    quickflex_active_work_leases: { data: null, error: null },
  };
  const client = {
    from(table) {
      const call = { table, filters: [] }; calls.push(call);
      const builder = {
        select(columns) { call.columns = columns; return builder; },
        eq(key, value) { call.filters.push(["eq", key, value]); return builder; },
        is(key, value) { call.filters.push(["is", key, value]); return builder; },
        gt(key, value) { call.filters.push(["gt", key, value]); return builder; },
        limit(value) { call.limit = value; return Promise.resolve(overrides[table] ?? defaults[table]); },
        maybeSingle() { return Promise.resolve(overrides[table] ?? defaults[table]); },
      };
      return builder;
    },
  };
  return { client, calls };
}

async function context(rows = {}, workShift = "night") {
  const { client, calls } = fixture(rows);
  return { result: await readNoahWorkDateContext({ client, userId: owner, workShift, now }), calls };
}

test("Noah keeps work-date module byte-identical and reads only owned real evidence", async () => {
  const browser = readFileSync(new URL("../src/lib/work-date.js", import.meta.url));
  const server = readFileSync(new URL("../supabase/functions/noah/work-date.js", import.meta.url));
  assert.deepEqual(server, browser);
  const { result, calls } = await context();
  assert.equal(result.today, today);
  assert.equal(result.reason, "empty");
  assert.equal(result.previousWorkDate, today);
  assert.equal(result.nextWorkDate, "2026-09-25");
  assert.equal(result.dayState.hasRecord, false);
  assert.equal(result.dayState.hasSchedule, false);
  assert.equal(result.dayState.hasAutomaticCompletion, false);
  assert.deepEqual(result.unavailable, []);
  assert.deepEqual(calls.map((call) => call.table), [
    "quickflex_day_records", "quickflex_day_route_items", "quickflex_sales_work_results", "quickflex_active_work_leases",
  ]);
  assert.ok(calls.every((call) => call.filters.some((filter) => filter[0] === "eq" && filter[1] === "user_id" && filter[2] === owner)));
  assert.ok(calls.slice(0, 3).every((call) => call.filters.some((filter) => filter[0] === "eq" && filter[1] === "work_date" && filter[2] === today)));
  assert.deepEqual(calls[3].filters.slice(1), [["is", "released_at", null], ["gt", "lease_expires_at", now.toISOString()]]);
  assert.equal(calls[1].columns, "route");
  assert.equal(calls[1].limit, 1000);
});

test("real schedule, automatic completion, off day and active lease use their priority", async () => {
  const scheduled = await context({
    quickflex_day_records: { data: { work_date: today, is_off: false }, error: null },
    quickflex_day_route_items: { data: [{ route: "318A" }], error: null },
  });
  assert.equal(scheduled.result.reason, "scheduled");
  assert.equal(scheduled.result.nextWorkDate, today);
  assert.equal(scheduled.result.previousWorkDate, "2026-09-23");
  const laterValidRoute = await context({
    quickflex_day_records: { data: { work_date: today, is_off: false }, error: null },
    quickflex_day_route_items: { data: [{ route: " | " }, { route: "318A|318B" }], error: null },
  });
  assert.equal(laterValidRoute.result.reason, "scheduled");
  const complete = await context({
    quickflex_sales_work_results: { data: [{ work_id: "work-1234" }], error: null },
  });
  assert.equal(complete.result.reason, "completed");
  assert.equal(complete.result.nextWorkDate, "2026-09-25");
  const off = await context({
    quickflex_day_records: { data: { work_date: today, is_off: true }, error: null },
  });
  assert.equal(off.result.reason, "off");
  const active = await context({
    quickflex_sales_work_results: { data: [{ work_id: "work-1234" }], error: null },
    quickflex_active_work_leases: { data: { work_date: today, released_at: null,
      lease_expires_at: "2026-09-24T02:00:00Z" }, error: null },
  });
  assert.equal(active.result.reason, "active");
  assert.equal(active.result.nextWorkDate, today);
});

test("expired or released lease is ignored, and day shift stays on today", async () => {
  const expired = await context({ quickflex_active_work_leases: { data: {
    work_date: "2026-09-25", released_at: null, lease_expires_at: "2026-09-24T00:00:00Z",
  }, error: null } });
  assert.equal(expired.result.reason, "empty");
  const released = await context({ quickflex_active_work_leases: { data: {
    work_date: "2026-09-25", released_at: "2026-09-24T00:30:00Z", lease_expires_at: "2026-09-24T02:00:00Z",
  }, error: null } });
  assert.equal(released.result.reason, "empty");
  const day = await context({}, "day");
  assert.equal(day.result.reason, "day");
  assert.equal(day.result.previousWorkDate, today);
  assert.equal(day.result.nextWorkDate, today);
});

test("partial read errors stay unknown and do not fabricate an empty schedule", async () => {
  const completionUnknown = await context({ quickflex_sales_work_results: { data: null, error: Error("DB unavailable") } });
  assert.equal(completionUnknown.result.dayState.hasAutomaticCompletion, undefined);
  assert.equal(completionUnknown.result.reason, "clock");
  assert.deepEqual(completionUnknown.result.unavailable, ["completion"]);
  const dayUnknown = await context({
    quickflex_day_records: { data: null, error: Error("DB unavailable") },
    quickflex_day_route_items: { data: [{ route: "318A" }], error: null },
  });
  assert.equal(dayUnknown.result.dayState.isOff, undefined);
  assert.equal(dayUnknown.result.dayState.hasSchedule, undefined);
  assert.equal(dayUnknown.result.reason, "clock");
  const leaseUnknown = await context({
    quickflex_day_records: { data: { work_date: today, is_off: false }, error: null },
    quickflex_day_route_items: { data: [{ route: "318A" }], error: null },
    quickflex_active_work_leases: { data: null, error: Error("DB unavailable") },
  });
  assert.equal(leaseUnknown.result.dayState.activeWorkDate, undefined);
  assert.equal(leaseUnknown.result.reason, "scheduled");
  assert.deepEqual(leaseUnknown.result.unavailable, ["lease"]);
  const cappedWithoutRoute = await context({
    quickflex_day_records: { data: { work_date: today, is_off: false }, error: null },
    quickflex_day_route_items: { data: Array.from({ length: 1000 }, () => ({ route: " | " })), error: null },
  });
  assert.equal(cappedWithoutRoute.result.dayState.hasSchedule, undefined);
  assert.equal(cappedWithoutRoute.result.reason, "clock");
  const afterNoon = await readNoahWorkDateContext({
    client: fixture({ quickflex_sales_work_results: { data: null, error: Error("DB unavailable") } }).client,
    userId: owner, workShift: "night", now: new Date("2026-09-24T03:00:00Z"),
  });
  assert.equal(afterNoon.reason, "clock");
  assert.equal(afterNoon.nextWorkDate, "2026-09-25");
});

test("model instructions receive only server account context, not browser-supplied dates", async () => {
  const actual = (await context()).result;
  let seenInstructions = "";
  const handler = createNoahHandler({
    authorize: async () => ({ userId: owner, getWorkDateContext: async () => actual,
      dataTools: { consumeQuota: async () => ({ allowed: true }) } }),
    respond: async (request) => {
      seenInstructions = request.instructions;
      return { output: [{ type: "message", content: [{ type: "output_text", text: "확인했어요." }] }] };
    },
    resources: { profile: "내 프로필" }, actions: {},
  });
  const response = await handler(new Request("https://example.test/noah", {
    method: "POST", headers: { origin: "https://jamaica8612.github.io", "content-type": "application/json" },
    body: JSON.stringify({ operation: "chat", message: "오늘 일은?", workDateContext: {
      previousWorkDate: "1999-01-01", nextWorkDate: "1999-01-02", reason: "active",
    } }),
  }));
  assert.equal(response.status, 200);
  assert.match(seenInstructions, /직전 업무일 2026-09-24/);
  assert.match(seenInstructions, /다음 업무일 2026-09-25/);
  assert.match(seenInstructions, /근무조 야간/);
  assert.match(seenInstructions, /판단 근거 empty/);
  assert.match(seenInstructions, /가장 최근 매출 기록을 검색한 날짜가 아닙니다/);
  assert.match(seenInstructions, /두 기준일이 다른데/);
  assert.match(seenInstructions, /기준 날짜를 짧게/);
  assert.match(seenInstructions, /sales_days\(휴무\).*sales_manual_items\(근무표 구역\)/);
  assert.match(seenInstructions, /배송수 0인 구역도 유효/);
  assert.doesNotMatch(seenInstructions, /1999-01-0[12]/);
  assert.match(noahWorkDateInstructions({ ...actual, unavailable: ["schedule"], reason: "clock" }), /추정/);
});

test("confirm does not depend on schedule reads or send work-date context to the model", async () => {
  let contextCalls = 0;
  let modelCalls = 0;
  const handler = createNoahHandler({
    authorize: async () => ({ userId: owner,
      getWorkDateContext: async () => { contextCalls++; throw Error("schedule unavailable"); },
      dataTools: { confirmWrite: async () => ({ id: "22222222-2222-4222-8222-222222222222", status: "confirmed" }) } }),
    respond: async () => { modelCalls++; throw Error("model should not run"); },
    resources: {}, actions: {},
  });
  const response = await handler(new Request("https://example.test/noah", {
    method: "POST", headers: { origin: "https://jamaica8612.github.io", "content-type": "application/json" },
    body: JSON.stringify({ operation: "confirm", proposalId: "22222222-2222-4222-8222-222222222222" }),
  }));
  assert.equal(response.status, 200);
  assert.equal(contextCalls, 0);
  assert.equal(modelCalls, 0);
});
