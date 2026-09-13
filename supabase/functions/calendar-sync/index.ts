import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { decryptCalendarToken, encryptCalendarToken, newOpaqueState, sha256Base64Url, sha256Hex } from "./security.js";
import { calendarStatusPayload, verifiedReconnectCalendarId } from "./status.js";

const FUNCTION_NAME = "calendar-sync";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const MAX_DAYS = 366;
const CALENDAR_SUMMARY = "플렉스노트";
const LEGACY_CALENDAR_SUMMARY = "퀵플렉스 근무";

type DaySnapshot = {
  date: string;
  off: boolean;
  worked: boolean;
  hasSchedule: boolean;
  revenue: number | null;
  routeLabel: string;
  workShift: "day" | "night";
};

type Settings = { includeWork: boolean; includeOff: boolean; includeRoute: boolean; includeRevenue: boolean };
type DesiredEvent = { date: string; kind: "work" | "off" | "revenue"; title: string; start: { date: string }; end: { date: string }; workShift: string };

function json(request: Request, body: unknown, status = 200) {
  const origin = request.headers.get("origin") || "";
  const allowed = allowedOrigins();
  const headers: Record<string, string> = { "Content-Type": "application/json; charset=utf-8", Vary: "Origin" };
  if (origin && allowed.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return new Response(JSON.stringify(body), { status, headers });
}

function allowedOrigins() {
  const configured = String(Deno.env.get("CALENDAR_ALLOWED_REDIRECT_ORIGINS") || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  return new Set(configured.length ? configured : ["https://jamaica8612.github.io"]);
}

function calendarConfig() {
  const projectUrl = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const clientId = String(Deno.env.get("GOOGLE_OAUTH_CLIENT_ID") || "").trim();
  const clientSecret = String(Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET") || "").trim();
  const encryptionKey = String(Deno.env.get("CALENDAR_TOKEN_ENCRYPTION_KEY") || "").trim();
  const redirectUri = String(Deno.env.get("CALENDAR_OAUTH_REDIRECT_URI") || `${projectUrl}/functions/v1/${FUNCTION_NAME}`).trim();
  return {
    projectUrl,
    clientId,
    clientSecret,
    encryptionKey,
    redirectUri,
    ready: Boolean(projectUrl && clientId && clientSecret && encryptionKey && redirectUri),
    workerConfigured: Boolean(String(Deno.env.get("CALENDAR_WORKER_SECRET") || "").trim()),
  };
}

function privilegedDb() {
  const config = calendarConfig();
  const key = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!config.projectUrl || !key) throw new Error("Supabase server credentials are not configured.");
  return createClient(config.projectUrl, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authenticatedUser(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "로그인이 필요합니다.");
  const config = calendarConfig();
  const anonKey = String(Deno.env.get("SUPABASE_ANON_KEY") || "").trim();
  if (!config.projectUrl || !anonKey) throw new HttpError(500, "Supabase Auth configuration is missing.");
  const auth = createClient(config.projectUrl, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "로그인 세션을 확인할 수 없습니다.");
  return data.user;
}

async function assertApprovedUser(userId: string) {
  const db = privilegedDb();
  const { data: profile, error } = await db.from("quickflex_profiles").select("status").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (!profile || profile.status !== "approved") throw new HttpError(403, "승인된 계정만 Google 캘린더를 연결하고 동기화할 수 있습니다.");
}

async function disableCalendarForInactiveUser(userId: string) {
  const db = privilegedDb();
  const { data: profile, error } = await db.from("quickflex_profiles").select("status").eq("id", userId).maybeSingle();
  if (error) throw error;
  if (profile?.status === "approved") return false;
  await db.from("quickflex_calendar_connections").update({
    connection_status: "disconnected",
    last_error: "계정이 승인 상태가 아니어서 캘린더 동기화를 중단했습니다.",
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return true;
}

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function asDate(value: unknown) {
  const date = String(value || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, "유효한 날짜 범위가 필요합니다.");
  return date;
}

function nextDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function normalizeSettings(value: unknown): Settings {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    includeWork: source.includeWork !== false,
    includeOff: source.includeOff !== false,
    includeRoute: source.includeRoute === true,
    includeRevenue: source.includeRevenue === true,
  };
}

function normalizeDays(value: unknown, startDate: string, endDate: string) {
  if (!Array.isArray(value) || value.length > MAX_DAYS) throw new HttpError(400, `날짜는 최대 ${MAX_DAYS}개까지 보낼 수 있습니다.`);
  const byDate = new Map<string, DaySnapshot>();
  value.forEach((raw) => {
    if (!raw || typeof raw !== "object") throw new HttpError(400, "잘못된 날짜 스냅샷입니다.");
    const source = raw as Record<string, unknown>;
    const date = asDate(source.date);
    if (date < startDate || date > endDate) throw new HttpError(400, "선택한 기간 밖의 날짜가 포함되어 있습니다.");
    const revenue = source.revenue === null || source.revenue === undefined || source.revenue === "" ? null : Number(source.revenue);
    if (revenue !== null && (!Number.isFinite(revenue) || revenue < 0 || !Number.isInteger(revenue))) throw new HttpError(400, "매출은 0 이상의 정수이거나 미기록이어야 합니다.");
    byDate.set(date, {
      date,
      off: source.off === true,
      worked: source.worked === true,
      hasSchedule: source.hasSchedule === true,
      revenue,
      routeLabel: String(source.routeLabel || "").trim().slice(0, 120),
      workShift: source.workShift === "night" ? "night" : "day",
    });
  });
  const days: DaySnapshot[] = [];
  let date = startDate;
  while (date <= endDate) {
    days.push(byDate.get(date) || {
      date, off: false, worked: false, hasSchedule: false, revenue: null, routeLabel: "", workShift: "day",
    });
    if (days.length > MAX_DAYS) throw new HttpError(400, `동기화 기간은 최대 ${MAX_DAYS}일입니다.`);
    date = nextDateKey(date);
  }
  return days;
}

function formatWon(amount: number) { return `${amount.toLocaleString("ko-KR")}원`; }

function desiredEvent(day: DaySnapshot, settings: Settings): DesiredEvent | null {
  const scheduledWork = !day.off && (day.worked || day.hasSchedule);
  const amount = settings.includeRevenue && day.revenue !== null ? formatWon(day.revenue) : "";
  let kind: DesiredEvent["kind"];
  let title: string;
  if (scheduledWork && settings.includeWork) {
    kind = "work";
    title = "배송 근무";
    if (settings.includeRoute && day.routeLabel) title += ` · ${day.routeLabel}`;
  } else if (day.off && settings.includeOff) {
    kind = "off";
    title = "휴무";
  } else if (settings.includeRevenue && day.revenue !== null) {
    kind = "revenue";
    title = "매출";
  } else return null;
  if (amount) title += ` · ${amount}`;
  return { date: day.date, kind, title, start: { date: day.date }, end: { date: nextDateKey(day.date) }, workShift: day.workShift };
}

function safeReturnTo(value: unknown) {
  try {
    const url = new URL(String(value || ""));
    if (!allowedOrigins().has(url.origin)) throw new Error("origin");
    return url.toString();
  } catch { throw new HttpError(400, "허용되지 않은 완료 주소입니다."); }
}

function callbackRedirect(returnTo: string, result: "connected" | "failed") {
  const url = new URL(returnTo);
  url.searchParams.set("calendar", result);
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Cache-Control": "no-store" } });
}

async function googleFetch(url: string, accessToken: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${accessToken}`);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, headers });
  const body = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(body?.error?.message || body?.error || `Google Calendar API ${response.status}`);
    const error = new Error(message) as Error & { googleStatus?: number };
    error.googleStatus = response.status;
    throw error;
  }
  return body;
}

async function oauthToken(config: ReturnType<typeof calendarConfig>, params: URLSearchParams) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(body.error_description || body.error || "Google 토큰 교환에 실패했습니다.")) as Error & { googleStatus?: number; googleOAuthError?: string };
    error.googleStatus = response.status;
    error.googleOAuthError = String(body.error || "");
    throw error;
  }
  return body as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string; token_type?: string };
}

async function refreshAccessToken(userId: string, connection: Record<string, unknown>) {
  const config = calendarConfig();
  const token = await decryptCalendarToken(String(connection.token_ciphertext), config.encryptionKey) as Record<string, unknown>;
  const expiresAt = String(token.expires_at || "");
  if (token.access_token && expiresAt && new Date(expiresAt).getTime() > Date.now() + 60_000) return token;
  if (!token.refresh_token) throw new Error("Google 재연결이 필요합니다.");
  const refreshed = await oauthToken(config, new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: String(token.refresh_token),
    grant_type: "refresh_token",
  }));
  const next = {
    ...token,
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || token.refresh_token,
    expires_at: new Date(Date.now() + Number(refreshed.expires_in || 3600) * 1000).toISOString(),
  };
  const db = privilegedDb();
  await db.from("quickflex_calendar_connections").update({
    token_ciphertext: await encryptCalendarToken(next, config.encryptionKey),
    expires_at: next.expires_at,
    updated_at: new Date().toISOString(),
  }).eq("user_id", userId);
  return next;
}

async function stableEventId(userId: string, date: string) {
  // Google Calendar event ids accept lowercase hexadecimal safely; this is stable
  // across a retry without exposing an account identifier in the event title.
  return `qf${(await sha256Hex(`${userId}:${date}`)).slice(0, 42)}`;
}

async function payloadHash(event: DesiredEvent | null) {
  return sha256Base64Url(JSON.stringify(event));
}

function eventBody(event: DesiredEvent, payloadHashValue: string) {
  return {
    summary: event.title,
    start: event.start,
    end: event.end,
    extendedProperties: {
      private: {
        quickflex_source: "quickflex-calendar-v1",
        quickflex_date: event.date,
        quickflex_hash: payloadHashValue,
      },
    },
  };
}

async function markConflict(userId: string, date: string, reason: string) {
  const db = privilegedDb();
  await db.from("quickflex_calendar_event_mappings").update({
    sync_state: "conflict", conflict_reason: reason.slice(0, 1000), updated_at: new Date().toISOString(),
  }).eq("user_id", userId).eq("work_date", date);
}

async function getOrCreateCalendar(userId: string, connection: Record<string, unknown>, accessToken: string) {
  if (connection.calendar_id) {
    const calendarId = String(connection.calendar_id);
    const calendarUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`;
    const calendar = await googleFetch(calendarUrl, accessToken);
    if (String(calendar?.summary || "") === LEGACY_CALENDAR_SUMMARY) {
      await googleFetch(calendarUrl, accessToken, {
        method: "PATCH", body: JSON.stringify({ summary: CALENDAR_SUMMARY }),
      });
    }
    return calendarId;
  }
  const calendar = await googleFetch("https://www.googleapis.com/calendar/v3/calendars", accessToken, {
    method: "POST", body: JSON.stringify({ summary: CALENDAR_SUMMARY, timeZone: "Asia/Seoul" }),
  });
  if (!calendar?.id) throw new Error("플렉스노트 전용 Google 캘린더를 만들지 못했습니다.");
  const db = privilegedDb();
  await db.from("quickflex_calendar_connections").update({ calendar_id: calendar.id, updated_at: new Date().toISOString() }).eq("user_id", userId);
  return String(calendar.id);
}

async function syncDay(userId: string, calendarId: string, accessToken: string, day: DaySnapshot, settings: Settings, force: boolean) {
  const db = privilegedDb();
  const desired = desiredEvent(day, settings);
  const desiredHash = await payloadHash(desired);
  const { data: mapping, error } = await db.from("quickflex_calendar_event_mappings").select("*")
    .eq("user_id", userId).eq("work_date", day.date).maybeSingle();
  if (error) throw error;
  const eventUrl = (eventId: string) => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

  if (!desired) {
    if (!mapping) return { outcome: "unchanged" };
    let remote;
    try { remote = await googleFetch(eventUrl(mapping.google_event_id), accessToken); }
    catch (error) {
      await markConflict(userId, day.date, "외부에서 일정이 삭제되어 정리 여부를 확인해야 합니다.");
      return { outcome: "conflict" };
    }
    if (!force && String(remote.etag || "") !== String(mapping.google_etag || "")) {
      await markConflict(userId, day.date, "외부에서 일정이 수정되어 자동으로 지우지 않았습니다.");
      return { outcome: "conflict" };
    }
    await googleFetch(eventUrl(mapping.google_event_id), accessToken, { method: "DELETE" });
    await db.from("quickflex_calendar_event_mappings").delete().eq("user_id", userId).eq("work_date", day.date);
    return { outcome: "removed" };
  }

  if (mapping) {
    let remote;
    try { remote = await googleFetch(eventUrl(mapping.google_event_id), accessToken); }
    catch (error) {
      if (force) {
        await db.from("quickflex_calendar_event_mappings").delete().eq("user_id", userId).eq("work_date", day.date);
        return syncDay(userId, calendarId, accessToken, day, settings, true);
      }
      await markConflict(userId, day.date, "외부에서 일정이 삭제되었습니다. 다시 반영을 선택하면 새로 만듭니다.");
      return { outcome: "conflict" };
    }
    if (!force && String(remote.etag || "") !== String(mapping.google_etag || "")) {
      await markConflict(userId, day.date, "외부에서 일정이 수정되어 자동으로 덮어쓰지 않았습니다.");
      return { outcome: "conflict" };
    }
    if (!force && mapping.last_payload_hash === desiredHash && mapping.sync_state === "synced") return { outcome: "unchanged" };
    const updated = await googleFetch(eventUrl(mapping.google_event_id), accessToken, {
      method: "PATCH", body: JSON.stringify(eventBody(desired, desiredHash)),
    });
    await db.from("quickflex_calendar_event_mappings").upsert({
      user_id: userId, work_date: day.date, google_event_id: mapping.google_event_id, google_etag: String(updated.etag || ""),
      last_payload_hash: desiredHash, last_payload: desired, sync_state: "synced", conflict_reason: "", updated_at: new Date().toISOString(),
    });
    return { outcome: "updated" };
  }

  const id = await stableEventId(userId, day.date);
  let created;
  try {
    created = await googleFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, accessToken, {
      method: "POST", body: JSON.stringify({ id, ...eventBody(desired, desiredHash) }),
    });
  } catch (error) {
    if ((error as { googleStatus?: number }).googleStatus !== 409) throw error;
    created = await googleFetch(eventUrl(id), accessToken);
    const privateProps = created?.extendedProperties?.private || {};
    if (privateProps.quickflex_source !== "quickflex-calendar-v1" || privateProps.quickflex_date !== day.date) {
      throw new Error("플렉스노트 일정 식별자가 다른 일정과 충돌했습니다.");
    }
  }
  await db.from("quickflex_calendar_event_mappings").upsert({
    user_id: userId, work_date: day.date, google_event_id: id, google_etag: String(created.etag || ""),
    last_payload_hash: desiredHash, last_payload: desired, sync_state: "synced", conflict_reason: "", updated_at: new Date().toISOString(),
  });
  return { outcome: "created" };
}

async function processJob(job: Record<string, unknown>) {
  const userId = String(job.user_id);
  const db = privilegedDb();
  if (await disableCalendarForInactiveUser(userId)) return { disabled: true, deferred: false, conflicts: 0 };
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 15 * 60_000).toISOString();
  // One user can have different queued payloads. Claim a connection lease before
  // touching Google so two workers cannot create two secondary calendars.
  const { data: connection, error } = await db.from("quickflex_calendar_connections").update({
    sync_lease_until: leaseUntil, updated_at: now.toISOString(),
  }).eq("user_id", userId).eq("connection_status", "connected")
    .or(`sync_lease_until.is.null,sync_lease_until.lt.${now.toISOString()}`).select("*").maybeSingle();
  if (error) throw error;
  if (!connection) return { disabled: false, deferred: true, conflicts: 0 };
  try {
    const payload = job.payload as { days: DaySnapshot[]; settings: Settings; force?: boolean };
    const token = await refreshAccessToken(userId, connection);
    const calendarId = await getOrCreateCalendar(userId, connection, String(token.access_token));
    let conflicts = 0;
    for (const day of payload.days) {
      const result = await syncDay(userId, calendarId, String(token.access_token), day, payload.settings, payload.force === true);
      if (result.outcome === "conflict") conflicts += 1;
    }
    await db.from("quickflex_calendar_connections").update({ last_successful_at: new Date().toISOString(), last_error: "", updated_at: new Date().toISOString() }).eq("user_id", userId);
    return { disabled: false, deferred: false, conflicts };
  } finally {
    await db.from("quickflex_calendar_connections").update({ sync_lease_until: null, updated_at: new Date().toISOString() })
      .eq("user_id", userId).eq("sync_lease_until", leaseUntil);
  }
}

async function runQueuedJobs(request: Request) {
  const expected = String(Deno.env.get("CALENDAR_WORKER_SECRET") || "").trim();
  if (!expected || request.headers.get("x-calendar-worker-secret") !== expected) throw new HttpError(401, "작업자 인증이 필요합니다.");
  const db = privilegedDb();
  const now = new Date().toISOString();
  const { data: jobs, error } = await db.from("quickflex_calendar_sync_jobs").select("*")
    .eq("status", "queued").lte("run_after", now).order("id", { ascending: true }).limit(8);
  if (error) throw error;
  let processed = 0;
  for (const candidate of jobs || []) {
    const { data: job } = await db.from("quickflex_calendar_sync_jobs").update({
      status: "running", locked_at: now, attempt_count: Number(candidate.attempt_count || 0) + 1, updated_at: now,
    }).eq("id", candidate.id).eq("status", "queued").select().maybeSingle();
    if (!job) continue;
    processed += 1;
    try {
      const result = await processJob(job);
      if (result.deferred) {
        await db.from("quickflex_calendar_sync_jobs").update({
          status: "queued", attempt_count: Math.max(0, Number(job.attempt_count || 1) - 1),
          run_after: new Date(Date.now() + 30_000).toISOString(), updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        continue;
      }
      if (result.disabled) {
        await db.from("quickflex_calendar_sync_jobs").update({
          status: "failed", active_key: null, finished_at: new Date().toISOString(),
          error_message: "계정이 승인 상태가 아니어서 캘린더 동기화를 중단했습니다.", updated_at: new Date().toISOString(),
        }).eq("id", job.id);
        continue;
      }
      await db.from("quickflex_calendar_sync_jobs").update({
        status: result.conflicts ? "conflict" : "succeeded", active_key: null, finished_at: new Date().toISOString(),
        error_message: result.conflicts ? `${result.conflicts}개 일정이 외부 변경으로 보류되었습니다.` : "", updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "동기화 작업 실패";
      const oauthError = error as { googleStatus?: number; googleOAuthError?: string };
      const unauthorized = oauthError.googleStatus === 401 || oauthError.googleOAuthError === "invalid_grant" || /재연결/.test(message);
      if (unauthorized) await db.from("quickflex_calendar_connections").update({ connection_status: "needs_reconnect", last_error: message, updated_at: new Date().toISOString() }).eq("user_id", job.user_id);
      const attempts = Number(job.attempt_count || 1);
      const retry = !unauthorized && attempts < 5;
      await db.from("quickflex_calendar_sync_jobs").update(retry ? {
        status: "queued", run_after: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000).toISOString(), error_message: message, updated_at: new Date().toISOString(),
      } : {
        status: "failed", active_key: null, finished_at: new Date().toISOString(), error_message: message, updated_at: new Date().toISOString(),
      }).eq("id", job.id);
    }
  }
  return { processed };
}

async function queueJob(userId: string, body: Record<string, unknown>, force: boolean) {
  const startDate = asDate(body.startDate);
  const endDate = asDate(body.endDate);
  if (startDate > endDate) throw new HttpError(400, "시작일은 종료일보다 뒤일 수 없습니다.");
  const settings = normalizeSettings(body.settings);
  const days = normalizeDays(body.days, startDate, endDate);
  const payload = { startDate, endDate, settings, days, force };
  const activeKey = await sha256Base64Url(`${userId}:${JSON.stringify(payload)}`);
  const db = privilegedDb();
  const { data: connection, error: connectionError } = await db.from("quickflex_calendar_connections")
    .select("connection_status").eq("user_id", userId).maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection || connection.connection_status !== "connected") throw new HttpError(409, "Google 계정을 다시 연결한 뒤 동기화할 수 있습니다.");
  const { data: existing } = await db.from("quickflex_calendar_sync_jobs").select("id").eq("user_id", userId).eq("active_key", activeKey).maybeSingle();
  if (existing) return { jobId: existing.id, pendingJobs: 1, alreadyQueued: true };
  const { data, error } = await db.from("quickflex_calendar_sync_jobs").insert({ user_id: userId, active_key: activeKey, payload, status: "queued" }).select("id").single();
  if (error) {
    if (error.code === "23505") {
      const { data: duplicate } = await db.from("quickflex_calendar_sync_jobs").select("id").eq("user_id", userId).eq("active_key", activeKey).maybeSingle();
      if (duplicate) return { jobId: duplicate.id, pendingJobs: 1, alreadyQueued: true };
    }
    throw error;
  }
  return { jobId: data.id, pendingJobs: 1, alreadyQueued: false };
}

async function statusFor(userId: string) {
  const config = calendarConfig();
  if (!config.ready) return { state: "setup_required", workerConfigured: config.workerConfigured };
  const db = privilegedDb();
  const { data: connection, error } = await db.from("quickflex_calendar_connections")
    .select("connection_status, calendar_id, last_successful_at, last_error").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const { count, error: countError } = await db.from("quickflex_calendar_sync_jobs").select("id", { count: "exact", head: true }).eq("user_id", userId).in("status", ["queued", "running"]);
  if (countError) throw countError;
  const { data: latestJob, error: latestJobError } = await db.from("quickflex_calendar_sync_jobs")
    .select("status, error_message, finished_at").eq("user_id", userId)
    .in("status", ["succeeded", "conflict", "failed"]).order("id", { ascending: false }).limit(1).maybeSingle();
  if (latestJobError) throw latestJobError;
  return calendarStatusPayload(connection, count, config.workerConfigured, latestJob);
}

async function startOauth(request: Request, userId: string, body: Record<string, unknown>) {
  const config = calendarConfig();
  if (!config.ready) throw new HttpError(409, "Google OAuth 설정이 아직 배포되지 않았습니다.");
  const returnTo = safeReturnTo(body.returnTo);
  const state = newOpaqueState();
  const db = privilegedDb();
  await db.from("quickflex_calendar_oauth_states").insert({
    user_id: userId, state_hash: await sha256Base64Url(state), return_to: returnTo,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: config.clientId, redirect_uri: config.redirectUri, response_type: "code", scope: GOOGLE_SCOPE,
    access_type: "offline", prompt: "consent", include_granted_scopes: "true", state,
  }).toString();
  return json(request, { authorizationUrl: url.toString() });
}

async function handleCallback(request: Request) {
  const url = new URL(request.url);
  const rawState = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  let returnTo = "";
  try {
    if (!rawState) throw new Error("missing OAuth state");
  const db = privilegedDb();
    const stateHash = await sha256Base64Url(rawState);
    const { data: state } = await db.from("quickflex_calendar_oauth_states").select("*").eq("state_hash", stateHash).maybeSingle();
    if (!state || state.consumed_at || new Date(state.expires_at).getTime() <= Date.now()) throw new Error("expired OAuth state");
    returnTo = String(state.return_to);
    if (!code) throw new Error("Google authorization was not completed");
    const { data: consumed } = await db.from("quickflex_calendar_oauth_states").update({ consumed_at: new Date().toISOString() })
      .eq("id", state.id).is("consumed_at", null).gt("expires_at", new Date().toISOString()).select().maybeSingle();
    if (!consumed) throw new Error("OAuth state was already used");
    const config = calendarConfig();
    if (!config.ready) throw new Error("OAuth configuration unavailable");
    const token = await oauthToken(config, new URLSearchParams({
      code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, grant_type: "authorization_code",
    }));
    if (!token.access_token || !token.refresh_token) throw new Error("Google refresh token was not returned. Reconnect and approve again.");
    const { data: existingConnection, error: existingConnectionError } = await db.from("quickflex_calendar_connections")
      .select("calendar_id").eq("user_id", state.user_id).maybeSingle();
    if (existingConnectionError) throw existingConnectionError;
    const existingCalendarId = String(existingConnection?.calendar_id || "");
    let calendarId = "";
    if (existingCalendarId) {
      const calendar = await googleFetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(existingCalendarId)}`,
        String(token.access_token),
      );
      calendarId = verifiedReconnectCalendarId(existingCalendarId, calendar);
    }
    const encrypted = await encryptCalendarToken({
      access_token: token.access_token, refresh_token: token.refresh_token,
      expires_at: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(), scope: token.scope || GOOGLE_SCOPE,
    }, config.encryptionKey);
    const { error: connectionSaveError } = await db.from("quickflex_calendar_connections").upsert({
      user_id: state.user_id, token_ciphertext: encrypted, calendar_id: calendarId, connection_status: "connected",
      expires_at: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(), last_error: "", updated_at: new Date().toISOString(),
    });
    if (connectionSaveError) throw connectionSaveError;
    return callbackRedirect(returnTo, "connected");
  } catch (_) {
    if (returnTo) return callbackRedirect(returnTo, "failed");
    return new Response("Google Calendar connection could not be completed.", { status: 400, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return json(request, { ok: true });
  if (request.method === "GET") return handleCallback(request);
  if (request.method !== "POST") return json(request, { error: "POST 요청만 지원합니다." }, 405);
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action || "");
    if (action === "worker") return json(request, await runQueuedJobs(request));
    const user = await authenticatedUser(request);
    if (action === "status") return json(request, await statusFor(user.id));
    if (action === "oauth_start") { await assertApprovedUser(user.id); return startOauth(request, user.id, body); }
    if (action === "queue") { await assertApprovedUser(user.id); return json(request, await queueJob(user.id, body, false)); }
    if (action === "reapply") { await assertApprovedUser(user.id); return json(request, await queueJob(user.id, body, true)); }
    if (action === "disconnect") {
      const db = privilegedDb();
      await db.from("quickflex_calendar_connections").update({ connection_status: "disconnected", updated_at: new Date().toISOString() }).eq("user_id", user.id);
      return json(request, { state: "disconnected", preservesExternalEvents: true });
    }
    throw new HttpError(400, "지원하지 않는 캘린더 작업입니다.");
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    return json(request, { error: error instanceof Error ? error.message : "캘린더 서버 오류" }, status);
  }
});
