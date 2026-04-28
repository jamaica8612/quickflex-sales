"use strict";

import { DB_KEY, DEFAULT_BACKUP_UNIT, GOAL, PUBLIC_SUPABASE_CONFIG, TABLES, WEEKDAYS } from "./config.js";

const GOAL_KEY = "quickflex-goal";
function getGoal() { return parseInt(localStorage.getItem(GOAL_KEY) || "", 10) || GOAL; }
function saveGoalLocal(val) { const n = parseInt(val, 10); if (n > 0) localStorage.setItem(GOAL_KEY, n); }
function goalRawValue() { return parseInt((el.goalAmountInput.value || "").replace(/,/g, ""), 10) || 0; }
function formatGoalInput() {
  const raw = goalRawValue();
  el.goalAmountInput.value = raw > 0 ? raw.toLocaleString("ko-KR") : "";
}
import { fmtCount, fmtNum, fmtWon } from "./lib/format.js";

const isLocalRuntime = ["localhost", "127.0.0.1", ""].includes(location.hostname) || location.protocol === "file:";
const LEGACY_USER_NAMES = new Map([["kim-gwanhyun", "김관현"]]);

const SAMPLE_SETTLEMENT = [
  ["302B", 306, 347310], ["302C", 237, 231075], ["303A", 220, 212300], ["303B", 573, 544350],
  ["304C", 53, 49025], ["308B", 165, 159225], ["308C", 154, 148610], ["310C", 473, 404415],
  ["310D", 370, 334895], ["311C", 139, 142475], ["311D", 173, 173865], ["313B", 194, 163930],
  ["313C", 57, 52725], ["313D", 186, 162750], ["314A", 305, 236375], ["314B", 210, 166950],
  ["316C", 177, 146025], ["316D", 80, 70000], ["318A", 179, 142305], ["318B", 132, 108900],
  ["318C", 360, 286200], ["318D", 58, 46110], ["319A", 212, 174900], ["319B", 189, 155925],
  ["319C", 106, 108650], ["322A", 281, 231825], ["322B", 230, 212750], ["322C", 224, 229600],
  ["322D", 179, 183475], ["324C", 127, 117475], ["324D", 50, 53750], ["407B", 218, 179850],
  ["407D", 54, 44550],
];
const DEFAULT_ROUTE_MASTER = [
  "302A", "302B", "302C", "302D",
  "303A", "303B",
  "304A", "304B", "304C", "304D",
  "308B", "308C",
  "310A", "310C", "310D",
  "311A", "311B", "311C", "311D",
  "313A", "313B", "313C", "313D",
  "314A", "314B", "314C", "314D",
  "316A", "316B", "316C", "316D",
  "318A", "318B", "318C", "318D",
  "319A", "319B", "319C",
  "322A", "322B", "322C", "322D",
  "324A", "324B", "324C", "324D",
  "407A", "407B", "407C", "407D",
  "410A", "410B", "410C", "410D",
  "425B", "425C", "425D",
  "428A", "428B", "428C", "428D",
];

const today = new Date();
const initialPeriodMonth = today.getDate() <= 25 ? today.getMonth() + 1 : today.getMonth() + 2;
const initialPeriodDate = new Date(today.getFullYear(), initialPeriodMonth - 1, 1);

const state = {
  year: initialPeriodDate.getFullYear(),
  month: initialPeriodDate.getMonth() + 1,
  selectedDate: toDateKey(today),
  mode: "amount",
  statsYear: initialPeriodDate.getFullYear(),
  statsMonth: initialPeriodDate.getMonth() + 1,
  statsDetailDate: "",
  adminStatsDetailUser: "",
  adminTab: "summary",
  rates: [],
  entries: {},
  db: null,
  session: null,
  profile: null,
  authMode: "login",
  pendingDates: new Set(),
  pendingRates: false,
  saveTimer: null,
  flushing: false,
  flushAgain: false,
};

let ocrDraftMap = null;
let toastTimer = null;
const $ = (id) => document.getElementById(id);
const el = {
  app: $("app"),
  setupOverlay: $("setupOverlay"),
  setupUrl: $("setupUrl"),
  setupKey: $("setupKey"),
  setupConnect: $("setupConnect"),
  setupError: $("setupError"),
  authOverlay: $("authOverlay"),
  authTitle: $("authTitle"),
  authHint: $("authHint"),
  authEmail: $("authEmail"),
  authPassword: $("authPassword"),
  authSignupFields: $("authSignupFields"),
  authName: $("authName"),
  authDriverType: $("authDriverType"),
  loginBtn: $("loginBtn"),
  signupBtn: $("signupBtn"),
  forgotPasswordBtn: $("forgotPasswordBtn"),
  authError: $("authError"),
  pendingOverlay: $("pendingOverlay"),
  pendingLogout: $("pendingLogout"),
  profileName: $("profileName"),
  periodRange: $("periodRange"),
  periodRevenue: $("periodRevenue"),
  periodCount: $("periodCount"),
  dailyAverage: $("dailyAverage"),
  workDaysHome: $("workDaysHome"),
  meterFill: $("meterFill"),
  meterLabel: $("meterLabel"),
  goalAmountInput: $("goalAmountInput"),
  saveAppSettings: $("saveAppSettings"),
  monthTitle: $("monthTitle"),
  monthCalendar: $("monthCalendar"),
  prevMonth: $("prevMonth"),
  nextMonth: $("nextMonth"),
  todayButton: $("todayButton"),
  homeSelectedDate: $("homeSelectedDate"),
  homeSelectedTotal: $("homeSelectedTotal"),
  homeOffToggle: $("homeOffToggle"),
  openRecord: $("openRecord"),
  openSettings: $("openSettings"),
  backToCalendar: $("backToCalendar"),
  prevDay: $("prevDay"),
  nextDay: $("nextDay"),
  selectedDateTitle: $("selectedDateTitle"),
  offToggle: $("offToggle"),
  addRoute: $("addRoute"),
  entryRows: $("entryRows"),
  freshCount: $("freshCount"),
  freshUnit: $("freshUnit"),
  freshRevenue: $("freshRevenue"),
  freshSingleRow: $("freshSingleRow"),
  freshDualRow: $("freshDualRow"),
  freshSoloCount: $("freshSoloCount"),
  freshLinkedCount: $("freshLinkedCount"),
  freshDualRevenue: $("freshDualRevenue"),
  backupRow: $("backupRow"),
  backupCount: $("backupCount"),
  backupUnit: $("backupUnit"),
  backupRevenue: $("backupRevenue"),
  selectedDayTotal: $("selectedDayTotal"),
  saveRecord: $("saveRecord"),
  statsMonthTitle: $("statsMonthTitle"),
  statsRange: $("statsRange"),
  statsRevenue: $("statsRevenue"),
  statsMeterFill: $("statsMeterFill"),
  statsWorkDays: $("statsWorkDays"),
  statsOffDays: $("statsOffDays"),
  statsCount: $("statsCount"),
  statsFresh: $("statsFresh"),
  statsAverage: $("statsAverage"),
  statsBestDay: $("statsBestDay"),
  statsWorstDay: $("statsWorstDay"),
  statsPrevMonth: $("statsPrevMonth"),
  statsNextMonth: $("statsNextMonth"),
  dailyList: $("dailyList"),
  yearlyStats: $("yearlyStats"),
  totalStats: $("totalStats"),
  adminMonthTitle: $("adminMonthTitle"),
  adminRange: $("adminRange"),
  adminPrevMonth: $("adminPrevMonth"),
  adminNextMonth: $("adminNextMonth"),
  adminRevenueList: $("adminRevenueList"),
  adminRouteList: $("adminRouteList"),
  backFromSettings: $("backFromSettings"),
  logoutBtn: $("logoutBtn"),
  syncStatus: $("syncStatus"),
  profileDisplayName: $("profileDisplayName"),
  fixedRoutesText: $("fixedRoutesText"),
  fixedRoutesInput: $("fixedRoutesInput"),
  saveProfile: $("saveProfile"),
  rateRoute: $("rateRoute"),
  rateUnit: $("rateUnit"),
  saveRate: $("saveRate"),
  rateList: $("rateList"),
  scheduleImage: $("scheduleImage"),
  runScheduleOcr: $("runScheduleOcr"),
  ocrStatus: $("ocrStatus"),
  schedulePreview: $("schedulePreview"),
  scheduleDraftSection: $("scheduleDraftSection"),
  scheduleDraftCards: $("scheduleDraftCards"),
  shiftScheduleBack: $("shiftScheduleBack"),
  shiftScheduleForward: $("shiftScheduleForward"),
  parseSchedule: $("parseSchedule"),
  scheduleCsvInput: $("scheduleCsvInput"),
  parseScheduleCsv: $("parseScheduleCsv"),
  settlementImage: $("settlementImage"),
  runSettlementOcr: $("runSettlementOcr"),
  settlementStatus: $("settlementStatus"),
  settlementPreview: $("settlementPreview"),
  csvInput: $("csvInput"),
  parseCsv: $("parseCsv"),
  adminSection: $("adminSection"),
  adminProfiles: $("adminProfiles"),
  resetData: $("resetData"),
  requestAccountDelete: $("requestAccountDelete"),
  openDbSettings: $("openDbSettings"),
  dbStatusBadge: $("dbStatusBadge"),
  dbOverlay: $("dbOverlay"),
  dbSheet: $("dbSheet"),
  supabaseUrl: $("supabaseUrl"),
  supabaseAnonKey: $("supabaseAnonKey"),
  saveDbConfig: $("saveDbConfig"),
  syncNow: $("syncNow"),
  dbStatus: $("dbStatus"),
  toast: $("toast"),
  entryTemplate: $("entryTemplate"),
  navTabs: document.querySelectorAll(".nav-tab"),
  modeBtns: document.querySelectorAll(".mode-btn"),
  statsTabs: document.querySelectorAll("[data-tab]"),
  statsPanels: document.querySelectorAll(".stats-panel"),
  adminTabs: document.querySelectorAll("[data-admin-tab]"),
  adminPanels: document.querySelectorAll("[data-admin-panel]"),
};

