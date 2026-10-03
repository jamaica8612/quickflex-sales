const PAGE_SIZE = 1000;
const SELECT = "user_id,work_id,work_date,work_shift,started_at,ended_at,active_seconds,measured_items,route_active_seconds,updated_at";

// Optional until the timing migration is deployed. Never request another owner.
export async function fetchWorkTimings(db, userId) {
  if (!db || !userId) return { rows: [], available: false };
  const rows = [];
  let expected = null;
  for (let offset = 0; offset < 10000000;) {
    const { data, error, count, status } = await db.from("quickflex_work_timings")
      .select(SELECT, { count: "exact" }).eq("user_id", userId)
      .order("work_date").order("work_id").range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      if (status === 404 || ["42P01", "PGRST205"].includes(error.code)) return { rows: [], available: false };
      throw error;
    }
    const batch = data || [];
    if (expected === null && Number.isSafeInteger(count)) expected = count;
    rows.push(...batch.filter((row) => row.user_id === userId));
    offset += batch.length;
    if (!batch.length || (expected !== null && offset >= expected) || (expected === null && batch.length < PAGE_SIZE)) {
      return { rows, available: true };
    }
  }
  throw new Error("시간 기록 조회량이 안전 한도를 넘었어요.");
}
