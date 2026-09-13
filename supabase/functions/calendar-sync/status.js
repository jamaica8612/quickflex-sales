const terminalJobStatuses = new Set(["succeeded", "conflict", "failed"]);

export function calendarLatestJobFields(job) {
  if (!job || !terminalJobStatuses.has(String(job.status || ""))) {
    return { lastJobStatus: null, lastJobError: "", lastJobFinishedAt: null };
  }
  return {
    lastJobStatus: String(job.status),
    lastJobError: String(job.error_message || "").slice(0, 1000),
    lastJobFinishedAt: job.finished_at || null,
  };
}

export function calendarStatusPayload(connection, pendingJobs, workerConfigured, latestJob) {
  if (!connection) return { state: "disconnected", pendingJobs: pendingJobs || 0, workerConfigured };
  return {
    state: connection.connection_status,
    calendarId: connection.calendar_id || null,
    lastSuccessfulAt: connection.last_successful_at || null,
    lastError: connection.last_error || "",
    pendingJobs: pendingJobs || 0,
    workerConfigured,
    ...calendarLatestJobFields(latestJob),
  };
}

export function verifiedReconnectCalendarId(existingCalendarId, calendar) {
  const expected = String(existingCalendarId || "");
  if (!expected) return "";
  if (String(calendar?.id || "") !== expected) {
    throw new Error("기존 플렉스노트 Google 캘린더를 새 Google 연결에서 확인할 수 없습니다.");
  }
  return expected;
}