function toast(message, type = "") {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.className = `toast show${type ? ` ${type}` : ""}`;
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2800);
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
function parseDateKey(key) { return new Date(`${key}T00:00:00`); }
function addDays(key, amount) {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}
function todayKey() { return toDateKey(new Date()); }
function formatShort(date) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}
function formatLong(key) {
  const date = parseDateKey(key);
  return `${date.getFullYear()}년 ${String(date.getMonth() + 1).padStart(2, "0")}월 ${String(date.getDate()).padStart(2, "0")}일(${WEEKDAYS[date.getDay()]})`;
}
function formatRecordTitleDate(key) {
  const date = parseDateKey(key);
  return `${String(date.getFullYear()).slice(2)}년 ${String(date.getMonth() + 1).padStart(2, "0")}월 ${String(date.getDate()).padStart(2, "0")}일`;
}
function formatLongShort(key) {
  const date = parseDateKey(key);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}(${WEEKDAYS[date.getDay()]})`;
}
function periodBounds(year = state.year, month = state.month) {
  return { start: new Date(year, month - 2, 26), end: new Date(year, month - 1, 25) };
}
function periodKeysFor(year, month) {
  const { start, end } = periodBounds(year, month);
  const keys = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    keys.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}
function periodKeys() { return periodKeysFor(state.year, state.month); }
function prevPeriod(year = state.year, month = state.month) {
  const date = new Date(year, month - 2, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}
function toNum(value) { return Number(String(value ?? "").replace(/[^\d.-]/g, "")) || 0; }
function normalizeRoute(value) { return String(value || "").trim().toUpperCase(); }
function routeListFromText(value) {
  return String(value || "")
    .split(/[,\s/|]+/)
    .map(normalizeRoute)
    .filter(Boolean)
    .filter((route, index, list) => list.indexOf(route) === index);
}
function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function splitStoredRoutes(value) { return routeListFromText(value); }
function joinStoredRoutes(routes) { return routeListFromText(Array.isArray(routes) ? routes.join("|") : routes).join("|"); }
function compactRouteList(routes) {
  const groups = new Map();
  routeListFromText(routes).forEach((route) => {
    const prefix = route.slice(0, 3);
    const suffix = route.slice(3);
    if (!groups.has(prefix)) groups.set(prefix, []);
    if (!groups.get(prefix).includes(suffix)) groups.get(prefix).push(suffix);
  });
  return [...groups.entries()].map(([prefix, suffixes]) => `${prefix}${suffixes.join("")}`).join(" ");
}
function formatRouteLabel(value) {
  return compactRouteList(splitStoredRoutes(value));
}
function formatRecordRoutes(rows) {
  return compactRouteList((rows || []).flatMap((row) => splitStoredRoutes(row.route)));
}
function currentUserId() { return state.session?.user?.id || ""; }
function isBackupDriver() { return (state.profile?.driver_type || "backup") === "backup"; }
function fixedRoutes() { return Array.isArray(state.profile?.fixed_routes) ? state.profile.fixed_routes.map(normalizeRoute).filter(Boolean) : []; }
function driverName() { return state.profile?.display_name || state.session?.user?.email || "매출관리"; }
function statusLabel(status) {
  if (status === "approved") return "승인";
  if (status === "blocked") return "차단";
  return "미승인";
}
function driverTypeLabel(driverType) {
  return driverType === "fixed" ? "고정기사" : "백업기사";
}
function profileNameForDisplay(profile) {
  return profile?.display_name || LEGACY_USER_NAMES.get(profile?.id) || profile?.email || "사용자";
}
function rateFor(route) {
  const normalized = normalizeRoute(route);
  return state.rates.find((rate) => rate.route === normalized)?.unit || 0;
}
function sharedRateForRoutes(routes) {
  const list = splitStoredRoutes(routes);
  if (!list.length) return 0;
  const units = list.map(rateFor).filter((unit) => unit > 0);
  if (!units.length) return 0;
  return units.every((unit) => unit === units[0]) ? units[0] : 0;
}
function defaultFreshUnit(value) { return value == null || value === "" ? 100 : value; }
function defaultBackupUnit(value) { return value == null || value === "" ? DEFAULT_BACKUP_UNIT : value; }
function freshbagMode() { return state.profile?.freshbag_mode || "single"; }
function emptyRecord() { return { off: false, rows: [], freshCount: "", freshUnit: 100, freshSoloCount: "", freshLinkedCount: "", backupUnit: DEFAULT_BACKUP_UNIT, driverType: isBackupDriver() ? "backup" : "fixed" }; }
function normalizeRecordShape(record) {
  const next = {
    off: Boolean(record?.off),
    rows: Array.isArray(record?.rows) ? record.rows.map((row) => ({ ...row })) : [],
    freshCount: record?.freshCount ?? "",
    freshUnit: defaultFreshUnit(record?.freshUnit),
    freshSoloCount: record?.freshSoloCount ?? "",
    freshLinkedCount: record?.freshLinkedCount ?? "",
    backupUnit: defaultBackupUnit(record?.backupUnit),
    driverType: record?.driverType || (isBackupDriver() ? "backup" : "fixed"),
  };
  next.rows = next.rows
    .map((row) => ({
      route: joinStoredRoutes(row.route),
      count: row.count ?? "",
      unit: row.unit ?? sharedRateForRoutes(row.route) ?? 0,
    }))
    .filter((row) => row.route || toNum(row.count) > 0 || toNum(row.unit) > 0);
  next.rows.forEach((row) => {
    if (!toNum(row.unit) && row.route) row.unit = sharedRateForRoutes(row.route) || rateFor(row.route);
  });
  next.rows = mergeGroupedRows(next.rows);
  return next;
}
function getRecord(dateKey, create = false) {
  if (!state.entries[dateKey]) {
    if (!create) return emptyRecord();
    state.entries[dateKey] = normalizeRecordShape(emptyRecord());
  }
  return state.entries[dateKey];
}
function setRecord(dateKey, record) { state.entries[dateKey] = normalizeRecordShape(record); }
function hasMeaningfulRecord(record) {
  const rec = normalizeRecordShape(record);
  return rec.off || rec.rows.length > 0 || toNum(rec.freshCount) > 0 || toNum(rec.freshUnit) !== 100 || (isBackupDriver() && toNum(rec.backupUnit) !== DEFAULT_BACKUP_UNIT);
}
function mergeGroupedRows(rows) {
  const merged = [];
  rows.forEach((row) => {
    const routes = splitStoredRoutes(row.route);
    if (!routes.length) return;
    const unit = toNum(row.unit) || sharedRateForRoutes(routes) || 0;
    const prefix = routes[0].slice(0, 3);
    const canGroup = unit > 0 && routes.every((route) => route.slice(0, 3) === prefix);
    const existing = canGroup ? merged.find((item) => {
      const itemRoutes = splitStoredRoutes(item.route);
      return itemRoutes.length && itemRoutes.every((route) => route.slice(0, 3) === prefix) && toNum(item.unit) === unit;
    }) : null;
    if (existing) {
      existing.route = joinStoredRoutes([...splitStoredRoutes(existing.route), ...routes]);
      existing.count = toNum(existing.count) || toNum(row.count) ? String(toNum(existing.count) + toNum(row.count)) : "";
    } else {
      merged.push({ route: joinStoredRoutes(routes), count: row.count ?? "", unit });
    }
  });
  return merged;
}
function buildGroupedRows(routes) {
  return mergeGroupedRows(routeListFromText(routes).map((route) => ({ route, count: "", unit: rateFor(route) })));
}
function fixedDefaultRows() {
  return buildGroupedRows(fixedRoutes()).map((row) => ({ ...row, count: "" }));
}
function ensureFixedRecordRows(record) {
  if (isBackupDriver()) return record;
  if (record.off) return record;
  const allowed = fixedRoutes();
  if (!allowed.length) return record;
  const byRoute = new Map(record.rows.map((row) => [joinStoredRoutes(row.route), row]));
  const rows = fixedDefaultRows().map((row) => {
    const existing = byRoute.get(row.route);
    return existing ? { ...row, count: existing.count, unit: existing.unit || row.unit } : row;
  });
  record.rows = rows;
  return record;
}
function effectiveUnit(row) {
  const explicit = toNum(row.unit);
  if (explicit > 0) return explicit;
  const fallback = sharedRateForRoutes(row.route) || rateFor(row.route);
  if (fallback > 0) {
    row.unit = fallback;
    return fallback;
  }
  return 0;
}
function calcRecordDetails(record) {
  const rec = normalizeRecordShape(record);
  if (rec.off) return { count: 0, routeRevenue: 0, freshCount: 0, freshUnit: toNum(defaultFreshUnit(rec.freshUnit)), freshRevenue: 0, backupUnit: toNum(defaultBackupUnit(rec.backupUnit)), backupRevenue: 0, revenue: 0 };
  const routeTotal = rec.rows.reduce((sum, row) => {
    const count = toNum(row.count);
    return { count: sum.count + count, revenue: sum.revenue + count * effectiveUnit(row) };
  }, { count: 0, revenue: 0 });
  const isDual = freshbagMode() === "dual";
  const freshCount = isDual ? toNum(rec.freshSoloCount) + toNum(rec.freshLinkedCount) : toNum(rec.freshCount);
  const freshUnit = isDual ? 0 : toNum(defaultFreshUnit(rec.freshUnit));
  const freshRevenue = isDual ? toNum(rec.freshSoloCount) * 200 + toNum(rec.freshLinkedCount) * 100 : freshCount * freshUnit;
  const backupApplies = rec.driverType === "backup";
  const backupUnit = backupApplies ? toNum(defaultBackupUnit(rec.backupUnit)) : 0;
  const backupRevenue = backupApplies ? routeTotal.count * backupUnit : 0;
  return {
    count: routeTotal.count,
    routeRevenue: routeTotal.revenue,
    freshCount,
    freshUnit,
    freshRevenue,
    backupUnit,
    backupRevenue,
    revenue: routeTotal.revenue + freshRevenue + backupRevenue,
  };
}
function calcRecord(record) {
  const details = calcRecordDetails(record);
  return { count: details.count, revenue: details.revenue };
}
function summarizePeriod(year = state.year, month = state.month) {
  let best = { dateKey: "", revenue: 0 };
  let worst = { dateKey: "", revenue: Infinity };
  const total = periodKeysFor(year, month).reduce((sum, dateKey) => {
    const record = getRecord(dateKey, false);
    const calc = calcRecord(record);
    if (calc.revenue > best.revenue) best = { dateKey, revenue: calc.revenue };
    if (!record.off && calc.revenue > 0 && calc.revenue < worst.revenue) worst = { dateKey, revenue: calc.revenue };
    return {
      count: sum.count + calc.count,
      revenue: sum.revenue + calc.revenue,
      workDays: sum.workDays + (calc.revenue > 0 ? 1 : 0),
      offDays: sum.offDays + (record.off ? 1 : 0),
      fresh: sum.fresh + (record.off ? 0 : calc.freshCount),
    };
  }, { count: 0, revenue: 0, workDays: 0, offDays: 0, fresh: 0 });
  total.average = total.workDays ? total.revenue / total.workDays : 0;
  total.best = best;
  total.worst = worst.revenue < Infinity ? worst : { dateKey: "", revenue: 0 };
  return total;
}

function loadDbConfig() {
  if (PUBLIC_SUPABASE_CONFIG.url && PUBLIC_SUPABASE_CONFIG.anonKey) {
    return {
      url: normalizeUrl(PUBLIC_SUPABASE_CONFIG.url),
      anonKey: PUBLIC_SUPABASE_CONFIG.anonKey,
      source: "public",
    };
  }
  try { return JSON.parse(localStorage.getItem(DB_KEY)) || {}; } catch { return {}; }
}
function normalizeUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return `${url.protocol}//${url.host}`;
  } catch {
    return raw.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, "");
  }
}
function saveDbConfig(url, anonKey) {
  localStorage.setItem(DB_KEY, JSON.stringify({ url: normalizeUrl(url), anonKey }));
}
function hasPublicDbConfig() {
  return Boolean(PUBLIC_SUPABASE_CONFIG.url && PUBLIC_SUPABASE_CONFIG.anonKey);
}
function canUseManualDbConfig() {
  return isLocalRuntime;
}
function showDeploymentConfigError() {
  el.setupOverlay.classList.add("visible");
  el.setupUrl.closest(".setup-fields")?.classList.add("hidden");
  el.setupConnect.classList.add("hidden");
  el.setupError.textContent = "배포 설정 오류: 운영 주소에서는 Supabase 공개 설정이 필요합니다. app.js의 PUBLIC_SUPABASE_CONFIG에 Project URL과 anon public key를 넣어 배포하세요.";
}
function buildClient(url, anonKey) {
  if (!window.supabase || !url || !anonKey) return null;
  return window.supabase.createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
}
function getDbConfig() { return loadDbConfig(); }
function getEdgeFunctionUrl(name) {
  const cfg = getDbConfig();
  const base = normalizeUrl(cfg.url || "");
  return base ? `${base}/functions/v1/${name}` : "";
}
async function authHeaders() {
  const cfg = getDbConfig();
  const token = state.session?.access_token || cfg.anonKey;
  return { "Content-Type": "application/json", apikey: cfg.anonKey, Authorization: `Bearer ${token}` };
}
function showSetup(show) { el.setupOverlay.classList.toggle("visible", show && canUseManualDbConfig()); }
function showAuth(show) {
  if (show) setAuthMode("login");
  el.authOverlay.classList.toggle("visible", show);
}
function showPending(show) { el.pendingOverlay.classList.toggle("visible", show); }
function isPasswordRecoveryUrl() {
  return /type=recovery/.test(`${location.hash}${location.search}`);
}
function setAuthMode(mode) {
  state.authMode = mode === "signup" ? "signup" : mode === "reset" ? "reset" : "login";
  const signupMode = state.authMode === "signup";
  const resetMode = state.authMode === "reset";
  el.authTitle.textContent = signupMode ? "가입 요청" : resetMode ? "비밀번호 변경" : "로그인";
  el.authHint.textContent = signupMode
    ? "처음 사용하는 기사님은 가입 요청을 보내고 관리자 승인을 기다려 주세요."
    : resetMode
      ? "새 비밀번호를 입력해 주세요."
      : "";
  el.authHint.classList.toggle("hidden", !(signupMode || resetMode));
  el.authSignupFields.classList.toggle("hidden", !signupMode);
  el.authName.required = signupMode;
  el.authDriverType.disabled = !signupMode;
  el.authEmail.disabled = false;
  el.authPassword.autocomplete = signupMode || resetMode ? "new-password" : "current-password";
  el.loginBtn.textContent = signupMode || resetMode ? "로그인으로" : "로그인";
  el.signupBtn.textContent = signupMode ? "가입 요청 보내기" : resetMode ? "비밀번호 저장" : "가입 요청";
  el.forgotPasswordBtn.classList.toggle("hidden", signupMode || resetMode);
  el.authError.textContent = "";
}
function setDbBadge(connected, text = "") {
  el.dbStatusBadge.textContent = connected ? (text || "연결됨") : "미연결";
  el.dbStatus.textContent = connected ? "DB에 연결되어 있습니다." : "DB 연결이 필요합니다.";
  el.syncStatus.textContent = connected ? (text || "DB 연결됨") : "미연결";
}
function applyProfileUi() {
  const profile = state.profile || {};
  const isAdmin = profile.role === "admin";
  el.app.dataset.driverType = profile.driver_type || "backup";
  el.app.dataset.role = isAdmin ? "admin" : "driver";
  el.profileName.textContent = profile.display_name || "매출관리";
  el.profileDisplayName.value = profile.display_name || "";
  const fixedRouteText = (profile.fixed_routes || []).join(", ");
  el.fixedRoutesInput.value = fixedRouteText;
  if (el.fixedRoutesText) el.fixedRoutesText.textContent = fixedRouteText || "관리자가 지정한 라우트가 없습니다.";
  document.querySelectorAll(".admin-only").forEach((node) => node.classList.toggle("hidden", !isAdmin));
  if (!isAdmin && el.app.dataset.view === "admin") showView("home");
  el.openDbSettings.style.display = hasPublicDbConfig() && !isAdmin ? "none" : "";
  const mode = profile.freshbag_mode || "single";
  document.querySelectorAll('input[name="freshbagMode"]').forEach((radio) => {
    radio.checked = radio.value === mode;
  });
  const storedGoal = parseInt(localStorage.getItem(GOAL_KEY) || "", 10) || 0;
  el.goalAmountInput.value = storedGoal > 0 ? storedGoal.toLocaleString("ko-KR") : "";
}
async function connectDb(url, key, persist = false) {
  const client = buildClient(url, key);
  if (!client) throw new Error("Supabase 라이브러리를 불러오지 못했습니다.");
  state.db = client;
  if (persist && !hasPublicDbConfig()) saveDbConfig(url, key);
  el.setupUrl.value = normalizeUrl(url);
  el.setupKey.value = key;
  el.supabaseUrl.value = normalizeUrl(url);
  el.supabaseAnonKey.value = key;
  showSetup(false);
  setDbBadge(true);
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  state.session = data.session;
  if (state.session && isPasswordRecoveryUrl()) {
    showAuth(true);
    setAuthMode("reset");
    return;
  }
  if (!state.session) {
    showAuth(true);
    return;
  }
  await bootSignedInUser();
}
async function bootSignedInUser() {
  showAuth(false);
  await loadProfile();
  if (state.profile?.status !== "approved") {
    showPending(true);
    return;
  }
  showPending(false);
  applyProfileUi();
  await loadFromDb();
  renderAll();
  if (state.profile?.role === "admin" && el.app.dataset.view === "admin") await renderAdminDashboard();
}
async function loadProfile() {
  const user = state.session?.user;
  if (!user) return;
  const { data, error } = await state.db.from(TABLES.profiles).select("*").eq("id", user.id).maybeSingle();
  if (error) throw error;
  if (data) {
    state.profile = data;
    return;
  }
  const profile = {
    id: user.id,
    email: user.email,
    display_name: user.user_metadata?.display_name || user.email?.split("@")[0] || "사용자",
    driver_type: user.user_metadata?.driver_type === "fixed" ? "fixed" : "backup",
    status: "pending",
    role: "driver",
    fixed_routes: [],
  };
  const { data: inserted, error: insertError } = await state.db.from(TABLES.profiles).insert(profile).select("*").single();
  if (insertError) throw insertError;
  state.profile = inserted;
}
async function saveProfile() {
  const selectedMode = document.querySelector('input[name="freshbagMode"]:checked')?.value || "single";
  const payload = {
    display_name: el.profileDisplayName.value.trim() || driverName(),
    freshbag_mode: selectedMode,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await state.db.from(TABLES.profiles).update(payload).eq("id", currentUserId()).select("*").single();
  if (error) throw error;
  state.profile = data;
  applyProfileUi();
  Object.keys(state.entries).forEach((dateKey) => {
    if (!isBackupDriver()) ensureFixedRecordRows(state.entries[dateKey]);
  });
  renderAll();
  if (el.app.dataset.view === "record") renderEntryForm();
  toast("내 정보를 저장했습니다.", "success");
}
async function login() {
  el.authError.textContent = "";
  const { data, error } = await state.db.auth.signInWithPassword({ email: el.authEmail.value.trim(), password: el.authPassword.value });
  if (error) throw error;
  state.session = data.session;
  await bootSignedInUser();
}
async function signup() {
  el.authError.textContent = "";
  if (!el.authEmail.value.trim() || !el.authPassword.value) throw new Error("이메일과 비밀번호를 입력해 주세요.");
  if (!el.authName.value.trim()) throw new Error("가입 요청에는 이름이 필요합니다.");
  const { data, error } = await state.db.auth.signUp({
    email: el.authEmail.value.trim(),
    password: el.authPassword.value,
    options: {
      data: {
        display_name: el.authName.value.trim() || el.authEmail.value.trim(),
        driver_type: el.authDriverType.value === "fixed" ? "fixed" : "backup",
      },
    },
  });
  if (error) throw error;
  state.session = data.session;
  if (state.session) {
    await bootSignedInUser();
  } else {
    toast("가입 요청을 보냈습니다. 이메일 확인이 필요할 수 있습니다.", "success");
  }
}
async function sendPasswordReset() {
  el.authError.textContent = "";
  const email = el.authEmail.value.trim();
  if (!email) throw new Error("비밀번호를 재설정할 이메일을 입력해 주세요.");
  const redirectTo = location.protocol === "file:"
    ? "https://jamaica8612.github.io/quickflex-sales/"
    : `${location.origin}${location.pathname}`;
  const { error } = await state.db.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) throw error;
  toast("비밀번호 재설정 메일을 보냈습니다.", "success");
  el.authError.textContent = "메일의 링크를 열고 새 비밀번호를 설정해 주세요.";
}
async function updatePassword() {
  el.authError.textContent = "";
  if (!el.authPassword.value || el.authPassword.value.length < 6) throw new Error("새 비밀번호는 6자 이상으로 입력해 주세요.");
  const { error } = await state.db.auth.updateUser({ password: el.authPassword.value });
  if (error) throw error;
  toast("비밀번호가 변경되었습니다. 다시 로그인해 주세요.", "success");
  await logout();
}
async function logout() {
  if (state.db) await state.db.auth.signOut();
  state.session = null;
  state.profile = null;
  state.rates = [];
  state.entries = {};
  renderAll();
  showPending(false);
  showAuth(true);
}

