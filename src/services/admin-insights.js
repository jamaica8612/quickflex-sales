// Admin-only aggregate views: per-screen usage and pending sign-up counts.
// Both RPCs return small aggregates only, never raw events or personal data.

export const USAGE_SCREEN_LABELS = Object.freeze({
  home: "매출노트",
  measurement: "배송노트",
  noah: "노아",
  routes: "구역노트",
  stats: "정산노트",
  record: "기록 입력",
  inspection: "일상점검",
  settings: "설정",
  admin: "관리자",
});

export const USAGE_SCREEN_SUMMARY_WINDOWS = Object.freeze([7, 30]);
export const USAGE_SCREEN_SUMMARY_DEFAULT_WINDOW = 30;

export const ADMIN_INSIGHTS_RPC = Object.freeze({
  screenSummary: "quickflex_usage_screen_summary",
  pendingSignups: "quickflex_pending_signups",
});

export function usageScreenLabel(screen) {
  return USAGE_SCREEN_LABELS[screen] || String(screen || "");
}

function nonNegativeInt(value) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : 0;
}

export function formatUsageScreenSummaryRow(row) {
  const userCount = nonNegativeInt(row?.user_count);
  const viewCount = nonNegativeInt(row?.view_count);
  return {
    screen: row?.screen || "",
    label: usageScreenLabel(row?.screen),
    userCount,
    viewCount,
    countsText: `${userCount}명 · ${viewCount}회`,
  };
}

export function formatUsageScreenSummary(rows) {
  return (Array.isArray(rows) ? rows : []).map(formatUsageScreenSummaryRow);
}

export function normalizeUsageSummaryWindow(windowDays) {
  const days = Number(windowDays);
  return USAGE_SCREEN_SUMMARY_WINDOWS.includes(days) ? days : USAGE_SCREEN_SUMMARY_DEFAULT_WINDOW;
}

export async function fetchUsageScreenSummary(db, options = {}) {
  if (typeof db?.rpc !== "function") throw new Error("Supabase client is unavailable");
  const windowDays = normalizeUsageSummaryWindow(options.windowDays);
  const { data, error } = await db.rpc(ADMIN_INSIGHTS_RPC.screenSummary, { p_window_days: windowDays });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

export function normalizePendingSignups(row) {
  return {
    pendingCount: nonNegativeInt(row?.pending_count),
    oldestWaitingDays: nonNegativeInt(row?.oldest_waiting_days),
  };
}

export function shouldShowPendingSignupsNotice(data) {
  return nonNegativeInt(data?.pendingCount) > 0;
}

export function pendingSignupsBannerText(data) {
  const pendingCount = nonNegativeInt(data?.pendingCount);
  if (pendingCount <= 0) return "";
  const oldestWaitingDays = nonNegativeInt(data?.oldestWaitingDays);
  return `가입 승인 대기 ${pendingCount}명 · 가장 오래 ${oldestWaitingDays}일째`;
}

export function pendingSignupsGearLabel(data) {
  const pendingCount = nonNegativeInt(data?.pendingCount);
  return pendingCount > 0 ? `설정, 가입 승인 대기 ${pendingCount}명` : "설정";
}

export async function fetchPendingSignups(db) {
  if (typeof db?.rpc !== "function") throw new Error("Supabase client is unavailable");
  const { data, error } = await db.rpc(ADMIN_INSIGHTS_RPC.pendingSignups);
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return normalizePendingSignups(row);
}
