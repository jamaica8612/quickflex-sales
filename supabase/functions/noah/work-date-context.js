import { koreanDateKey, resolveWorkDates } from "./work-date.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read only this account's current Korean work date evidence with its JWT client. */
export async function readNoahWorkDateContext({ client, userId, workShift, now = new Date() }) {
  if (!client?.from || !UUID.test(String(userId))) throw new TypeError("Verified account required");
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new RangeError("Invalid server time");
  const today = koreanDateKey(instant);
  const names = ["record", "schedule", "completion", "lease"];
  const checks = [
    () => client.from("quickflex_day_records").select("work_date,is_off")
      .eq("user_id", userId).eq("work_date", today).maybeSingle(),
    () => client.from("quickflex_day_route_items").select("route")
      .eq("user_id", userId).eq("work_date", today).limit(1000),
    () => client.from("quickflex_sales_work_results").select("work_id")
      .eq("user_id", userId).eq("work_date", today).limit(1),
    () => client.from("quickflex_active_work_leases").select("work_date,lease_expires_at,released_at")
      .eq("user_id", userId).is("released_at", null)
      .gt("lease_expires_at", instant.toISOString()).maybeSingle(),
  ];
  const results = await Promise.allSettled(checks.map((check) => Promise.resolve().then(check)));
  const known = results.map((result, index) => {
    if (result.status !== "fulfilled" || result.value?.error
      || !Object.hasOwn(result.value ?? {}, "data")) return false;
    if ((index === 1 || index === 2) && !Array.isArray(result.value.data)) return false;
    return true;
  });
  const splitStoredRoutes = (value) => String(value || "").split(/[,\s/|]+/)
    .map((route) => route.trim().toUpperCase()).filter(Boolean);
  const scheduleRows = known[1] ? results[1].value.data : [];
  const scheduled = scheduleRows.some((row) => splitStoredRoutes(row.route).length > 0);
  // A capped page with no usable route cannot establish that the full day is empty.
  if (known[1] && scheduleRows.length >= 1000 && !scheduled) known[1] = false;
  const unavailable = names.filter((_, index) => !known[index]);
  const [day, , completions, lease] = results.map((result, index) =>
    known[index] ? result.value.data : undefined);
  // Guard against stale mocked/cached results as well as relying on the DB filter.
  const activeWorkDate = !known[3] ? undefined : lease?.released_at == null
    && Number.isFinite(Date.parse(lease?.lease_expires_at))
    && Date.parse(lease.lease_expires_at) > instant.getTime()
    ? lease.work_date : null;
  const dayState = {
    isOff: known[0] ? day?.is_off === true : undefined,
    hasRecord: known[0] ? Boolean(day) : undefined,
    hasSchedule: known[0] && known[1] ? scheduled : undefined,
    hasAutomaticCompletion: known[2] ? completions.length > 0 : undefined,
    activeWorkDate,
  };
  return { today, workShift, ...resolveWorkDates({ now: instant, workShift, dayState }), dayState, unavailable };
}