function ratesFromDb(rows) {
  return (rows || []).map((row) => ({ route: normalizeRoute(row.route), unit: toNum(row.current_unit), count: 0, amount: 0 }))
    .filter((row) => row.route)
    .sort((a, b) => a.route.localeCompare(b.route));
}
function mergeDefaultRouteMaster(rates) {
  const byRoute = new Map((rates || []).map((rate) => [normalizeRoute(rate.route), { ...rate, route: normalizeRoute(rate.route), unit: toNum(rate.unit) }]));
  let changed = false;
  DEFAULT_ROUTE_MASTER.forEach((route) => {
    if (byRoute.has(route)) return;
    byRoute.set(route, { route, unit: 0, count: 0, amount: 0 });
    changed = true;
  });
  return { rates: [...byRoute.values()].sort((a, b) => a.route.localeCompare(b.route)), changed };
}
function entriesFromDb(dayRows, itemRows) {
  const entries = {};
  (dayRows || []).forEach((row) => {
    entries[row.work_date] = normalizeRecordShape({
      off: row.is_off,
      rows: [],
      freshCount: row.fresh_count ?? "",
      freshUnit: row.fresh_unit ?? 100,
      freshSoloCount: row.fresh_solo_count ?? "",
      freshLinkedCount: row.fresh_linked_count ?? "",
      backupUnit: row.backup_unit ?? DEFAULT_BACKUP_UNIT,
      driverType: row.driver_type || "backup",
    });
  });
  (itemRows || []).forEach((row) => {
    if (!entries[row.work_date]) entries[row.work_date] = emptyRecord();
    entries[row.work_date].rows.push({ route: row.route, count: row.delivery_count ?? "", unit: row.unit_snapshot ?? 0 });
  });
  Object.keys(entries).forEach((dateKey) => {
    entries[dateKey] = normalizeRecordShape(entries[dateKey]);
    if (!isBackupDriver()) ensureFixedRecordRows(entries[dateKey]);
  });
  return entries;
}
async function loadFromDb() {
  if (!state.db || !currentUserId()) return;
  const userId = currentUserId();
  const [ratesResult, daysResult, itemsResult] = await Promise.all([
    state.db.from(TABLES.rates).select("*").eq("user_id", userId).order("route"),
    state.db.from(TABLES.days).select("*").eq("user_id", userId),
    state.db.from(TABLES.items).select("*").eq("user_id", userId).order("sort_order"),
  ]);
  if (ratesResult.error) throw ratesResult.error;
  if (daysResult.error) throw daysResult.error;
  if (itemsResult.error) throw itemsResult.error;
  state.rates = ratesFromDb(ratesResult.data);
  state.entries = entriesFromDb(daysResult.data, itemsResult.data);
  const hadRates = state.rates.length > 0;
  if (!state.rates.length) {
    state.rates = avgRates(SAMPLE_SETTLEMENT);
  }
  const merged = mergeDefaultRouteMaster(state.rates);
  state.rates = merged.rates;
  if (!hadRates || merged.changed) await persistRates();
  setDbBadge(true, "동기화됨");
}
async function persistRates() {
  const userId = currentUserId();
  const cleanRates = state.rates.filter((rate) => normalizeRoute(rate.route) && toNum(rate.unit) >= 0);
  const { error: upsertError } = await state.db.from(TABLES.rates).upsert(cleanRates.map((rate) => ({
    user_id: userId,
    route: normalizeRoute(rate.route),
    current_unit: toNum(rate.unit),
    updated_at: new Date().toISOString(),
  })), { onConflict: "user_id,route" });
  if (upsertError) throw upsertError;
}
async function persistDay(dateKey) {
  const userId = currentUserId();
  const rec = normalizeRecordShape(getRecord(dateKey, false));
  const { error: deleteItemsError } = await state.db.from(TABLES.items).delete().eq("user_id", userId).eq("work_date", dateKey);
  if (deleteItemsError) throw deleteItemsError;
  if (!hasMeaningfulRecord(rec)) {
    const { error: deleteDayError } = await state.db.from(TABLES.days).delete().eq("user_id", userId).eq("work_date", dateKey);
    if (deleteDayError) throw deleteDayError;
    delete state.entries[dateKey];
    return;
  }
  const dayPayload = {
    user_id: userId,
    work_date: dateKey,
    is_off: rec.off,
    fresh_count: rec.off ? 0 : toNum(rec.freshCount),
    fresh_unit: toNum(defaultFreshUnit(rec.freshUnit)),
    fresh_solo_count: rec.off ? 0 : toNum(rec.freshSoloCount),
    fresh_linked_count: rec.off ? 0 : toNum(rec.freshLinkedCount),
    backup_unit: isBackupDriver() ? toNum(defaultBackupUnit(rec.backupUnit)) : 0,
    driver_type: isBackupDriver() ? "backup" : "fixed",
    updated_at: new Date().toISOString(),
  };
  const { error: dayError } = await state.db.from(TABLES.days).upsert(dayPayload, { onConflict: "user_id,work_date" });
  if (dayError) throw dayError;
  const itemPayload = rec.off ? [] : rec.rows
    .filter((row) => row.route)
    .map((row, index) => ({
      user_id: userId,
      work_date: dateKey,
      route: joinStoredRoutes(row.route),
      delivery_count: toNum(row.count),
      unit_snapshot: effectiveUnit(row),
      sort_order: index,
      updated_at: new Date().toISOString(),
    }));
  if (itemPayload.length) {
    const { error: itemError } = await state.db.from(TABLES.items).insert(itemPayload);
    if (itemError) throw itemError;
  }
}
function scheduleSave({ dateKeys = [], rates = false, immediate = false } = {}) {
  dateKeys.forEach((key) => state.pendingDates.add(key));
  if (rates) state.pendingRates = true;
  if (!state.db || !currentUserId()) return;
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(flushSaves, immediate ? 0 : 450);
}
async function flushSaves() {
  if (!state.db || !currentUserId()) return;
  if (state.flushing) {
    state.flushAgain = true;
    return;
  }
  state.flushing = true;
  try {
    if (state.pendingRates) {
      state.pendingRates = false;
      await persistRates();
    }
    const dates = [...state.pendingDates];
    state.pendingDates.clear();
    for (const dateKey of dates) await persistDay(dateKey);
    setDbBadge(true, `${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 저장됨`);
  } catch (error) {
    console.error("[DB save]", error);
    toast(`DB 저장 실패: ${error.message}`, "error");
  } finally {
    state.flushing = false;
    if (state.flushAgain) {
      state.flushAgain = false;
      flushSaves();
    }
  }
}
async function ensurePendingSavesFlushed() {
  clearTimeout(state.saveTimer);
  await flushSaves();
}

