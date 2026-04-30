"use strict";

import {
  DB_KEY,
  DEFAULT_BACKUP_UNIT,
  DEFAULT_ROUTE_BUNDLES,
  DEFAULT_ROUTE_MASTER,
  GOAL,
  PUBLIC_SITE_URL,
  PUBLIC_SUPABASE_CONFIG,
  SAMPLE_SETTLEMENT,
  TABLES,
} from "./config.js?v=2";
import {
  addDays,
  formatLong,
  formatLongShort,
  formatRecordTitleDate,
  formatShort,
  parseDateKey,
  todayKey,
  toDateKey,
} from "./lib/date.js";
import {
  compactRouteList,
  expandRouteText,
  formatRecordRoutes,
  formatRouteLabel,
  joinStoredRoutes,
  normalizeRoute,
  routeListFromText,
  splitStoredRoutes,
} from "./lib/route.js";

const THEME_KEY = "quickflex-theme";
const THEME_DEFAULT_MARK_KEY = "quickflex-theme-default-dark-gold-v1";
function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  if (document.documentElement) document.documentElement.dataset.theme = t;
  if (document.body) document.body.dataset.theme = t;
  try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
  document.querySelectorAll("[data-theme-set]").forEach((b) => {
    b.classList.toggle("active", b.dataset.themeSet === t);
  });
  if (typeof renderStats === "function") {
    try { renderStats(); } catch (_) {}
  }
}
function getInitialTheme() {
  try {
    if (localStorage.getItem(THEME_DEFAULT_MARK_KEY) !== "1") {
      localStorage.setItem(THEME_DEFAULT_MARK_KEY, "1");
      return "dark";
    }
    return localStorage.getItem(THEME_KEY) || "dark";
  } catch (_) {
    return "dark";
  }
}
try { applyTheme(getInitialTheme()); } catch (_) {}

const GOAL_SETTING_ROUTE = "__GOAL__";
function getGoal() { return toNum(state.profile?.goal_amount) || GOAL; }
function goalRawValue() { return parseInt((el.goalAmountInput.value || "").replace(/,/g, ""), 10) || 0; }

const FIXED_KOREAN_HOLIDAYS = {
  "01-01": "신정",
  "03-01": "삼일절",
  "05-05": "어린이날",
  "06-06": "현충일",
  "08-15": "광복절",
  "10-03": "개천절",
  "10-09": "한글날",
  "12-25": "성탄절",
};
const KOREAN_HOLIDAYS = {
  "2026-01-01": "신정",
  "2026-02-16": "설날",
  "2026-02-17": "설날",
  "2026-02-18": "설날",
  "2026-03-01": "삼일절",
  "2026-03-02": "대체공휴일",
  "2026-05-05": "어린이날",
  "2026-05-24": "부처님오신날",
  "2026-05-25": "대체공휴일",
  "2026-06-03": "지방선거",
  "2026-06-06": "현충일",
  "2026-08-15": "광복절",
  "2026-08-17": "대체공휴일",
  "2026-09-24": "추석",
  "2026-09-25": "추석",
  "2026-09-26": "추석",
  "2026-10-03": "개천절",
  "2026-10-05": "대체공휴일",
  "2026-10-09": "한글날",
  "2026-12-25": "성탄절",
};
function koreanHoliday(dateKey) {
  return KOREAN_HOLIDAYS[dateKey] || FIXED_KOREAN_HOLIDAYS[dateKey.slice(5)] || "";
}
function holidayShortLabel(name) {
  if (!name) return "";
  if (name.includes("대체")) return "대체";
  if (name.includes("부처님")) return "부처님";
  return name.length > 4 ? name.slice(0, 4) : name;
}
function formatGoalInput() {
  const raw = goalRawValue();
  el.goalAmountInput.value = raw > 0 ? raw.toLocaleString("ko-KR") : "";
}
import { fmtCount, fmtNum, fmtWon } from "./lib/format.js";
import { toNum } from "./lib/revenue.js";

