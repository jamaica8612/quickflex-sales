import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarLatestJobFields,
  calendarStatusPayload,
  verifiedReconnectCalendarId,
} from "../supabase/functions/calendar-sync/status.js";

test("reconnect preserves only the existing calendar verified by the new Google token", () => {
  assert.equal(verifiedReconnectCalendarId("quickflex@example", { id: "quickflex@example" }), "quickflex@example");
  assert.equal(verifiedReconnectCalendarId("", null), "");
  assert.throws(
    () => verifiedReconnectCalendarId("old-account-calendar", { id: "different-account-calendar" }),
    /기존 QuickFlex Google 캘린더/,
  );
  assert.throws(() => verifiedReconnectCalendarId("old-account-calendar", null), /기존 QuickFlex Google 캘린더/);
});

test("status exposes only a bounded latest terminal job result", () => {
  assert.deepEqual(calendarLatestJobFields({
    status: "failed", error_message: "x".repeat(1200), finished_at: "2026-09-13T06:05:20.000Z",
  }), {
    lastJobStatus: "failed", lastJobError: "x".repeat(1000), lastJobFinishedAt: "2026-09-13T06:05:20.000Z",
  });
  assert.deepEqual(calendarLatestJobFields({ status: "conflict", error_message: "외부 변경" }), {
    lastJobStatus: "conflict", lastJobError: "외부 변경", lastJobFinishedAt: null,
  });
  assert.deepEqual(calendarLatestJobFields({ status: "running", error_message: "retry" }), {
    lastJobStatus: null, lastJobError: "", lastJobFinishedAt: null,
  });
  assert.deepEqual(calendarStatusPayload({
    connection_status: "connected", calendar_id: "calendar-id",
    last_successful_at: "2026-09-13T06:00:00.000Z", last_error: "",
  }, 0, true, {
    status: "conflict", error_message: "외부 변경", finished_at: "2026-09-13T06:05:20.000Z",
  }), {
    state: "connected", calendarId: "calendar-id", lastSuccessfulAt: "2026-09-13T06:00:00.000Z",
    lastError: "", pendingJobs: 0, workerConfigured: true,
    lastJobStatus: "conflict", lastJobError: "외부 변경", lastJobFinishedAt: "2026-09-13T06:05:20.000Z",
  });
});