function showView(view) {
  if (view === "admin" && state.profile?.role !== "admin") view = "home";
  el.app.dataset.view = view;
  el.navTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  if (view === "record") renderEntryForm();
  if (view === "stats") renderStats();
  if (view === "admin") renderAdminDashboard();
  if (view === "settings") {
    renderRates();
  }
}
function renderAll() {
  applyProfileUi();
  renderSummary();
  renderMonth();
  renderHomeSelection();
  renderRates();
  renderStats();
  if (el.app.dataset.view === "admin") renderAdminDashboard();
}
function renderSummary() {
  const { start, end } = periodBounds();
  const total = summarizePeriod();
  el.periodRange.textContent = `정산기간 ${formatShort(start)} ~ ${formatShort(end)}`;
  el.monthTitle.textContent = `${state.year}년 ${String(state.month).padStart(2, "0")}월`;
  el.periodRevenue.textContent = fmtWon(total.revenue);
  el.periodCount.textContent = fmtCount(total.count);
  el.dailyAverage.textContent = fmtWon(total.average);
  el.workDaysHome.textContent = `${total.workDays}일`;
  const goal = getGoal();
  el.meterFill.style.width = `${Math.min(100, total.revenue / goal * 100)}%`;
  el.meterLabel.textContent = `목표 ${fmtWon(goal)} 대비 진행률`;
}
function renderMonth() {
  const { start } = periodBounds();
  const first = new Date(start);
  first.setDate(first.getDate() - first.getDay());
  el.monthCalendar.innerHTML = "";
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(first);
    date.setDate(first.getDate() + i);
    const dateKey = toDateKey(date);
    const record = getRecord(dateKey, false);
    const calc = calcRecord(record);
    const inPeriod = periodKeys().includes(dateKey);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `day-cell${inPeriod ? "" : " outside"}${dateKey === state.selectedDate ? " selected" : ""}${dateKey === todayKey() ? " today-cell" : ""}${record.off ? " off" : ""}`;
    const routeText = record.off ? "" : formatRecordRoutes(record.rows);
    const value = record.off ? "휴무" : state.mode === "count" ? (calc.count ? fmtCount(calc.count) : "") : (calc.revenue ? fmtNum(calc.revenue) : "");
    cell.innerHTML = `<span class="day-number">${date.getDate()}</span><span class="day-value">${value}</span><span class="day-routes">${routeText}</span>`;
    cell.addEventListener("click", () => selectDate(dateKey));
    el.monthCalendar.appendChild(cell);
  }
}
function renderHomeSelection() {
  const record = getRecord(state.selectedDate, false);
  const calc = calcRecord(record);
  el.homeSelectedDate.textContent = formatLong(state.selectedDate);
  el.homeSelectedTotal.textContent = record.off ? "휴무" : fmtWon(calc.revenue);
  el.homeOffToggle.classList.toggle("active", record.off);
}
function selectDate(dateKey) {
  state.selectedDate = dateKey;
  renderMonth();
  renderHomeSelection();
}
function moveMonth(amount) {
  const date = new Date(state.year, state.month - 1 + amount, 1);
  state.year = date.getFullYear();
  state.month = date.getMonth() + 1;
  state.selectedDate = toDateKey(periodBounds().end);
  renderSummary();
  renderMonth();
  renderHomeSelection();
}

function routeOptions(selected) {
  const selectedRoutes = splitStoredRoutes(selected);
  const optionRoutes = new Set(state.rates.map((rate) => rate.route));
  selectedRoutes.forEach((route) => optionRoutes.add(route));
  if (!isBackupDriver()) fixedRoutes().forEach((route) => optionRoutes.add(route));
  return [...optionRoutes].sort().map((route) => `<option value="${route}"${selectedRoutes[0] === route ? " selected" : ""}>${route}</option>`).join("");
}
function renderEntryForm() {
  let record = getRecord(state.selectedDate, true);
  if (record.off) record.rows = [];
  if (!isBackupDriver()) record = ensureFixedRecordRows(record);
  setRecord(state.selectedDate, record);
  el.selectedDateTitle.textContent = formatRecordTitleDate(state.selectedDate);
  el.offToggle.checked = record.off;
  el.entryRows.innerHTML = "";
  record.rows.forEach((row, index) => renderEntryRow(row, index));
  if (!record.rows.length && !record.off && !isBackupDriver() && fixedRoutes().length) {
    record.rows = fixedDefaultRows();
    record.rows.forEach((row, index) => renderEntryRow(row, index));
  }
  const dual = freshbagMode() === "dual";
  el.freshSingleRow.classList.toggle("hidden", dual);
  el.freshDualRow.classList.toggle("hidden", !dual);
  el.freshCount.value = record.freshCount || "";
  el.freshUnit.value = defaultFreshUnit(record.freshUnit);
  el.freshSoloCount.value = record.freshSoloCount || "";
  el.freshLinkedCount.value = record.freshLinkedCount || "";
  el.backupUnit.value = defaultBackupUnit(record.backupUnit);
  refreshTotals();
}
function renderEntryRow(row, index) {
  const node = el.entryTemplate.content.firstElementChild.cloneNode(true);
  const routeInput = node.querySelector(".route");
  const count = node.querySelector(".count");
  const unit = node.querySelector(".unit");
  const output = node.querySelector("output");
  const del = node.querySelector(".del-btn");
  routeInput.value = splitStoredRoutes(row.route)[0] ?? "";
  routeInput.readOnly = !isBackupDriver();
  count.value = row.count || "";
  unit.value = row.unit || sharedRateForRoutes(row.route) || "";
  unit.title = "이 날짜에만 적용되는 단가입니다. 기본 단가는 바뀌지 않습니다.";
  unit.setAttribute("aria-label", "이 날짜 단가");
  output.textContent = fmtWon(toNum(count.value) * toNum(unit.value));
  del.style.visibility = isBackupDriver() ? "visible" : "hidden";
  routeInput.addEventListener("input", () => {
    const raw = routeInput.value.trim().toUpperCase();
    routeInput.value = raw;
    const record = getRecord(state.selectedDate, true);
    record.rows[index].route = raw;
    const autoUnit = rateFor(raw);
    if (autoUnit > 0) {
      record.rows[index].unit = autoUnit;
      unit.value = autoUnit;
      output.textContent = fmtWon(toNum(count.value) * autoUnit);
    }
    scheduleSave({ dateKeys: [state.selectedDate] });
    refreshTotals();
  });
  count.addEventListener("input", () => {
    const record = getRecord(state.selectedDate, true);
    record.rows[index].count = count.value;
    scheduleSave({ dateKeys: [state.selectedDate] });
    refreshTotals();
  });
  unit.addEventListener("input", () => {
    const record = getRecord(state.selectedDate, true);
    record.rows[index].unit = unit.value;
    scheduleSave({ dateKeys: [state.selectedDate] });
    refreshTotals();
  });
  del.addEventListener("click", () => {
    const record = getRecord(state.selectedDate, true);
    record.rows.splice(index, 1);
    scheduleSave({ dateKeys: [state.selectedDate], immediate: true });
    renderEntryForm();
    renderSummary();
    renderMonth();
    renderHomeSelection();
  });
  el.entryRows.appendChild(node);
}
function syncFormToRecord() {
  const record = getRecord(state.selectedDate, true);
  record.freshCount = el.freshCount.value;
  record.freshUnit = el.freshUnit.value;
  record.freshSoloCount = el.freshSoloCount.value;
  record.freshLinkedCount = el.freshLinkedCount.value;
  record.backupUnit = isBackupDriver() ? el.backupUnit.value : 0;
  return record;
}
function refreshTotals() {
  const record = syncFormToRecord();
  const details = calcRecordDetails(record);
  el.entryRows.querySelectorAll(".entry-row").forEach((node, index) => {
    const row = record.rows[index];
    node.querySelector("output").textContent = fmtWon(toNum(row?.count) * effectiveUnit(row || {}));
    const unitInput = node.querySelector(".unit");
    if (!toNum(unitInput.value) && row?.unit) unitInput.value = row.unit;
  });
  el.freshRevenue.textContent = fmtWon(details.freshRevenue);
  el.freshDualRevenue.textContent = fmtWon(details.freshRevenue);
  el.backupCount.textContent = fmtCount(details.count);
  el.backupRevenue.textContent = fmtWon(details.backupRevenue);
  el.selectedDayTotal.textContent = fmtWon(details.revenue);
  renderSummary();
  renderMonth();
  renderHomeSelection();
}
async function saveCurrentRecordAndGoHome() {
  syncFormToRecord();
  scheduleSave({ dateKeys: [state.selectedDate], immediate: true });
  await ensurePendingSavesFlushed();
  renderAll();
  showView("home");
  toast("기록을 저장했습니다.", "success");
}