const isLocalRuntime = ["localhost", "127.0.0.1", ""].includes(location.hostname) || location.protocol === "file:";
const LEGACY_USER_NAMES = new Map([["kim-gwanhyun", "김관현"]]);

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
  defaultRates: [],
  routeBundles: [],
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
  recordDraftDate: "",
  recordDraft: null,
  statsRangeMode: "thisMonth",
  statsRangeCustom: { from: "", to: "" },
  revenueVisibility: (() => {
    try { return JSON.parse(localStorage.getItem("quickflex-revenue-vis") || "{}") || {}; }
    catch (_) { return {}; }
  })(),
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
  meterPct: $("meterPct"),
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
  statsSummaryRange: $("statsSummaryRange"),
  statsSummaryTotal: $("statsSummaryTotal"),
  statsRevenue: $("statsRevenue"),
  statsMeterFill: $("statsMeterFill"),
  statsMeterPct: $("statsMeterPct"),
  statsMeterLabel: $("statsMeterLabel"),
  statsRangeTabs: $("statsRangeTabs"),
  statsRangeCustom: $("statsRangeCustom"),
  statsRangeFrom: $("statsRangeFrom"),
  statsRangeTo: $("statsRangeTo"),
  statsRangeApply: $("statsRangeApply"),
  statsChart: $("statsChart"),
  statsChartTooltip: $("statsChartTooltip"),
  revenueList: $("revenueList"),
  statsAvgCount: $("statsAvgCount"),
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
  adminBundleLabel: $("adminBundleLabel"),
  adminBundleRoutes: $("adminBundleRoutes"),
  saveAdminBundle: $("saveAdminBundle"),
  adminBundleBulk: $("adminBundleBulk"),
  importAdminBundles: $("importAdminBundles"),
  adminBundleList: $("adminBundleList"),
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
function periodForDate(date = new Date()) {
  const month = date.getDate() <= 25 ? date.getMonth() + 1 : date.getMonth() + 2;
  const periodDate = new Date(date.getFullYear(), month - 1, 1);
  return { year: periodDate.getFullYear(), month: periodDate.getMonth() + 1 };
}
function prevPeriod(year = state.year, month = state.month) {
  const date = new Date(year, month - 2, 1);
  return { year: date.getFullYear(), month: date.getMonth() + 1 };
}
function escapeAttr(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("\"", "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
function routeCandidateSet() {
  const candidates = new Set(DEFAULT_ROUTE_MASTER.map(normalizeRoute));
  DEFAULT_ROUTE_BUNDLES.flat().forEach((route) => {
    const normalized = normalizeRoute(route);
    if (/^\d{3}[A-Z]$/.test(normalized)) candidates.add(normalized);
  });
  (state.routeBundles || []).forEach((bundle) => {
    routeListFromText(bundle.routes).forEach((route) => {
      if (/^\d{3}[A-Z]$/.test(route)) candidates.add(route);
    });
  });
  state.rates.forEach((rate) => {
    const route = normalizeRoute(rate.route);
    if (/^\d{3}[A-Z]$/.test(route)) candidates.add(route);
  });
  fixedRoutes().forEach((route) => {
    if (/^\d{3}[A-Z]$/.test(route)) candidates.add(route);
  });
  return candidates;
}
function routeDistance(a, b) {
  if (a.length !== b.length) return 99;
  const confusion = { O: "0", 0: "O", I: "1", 1: "I", L: "1", S: "5", 5: "S", B: "8", 8: "B", Z: "2", 2: "Z" };
  let score = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (confusion[a[i]] === b[i]) score += 0.35;
    else score += 1;
  }
  return score;
}
function correctRoute(route, candidates = routeCandidateSet()) {
  const raw = normalizeRoute(route).replace(/[^0-9A-Z]/g, "");
  if (!raw) return "";
  if (candidates.has(raw)) return raw;
  const normalized = raw
    .slice(0, 3).replace(/[OIL]/g, "0").replace(/S/g, "5").replace(/B/g, "8")
    + raw.slice(3).replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B");
  if (candidates.has(normalized)) return normalized;
  let best = "";
  let bestScore = 99;
  for (const candidate of candidates) {
    const score = routeDistance(raw, candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    } else if (score === bestScore) {
      best = "";
    }
  }
  if (bestScore <= 1) return best;
  return /^\d{3}[A-Z]$/.test(raw) ? raw : "";
}
function correctRouteList(routes) {
  const candidates = routeCandidateSet();
  const seen = new Set();
  const corrected = routeListFromText(routes)
    .flatMap(expandRouteText)
    .map((route) => correctRoute(route, candidates))
    .filter((route) => route && !seen.has(route) && seen.add(route));
  return completeRouteBundles(corrected);
}
function activeRouteBundles() {
  const dbBundles = (state.routeBundles || [])
    .filter((bundle) => bundle.active !== false && Array.isArray(bundle.routes) && bundle.routes.length >= 1)
    .map((bundle) => ({ routes: routeListFromText(bundle.routes), trusted: true }));
  const seen = new Set(dbBundles.map((bundle) => joinStoredRoutes(bundle.routes)));
  const fallback = DEFAULT_ROUTE_BUNDLES
    .filter((bundle) => !seen.has(joinStoredRoutes(bundle)))
    .map((bundle) => ({ routes: bundle, trusted: false }));
  return [...dbBundles, ...fallback];
}
function completeRouteBundles(routes) {
  const result = [...routes];
  const seen = new Set(result);
  activeRouteBundles().forEach(({ routes: bundle, trusted }) => {
    const observed = bundle.filter((route) => seen.has(route));
    const missing = bundle.filter((route) => !seen.has(route));
    const shouldComplete = trusted
      ? observed.length >= 2 && missing.length >= 1
      : observed.length >= 2 && missing.length === 1;
    if (shouldComplete) {
      bundle.forEach((route) => {
        if (!seen.has(route)) {
          seen.add(route);
          result.push(route);
        }
      });
    }
  });
  return result;
}
function currentUserId() { return state.session?.user?.id || ""; }
function isBackupDriver() { return (state.profile?.driver_type || "backup") === "backup"; }
function fixedRoutes() { return Array.isArray(state.profile?.fixed_routes) ? expandRouteText(state.profile.fixed_routes.join(",")) : []; }
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
  return state.rates.find((rate) => rate.route === normalized)?.unit
    || state.defaultRates.find((rate) => rate.route === normalized)?.unit
    || 0;
}
function sharedRateForRoutes(routes) {
  const list = expandRouteText(routes);
  if (!list.length) return 0;
  const units = list.map(rateFor).filter((unit) => unit > 0);
  if (!units.length) return 0;
  return units.every((unit) => unit === units[0]) ? units[0] : 0;
}
function autoUnitForRoutes(routes) {
  const list = expandRouteText(routes);
  if (!list.length) return 0;
  return sharedRateForRoutes(list) || rateFor(list[0]) || 0;
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
      route: joinStoredRoutes(expandRouteText(row.route)),
      count: row.count ?? "",
      unit: row.unit ?? sharedRateForRoutes(row.route) ?? 0,
      draft: Boolean(row.draft),
    }))
    .filter((row) => row.draft || row.route || toNum(row.count) > 0 || toNum(row.unit) > 0);
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
function cloneRecord(record) {
  return normalizeRecordShape(JSON.parse(JSON.stringify(record || emptyRecord())));
}
function startRecordDraft(dateKey = state.selectedDate) {
  state.recordDraftDate = dateKey;
  state.recordDraft = cloneRecord(getRecord(dateKey, false));
  return state.recordDraft;
}
function currentRecordDraft() {
  if (state.recordDraftDate !== state.selectedDate || !state.recordDraft) return startRecordDraft();
  return state.recordDraft;
}
function discardRecordDraft() {
  state.recordDraftDate = "";
  state.recordDraft = null;
}
function commitRecordDraft() {
  if (!state.recordDraft || !state.recordDraftDate) return;
  const record = cloneRecord(state.recordDraft);
  record.rows = record.rows
    .filter((row) => row.route || toNum(row.count) > 0 || toNum(row.unit) > 0)
    .map(({ draft, ...row }) => row);
  setRecord(state.recordDraftDate, record);
  discardRecordDraft();
}
function hasMeaningfulRecord(record) {
  const rec = normalizeRecordShape(record);
  return rec.off || rec.rows.length > 0 || toNum(rec.freshCount) > 0 || toNum(rec.freshUnit) !== 100 || (isBackupDriver() && toNum(rec.backupUnit) !== DEFAULT_BACKUP_UNIT);
}
function mergeGroupedRows(rows) {
  const merged = [];
  rows.forEach((row) => {
    const routes = splitStoredRoutes(row.route);
    if (!routes.length) {
      if (row.draft) merged.push({ route: "", count: row.count ?? "", unit: row.unit ?? 0, draft: true });
      return;
    }
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
  return mergeGroupedRows(expandRouteText(routes).map((route) => ({ route, count: "", unit: rateFor(route) })));
}
function fixedDefaultRows() {
  return buildGroupedRows(fixedRoutes()).map((row) => ({ ...row, count: "" }));
}
function defaultEntryRows() {
  if (!isBackupDriver()) return fixedDefaultRows();
  const firstRate = state.rates[0] || state.defaultRates[0];
  if (!firstRate) return [{ route: "", count: "", unit: 0, draft: true }];
  return [{ route: firstRate.route, count: "", unit: firstRate.unit || 0, draft: false }];
}
function ensureFixedRecordRows(record) {
  if (isBackupDriver()) return record;
  if (record.off) return record;
  const allowed = fixedRoutes();
  if (!allowed.length) return record;
  // 기존 행에 들어있는 모든 라우트 수집 (사용자가 추가한 커스텀 라우트 포함)
  const existingRoutes = new Set();
  record.rows.forEach((row) => {
    splitStoredRoutes(row.route).forEach((r) => existingRoutes.add(r));
  });
  // 고정 라우트 중 누락된 것만 행 앞에 추가
  const missing = allowed.filter((r) => !existingRoutes.has(r));
  if (missing.length) {
    record.rows = [...buildGroupedRows(missing), ...record.rows];
  }
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
function routeRevenueKey(route) { return `route:${route || "?"}`; }
function isVisibleKey(key) { return state.revenueVisibility[key] !== false; }
function recordRouteAggregates(record) {
  const rec = normalizeRecordShape(record);
  const out = new Map();
  if (rec.off) return out;
  rec.rows.forEach((row) => {
    splitStoredRoutes(row.route).forEach((r) => {
      const count = toNum(row.count);
      const unit = effectiveUnit(row);
      const share = splitStoredRoutes(row.route).length || 1;
      const entry = out.get(r) || { count: 0, revenue: 0 };
      entry.count += count / share;
      entry.revenue += (count * unit) / share;
      out.set(r, entry);
    });
  });
  return out;
}
function recordVisibleRevenue(record) {
  const details = calcRecordDetails(record);
  let visible = 0;
  recordRouteAggregates(record).forEach((agg, route) => {
    if (isVisibleKey(routeRevenueKey(route))) visible += agg.revenue;
  });
  if (isVisibleKey("fresh")) visible += details.freshRevenue;
  if (isVisibleKey("backup")) visible += details.backupRevenue;
  return visible;
}
function summarizeKeys(keys, opts = {}) {
  const useVisibility = !!opts.visibility;
  let best = { dateKey: "", revenue: 0 };
  let worst = { dateKey: "", revenue: Infinity };
  const total = keys.reduce((sum, dateKey) => {
    const record = getRecord(dateKey, false);
    const calc = calcRecordDetails(record);
    const revenue = useVisibility ? recordVisibleRevenue(record) : calc.revenue;
    const isWorkedDay = !record.off && calc.revenue > 0 && revenue > 0;
    if (isWorkedDay && revenue > best.revenue) best = { dateKey, revenue };
    if (isWorkedDay && revenue < worst.revenue) worst = { dateKey, revenue };
    return {
      count: sum.count + calc.count,
      revenue: sum.revenue + revenue,
      workDays: sum.workDays + (calc.revenue > 0 ? 1 : 0),
      offDays: sum.offDays + (record.off ? 1 : 0),
      fresh: sum.fresh + calc.freshCount,
    };
  }, { count: 0, revenue: 0, workDays: 0, offDays: 0, fresh: 0 });
  total.average = total.workDays ? total.revenue / total.workDays : 0;
  total.avgCount = total.workDays ? total.count / total.workDays : 0;
  total.best = best;
  total.worst = worst.revenue < Infinity ? worst : { dateKey: "", revenue: 0 };
  return total;
}
function getStatsKeys() {
  const mode = state.statsRangeMode || "thisMonth";
  if (mode === "thisMonth") return periodKeysFor(state.statsYear, state.statsMonth);
  if (mode === "lastMonth") {
    const prev = prevPeriod(state.statsYear, state.statsMonth);
    return periodKeysFor(prev.year, prev.month);
  }
  if (mode === "last3" || mode === "last6" || mode === "last12") {
    const n = mode === "last3" ? 3 : (mode === "last6" ? 6 : 12);
    const keys = [];
    let cur = { year: state.statsYear, month: state.statsMonth };
    for (let i = 0; i < n; i += 1) {
      keys.unshift(...periodKeysFor(cur.year, cur.month));
      cur = prevPeriod(cur.year, cur.month);
    }
    return keys;
  }
  if (mode === "all") {
    return Object.keys(state.entries).sort();
  }
  if (mode === "custom") {
    const { from, to } = state.statsRangeCustom || {};
    if (!from || !to) return [];
    const start = parseDateKey(from);
    const end = parseDateKey(to);
    if (!start || !end || start > end) return [];
    const keys = [];
    const cur = new Date(start);
    while (cur <= end) {
      keys.push(toDateKey(cur));
      cur.setDate(cur.getDate() + 1);
    }
    return keys;
  }
  return periodKeysFor(state.statsYear, state.statsMonth);
}
function getStatsBounds() {
  const keys = getStatsKeys();
  if (!keys.length) return { start: null, end: null };
  return { start: parseDateKey(keys[0]), end: parseDateKey(keys[keys.length - 1]) };
}
function formatRangeLabel(start, end) {
  if (!start || !end) return "-";
  const fmt = (d) => `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
  return `${fmt(start)} ~ ${fmt(end)}`;
}
function formatPeriodRangeSimple(start, end) {
  const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}`;
  return `${fmt(start)} - ${fmt(end)}`;
}
function formatMonthDay(key) {
  const date = parseDateKey(key);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}`;
}
function formatCalendarWon(value) {
  const n = Math.round(Number(value) || 0);
  if (!n) return "";
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}만`;
  return n.toLocaleString("ko-KR");
}
function formatKoreanWon(value) {
  const n = Math.round(value);
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 100000000) return `${(n / 100000000).toFixed(abs >= 1000000000 ? 0 : 1).replace(/\.0$/, "")}억`;
  if (abs >= 10000) return `${Math.round(n / 10000)}만`;
  return n.toLocaleString("ko-KR");
}
function formatCompactWonWithUnit(value) {
  const n = Math.round(Number(value) || 0);
  if (!n) return "0원";
  if (Math.abs(n) >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, "")}만원`;
  return `${n.toLocaleString("ko-KR")}원`;
}
function aggregateRevenueByItem(keys) {
  const routes = new Map();
  let freshCount = 0;
  let freshRevenue = 0;
  let backupRevenue = 0;
  keys.forEach((dateKey) => {
    const record = getRecord(dateKey, false);
    const details = calcRecordDetails(record);
    recordRouteAggregates(record).forEach((agg, route) => {
      const entry = routes.get(route) || { count: 0, revenue: 0 };
      entry.count += agg.count;
      entry.revenue += agg.revenue;
      routes.set(route, entry);
    });
    freshCount += details.freshCount;
    freshRevenue += details.freshRevenue;
    backupRevenue += details.backupRevenue;
  });
  const items = [];
  Array.from(routes.entries())
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .forEach(([route, agg]) => {
      items.push({ key: routeRevenueKey(route), label: route, count: Math.round(agg.count), revenue: Math.round(agg.revenue), kind: "route" });
    });
  if (freshCount > 0 || freshRevenue > 0) items.push({ key: "fresh", label: "프레시백 매출", count: freshCount, revenue: Math.round(freshRevenue), kind: "fresh" });
  if (backupRevenue > 0) items.push({ key: "backup", label: "백업수당 매출", count: 0, revenue: Math.round(backupRevenue), kind: "backup" });
  return items;
}
function aggregateRevenueGroups(items) {
  return items.reduce((groups, item) => {
    if (item.kind === "route") {
      groups.route.revenue += item.revenue;
      groups.route.count += item.count;
      groups.route.items.push(item);
    } else if (item.kind === "fresh") {
      groups.fresh.revenue += item.revenue;
      groups.fresh.count += item.count;
      groups.fresh.items.push(item);
    } else if (item.kind === "backup") {
      groups.backup.revenue += item.revenue;
      groups.backup.items.push(item);
    }
    return groups;
  }, {
    route: { label: "라우트 매출", count: 0, revenue: 0, items: [] },
    fresh: { label: "프레시백", count: 0, revenue: 0, items: [] },
    backup: { label: "백업수당", count: 0, revenue: 0, items: [] },
  });
}
function summarizePeriod(year = state.year, month = state.month) {
  let best = { dateKey: "", revenue: 0 };
  let worst = { dateKey: "", revenue: Infinity };
  const total = periodKeysFor(year, month).reduce((sum, dateKey) => {
    const record = getRecord(dateKey, false);
    const calc = calcRecordDetails(record);
    if (calc.revenue > best.revenue) best = { dateKey, revenue: calc.revenue };
    if (!record.off && calc.revenue > 0 && calc.revenue < worst.revenue) worst = { dateKey, revenue: calc.revenue };
    return {
      count: sum.count + calc.count,
      revenue: sum.revenue + calc.revenue,
      workDays: sum.workDays + (calc.revenue > 0 ? 1 : 0),
      offDays: sum.offDays + (record.off ? 1 : 0),
      fresh: sum.fresh + calc.freshCount,
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
  el.setupError.textContent = "배포 설정 오류: 운영 주소에서는 Supabase 공개 설정이 필요합니다. src/config.js의 PUBLIC_SUPABASE_CONFIG에 Project URL과 anon public key를 넣어 배포하세요.";
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
  el.syncStatus.classList.toggle("sync-ok", connected);
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
  const goal = getGoal();
  el.goalAmountInput.value = goal > 0 ? goal.toLocaleString("ko-KR") : "";
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
  await loadProfile();
  if (state.profile?.status !== "approved") {
    showAuth(false);
    showPending(true);
    return;
  }
  showPending(false);
  applyProfileUi();
  await loadFromDb();
  renderAll();
  showAuth(false);
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
  const displayName = user.user_metadata?.display_name || user.email?.split("@")[0] || "사용자";
  const driverType = user.user_metadata?.driver_type === "fixed" ? "fixed" : "backup";
  const { data: ensured, error: rpcError } = await state.db.rpc("quickflex_ensure_profile", {
    profile_email: user.email,
    profile_display_name: displayName,
    profile_driver_type: driverType,
  });
  if (!rpcError && ensured) {
    state.profile = Array.isArray(ensured) ? ensured[0] : ensured;
    return;
  }
  if (rpcError && !/quickflex_ensure_profile|Could not find the function/i.test(rpcError.message || "")) throw rpcError;
  const profile = {
    id: user.id,
    email: user.email,
    display_name: displayName,
    driver_type: driverType,
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
  renderAll();
  if (el.app.dataset.view === "record") renderEntryForm();
  toast("내 정보를 저장했습니다.", "success");
}
async function saveGoalAmount() {
  const goal = goalRawValue();
  if (!goal || goal <= 0) return toast("올바른 목표 금액을 입력해 주세요.", "error");
  if (!state.db || !currentUserId()) throw new Error("DB 연결이 필요합니다.");
  const updatedAt = new Date().toISOString();
  const { error } = await state.db
    .from(TABLES.profiles)
    .update({ goal_amount: goal, updated_at: updatedAt })
    .eq("id", currentUserId());
  if (error) throw error;
  state.profile = { ...(state.profile || {}), goal_amount: goal, updated_at: updatedAt };
  applyProfileUi();
  renderSummary();
  renderStats();
  toast("목표를 저장했습니다.", "success");
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
  const redirectTo = PUBLIC_SITE_URL;
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
  state.defaultRates = [];
  state.routeBundles = [];
  state.entries = {};
  renderAll();
  showPending(false);
  showAuth(true);
}

function ratesFromDb(rows) {
  return (rows || []).map((row) => ({ route: normalizeRoute(row.route), unit: toNum(row.current_unit), count: 0, amount: 0 }))
    .filter((row) => row.route && row.route !== GOAL_SETTING_ROUTE)
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
    if (!isBackupDriver() && !entries[dateKey].rows.length) ensureFixedRecordRows(entries[dateKey]);
  });
  return entries;
}
async function migrateLegacyGoalAmount(legacyGoal) {
  const currentGoal = toNum(state.profile?.goal_amount);
  if (!legacyGoal || legacyGoal <= 0 || (currentGoal && currentGoal !== GOAL)) return;
  state.profile = { ...(state.profile || {}), goal_amount: legacyGoal };
  if (!state.db || !currentUserId()) return;
  const { data, error } = await state.db
    .from(TABLES.profiles)
    .update({ goal_amount: legacyGoal, updated_at: new Date().toISOString() })
    .eq("id", currentUserId())
    .select("*")
    .single();
  if (!error && data) state.profile = data;
}
async function loadFromDb() {
  if (!state.db || !currentUserId()) return;
  const userId = currentUserId();
  const defaultRatesQuery = state.profile?.role === "admin"
    ? Promise.resolve({ data: [], error: null })
    : state.db.from(TABLES.rates).select("*").neq("user_id", userId).order("route");
  const [ratesResult, defaultRatesResult, daysResult, itemsResult, bundlesResult] = await Promise.all([
    state.db.from(TABLES.rates).select("*").eq("user_id", userId).order("route"),
    defaultRatesQuery,
    state.db.from(TABLES.days).select("*").eq("user_id", userId),
    state.db.from(TABLES.items).select("*").eq("user_id", userId).order("sort_order"),
    state.db.from(TABLES.bundles).select("*").eq("active", true).order("sort_order").order("label"),
  ]);
  if (ratesResult.error) throw ratesResult.error;
  if (defaultRatesResult.error) throw defaultRatesResult.error;
  if (daysResult.error) throw daysResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (bundlesResult.error) throw bundlesResult.error;
  const goalRate = (ratesResult.data || []).find((row) => normalizeRoute(row.route) === GOAL_SETTING_ROUTE);
  await migrateLegacyGoalAmount(toNum(goalRate?.current_unit));
  state.rates = ratesFromDb(ratesResult.data);
  state.defaultRates = ratesFromDb(defaultRatesResult.data);
  state.routeBundles = bundlesResult.data || [];
  state.entries = entriesFromDb(daysResult.data, itemsResult.data);
  const hadRates = state.rates.length > 0;
  if (!state.rates.length && !state.defaultRates.length) {
    state.rates = avgRates(SAMPLE_SETTLEMENT);
  }
  if (!state.defaultRates.length && !hadRates && (state.rates.length || !state.defaultRates.length)) {
    const merged = mergeDefaultRouteMaster(state.rates);
    state.rates = merged.rates;
    if (!hadRates || merged.changed) await persistRates();
  }
  setDbBadge(true, "동기화됨");
}
async function persistRates() {
  const userId = currentUserId();
  const cleanRates = state.rates.filter((rate) => normalizeRoute(rate.route) && normalizeRoute(rate.route) !== GOAL_SETTING_ROUTE && toNum(rate.unit) >= 0);
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
  el.periodRange.textContent = `정산기간 ${formatPeriodRangeSimple(start, end)}`;
  el.periodRevenue.textContent = fmtWon(total.revenue);
  el.periodCount.textContent = fmtCount(total.count);
  el.dailyAverage.textContent = formatCompactWonWithUnit(total.average);
  el.workDaysHome.textContent = `${total.workDays}일`;
  const goal = getGoal();
  const pct = Math.min(100, total.revenue / goal * 100);
  el.meterFill.style.width = `${pct}%`;
  el.meterPct.textContent = `${Math.round(pct)}%`;
  el.meterLabel.textContent = `목표 ${fmtWon(goal)} 대비 진행률`;
}
function renderMonth() {
  const { start, end } = periodBounds();
  const first = new Date(start);
  first.setDate(first.getDate() - first.getDay());
  const last = new Date(end);
  last.setDate(last.getDate() + (6 - last.getDay()));
  const cellCount = Math.max(35, Math.ceil((last - first) / 86400000) + 1);
  el.monthCalendar.innerHTML = "";
  for (let i = 0; i < cellCount; i += 1) {
    const date = new Date(first);
    date.setDate(first.getDate() + i);
    const dateKey = toDateKey(date);
    const record = getRecord(dateKey, false);
    const calc = calcRecord(record);
    const inPeriod = periodKeys().includes(dateKey);
    const holidayName = koreanHoliday(dateKey);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `day-cell${inPeriod ? "" : " outside"}${dateKey === state.selectedDate ? " selected" : ""}${dateKey === todayKey() ? " today-cell" : ""}${record.off ? " off" : ""}${holidayName ? " holiday" : ""}`;
    const routeText = record.off ? "" : formatRecordRoutes(record.rows);
    const displayValue = record.off ? "휴무" : state.mode === "count" ? (calc.count ? fmtCount(calc.count) : "") : formatCalendarWon(calc.revenue);
    const displayRouteOrHoliday = routeText || (!displayValue && holidayName ? holidayName : "");
    if (holidayName) cell.title = holidayName;
    cell.innerHTML = `<span class="day-number">${date.getDate()}</span><span class="day-value">${displayValue}</span><span class="day-routes">${displayRouteOrHoliday}</span>`;
    cell.addEventListener("click", () => selectDate(dateKey));
    el.monthCalendar.appendChild(cell);
  }
}
function renderHomeSelection() {
  const record = getRecord(state.selectedDate, false);
  const calc = calcRecord(record);
  el.homeSelectedDate.textContent = formatLong(state.selectedDate);
  el.homeSelectedTotal.textContent = record.off ? "휴무" : fmtWon(calc.revenue);
  el.homeSelectedDate.textContent = formatMonthDay(state.selectedDate);
  el.homeSelectedTotal.textContent = record.off ? "휴무" : fmtWon(calc.revenue);
  el.homeOffToggle.classList.toggle("active", record.off);
}
function selectDate(dateKey) {
  state.selectedDate = dateKey;
  renderMonth();
  renderHomeSelection();
}
function selectToday() {
  const todayDate = new Date();
  const period = periodForDate(todayDate);
  state.year = period.year;
  state.month = period.month;
  selectDate(toDateKey(todayDate));
  renderSummary();
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
  const optionRoutes = new Set([...state.rates, ...state.defaultRates].map((rate) => rate.route));
  selectedRoutes.forEach((route) => optionRoutes.add(route));
  if (!isBackupDriver()) fixedRoutes().forEach((route) => optionRoutes.add(route));
  return [...optionRoutes].sort().map((route) => `<option value="${route}"${selectedRoutes[0] === route ? " selected" : ""}>${route}</option>`).join("");
}
function renderEntryForm() {
  const existed = Boolean(state.entries[state.selectedDate]);
  let record = currentRecordDraft();
  if (record.off) record.rows = [];
  el.selectedDateTitle.textContent = formatRecordTitleDate(state.selectedDate);
  el.offToggle.checked = record.off;
  el.entryRows.innerHTML = "";
  record.rows.forEach((row, index) => renderEntryRow(row, index));
  const defaultRows = defaultEntryRows();
  if (!existed && !record.rows.length && !record.off && defaultRows.length) {
    record.rows = defaultRows;
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
  routeInput.value = formatRouteLabel(row.route);
  routeInput.readOnly = false;
  count.value = row.count || "";
  unit.value = row.unit || sharedRateForRoutes(row.route) || "";
  unit.title = "이 날짜에만 적용되는 단가입니다. 기본 단가는 바뀌지 않습니다.";
  unit.setAttribute("aria-label", "이 날짜 단가");
  output.textContent = fmtWon(toNum(count.value) * toNum(unit.value));
  del.style.visibility = "visible";
  routeInput.addEventListener("input", () => {
    routeInput.value = routeInput.value.toUpperCase();
    const expanded = expandRouteText(routeInput.value);
    const joined = joinStoredRoutes(expanded);
    const record = currentRecordDraft();
    record.rows[index].route = joined || routeInput.value;
    record.rows[index].draft = !joined;
    const autoUnit = autoUnitForRoutes(joined || expanded);
    record.rows[index].unit = autoUnit;
    unit.value = autoUnit || "";
    output.textContent = fmtWon(toNum(count.value) * autoUnit);
    refreshTotals();
  });
  routeInput.addEventListener("blur", () => {
    const expanded = expandRouteText(routeInput.value);
    const joined = joinStoredRoutes(expanded);
    const record = currentRecordDraft();
    record.rows[index].route = joined || routeInput.value;
    record.rows[index].draft = !joined;
    routeInput.value = joined ? formatRouteLabel(joined) : routeInput.value.trim().toUpperCase();
    const autoUnit = autoUnitForRoutes(joined || expanded);
    record.rows[index].unit = autoUnit;
    unit.value = autoUnit || "";
    output.textContent = fmtWon(toNum(count.value) * autoUnit);
    refreshTotals();
  });
  count.addEventListener("input", () => {
    const record = currentRecordDraft();
    record.rows[index].count = count.value;
    refreshTotals();
  });
  unit.addEventListener("input", () => {
    const record = currentRecordDraft();
    record.rows[index].unit = unit.value;
    refreshTotals();
  });
  del.addEventListener("click", () => {
    const record = currentRecordDraft();
    record.rows.splice(index, 1);
    renderEntryForm();
    refreshTotals();
  });
  el.entryRows.appendChild(node);
}
function syncFormToRecord() {
  const record = currentRecordDraft();
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
  commitRecordDraft();
  scheduleSave({ dateKeys: [state.selectedDate], immediate: true });
  await ensurePendingSavesFlushed();
  renderAll();
  showView("home");
  toast("기록을 저장했습니다.", "success");
}

function renderRates() {
  const allowedRoutes = new Set(fixedRoutes());
  const mergedRates = mergeDefaultRatesForDisplay();
  const visibleRates = isBackupDriver() ? mergedRates : mergedRates.filter((rate) => allowedRoutes.has(rate.route));
  const personalRoutes = new Set(state.rates.map((rate) => rate.route));
  el.rateList.innerHTML = visibleRates.length
    ? visibleRates.map((rate) => {
      const route = escapeAttr(rate.route);
      const deleteButton = personalRoutes.has(rate.route) ? `<button class="rate-delete" data-route="${route}" type="button" aria-label="${route} 구역 삭제">×</button>` : "";
      return `<div class="rate-chip" data-route="${route}" role="button" tabindex="0"><strong>${route}</strong><span>${fmtWon(rate.unit)}</span>${deleteButton}</div>`;
    }).join("")
    : `<div class="daily-card"><span>${isBackupDriver() ? "등록된 단가가 없습니다." : "고정 라우트를 먼저 등록하면 해당 단가만 표시됩니다."}</span></div>`;
  el.rateList.querySelectorAll(".rate-chip").forEach((button) => {
    const selectRate = () => {
      const rate = mergedRates.find((item) => item.route === button.dataset.route);
      if (!rate) return;
      el.rateRoute.value = rate.route;
      el.rateUnit.value = rate.unit;
    };
    button.addEventListener("click", (event) => {
      if (event.target.closest(".rate-delete")) return;
      selectRate();
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      selectRate();
    });
  });
  el.rateList.querySelectorAll(".rate-delete").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteRate(button.dataset.route).catch((error) => toast(`구역 삭제 실패: ${error.message}`, "error"));
    });
  });
}
function mergeDefaultRatesForDisplay() {
  const byRoute = new Map();
  state.defaultRates.forEach((rate) => byRoute.set(rate.route, rate));
  state.rates.forEach((rate) => byRoute.set(rate.route, rate));
  return [...byRoute.values()].sort((a, b) => a.route.localeCompare(b.route));
}
function isKnownRateRoute(route) {
  const normalized = normalizeRoute(route);
  return DEFAULT_ROUTE_MASTER.includes(normalized)
    || state.rates.some((rate) => rate.route === normalized)
    || state.defaultRates.some((rate) => rate.route === normalized);
}
async function deleteRate(routeValue) {
  const route = normalizeRoute(routeValue);
  if (!route) return;
  if (!state.rates.some((rate) => rate.route === route)) return toast("삭제할 개인 구역이 없습니다.", "error");
  if (!window.confirm(`${route} 구역을 내 단가 목록에서 삭제할까요? 기존 기록의 매출은 유지됩니다.`)) return;
  state.rates = state.rates.filter((rate) => rate.route !== route);
  if (state.db && currentUserId()) {
    const { error } = await state.db.from(TABLES.rates).delete().eq("user_id", currentUserId()).eq("route", route);
    if (error) throw error;
  }
  if (el.rateRoute.value.trim().toUpperCase() === route) {
    el.rateRoute.value = "";
    el.rateUnit.value = "";
  }
  renderRates();
  renderAll();
  if (el.app.dataset.view === "record") renderEntryForm();
  toast(`${route} 구역을 삭제했습니다.`, "success");
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
async function approvedRateTargetUserIds() {
  if (state.profile?.role !== "admin" || !state.db) return [currentUserId()];
  const { data, error } = await state.db
    .from(TABLES.profiles)
    .select("id,driver_type,status")
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
  if (!window.confirm(`${createdPreview}\n${changedPreview}\n\n승인된 사용자들의 DB 기본 단가에 반영할까요?`)) {
    toast("단가 반영을 취소했습니다.", "error");
    return false;
  }
  selectedRates.forEach((rate) => {
    const existing = state.rates.find((item) => item.route === rate.route);
    if (existing) Object.assign(existing, rate);
    else state.rates.push(rate);
  });
  state.rates = mergeDefaultRouteMaster(state.rates).rates;
  const targetUserIds = await approvedRateTargetUserIds();
  await persistRatesForUsers(state.rates, targetUserIds);
  renderRates();
  renderAll();
  toast(`정산표 단가와 기본 구역 ${state.rates.length}개를 승인 사용자 ${targetUserIds.length}명 기준으로 반영했습니다.`, "success");
  return true;
}

function renderStats() {
  const { start: cycleStart, end: cycleEnd } = periodBounds(state.statsYear, state.statsMonth);
  const keys = getStatsKeys();
  const { start, end } = getStatsBounds();
  const total = summarizeKeys(keys);
  el.statsMonthTitle.textContent = `${state.statsYear}년 ${String(state.statsMonth).padStart(2, "0")}월`;
  el.statsRange.textContent = `${formatShort(cycleStart)} ~ ${formatShort(cycleEnd)}`;
  if (el.statsSummaryRange) el.statsSummaryRange.textContent = formatRangeLabel(start, end);
  if (el.statsRevenue) el.statsRevenue.textContent = fmtWon(total.revenue);
  const goal = getGoal();
  const statsPct = goal ? Math.min(100, total.revenue / goal * 100) : 0;
  el.statsMeterFill.style.width = `${statsPct}%`;
  el.statsMeterPct.textContent = `${Math.round(statsPct)}%`;
  el.statsMeterLabel.textContent = goal ? `목표 ${fmtWon(goal)} (설정됨)` : "목표 미설정";
  renderStatsSummaryRows(total, statsPct);
  el.statsWorkDays.textContent = `${total.workDays}일`;
  el.statsOffDays.textContent = `${total.offDays}일`;
  el.statsCount.textContent = fmtCount(total.count);
  el.statsFresh.textContent = fmtCount(total.fresh);
  if (el.statsAvgCount) el.statsAvgCount.textContent = fmtCount(Math.round(total.avgCount));
  el.statsAverage.textContent = formatCompactWonWithUnit(total.average);
  el.statsBestDay.textContent = total.best.dateKey ? `${formatLongShort(total.best.dateKey)} ${fmtWon(total.best.revenue)}` : "-";
  el.statsWorstDay.textContent = total.worst.dateKey ? `${formatLongShort(total.worst.dateKey)} ${fmtWon(total.worst.revenue)}` : "-";
  syncStatsRangeButtons();
  renderRevenueList(keys);
  renderStatsChart(keys);
  renderDailyStatsFor(keys);
  renderYearlyStats();
  renderTotalStats();
}
function renderStatsSummaryRows(total, statsPct) {
  const rows = document.querySelector(".stats-summary-card .ssc-rows");
  if (!rows) return;
  rows.innerHTML = `
    <div class="ssc-main"><span>총매출</span><strong>${fmtWon(total.revenue)}</strong></div>
    <div><span>목표 대비</span><strong>${Math.round(statsPct)}%</strong></div>
    <div><span>근무일</span><strong>${total.workDays}일</strong></div>
    <div><span>일평균</span><strong>${formatCompactWonWithUnit(total.average)}</strong></div>
    <div><span>총 배송건수</span><strong>${fmtCount(total.count)}</strong></div>
  `;
}
function renderDailyStats() { renderDailyStatsFor(getStatsKeys()); }
function renderDailyStatsFor(allKeys) {
  const keys = (allKeys || []).filter((dateKey) => hasMeaningfulRecord(getRecord(dateKey, false)));
  el.dailyList.innerHTML = keys.length ? keys.map((dateKey) => {
    const record = getRecord(dateKey, false);
    const details = calcRecordDetails(record);
    const open = state.statsDetailDate === dateKey;
    const routes = record.rows.map((row) => {
      const sub = toNum(row.count) * effectiveUnit(row);
      return `<div class="dd-row"><span>${formatRouteLabel(row.route)} · ${fmtCount(row.count)} × ${fmtWon(effectiveUnit(row))}</span><strong>${fmtWon(sub)}</strong></div>`;
    }).join("");
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
      ${open ? `<div class="daily-detail">${
        record.off ? "<div class=\"dd-row\"><span>휴무</span></div>" :
        `${routes || "<div class=\"dd-row\"><span>라우트 없음</span></div>"}` +
        `${details.freshRevenue ? `<div class="dd-row"><span>프레시백 ${fmtCount(details.freshCount)}</span><strong>${fmtWon(details.freshRevenue)}</strong></div>` : ""}` +
        `${details.backupRevenue ? `<div class="dd-row"><span>백업수당</span><strong>${fmtWon(details.backupRevenue)}</strong></div>` : ""}` +
        `<div class="dd-row dd-total"><span>합계</span><strong>${fmtWon(details.revenue)}</strong></div>`
      }</div>` : ""}
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
function syncStatsRangeButtons() {
  if (!el.statsRangeTabs) return;
  el.statsRangeTabs.querySelectorAll("button[data-range]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.range === state.statsRangeMode);
  });
  if (el.statsRangeCustom) el.statsRangeCustom.hidden = state.statsRangeMode !== "custom";
  const navDisabled = state.statsRangeMode !== "thisMonth";
  if (el.statsPrevMonth) el.statsPrevMonth.classList.toggle("is-disabled", navDisabled);
  if (el.statsNextMonth) el.statsNextMonth.classList.toggle("is-disabled", navDisabled);
}
function renderRevenueList(keys) {
  if (!el.revenueList) return;
  const items = aggregateRevenueByItem(keys);
  if (!items.length) {
    el.revenueList.innerHTML = `<div class="rev-empty">기록된 매출 항목이 없습니다.</div>`;
    return;
  }
  let visibleTotal = 0;
  const renderRow = (item) => {
    const checked = isVisibleKey(item.key);
    if (checked) visibleTotal += item.revenue;
    const meta = item.kind === "route" ? fmtCount(item.count) : (item.kind === "fresh" ? fmtCount(item.count) : "");
    return `<label class="rev-row${checked ? "" : " is-off"}">
      <input type="checkbox" data-rev-key="${escapeAttr(item.key)}" ${checked ? "checked" : ""} />
      <span class="rev-label">${escapeAttr(item.label)}</span>
      ${meta ? `<span class="rev-meta">${meta}</span>` : ""}
      <strong class="rev-amount">${fmtWon(item.revenue)}</strong>
    </label>`;
  };
  const groups = aggregateRevenueGroups(items);
  const sections = [groups.route, groups.fresh, groups.backup]
    .filter((group) => group.items.length)
    .map((group) => {
      const meta = group.count ? fmtCount(group.count) : "";
      return `<section class="rev-section">
        <div class="rev-section-head">
          <span>${group.label}</span>
          ${meta ? `<em>${meta}</em>` : ""}
          <strong>${fmtWon(group.revenue)}</strong>
        </div>
        <div class="rev-section-rows">${group.items.map(renderRow).join("")}</div>
      </section>`;
    }).join("");
  el.revenueList.innerHTML = `${sections}<div class="rev-row rev-sum"><span class="rev-label">선택 합계</span><strong class="rev-amount">${fmtWon(visibleTotal)}</strong></div>`;
  el.revenueList.querySelectorAll("input[data-rev-key]").forEach((cb) => {
    cb.addEventListener("change", () => {
      state.revenueVisibility[cb.dataset.revKey] = cb.checked;
      try { localStorage.setItem("quickflex-revenue-vis", JSON.stringify(state.revenueVisibility)); } catch (_) {}
      renderStats();
    });
  });
}
const statsChartState = { keys: [], series: [], points: [], hoverIndex: -1 };
function niceStep(rawStep) {
  if (rawStep <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / exp;
  const candidate = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return candidate * exp;
}
function renderStatsChart(keys) {
  const canvas = el.statsChart;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.parentElement ? canvas.parentElement.clientWidth - 24 : 320;
  const cssH = 190;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const series = keys.map((dateKey) => {
    const record = getRecord(dateKey, false);
    const details = calcRecordDetails(record);
    return { dateKey, revenue: recordVisibleRevenue(record), count: details.count, freshCount: details.freshCount };
  });
  statsChartState.keys = keys;
  statsChartState.series = series;
  statsChartState.points = [];
  statsChartState.hoverIndex = -1;
  if (el.statsChartTooltip) el.statsChartTooltip.hidden = true;
  if (!series.length) {
    ctx.fillStyle = "#98a2b3";
    ctx.font = "12px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("표시할 데이터가 없습니다", cssW / 2, cssH / 2);
    return;
  }
  const margin = { l: 42, r: 10, t: 12, b: 26 };
  const w = cssW - margin.l - margin.r;
  const h = cssH - margin.t - margin.b;
  const maxVal = Math.max(...series.map((s) => s.revenue), 100000);
  const step = niceStep(maxVal / 5);
  const yMax = Math.ceil(maxVal / step) * step;
  const cs = getComputedStyle(document.documentElement);
  const primaryColor = (cs.getPropertyValue("--gold") || "#0066FF").trim() || "#0066FF";
  const gridColor = (cs.getPropertyValue("--line") || "rgba(112,115,124,.18)").trim() || "rgba(112,115,124,.18)";
  const labelColor = (cs.getPropertyValue("--muted") || "#70737C").trim() || "#70737C";
  ctx.strokeStyle = gridColor;
  ctx.fillStyle = labelColor;
  ctx.font = "10px 'Pretendard Variable', Pretendard, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 1;
  for (let v = 0; v <= yMax; v += step) {
    const y = margin.t + h - (v / yMax) * h;
    ctx.beginPath();
    ctx.moveTo(margin.l, y);
    ctx.lineTo(margin.l + w, y);
    ctx.stroke();
    ctx.fillText(formatKoreanWon(v), margin.l - 6, y);
  }
  const xFor = (i) => series.length === 1 ? margin.l + w / 2 : margin.l + (i / (series.length - 1)) * w;
  const yFor = (v) => margin.t + h - (v / yMax) * h;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const labelCount = Math.min(5, series.length);
  for (let i = 0; i < labelCount; i += 1) {
    const idx = Math.round((i / Math.max(1, labelCount - 1)) * (series.length - 1));
    const d = parseDateKey(series[idx].dateKey);
    if (!d) continue;
    ctx.fillText(`${d.getMonth() + 1}/${d.getDate()}`, xFor(idx), margin.t + h + 6);
  }
  const barGap = Math.max(3, Math.min(8, w / Math.max(1, series.length) * .24));
  const barW = Math.max(3, Math.min(18, w / Math.max(1, series.length) - barGap));
  const zeroY = yFor(0);
  series.forEach((s, i) => {
    const x = xFor(i);
    const y = yFor(s.revenue);
    statsChartState.points.push({ x, y, ...s });
    const barH = Math.max(s.revenue > 0 ? 3 : 1, zeroY - y);
    ctx.fillStyle = s.revenue > 0 ? primaryColor : (cs.getPropertyValue("--soft").trim() || "#AEB0B6");
    ctx.globalAlpha = s.revenue > 0 ? .9 : .35;
    ctx.fillRect(x - barW / 2, zeroY - barH, barW, barH);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.fillStyle = s.revenue > 0 ? "#fff" : (cs.getPropertyValue("--muted").trim() || "#70737C");
    ctx.arc(x, y, s.revenue > 0 ? 2.2 : 1.8, 0, Math.PI * 2);
    ctx.fill();
  });
}
function showChartTooltip(clientX) {
  const canvas = el.statsChart;
  const tooltip = el.statsChartTooltip;
  if (!canvas || !tooltip || !statsChartState.points.length) return;
  const rect = canvas.getBoundingClientRect();
  const localX = clientX - rect.left;
  let nearest = 0;
  let nearestDx = Infinity;
  statsChartState.points.forEach((p, i) => {
    const dx = Math.abs(p.x - localX);
    if (dx < nearestDx) { nearestDx = dx; nearest = i; }
  });
  const point = statsChartState.points[nearest];
  if (!point) return;
  tooltip.innerHTML = `<strong>${formatLongShort(point.dateKey)}</strong>` +
    `<div>매출 <b>${fmtWon(point.revenue)}</b></div>` +
    `<div>총 물량 <b>${fmtCount(point.count)}</b></div>` +
    `<div>프레시백 <b>${fmtCount(point.freshCount)}</b></div>`;
  tooltip.hidden = false;
  const cardRect = canvas.parentElement.getBoundingClientRect();
  let left = point.x - tooltip.offsetWidth / 2;
  const maxLeft = cardRect.width - tooltip.offsetWidth - 4;
  if (left < 4) left = 4;
  if (left > maxLeft) left = maxLeft;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${Math.max(0, point.y - tooltip.offsetHeight - 10)}px`;
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
    if (state.adminTab === "bundles") await renderAdminBundles();
  } catch (error) {
    const target = state.adminTab === "routes"
      ? el.adminRouteList
      : state.adminTab === "users"
        ? el.adminProfiles
        : state.adminTab === "bundles"
          ? el.adminBundleList
          : el.adminRevenueList;
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
function normalizeBundleRows(rows) {
  return (rows || [])
    .map((row) => ({
      ...row,
      label: String(row.label || "").trim(),
      routes: routeListFromText(row.routes),
      active: row.active !== false,
      sort_order: toNum(row.sort_order),
    }))
    .filter((row) => row.label && row.routes.length >= 1)
    .sort((a, b) => a.sort_order - b.sort_order || a.label.localeCompare(b.label));
}
async function loadRouteBundles({ includeInactive = false } = {}) {
  if (!state.db) return [];
  let query = state.db.from(TABLES.bundles).select("*").order("sort_order").order("label");
  if (!includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  const bundles = normalizeBundleRows(data);
  if (!includeInactive) state.routeBundles = bundles;
  return bundles;
}
function parseBundleDraft(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parts = line.split("=");
      const routeText = parts.length > 1 ? parts.slice(1).join("=") : line;
      const routes = routeListFromText(routeText);
      const label = (parts.length > 1 ? parts[0] : compactRouteList(routes)).trim();
      return { label, routes, sort_order: index };
    })
    .filter((row) => row.label && row.routes.length >= 1);
}
async function saveRouteBundle({ id = null, label, routes, active = true, sort_order = 0 }) {
  const cleanRoutes = routeListFromText(routes);
  const cleanLabel = String(label || compactRouteList(cleanRoutes)).trim();
  if (!cleanLabel || cleanRoutes.length < 1) throw new Error("묶음 이름과 1개 이상의 구역이 필요합니다.");
  const payload = {
    label: cleanLabel,
    routes: cleanRoutes,
    active: Boolean(active),
    sort_order: toNum(sort_order),
    updated_at: new Date().toISOString(),
  };
  const query = id
    ? state.db.from(TABLES.bundles).update(payload).eq("id", id)
    : state.db.from(TABLES.bundles).upsert(payload, { onConflict: "label" });
  const { error } = await query;
  if (error) throw error;
  state.routeBundles = await loadRouteBundles();
}
async function renderAdminBundles() {
  if (!el.adminBundleList || state.profile?.role !== "admin") return;
  if (!state.db) {
    el.adminBundleList.innerHTML = `<div class="daily-card"><span>DB 연결 후 확인할 수 있습니다.</span></div>`;
    return;
  }
  el.adminBundleList.innerHTML = `<div class="daily-card"><span>OCR 보정 묶음을 불러오는 중입니다.</span></div>`;
  const bundles = await loadRouteBundles({ includeInactive: true });
  state.routeBundles = bundles.filter((bundle) => bundle.active);
  el.adminBundleList.innerHTML = bundles.length ? bundles.map((bundle) => `
    <div class="admin-card" data-bundle-id="${bundle.id}">
      <div class="admin-card-row">
        <input data-field="label" type="text" value="${escapeAttr(bundle.label)}" aria-label="묶음 이름" />
        <input data-field="sort_order" type="number" value="${toNum(bundle.sort_order)}" aria-label="정렬" />
        <label class="inline-check"><input data-field="active" type="checkbox"${bundle.active ? " checked" : ""} /> 사용</label>
      </div>
      <label class="admin-route-field">
        <span>구역 코드</span>
        <input data-field="routes" type="text" value="${escapeAttr(bundle.routes.join(", "))}" />
      </label>
      <div class="admin-card-row">
        <button class="secondary-btn" data-action="save-bundle">저장</button>
        <button class="secondary-btn danger" data-action="delete-bundle">삭제</button>
      </div>
    </div>
  `).join("") : `<div class="daily-card"><span>등록된 OCR 보정 묶음이 없습니다.</span></div>`;
}
async function addAdminBundleFromInputs() {
  await saveRouteBundle({
    label: el.adminBundleLabel.value,
    routes: el.adminBundleRoutes.value,
    sort_order: (state.routeBundles || []).length,
  });
  el.adminBundleLabel.value = "";
  el.adminBundleRoutes.value = "";
  await renderAdminBundles();
  toast("OCR 보정 묶음을 저장했습니다.", "success");
}
async function importAdminBundles() {
  const rows = parseBundleDraft(el.adminBundleBulk.value);
  if (!rows.length) throw new Error("저장할 묶음 초안을 찾지 못했습니다.");
  const payload = rows.map((row) => ({
    label: row.label,
    routes: row.routes,
    active: true,
    sort_order: row.sort_order,
    updated_at: new Date().toISOString(),
  }));
  const { error } = await state.db.from(TABLES.bundles).upsert(payload, { onConflict: "label" });
  if (error) throw error;
  el.adminBundleBulk.value = "";
  state.routeBundles = await loadRouteBundles();
  await renderAdminBundles();
  toast(`${payload.length}개 묶음을 저장했습니다.`, "success");
}
async function saveAdminBundleCard(card) {
  await saveRouteBundle({
    id: card.dataset.bundleId,
    label: card.querySelector('[data-field="label"]').value,
    routes: card.querySelector('[data-field="routes"]').value,
    active: card.querySelector('[data-field="active"]').checked,
    sort_order: card.querySelector('[data-field="sort_order"]').value,
  });
  await renderAdminBundles();
  toast("OCR 보정 묶음을 저장했습니다.", "success");
}
async function deleteAdminBundleCard(card) {
  if (!window.confirm("이 OCR 보정 묶음을 삭제할까요?")) return;
  const { error } = await state.db.from(TABLES.bundles).delete().eq("id", card.dataset.bundleId);
  if (error) throw error;
  state.routeBundles = await loadRouteBundles();
  await renderAdminBundles();
  toast("OCR 보정 묶음을 삭제했습니다.", "success");
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
    record.rows = routes === null ? [] : buildGroupedRows(routes);
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
  if (!map) {
    ocrDraftMap = null;
  } else {
    ocrDraftMap = {};
    Object.entries(map).forEach(([dateKey, routes]) => {
      if (routes === null) {
        ocrDraftMap[dateKey] = null;
      } else {
        const corrected = correctRouteList(routes);
        ocrDraftMap[dateKey] = corrected.length ? corrected : draftWorkRoutes();
      }
    });
  }
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
    const chips = (routes || []).map((route) => `<span class="draft-chip">${route}<button type="button" data-action="remove" data-date="${dateKey}" data-route="${route}">×</button></span>`).join("");
    const addControl = `<span class="draft-add-row"><input class="draft-add-input" data-date="${dateKey}" type="text" placeholder="구역" autocapitalize="characters" /><button class="draft-add-btn" type="button" data-action="add" data-date="${dateKey}">추가</button></span>`;
    return `<div class="draft-card"><div class="draft-card-header"><strong>${formatLongShort(dateKey)}</strong><button class="draft-off-btn${routes === null ? " active" : ""}" type="button" data-action="off" data-date="${dateKey}">${routes === null ? "휴무" : "근무"}</button></div><div>${routes === null ? "휴무" : `${chips}${addControl}`}</div></div>`;
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
function loadImageFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (error) => { URL.revokeObjectURL(url); reject(error); };
    img.src = url;
  });
}
function averageRgbFromImageData(imageData) {
  const data = imageData.data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < data.length; i += 16) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n += 1;
  }
  return n ? { r: r / n, g: g / n, b: b / n } : { r: 255, g: 255, b: 255 };
}
function isPinkOffColor({ r, g, b }) {
  return r > 205 && g > 120 && g < 215 && b > 130 && b < 225 && r - g > 18 && r - b > 18;
}
async function detectPinkOffDates(file, debug) {
  const columns = Array.isArray(debug?.columns) ? debug.columns : [];
  const ownerRow = debug?.ownerRow;
  if (!columns.length || !ownerRow || !Number.isFinite(ownerRow.cy)) return new Set();
  const img = await loadImageFile(file);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const rowHeight = Math.max(18, Number(ownerRow.bottom || ownerRow.cy) - Number(ownerRow.top || ownerRow.cy));
  const y = Math.max(0, Math.round(Number(ownerRow.cy) - rowHeight * 0.45));
  const h = Math.max(8, Math.min(canvas.height - y, Math.round(rowHeight * 0.9)));
  const offDates = new Set();
  columns.forEach((column) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(column.date || ""))) return;
    const left = Number(column.left);
    const right = Number(column.right);
    if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return;
    const pad = Math.max(4, (right - left) * 0.18);
    const x = Math.max(0, Math.round(left + pad));
    const w = Math.max(8, Math.min(canvas.width - x, Math.round(right - left - pad * 2)));
    const avg = averageRgbFromImageData(ctx.getImageData(x, y, w, h));
    if (isPinkOffColor(avg)) offDates.add(column.date);
  });
  return offDates;
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
  const owner = String(driverName() || "").trim();
  if (owner.length < 2) {
    return toast("기사 이름을 정확히 입력한 뒤 다시 실행해 주세요.", "error");
  }
  const baseUrl = getEdgeFunctionUrl("ocr-schedule");
  if (!baseUrl) return toast("Supabase 연결이 필요합니다.", "error");

  el.runScheduleOcr.disabled = true;
  el.ocrStatus.textContent = "이미지 업로드 준비 중...";

  try {
    const image = await fileToBase64(file);
    el.ocrStatus.textContent = "Cloud Vision으로 스케줄 분석 중...";
    const response = await fetch(baseUrl, {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        mode: "vision-schedule",
        imageBase64: image.base64,
        mimeType: image.mimeType,
        ownerName: owner,
        year: state.year,
        month: state.month,
      }),
    });
    const result = await readOcrResponse(response);
    const { schedule } = result;
    const pinkOffDates = await detectPinkOffDates(file, result?.debug).catch(() => new Set());
    const map = {};
    Object.entries(schedule || {}).forEach(([dateKey, routes]) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        map[dateKey] = pinkOffDates.has(dateKey) ? null : Array.isArray(routes) ? routes : null;
      }
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
  const fixedRoutes = expandRouteText(card.querySelector('[data-field="fixed_routes"]')?.value || "");
  const { error } = await state.db.from(TABLES.profiles).update({
    status,
    driver_type: driverType,
    fixed_routes: driverType === "fixed" ? fixedRoutes : [],
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  if (error) throw error;
  if (status === "approved" && state.rates.length) {
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
  [el.authEmail, el.authPassword].forEach((input) => input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    if (state.authMode === "signup" || state.authMode === "reset") return;
    event.preventDefault();
    login().catch((error) => { el.authError.textContent = error.message; });
  }));
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
  el.todayButton.addEventListener("click", selectToday);
  el.homeOffToggle.addEventListener("click", () => {
    const record = getRecord(state.selectedDate, true);
    record.off = !record.off;
    if (record.off) record.rows = [];
    else record.rows = defaultEntryRows();
    scheduleSave({ dateKeys: [state.selectedDate] });
    renderAll();
  });
  el.openRecord.addEventListener("click", () => { startRecordDraft(); showView("record"); });
  el.backToCalendar.addEventListener("click", () => { discardRecordDraft(); renderAll(); showView("home"); });
  el.prevDay.addEventListener("click", () => { discardRecordDraft(); selectDate(addDays(state.selectedDate, -1)); renderEntryForm(); });
  el.nextDay.addEventListener("click", () => { discardRecordDraft(); selectDate(addDays(state.selectedDate, 1)); renderEntryForm(); });
  el.offToggle.addEventListener("change", () => {
    const record = currentRecordDraft();
    record.off = el.offToggle.checked;
    if (record.off) record.rows = [];
    else record.rows = defaultEntryRows();
    renderEntryForm();
    refreshTotals();
  });
  el.addRoute.addEventListener("click", () => {
    const record = currentRecordDraft();
    record.off = false;
    const firstRate = isBackupDriver() ? state.rates[0] || state.defaultRates[0] : null;
    record.rows.push({ route: firstRate?.route || "", count: "", unit: firstRate?.unit || 0, draft: !firstRate });
    renderEntryForm();
  });
  [el.freshCount, el.freshUnit, el.backupUnit].forEach((input) => input.addEventListener("input", () => {
    refreshTotals();
  }));
  [el.freshSoloCount, el.freshLinkedCount].forEach((input) => input.addEventListener("input", () => {
    syncFormToRecord();
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
  el.statsPrevMonth.addEventListener("click", () => { if (state.statsRangeMode !== "thisMonth") return; moveStatsMonth(-1); });
  el.statsNextMonth.addEventListener("click", () => { if (state.statsRangeMode !== "thisMonth") return; moveStatsMonth(1); });
  if (el.statsRangeTabs) {
    el.statsRangeTabs.querySelectorAll("button[data-range]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.range;
        state.statsRangeMode = next;
        if (next === "thisMonth") {
          const now = new Date();
          const m = now.getDate() <= 25 ? now.getMonth() + 1 : now.getMonth() + 2;
          const d = new Date(now.getFullYear(), m - 1, 1);
          state.statsYear = d.getFullYear();
          state.statsMonth = d.getMonth() + 1;
        }
        if (next === "custom") {
          if (!state.statsRangeCustom.from || !state.statsRangeCustom.to) {
            const today = new Date();
            const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
            state.statsRangeCustom = { from: toDateKey(monthAgo), to: toDateKey(today) };
            if (el.statsRangeFrom) el.statsRangeFrom.value = state.statsRangeCustom.from;
            if (el.statsRangeTo) el.statsRangeTo.value = state.statsRangeCustom.to;
          }
        }
        renderStats();
      });
    });
  }
  if (el.statsRangeApply) {
    el.statsRangeApply.addEventListener("click", () => {
      state.statsRangeCustom = { from: el.statsRangeFrom.value || "", to: el.statsRangeTo.value || "" };
      state.statsRangeMode = "custom";
      renderStats();
    });
  }
  if (el.statsChart) {
    const handler = (e) => {
      const ev = e.touches ? e.touches[0] : e;
      showChartTooltip(ev.clientX);
    };
    el.statsChart.addEventListener("click", handler);
    el.statsChart.addEventListener("touchstart", handler, { passive: true });
    document.addEventListener("click", (e) => {
      if (!el.statsChartTooltip || el.statsChartTooltip.hidden) return;
      if (e.target === el.statsChart) return;
      el.statsChartTooltip.hidden = true;
    });
  }
  el.adminTabs.forEach((tab) => tab.addEventListener("click", () => {
    if (state.profile?.role !== "admin") return;
    state.adminTab = tab.dataset.adminTab;
    renderAdminDashboard();
  }));
  el.adminPrevMonth.addEventListener("click", () => moveAdminMonth(-1));
  el.adminNextMonth.addEventListener("click", () => moveAdminMonth(1));
  el.saveAdminBundle.addEventListener("click", () => addAdminBundleFromInputs().catch((error) => toast(`묶음 저장 실패: ${error.message}`, "error")));
  el.importAdminBundles.addEventListener("click", () => importAdminBundles().catch((error) => toast(`초안 저장 실패: ${error.message}`, "error")));
  el.saveProfile.addEventListener("click", () => saveProfile().catch((error) => toast(`프로필 저장 실패: ${error.message}`, "error")));
  el.goalAmountInput.addEventListener("input", () => {
    const pos = el.goalAmountInput.selectionStart;
    const prevLen = el.goalAmountInput.value.length;
    const raw = parseInt(el.goalAmountInput.value.replace(/,/g, ""), 10) || 0;
    el.goalAmountInput.value = raw > 0 ? raw.toLocaleString("ko-KR") : "";
    const diff = el.goalAmountInput.value.length - prevLen;
    el.goalAmountInput.setSelectionRange(pos + diff, pos + diff);
  });
  el.saveAppSettings.addEventListener("click", () => saveGoalAmount().catch((error) => toast(`목표 저장 실패: ${error.message}`, "error")));
  document.querySelectorAll("[data-theme-set]").forEach((btn) => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.themeSet));
  });
  applyTheme(getInitialTheme());
  el.saveRate.addEventListener("click", async () => {
    const route = normalizeRoute(el.rateRoute.value);
    if (route && isBackupDriver() && !isKnownRateRoute(route)) {
      const ok = window.confirm(`새 업무 구역 ${route}를 추가할까요? 추가하면 달력과 기록하기 화면에서 계속 사용할 수 있습니다.`);
      if (!ok) return;
    }
    if (!upsertRate(el.rateRoute.value, el.rateUnit.value)) return toast("구역과 단가를 확인해 주세요.", "error");
    el.rateRoute.value = "";
    el.rateUnit.value = "";
    renderRates();
    renderAll();
    scheduleSave({ rates: true, immediate: true });
    try {
      await ensurePendingSavesFlushed();
      if (state.profile?.role === "admin" && state.rates.length) {
        const targetUserIds = await approvedRateTargetUserIds();
        await persistRatesForUsers(state.rates, targetUserIds);
        toast(`단가를 저장하고 승인 사용자 ${targetUserIds.length}명에게 반영했습니다.`, "success");
      } else {
        toast("단가를 저장했습니다.", "success");
      }
    } catch (error) {
      toast(`단가 저장 실패: ${error.message}`, "error");
    }
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
  el.scheduleDraftCards.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button || !ocrDraftMap) return;
    const dateKey = button.dataset.date;
    if (button.dataset.action === "off") ocrDraftMap[dateKey] = ocrDraftMap[dateKey] === null ? draftWorkRoutes() : null;
    if (button.dataset.action === "remove") ocrDraftMap[dateKey] = (ocrDraftMap[dateKey] || []).filter((route) => route !== button.dataset.route);
    if (button.dataset.action === "add") {
      const input = el.scheduleDraftCards.querySelector(`.draft-add-input[data-date="${dateKey}"]`);
      const route = input?.value || "";
      if (!route.trim()) {
        input?.focus();
        return;
      }
      if (route) {
        const corrected = correctRouteList(route);
        ocrDraftMap[dateKey] = [...(ocrDraftMap[dateKey] || []), ...(corrected.length ? corrected : routeListFromText(route))];
        if (input) input.value = "";
      }
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
  el.adminBundleList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const card = button.closest("[data-bundle-id]");
    if (!card) return;
    if (button.dataset.action === "save-bundle") {
      saveAdminBundleCard(card).catch((error) => toast(`묶음 저장 실패: ${error.message}`, "error"));
    }
    if (button.dataset.action === "delete-bundle") {
      deleteAdminBundleCard(card).catch((error) => toast(`묶음 삭제 실패: ${error.message}`, "error"));
    }
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