function renderRates() {
  const allowedRoutes = new Set(fixedRoutes());
  const visibleRates = isBackupDriver() ? state.rates : state.rates.filter((rate) => allowedRoutes.has(rate.route));
  el.rateList.innerHTML = visibleRates.length
    ? visibleRates.map((rate) => `<button class="rate-chip" data-route="${rate.route}" type="button"><strong>${rate.route}</strong><span>${fmtWon(rate.unit)}</span></button>`).join("")
    : `<div class="daily-card"><span>${isBackupDriver() ? "등록된 단가가 없습니다." : "고정 라우트를 먼저 등록하면 해당 단가만 표시됩니다."}</span></div>`;
  el.rateList.querySelectorAll(".rate-chip").forEach((button) => {
    button.addEventListener("click", () => {
      const rate = state.rates.find((item) => item.route === button.dataset.route);
      if (!rate) return;
      el.rateRoute.value = rate.route;
      el.rateUnit.value = rate.unit;
    });
  });
}
function upsertRate(routeValue, unitValue) {
  const route = normalizeRoute(routeValue);
  const unit = toNum(unitValue);
  if (!route || unit < 0) return false;
  if (!isBackupDriver() && !fixedRoutes().includes(route)) return false;
  const existing = state.rates.find((rate) => rate.route === route);
  if (existing) existing.unit = unit;
  else state.rates.push({ route, unit, count: 0, amount: 0 });
  state.rates.sort((a, b) => a.route.localeCompare(b.route));
  return true;
}
function avgRates(rows) {
  const bucket = new Map();
  rows.forEach(([route, count, amount]) => {
    const key = normalizeRoute(route);
    const qty = toNum(count);
    const total = toNum(amount);
    if (!key || qty <= 0 || total <= 0) return;
    const current = bucket.get(key) || { count: 0, amount: 0 };
    bucket.set(key, { count: current.count + qty, amount: current.amount + total });
  });
  return [...bucket.entries()].map(([route, value]) => ({
    route,
    count: value.count,
    amount: value.amount,
    unit: Math.round(value.amount / value.count),
  })).sort((a, b) => a.route.localeCompare(b.route));
}
function settlementRatePlan(nextRates, existingRates = state.rates) {
  const existingByRoute = new Map((existingRates || []).map((rate) => [normalizeRoute(rate.route), toNum(rate.unit)]));
  const created = [];
  const changed = [];
  const unchanged = [];
  nextRates.forEach((rate) => {
    const route = normalizeRoute(rate.route);
    const previousUnit = existingByRoute.get(route) || 0;
    if (!previousUnit) created.push(rate);
    else if (previousUnit !== toNum(rate.unit)) changed.push({ ...rate, previousUnit });
    else unchanged.push(rate);
  });
  return { created, changed, unchanged };
}
function askChangedRatePolicy(changedRates) {
  if (!changedRates.length) return true;
  const preview = changedRates
    .slice(0, 12)
    .map((rate) => `${rate.route}: 기존 ${fmtWon(rate.previousUnit)} -> 정산표 ${fmtWon(rate.unit)}`)
    .join("\n");
  const suffix = changedRates.length > 12 ? `\n외 ${changedRates.length - 12}개` : "";
  return window.confirm(`기존 단가와 다른 구역이 있습니다.\n\n${preview}${suffix}\n\n정산표 기준 새 단가로 바꿀까요?\n확인: 새 단가로 변경\n취소: 기존 단가 유지`);
}
async function backupRateTargetUserIds() {
  if (state.profile?.role !== "admin" || !state.db) return [currentUserId()];
  const { data, error } = await state.db
    .from(TABLES.profiles)
    .select("id,driver_type,status")
    .eq("driver_type", "backup")
    .eq("status", "approved");
  if (error) throw error;
  const ids = (data || []).map((profile) => profile.id).filter(Boolean);
  return ids.length ? ids : [currentUserId()];
}
async function persistRatesForUsers(rates, userIds) {
  const payload = [];
  const updatedAt = new Date().toISOString();
  (userIds || []).forEach((userId) => {
    rates.forEach((rate) => {
      const route = normalizeRoute(rate.route);
      const unit = toNum(rate.unit);
      if (!userId || !route || unit < 0) return;
      payload.push({ user_id: userId, route, current_unit: unit, updated_at: updatedAt });
    });
  });
  if (!payload.length) return;
  const { error } = await state.db.from(TABLES.rates).upsert(payload, { onConflict: "user_id,route" });
  if (error) throw error;
}
function splitLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (const char of String(line)) {
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}
function parseSettlementCsv(text) {
  const rows = String(text || "").split(/\r?\n/).map(splitLine).filter((row) => row.some(Boolean));
  const parsed = rows.map((row) => {
    const route = row.find((cell) => /^\d{3}[A-Z]$/i.test(cell));
    const numbers = row.map(toNum).filter((n) => n > 0);
    if (!route || numbers.length < 2) return null;
    const count = numbers.find((n) => n < 1000) || numbers[0];
    const amount = [...numbers].reverse().find((n) => n >= 1000) || 0;
    return [route, count, amount];
  }).filter(Boolean);
  if (!parsed.length) toast("정산표에서 Route, 배송건수, 금액을 찾지 못했습니다.", "error");
  return parsed;
}
async function applySettlementRows(rows) {
  const parsed = (rows || []).map((row) => [
    row.route,
    row.deliveryCount ?? row.count,
    row.amount,
  ]);
  const nextRates = avgRates(parsed);
  if (!nextRates.length) {
    toast("정산표에서 단가를 계산할 Route를 찾지 못했습니다.", "error");
    return false;
  }
  const allowedRoutes = new Set(fixedRoutes());
  const filteredRates = nextRates.filter((rate) => isBackupDriver() || allowedRoutes.has(rate.route));
  if (!filteredRates.length) {
    toast("현재 프로필에 적용할 수 있는 Route 단가가 없습니다.", "error");
    return false;
  }
  const { created, changed, unchanged } = settlementRatePlan(filteredRates);
  const shouldUpdateChanged = askChangedRatePolicy(changed);
  const selectedRates = [
    ...created,
    ...unchanged,
    ...(shouldUpdateChanged
      ? changed.map(({ previousUnit, ...rate }) => rate)
      : changed.map(({ previousUnit, ...rate }) => ({ ...rate, unit: previousUnit }))),
  ];
  const createdPreview = created.length ? `새 구역 ${created.map((rate) => rate.route).join(", ")}은 기본 단가로 추가합니다.` : "새 구역은 없습니다.";
  const changedPreview = changed.length ? `단가가 다른 구역 ${changed.length}개는 ${shouldUpdateChanged ? "정산표 단가로 변경" : "기존 단가 유지"}합니다.` : "단가가 다른 구역은 없습니다.";
  if (!window.confirm(`${createdPreview}\n${changedPreview}\n\n백업기사들이 볼 수 있도록 DB 기본 단가에 반영할까요?`)) {
    toast("단가 반영을 취소했습니다.", "error");
    return false;
  }
  selectedRates.forEach((rate) => {
    const existing = state.rates.find((item) => item.route === rate.route);
    if (existing) Object.assign(existing, rate);
    else state.rates.push(rate);
  });
  state.rates = mergeDefaultRouteMaster(state.rates).rates;
  const targetUserIds = await backupRateTargetUserIds();
  await persistRatesForUsers(state.rates, targetUserIds);
  renderRates();
  renderAll();
  toast(`정산표 단가와 기본 구역 ${state.rates.length}개를 백업기사 ${targetUserIds.length}명 기준으로 반영했습니다.`, "success");
  return true;
}

function renderStats() {
  const { start, end } = periodBounds(state.statsYear, state.statsMonth);
  const total = summarizePeriod(state.statsYear, state.statsMonth);
  el.statsMonthTitle.textContent = `${state.statsYear}년 ${String(state.statsMonth).padStart(2, "0")}월`;
  el.statsRange.textContent = `${formatShort(start)} ~ ${formatShort(end)}`;
  el.statsRevenue.textContent = fmtWon(total.revenue);
  el.statsMeterFill.style.width = `${Math.min(100, total.revenue / getGoal() * 100)}%`;
  el.statsWorkDays.textContent = `${total.workDays}일`;
  el.statsOffDays.textContent = `${total.offDays}일`;
  el.statsCount.textContent = fmtCount(total.count);
  el.statsFresh.textContent = fmtCount(total.fresh);
  el.statsAverage.textContent = fmtWon(total.average);
  el.statsBestDay.textContent = total.best.dateKey ? `${formatLongShort(total.best.dateKey)} ${fmtWon(total.best.revenue)}` : "-";
  el.statsWorstDay.textContent = total.worst.dateKey ? `${formatLongShort(total.worst.dateKey)} ${fmtWon(total.worst.revenue)}` : "-";
  renderDailyStats();
  renderYearlyStats();
  renderTotalStats();
}
function renderDailyStats() {
  const keys = periodKeysFor(state.statsYear, state.statsMonth).filter((dateKey) => hasMeaningfulRecord(getRecord(dateKey, false)));
  el.dailyList.innerHTML = keys.length ? keys.map((dateKey) => {
    const record = getRecord(dateKey, false);
    const details = calcRecordDetails(record);
    const open = state.statsDetailDate === dateKey;
    const routes = record.rows.map((row) => `${formatRouteLabel(row.route)} ${fmtCount(row.count)} × ${fmtWon(effectiveUnit(row))}`).join("<br>");
    const routePreview = record.off ? "휴무" : (formatRecordRoutes(record.rows) || "라우트 없음");
    return `<div class="daily-card stat-day-card">
      <button type="button" data-date="${dateKey}">
        <div class="daily-top">
          <div>
            <strong>${formatLongShort(dateKey)}</strong>
            <span>${routePreview}</span>
          </div>
          <strong>${record.off ? "휴무" : fmtWon(details.revenue)}</strong>
        </div>
        <div class="daily-metrics">
          <span>배송 ${fmtCount(details.count)}</span>
          <span>프레시백 ${fmtCount(details.freshCount)}</span>
          ${details.backupRevenue ? `<span>백업 ${fmtWon(details.backupRevenue)}</span>` : ""}
        </div>
      </button>
      ${open ? `<div class="daily-detail">${record.off ? "휴무" : routes || "라우트 없음"}${details.freshRevenue ? `<br>프레시백 ${fmtWon(details.freshRevenue)}` : ""}</div>` : ""}
    </div>`;
  }).join("") : `<div class="daily-card"><span>기록된 날짜가 없습니다.</span></div>`;
  el.dailyList.querySelectorAll("button[data-date]").forEach((button) => {
    button.addEventListener("click", () => {
      state.statsDetailDate = state.statsDetailDate === button.dataset.date ? "" : button.dataset.date;
      renderDailyStats();
    });
  });
}
function renderYearlyStats() {
  const year = state.statsYear;
  el.yearlyStats.innerHTML = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const total = summarizePeriod(year, month);
    return `<div><span>${month}월</span><strong>${fmtWon(total.revenue)} · ${fmtCount(total.count)}</strong></div>`;
  }).join("");
}
function renderTotalStats() {
  const rows = Object.entries(state.entries);
  const totals = rows.reduce((sum, [, record]) => {
    const details = calcRecordDetails(record);
    return {
      revenue: sum.revenue + details.revenue,
      count: sum.count + details.count,
      fresh: sum.fresh + details.freshCount,
      workDays: sum.workDays + (details.revenue > 0 ? 1 : 0),
      offDays: sum.offDays + (record.off ? 1 : 0),
    };
  }, { revenue: 0, count: 0, fresh: 0, workDays: 0, offDays: 0 });
  el.totalStats.innerHTML = `
    <div><span>누적 매출</span><strong>${fmtWon(totals.revenue)}</strong></div>
    <div><span>누적 배송건수</span><strong>${fmtCount(totals.count)}</strong></div>
    <div><span>누적 근무일</span><strong>${totals.workDays}일</strong></div>
    <div><span>누적 휴무</span><strong>${totals.offDays}일</strong></div>
    <div><span>누적 프레시백</span><strong>${fmtCount(totals.fresh)}</strong></div>`;
}
function adminRecordDetails(day, items) {
  if (day.is_off) return { revenue: 0, count: 0, freshCount: 0, backupRevenue: 0, routeRevenue: 0 };
  const routeTotal = (items || []).reduce((sum, item) => {
    const count = toNum(item.delivery_count);
    return { count: sum.count + count, revenue: sum.revenue + count * toNum(item.unit_snapshot) };
  }, { count: 0, revenue: 0 });
  const freshCount = toNum(day.fresh_count);
  const freshRevenue = freshCount * toNum(day.fresh_unit || 100);
  const backupRevenue = day.driver_type === "backup" ? routeTotal.count * toNum(defaultBackupUnit(day.backup_unit)) : 0;
  return {
    revenue: routeTotal.revenue + freshRevenue + backupRevenue,
    count: routeTotal.count,
    freshCount,
    backupRevenue,
    routeRevenue: routeTotal.revenue,
  };
}
function renderAdminPeriodHeader() {
  if (!el.adminMonthTitle || !el.adminRange) return;
  const { start, end } = periodBounds(state.statsYear, state.statsMonth);
  el.adminMonthTitle.textContent = `${state.statsYear}년 ${String(state.statsMonth).padStart(2, "0")}월`;
  el.adminRange.textContent = `${formatShort(start)} ~ ${formatShort(end)}`;
}
async function renderAdminDashboard() {
  if (state.profile?.role !== "admin") return;
  renderAdminPeriodHeader();
  el.adminTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.adminTab === state.adminTab));
  el.adminPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.adminPanel === state.adminTab));
  try {
    if (state.adminTab === "summary") await renderAdminRevenueStats();
    if (state.adminTab === "routes") await renderAdminRouteStats();
    if (state.adminTab === "users") await renderAdminProfiles();
  } catch (error) {
    const target = state.adminTab === "routes" ? el.adminRouteList : state.adminTab === "users" ? el.adminProfiles : el.adminRevenueList;
    if (target) target.innerHTML = `<div class="daily-card"><span>${error.message}</span></div>`;
  }
}
async function renderAdminRevenueStats() {
  if (!el.adminRevenueList || state.profile?.role !== "admin") return;
  if (!state.db) {
    el.adminRevenueList.innerHTML = `<div class="daily-card"><span>DB 연결 후 확인할 수 있습니다.</span></div>`;
    return;
  }
  el.adminRevenueList.innerHTML = `<div class="daily-card"><span>사용자 매출을 불러오는 중입니다.</span></div>`;
  const { start, end } = periodBounds(state.statsYear, state.statsMonth);
  const startKey = toDateKey(start);
  const endKey = toDateKey(end);
  const [profilesResult, daysResult, itemsResult] = await Promise.all([
    state.db.from(TABLES.profiles).select("id,email,display_name,driver_type,status").order("display_name"),
    state.db.from(TABLES.days).select("*").gte("work_date", startKey).lte("work_date", endKey),
    state.db.from(TABLES.items).select("*").gte("work_date", startKey).lte("work_date", endKey).order("work_date"),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (daysResult.error) throw daysResult.error;
  if (itemsResult.error) throw itemsResult.error;

  const itemsByUserDate = new Map();
  (itemsResult.data || []).forEach((item) => {
    const key = `${item.user_id}|${item.work_date}`;
    if (!itemsByUserDate.has(key)) itemsByUserDate.set(key, []);
    itemsByUserDate.get(key).push(item);
  });
  const summaryByUser = new Map((profilesResult.data || []).map((profile) => [profile.id, {
    profile,
    revenue: 0,
    count: 0,
    fresh: 0,
    workDays: 0,
    offDays: 0,
    days: [],
  }]));
  (daysResult.data || []).forEach((day) => {
    if (!summaryByUser.has(day.user_id)) {
      summaryByUser.set(day.user_id, {
        profile: {
          id: day.user_id,
          display_name: LEGACY_USER_NAMES.get(day.user_id) || "사용자",
          driver_type: day.driver_type || "backup",
          status: "approved",
        },
        revenue: 0,
        count: 0,
        fresh: 0,
        workDays: 0,
        offDays: 0,
        days: [],
      });
    }
    const summary = summaryByUser.get(day.user_id);
    const details = adminRecordDetails(day, itemsByUserDate.get(`${day.user_id}|${day.work_date}`) || []);
    summary.revenue += details.revenue;
    summary.count += details.count;
    summary.fresh += details.freshCount;
    summary.workDays += details.revenue > 0 ? 1 : 0;
    summary.offDays += day.is_off ? 1 : 0;
    summary.days.push({ dateKey: day.work_date, day, details });
  });

  const summaries = [...summaryByUser.values()].sort((a, b) => b.revenue - a.revenue || String(a.profile.display_name || "").localeCompare(String(b.profile.display_name || "")));
  el.adminRevenueList.innerHTML = summaries.length ? summaries.map((summary) => {
    const profile = summary.profile;
    const open = state.adminStatsDetailUser === profile.id;
    const driverLabel = driverTypeLabel(profile.driver_type);
    const profileStatus = statusLabel(profile.status);
    const dayRows = summary.days
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .map((row) => `<div class="admin-day-row"><span>${formatLongShort(row.dateKey)}${row.day.is_off ? " 휴무" : ""}</span><strong>${fmtWon(row.details.revenue)} · ${fmtCount(row.details.count)}</strong></div>`)
      .join("");
    return `<div class="admin-revenue-card">
      <button type="button" data-admin-user="${profile.id}">
        <div class="admin-revenue-head">
          <div><strong>${profileNameForDisplay(profile)}</strong><span>${driverLabel} · ${profileStatus}</span></div>
          <div class="admin-revenue-total">${fmtWon(summary.revenue)}</div>
        </div>
        <div class="admin-revenue-metrics"><span>배송 ${fmtCount(summary.count)}</span><span>근무 ${summary.workDays}일</span><span>휴무 ${summary.offDays}일</span></div>
      </button>
      ${open ? `<div class="admin-day-list">${dayRows || `<span>선택한 정산기간 기록이 없습니다.</span>`}</div>` : ""}
    </div>`;
  }).join("") : `<div class="daily-card"><span>사용자 정보가 없습니다.</span></div>`;
  el.adminRevenueList.querySelectorAll("[data-admin-user]").forEach((button) => {
    button.addEventListener("click", () => {
      state.adminStatsDetailUser = state.adminStatsDetailUser === button.dataset.adminUser ? "" : button.dataset.adminUser;
      renderAdminRevenueStats().catch((error) => {
        el.adminRevenueList.innerHTML = `<div class="daily-card"><span>${error.message}</span></div>`;
      });
    });
  });
}
async function renderAdminRouteStats() {
  if (!el.adminRouteList || state.profile?.role !== "admin") return;
  if (!state.db) {
    el.adminRouteList.innerHTML = `<div class="daily-card"><span>DB 연결 후 확인할 수 있습니다.</span></div>`;
    return;
  }
  el.adminRouteList.innerHTML = `<div class="daily-card"><span>라우트 통계를 불러오는 중입니다.</span></div>`;
  const { start, end } = periodBounds(state.statsYear, state.statsMonth);
  const startKey = toDateKey(start);
  const endKey = toDateKey(end);
  const [profilesResult, itemsResult] = await Promise.all([
    state.db.from(TABLES.profiles).select("id,email,display_name,driver_type,status"),
    state.db.from(TABLES.items).select("user_id,work_date,route,delivery_count,unit_snapshot").gte("work_date", startKey).lte("work_date", endKey),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (itemsResult.error) throw itemsResult.error;

  const profiles = new Map((profilesResult.data || []).map((profile) => [profile.id, profile]));
  const routeMap = new Map();
  (itemsResult.data || []).forEach((item) => {
    const route = joinStoredRoutes(item.route);
    const count = toNum(item.delivery_count);
    const revenue = count * toNum(item.unit_snapshot);
    if (!route || count <= 0) return;
    if (!routeMap.has(route)) routeMap.set(route, { route, count: 0, revenue: 0, users: new Map() });
    const row = routeMap.get(route);
    row.count += count;
    row.revenue += revenue;
    const user = row.users.get(item.user_id) || { count: 0, revenue: 0 };
    user.count += count;
    user.revenue += revenue;
    row.users.set(item.user_id, user);
  });

  const routes = [...routeMap.values()].sort((a, b) => b.revenue - a.revenue || a.route.localeCompare(b.route));
  el.adminRouteList.innerHTML = routes.length ? routes.map((row) => {
    const avgUnit = row.count ? Math.round(row.revenue / row.count) : 0;
    const users = [...row.users.entries()]
      .map(([userId, user]) => ({ profile: profiles.get(userId) || { id: userId, display_name: LEGACY_USER_NAMES.get(userId) || "사용자" }, ...user }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 3)
      .map((user) => `<span>${profileNameForDisplay(user.profile)} ${fmtCount(user.count)} · ${fmtWon(user.revenue)}</span>`)
      .join("");
    return `<div class="admin-route-card">
      <div class="admin-route-head">
        <strong>${formatRouteLabel(row.route)}</strong>
        <span>${fmtWon(row.revenue)}</span>
      </div>
      <div class="admin-route-metrics">
        <span>배송 ${fmtCount(row.count)}</span>
        <span>평균 ${fmtWon(avgUnit)}</span>
      </div>
      <div class="admin-route-users">${users || "<span>사용자 기록 없음</span>"}</div>
    </div>`;
  }).join("") : `<div class="daily-card"><span>선택한 정산기간 라우트 기록이 없습니다.</span></div>`;
}
function moveStatsMonth(amount) {
  const date = new Date(state.statsYear, state.statsMonth - 1 + amount, 1);
  state.statsYear = date.getFullYear();
  state.statsMonth = date.getMonth() + 1;
  renderStats();
}
function moveAdminMonth(amount) {
  const date = new Date(state.statsYear, state.statsMonth - 1 + amount, 1);
  state.statsYear = date.getFullYear();
  state.statsMonth = date.getMonth() + 1;
  renderStats();
  renderAdminDashboard();
}

function routesFromCell(value) {
  const clean = String(value || "").toUpperCase();
  if (/휴무|OFF/.test(clean)) return null;
  return clean.match(/\d{3}[A-D]/g) || [];
}
function parseHeaderDate(value) {
  const match = String(value || "").match(/(\d{1,2})\s*[./-]\s*(\d{1,2})/);
  if (!match) return "";
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = month === 12 && state.month === 1 ? state.year - 1 : state.year;
  return toDateKey(new Date(year, month - 1, day));
}
function applySchedule(map) {
  const changed = [];
  Object.entries(map || {}).forEach(([dateKey, routes]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    const record = getRecord(dateKey, true);
    record.off = routes === null;
    record.rows = routes === null ? [] : (isBackupDriver() ? buildGroupedRows(routes) : fixedDefaultRows());
    record.freshCount = "";
    record.freshUnit = 100;
    record.backupUnit = DEFAULT_BACKUP_UNIT;
    setRecord(dateKey, record);
    changed.push(dateKey);
  });
  if (!changed.length) return;
  scheduleSave({ dateKeys: changed, immediate: true });
  renderAll();
  if (el.app.dataset.view === "record") renderEntryForm();
  toast(`스케줄 ${changed.length}일 반영 완료`, "success");
}
function extractScheduleJson(text) {
  const raw = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  const source = raw.startsWith("{") ? raw : raw.match(/\{[\s\S]*\}/)?.[0];
  if (!source) return null;
  try {
    const parsed = JSON.parse(source);
    const map = {};
    Object.entries(parsed || {}).forEach(([dateKey, routes]) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) map[dateKey] = Array.isArray(routes) ? routes.map(normalizeRoute).filter(Boolean) : null;
    });
    return Object.keys(map).length ? map : null;
  } catch {
    return null;
  }
}
function parseScheduleCsv(text) {
  const jsonMap = extractScheduleJson(text);
  if (jsonMap) return applySchedule(jsonMap);
  const rows = String(text || "").split(/\r?\n/).map(splitLine).filter((row) => row.some(Boolean));
  if (rows.length < 2) return toast("스케줄 텍스트를 인식하지 못했습니다.", "error");
  const header = rows[0];
  const name = driverName().replace(/\s/g, "");
  const target = rows.find((row, index) => index > 0 && row.some((cell) => String(cell).replace(/\s/g, "").includes(name)));
  if (!target) return toast(`${driverName()} 행을 찾지 못했습니다.`, "error");
  const map = {};
  header.forEach((cell, index) => {
    const dateKey = parseHeaderDate(cell);
    if (dateKey) map[dateKey] = routesFromCell(target[index]);
  });
  applySchedule(map);
}
function shiftDateMap(dateMap, days) {
  const shifted = {};
  Object.entries(dateMap || {}).forEach(([dateKey, routes]) => { shifted[addDays(dateKey, days)] = routes; });
  return shifted;
}
function setOcrDraft(map) {
  ocrDraftMap = map ? { ...map } : null;
  el.scheduleDraftSection.classList.toggle("hidden", !(ocrDraftMap && Object.keys(ocrDraftMap).length));
  renderDraftCards();
}
function renderDraftCards() {
  if (!ocrDraftMap) {
    el.scheduleDraftCards.innerHTML = "";
    return;
  }
  el.scheduleDraftCards.innerHTML = Object.keys(ocrDraftMap).sort().map((dateKey) => {
    const routes = ocrDraftMap[dateKey];
    const chips = (routes || []).map((route) => `<span class="draft-chip">${route}<button data-action="remove" data-date="${dateKey}" data-route="${route}">×</button></span>`).join("");
    return `<div class="draft-card"><div class="draft-card-header"><strong>${formatLongShort(dateKey)}</strong><button class="draft-off-btn${routes === null ? " active" : ""}" data-action="off" data-date="${dateKey}">${routes === null ? "휴무" : "근무"}</button></div><div>${routes === null ? "휴무" : `${chips}<button class="draft-add-btn" data-action="add" data-date="${dateKey}">+ 추가</button>`}</div></div>`;
  }).join("");
}
function draftWorkRoutes() {
  return isBackupDriver() ? [] : fixedRoutes();
}
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ base64: String(reader.result).split(",")[1], mimeType: file.type || "image/jpeg" });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function cleanOcrErrorMessage(message) {
  const text = String(message || "").trim();
  if (!text) return "OCR 처리 중 오류가 발생했습니다.";
  if (/UNAVAILABLE|503|high demand|experienc/i.test(text)) {
    return "OCR 서버가 잠시 혼잡합니다. 이미지는 그대로 두고 잠시 후 다시 실행해 주세요.";
  }
  try {
    const parsed = JSON.parse(text);
    if (parsed?.error) return cleanOcrErrorMessage(parsed.error);
    if (parsed?.message) return cleanOcrErrorMessage(parsed.message);
  } catch {
    const embedded = text.match(/\{[\s\S]*\}/)?.[0];
    if (embedded && embedded !== text) return cleanOcrErrorMessage(embedded);
  }
  return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}
async function readOcrResponse(response) {
  const text = await response.text();
  if (!response.ok) throw new Error(cleanOcrErrorMessage(text));
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("OCR 서버 응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.");
  }
}
function previewImageFile(file, target, altText) {
  if (!file || !target) return;
  const reader = new FileReader();
  reader.onload = () => {
    target.innerHTML = `<img src="${reader.result}" alt="${altText}" /> <span class="hint">${file.name}</span>`;
  };
  reader.readAsDataURL(file);
}
async function runOcr() {
  const file = el.scheduleImage.files?.[0];
  if (!file) return toast("스케줄 이미지를 먼저 선택해 주세요.", "error");
  const url = getEdgeFunctionUrl("ocr-schedule");
  if (!url) return toast("Supabase 연결이 필요합니다.", "error");
  el.runScheduleOcr.disabled = true;
  el.ocrStatus.textContent = "OCR 분석 중...";
  try {
    const image = await fileToBase64(file);
    const response = await fetch(url, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ imageBase64: image.base64, mimeType: image.mimeType, ownerName: driverName(), year: state.year, month: state.month }),
    });
    const result = await readOcrResponse(response);
    const map = {};
    Object.entries(result.schedule || {}).forEach(([dateKey, routes]) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) map[dateKey] = Array.isArray(routes) && routes.length ? routes.map(normalizeRoute) : null;
    });
    if (!Object.keys(map).length) throw new Error("유효한 스케줄이 없습니다.");
    setOcrDraft(map);
    el.ocrStatus.textContent = `${Object.keys(map).length}일 인식 완료`;
    toast("OCR 초안이 준비됐습니다.", "success");
  } catch (error) {
    console.error("[OCR]", error);
    const message = cleanOcrErrorMessage(error.message);
    el.ocrStatus.textContent = message;
    toast(`OCR 실패: ${message}`, "error");
  } finally {
    el.runScheduleOcr.disabled = false;
  }
}
async function runSettlementOcr() {
  const file = el.settlementImage.files?.[0];
  if (!file) return toast("정산표 이미지를 먼저 선택해 주세요.", "error");
  const url = getEdgeFunctionUrl("ocr-schedule");
  if (!url) return toast("Supabase 연결이 필요합니다.", "error");
  el.runSettlementOcr.disabled = true;
  el.settlementStatus.textContent = "정산표 OCR 분석 중...";
  try {
    const image = await fileToBase64(file);
    const response = await fetch(url, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        kind: "settlement",
        imageBase64: image.base64,
        mimeType: image.mimeType,
        ownerName: driverName(),
        year: state.year,
        month: state.month,
      }),
    });
    const result = await readOcrResponse(response);
    const rows = result?.settlement?.rows || [];
    if (!rows.length) throw new Error("정산표 배송 행을 찾지 못했습니다.");
    el.settlementStatus.textContent = `${rows.length}개 배송 행 인식 완료`;
    await applySettlementRows(rows);
  } catch (error) {
    console.error("[Settlement OCR]", error);
    const message = cleanOcrErrorMessage(error.message);
    el.settlementStatus.textContent = message;
    toast(`정산표 OCR 실패: ${message}`, "error");
  } finally {
    el.runSettlementOcr.disabled = false;
  }
}

async function renderAdminProfiles() {
  if (!el.adminProfiles || state.profile?.role !== "admin") return;
  if (!state.db) {
    el.adminProfiles.innerHTML = `<div class="daily-card"><span>DB 연결 후 확인할 수 있습니다.</span></div>`;
    return;
  }
  const { data, error } = await state.db.from(TABLES.profiles).select("*").order("created_at", { ascending: false });
  if (error) {
    el.adminProfiles.innerHTML = `<p class="error-text">${error.message}</p>`;
    return;
  }
  el.adminProfiles.innerHTML = (data || []).map((profile) => `<div class="admin-card" data-id="${profile.id}">
    <strong>${profileNameForDisplay(profile)}</strong>
    <span class="hint">${profile.email || ""}</span>
    <div class="admin-card-row">
      <select data-field="status"><option value="pending"${profile.status === "pending" ? " selected" : ""}>대기</option><option value="approved"${profile.status === "approved" ? " selected" : ""}>승인</option><option value="blocked"${profile.status === "blocked" ? " selected" : ""}>차단</option></select>
      <select data-field="driver_type"><option value="backup"${profile.driver_type === "backup" ? " selected" : ""}>백업</option><option value="fixed"${profile.driver_type === "fixed" ? " selected" : ""}>고정</option></select>
      <button class="secondary-btn" data-action="save-admin">저장</button>
    </div>
    <label class="admin-route-field">
      <span>고정기사 라우트</span>
      <input data-field="fixed_routes" type="text" placeholder="예: 322A, 322B" value="${escapeAttr((profile.fixed_routes || []).join(", "))}" />
    </label>
    <p class="hint">기사 유형을 고정으로 저장하면 해당 기사는 이 라우트만 기록 화면과 단가 관리에 표시됩니다.</p>
  </div>`).join("");
}
async function saveAdminProfile(card) {
  const id = card.dataset.id;
  const status = card.querySelector('[data-field="status"]').value;
  const driverType = card.querySelector('[data-field="driver_type"]').value;
  const fixedRoutes = routeListFromText(card.querySelector('[data-field="fixed_routes"]')?.value || "");
  const { error } = await state.db.from(TABLES.profiles).update({
    status,
    driver_type: driverType,
    fixed_routes: driverType === "fixed" ? fixedRoutes : [],
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
  if (status === "approved" && driverType === "backup" && state.rates.length) {
    await persistRatesForUsers(state.rates, [id]);
  }
  toast("사용자 정보를 저장했습니다.", "success");
  renderAdminDashboard();
}

function openSheet() {
  el.dbOverlay.classList.add("open");
  el.dbSheet.classList.add("open");
}
function closeSheet() {
  el.dbOverlay.classList.remove("open");
  el.dbSheet.classList.remove("open");
}

function bindEvents() {
  el.setupConnect.addEventListener("click", async () => {
    try {
      el.setupError.textContent = "";
      await connectDb(el.setupUrl.value, el.setupKey.value, true);
    } catch (error) {
      el.setupError.textContent = error.message;
    }
  });
  el.loginBtn.addEventListener("click", () => {
    if (state.authMode === "signup" || state.authMode === "reset") {
      setAuthMode("login");
      return;
    }
    login().catch((error) => { el.authError.textContent = error.message; });
  });
  el.signupBtn.addEventListener("click", () => {
    if (state.authMode === "reset") {
      updatePassword().catch((error) => { el.authError.textContent = error.message; });
      return;
    }
    if (state.authMode !== "signup") {
      setAuthMode("signup");
      return;
    }
    signup().catch((error) => { el.authError.textContent = error.message; });
  });
  el.forgotPasswordBtn.addEventListener("click", () => {
    sendPasswordReset().catch((error) => { el.authError.textContent = error.message; });
  });
  el.pendingLogout.addEventListener("click", logout);
  el.logoutBtn.addEventListener("click", logout);
  el.navTabs.forEach((tab) => tab.addEventListener("click", () => showView(tab.dataset.view)));
  el.openSettings.addEventListener("click", () => showView("settings"));
  el.backFromSettings.addEventListener("click", () => showView("home"));
  el.prevMonth.addEventListener("click", () => moveMonth(-1));
  el.nextMonth.addEventListener("click", () => moveMonth(1));
  el.todayButton.addEventListener("click", () => selectDate(todayKey()));
  el.homeOffToggle.addEventListener("click", () => {
    const record = getRecord(state.selectedDate, true);
    record.off = !record.off;
    if (record.off) record.rows = [];
    else if (!isBackupDriver()) record.rows = fixedDefaultRows();
    scheduleSave({ dateKeys: [state.selectedDate] });
    renderAll();
  });
  el.openRecord.addEventListener("click", () => showView("record"));
  el.backToCalendar.addEventListener("click", () => showView("home"));
  el.prevDay.addEventListener("click", () => { selectDate(addDays(state.selectedDate, -1)); renderEntryForm(); });
  el.nextDay.addEventListener("click", () => { selectDate(addDays(state.selectedDate, 1)); renderEntryForm(); });
  el.offToggle.addEventListener("change", () => {
    const record = getRecord(state.selectedDate, true);
    record.off = el.offToggle.checked;
    if (record.off) record.rows = [];
    else if (!isBackupDriver()) record.rows = fixedDefaultRows();
    scheduleSave({ dateKeys: [state.selectedDate] });
    renderEntryForm();
    refreshTotals();
  });
  el.addRoute.addEventListener("click", () => {
    const record = getRecord(state.selectedDate, true);
    record.off = false;
    record.rows.push({ route: state.rates[0]?.route || "", count: "", unit: state.rates[0]?.unit || 0 });
    scheduleSave({ dateKeys: [state.selectedDate] });
    renderEntryForm();
  });
  [el.freshCount, el.freshUnit, el.backupUnit].forEach((input) => input.addEventListener("input", () => {
    scheduleSave({ dateKeys: [state.selectedDate] });
    refreshTotals();
  }));
  [el.freshSoloCount, el.freshLinkedCount].forEach((input) => input.addEventListener("input", () => {
    syncFormToRecord();
    scheduleSave({ dateKeys: [state.selectedDate] });
    refreshTotals();
  }));
  document.querySelectorAll('input[name="freshbagMode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (state.profile) state.profile.freshbag_mode = radio.value;
      renderEntryForm();
    });
  });
  el.saveRecord.addEventListener("click", saveCurrentRecordAndGoHome);
  el.modeBtns.forEach((button) => button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    el.modeBtns.forEach((target) => target.classList.toggle("active", target === button));
    renderMonth();
  }));
  el.statsTabs.forEach((tab) => tab.addEventListener("click", () => {
    if (tab.dataset.tab === "admin" && state.profile?.role !== "admin") return;
    state.statsDetailDate = "";
    el.statsTabs.forEach((target) => target.classList.toggle("active", target === tab));
    el.statsPanels.forEach((panel) => panel.classList.toggle("active", panel.dataset.panel === tab.dataset.tab));
    renderStats();
  }));
  el.statsPrevMonth.addEventListener("click", () => moveStatsMonth(-1));
  el.statsNextMonth.addEventListener("click", () => moveStatsMonth(1));
  el.adminTabs.forEach((tab) => tab.addEventListener("click", () => {
    if (state.profile?.role !== "admin") return;
    state.adminTab = tab.dataset.adminTab;
    renderAdminDashboard();
  }));
  el.adminPrevMonth.addEventListener("click", () => moveAdminMonth(-1));
  el.adminNextMonth.addEventListener("click", () => moveAdminMonth(1));
  el.saveProfile.addEventListener("click", () => saveProfile().catch((error) => toast(`프로필 저장 실패: ${error.message}`, "error")));
  el.goalAmountInput.addEventListener("input", () => {
    const pos = el.goalAmountInput.selectionStart;
    const prevLen = el.goalAmountInput.value.length;
    const raw = parseInt(el.goalAmountInput.value.replace(/,/g, ""), 10) || 0;
    el.goalAmountInput.value = raw > 0 ? raw.toLocaleString("ko-KR") : "";
    const diff = el.goalAmountInput.value.length - prevLen;
    el.goalAmountInput.setSelectionRange(pos + diff, pos + diff);
  });
  el.saveAppSettings.addEventListener("click", () => {
    const val = goalRawValue();
    if (!val || val <= 0) return toast("올바른 목표 금액을 입력해 주세요.", "error");
    saveGoalLocal(val);
    renderSummary();
    renderStats();
    toast("설정을 저장했습니다.", "success");
  });
  el.saveRate.addEventListener("click", () => {
    if (!upsertRate(el.rateRoute.value, el.rateUnit.value)) return toast("구역과 단가를 확인해 주세요.", "error");
    el.rateRoute.value = "";
    el.rateUnit.value = "";
    renderRates();
    renderAll();
    scheduleSave({ rates: true, immediate: true });
    toast("단가를 저장했습니다.", "success");
  });
  el.parseCsv.addEventListener("click", () => {
    const rows = parseSettlementCsv(el.csvInput.value);
    if (!rows.length) return;
    applySettlementRows(rows.map(([route, deliveryCount, amount]) => ({ route, deliveryCount, amount })))
      .catch((error) => toast(`정산표 단가 반영 실패: ${error.message}`, "error"));
  });
  el.scheduleImage.addEventListener("change", () => {
    const file = el.scheduleImage.files?.[0];
    if (!file) return;
    previewImageFile(file, el.schedulePreview, "스케줄표 미리보기");
  });
  el.runScheduleOcr.addEventListener("click", runOcr);
  el.settlementImage.addEventListener("change", () => {
    const file = el.settlementImage.files?.[0];
    if (!file) return;
    previewImageFile(file, el.settlementPreview, "정산표 미리보기");
    el.settlementStatus.textContent = "정산표 이미지가 선택됐습니다. OCR 실행을 누르면 Route별 단가 후보를 계산합니다.";
  });
  el.runSettlementOcr.addEventListener("click", runSettlementOcr);
  el.shiftScheduleBack.addEventListener("click", () => {
    if (!ocrDraftMap) return toast("보정할 OCR 초안이 없습니다.", "error");
    ocrDraftMap = shiftDateMap(ocrDraftMap, -1);
    renderDraftCards();
  });
  el.shiftScheduleForward.addEventListener("click", () => {
    if (!ocrDraftMap) return toast("보정할 OCR 초안이 없습니다.", "error");
    ocrDraftMap = shiftDateMap(ocrDraftMap, 1);
    renderDraftCards();
  });
  el.scheduleDraftCards.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !ocrDraftMap) return;
    const dateKey = button.dataset.date;
    if (button.dataset.action === "off") ocrDraftMap[dateKey] = ocrDraftMap[dateKey] === null ? draftWorkRoutes() : null;
    if (button.dataset.action === "remove") ocrDraftMap[dateKey] = (ocrDraftMap[dateKey] || []).filter((route) => route !== button.dataset.route);
    if (button.dataset.action === "add") {
      const route = prompt("추가할 구역을 입력하세요. 예: 302B");
      if (route) ocrDraftMap[dateKey] = [...(ocrDraftMap[dateKey] || []), normalizeRoute(route)];
    }
    renderDraftCards();
  });
  el.parseSchedule.addEventListener("click", () => {
    if (!ocrDraftMap) return toast("반영할 스케줄이 없습니다.", "error");
    applySchedule(ocrDraftMap);
    setOcrDraft(null);
  });
  el.parseScheduleCsv.addEventListener("click", () => parseScheduleCsv(el.scheduleCsvInput.value));
  el.resetData.addEventListener("click", async () => {
    if (!window.confirm("내 단가와 기록을 모두 삭제할까요?")) return;
    const userId = currentUserId();
    try {
      await state.db.from(TABLES.items).delete().eq("user_id", userId);
      await state.db.from(TABLES.days).delete().eq("user_id", userId);
      await state.db.from(TABLES.rates).delete().eq("user_id", userId);
      state.rates = [];
      state.entries = {};
      renderAll();
      toast("내 데이터를 초기화했습니다.", "success");
    } catch (error) {
      toast(`초기화 실패: ${error.message}`, "error");
    }
  });
  el.requestAccountDelete.addEventListener("click", async () => {
    if (!window.confirm("탈퇴 요청을 남기고 내 기록과 단가 데이터를 삭제할까요?\n\n계정 완전 삭제는 관리자가 확인 후 처리합니다.")) return;
    const userId = currentUserId();
    try {
      await state.db.from(TABLES.items).delete().eq("user_id", userId);
      await state.db.from(TABLES.days).delete().eq("user_id", userId);
      await state.db.from(TABLES.rates).delete().eq("user_id", userId);
      await state.db.from(TABLES.profiles).update({
        display_name: `[탈퇴요청] ${driverName()}`,
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
      toast("탈퇴 요청을 남겼습니다.", "success");
      await logout();
    } catch (error) {
      toast(`탈퇴 요청 실패: ${error.message}`, "error");
    }
  });
  el.openDbSettings.addEventListener("click", openSheet);
  el.dbOverlay.addEventListener("click", closeSheet);
  el.saveDbConfig.addEventListener("click", async () => {
    try {
      await connectDb(el.supabaseUrl.value, el.supabaseAnonKey.value, true);
      closeSheet();
    } catch (error) {
      toast(`DB 연결 실패: ${error.message}`, "error");
    }
  });
  el.syncNow.addEventListener("click", async () => {
    try {
      await ensurePendingSavesFlushed();
      await loadFromDb();
      renderAll();
      toast("동기화 완료", "success");
    } catch (error) {
      toast(`동기화 실패: ${error.message}`, "error");
    }
  });
  el.adminProfiles.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="save-admin"]');
    if (!button) return;
    saveAdminProfile(button.closest(".admin-card")).catch((error) => toast(`저장 실패: ${error.message}`, "error"));
  });
}

async function init() {
  bindEvents();
  renderAll();
  const cfg = getDbConfig();
  if (!cfg.url || !cfg.anonKey) {
    if (canUseManualDbConfig()) {
      showSetup(true);
    } else {
      showDeploymentConfigError();
    }
    return;
  }
  try {
    await connectDb(cfg.url, cfg.anonKey, false);
  } catch (error) {
    console.error("[init]", error);
    if (canUseManualDbConfig()) {
      showSetup(true);
      el.setupError.textContent = error.message;
    } else {
      showDeploymentConfigError();
    }
  }
}

init();
