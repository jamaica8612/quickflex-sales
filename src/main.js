import { createExpenseService } from "./services/expenses.js";
import { createRouteNotesService } from "./services/route-notes.js?v=3";
import { createRouteNotesController } from "./ui/route-notes.js?v=16";
import { createRouteNoteShareService } from "./services/route-note-share.js";
import { createRouteNoteShareDialog } from "./ui/route-note-share.js";
import { checkBetaMeasurementAccess } from "./services/beta-access.js";
import { createExpensesController } from "./ui/expenses.js";
import { createNoahController } from "./ui/noah.js?v=5";
import { createNativePullRefresh } from "./ui/native-pull-refresh.js";
import { isNativeShell } from "./ui/noah-refresh-guard.js";
import { createExportsController } from "./ui/exports.js";
import { mountCalendarSync } from "./ui/calendar-sync.js";
import { buildStatsInsights } from "./lib/stats-insights.js";
import * as motion from "./lib/motion.js";
﻿"use strict";

import {
  APP_UPDATE_NOTICE,
  DB_KEY,
  DEFAULT_BACKUP_UNIT,
  DEFAULT_ROUTE_BUNDLES,
  DEFAULT_ROUTE_MASTER,
  GOAL,
  PUBLIC_SITE_URL,
  PUBLIC_SUPABASE_CONFIG,
  RATE_UPDATE_OFFER,
  ROUTE_NOTES_CONFIG,
  RPC,
  SAMPLE_SETTLEMENT,
  TABLES,
} from "./config.js?v=11";
import {
  addDays,
  eunNeunParticle,
  formatLong,
  formatLongShort,
  formatMonthDayFull,
  formatMonthDayShort,
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
  parseScheduleRoutes,
  routeListFromText,
  splitStoredRoutes,
} from "./lib/route.js";
import {
  MAX_CUSTOM_RANGE_DAYS,
  buildStatsReport,
  dateRangeDayCount,
} from "./lib/stats-report.js";
import { bindAdminEvents } from "./ui/admin.js";
import { bindAuthEvents } from "./services/auth.js";
import { mergeDefaultRouteMaster, ratesFromDb } from "./services/db.js";
import { trackUsageEvent } from "./services/usage.js";
import {
  fetchPendingSignups,
  fetchUsageScreenSummary,
  formatUsageScreenSummary,
  pendingSignupsBannerText,
  pendingSignupsGearLabel,
  shouldShowPendingSignupsNotice,
  USAGE_SCREEN_SUMMARY_DEFAULT_WINDOW,
} from "./services/admin-insights.js";
import { bindCalendarEvents } from "./ui/calendar.js";
import { bindInspectionEvents } from "./ui/inspection.js";
import { bindOcrEvents } from "./ui/ocr.js";
import { bindRecordEvents } from "./ui/record.js?v=2";
import { bindSettingsEvents } from "./ui/settings.js?v=4";
import { bindStatsEvents } from "./ui/stats.js";

const THEME_KEY = "quickflex-theme";
const NATIVE_SESSION_REVISION_KEY = "quickflex-native-session-revision";
const THEME_DEFAULT_MARK_KEY = "quickflex-theme-default-dark-gold-v1";
const CALENDAR_ROUTES_KEY = "quickflex-calendar-routes-visible";
const APP_NOTICE_LOCAL_KEY_PREFIX = "quickflex-app-notice:";
function applyTheme(theme) {
  const t = theme === "dark" ? "dark" : "light";
  if (document.documentElement) document.documentElement.dataset.theme = t;
  if (document.body) document.body.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#10141F" : "#F7F7F8");
  try { localStorage.setItem(THEME_KEY, t); } catch (_) {}
  // The trusted Android wrapper uses the same choice for its measurement UI.
  postNativeMessage({ type: "sync_theme", theme: t });
  document.querySelectorAll("[data-theme-set]").forEach((b) => {
    const selected = b.dataset.themeSet === t;
    b.classList.toggle("active", selected);
    b.setAttribute("aria-pressed", String(selected));
  });
  if (typeof renderStats === "function") {
    try { renderStats(); } catch (_) {}
  }
  if (typeof renderSettingsSummary === "function") {
    try { renderSettingsSummary(); } catch (_) {}
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
function getCalendarRoutesPreference() {
  try {
    const saved = localStorage.getItem(CALENDAR_ROUTES_KEY);
    return saved === null ? null : saved === "1";
  } catch (_) {
    return null;
  }
}
function setCalendarRoutesPreference(visible) {
  try { localStorage.setItem(CALENDAR_ROUTES_KEY, visible ? "1" : "0"); } catch (_) {}
}
function shouldShowCalendarRoutes() {
  const saved = getCalendarRoutesPreference();
  return saved === null ? isBackupDriver() : saved;
}
import { fmtCount, fmtNum, fmtWon } from "./lib/format.js";
import { toNum } from "./lib/revenue.js";
import { koreanDateKey, resolveWorkDates } from "./lib/work-date.js?v=1.0.102";
import { detectMeasurementApp, measurementAppIntentUrl, MEASUREMENT_APP_INSTALL_URL } from "./lib/measurement-app-launch.js";
import { purgeLegacyNoahStorage } from "./lib/noah-legacy-storage.js";
import { shouldShowPreviousPeriod } from "./lib/period-fallback.js";

const isLocalRuntime = ["localhost", "127.0.0.1", ""].includes(location.hostname) || location.protocol === "file:";
const LEGACY_USER_NAMES = new Map([["kim-gwanhyun", "김관현"]]);
const INSPECTION_ITEMS = [
  ["외관점검", "번호판, 전면유리, 후사경 등의 청결상태"],
  ["외관점검", "후미등, 차폭등 등 등화장치 작동상태"],
  ["외관점검", "창닦이기(와이퍼) 작동상태"],
  ["외관점검", "적재함(보조지지대 포함), 측면 보호대, 후부반사판, 트레일러 연결장치의 부착 상태 및 훼손 여부"],
  ["상태점검", "타이어 손상 및 마모(1.6mm 이상) 여부"],
  ["상태점검", "화물, 적재함 지지대(판스프링) 등의 고정상태"],
  ["상태점검", "바퀴 너트 등 균열 여부"],
  ["기타", "냉각수, 공기압, 엔진오일 등 차량 이상 여부(계기판 확인)"],
  ["기타", "좌석안전띠 상태"],
  ["기타", "소화기 비치 여부"],
  ["기타", "안전삼각대 등 비치 여부"],
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
  rates: [],
  defaultRates: [],
  routeBundles: [],
  entries: {},
  receiptEntries: {},
  automaticSalesOverrides: {},
  workRouteDetails: {},
  salesOverrideContractAvailable: false,
  workRouteDetailsContractAvailable: false,
  salesOverrideDraft: null,
  inspections: {},
  inspectionSignature: "",
  inspectionDate: todayKey(),
  inspectionDraft: { results: {}, defectNotes: "", actionNotes: "" },
  db: null,
  session: null,
  profile: null,
  authMode: "login",
  pendingDates: new Set(),
  pendingRates: false,
  saveTimer: null,
  flushPromise: null,
  rateOfferPrompted: false,
  recordDraftDate: "",
  recordDraft: null,
  recordDraftSalesRequestId: "",
  recordDraftSalesPayload: "",
  measurementDate: "",
  measurementDateAuto: false,
  workDateDataLoaded: false,
  workDateScheduleDates: new Set(),
  activeMeasurementLease: null,
  statsRangeMode: "thisMonth",
  statsRangeModeUserSet: false,
  statsRangeCustom: { from: "", to: "" },
  adminUsageWindowDays: USAGE_SCREEN_SUMMARY_DEFAULT_WINDOW,
  pendingSignupsNotice: null,
  revenueVisibility: (() => {
    try { return JSON.parse(localStorage.getItem("quickflex-revenue-vis") || "{}") || {}; }
    catch (_) { return {}; }
  })(),
};

function currentSettlementPeriod(date = new Date()) {
  const settlementMonth = date.getDate() <= 25 ? date.getMonth() + 1 : date.getMonth() + 2;
  const anchor = new Date(date.getFullYear(), settlementMonth - 1, 1);
  return { year: anchor.getFullYear(), month: anchor.getMonth() + 1 };
}

function syncStatsToCurrentPeriod() {
  const current = currentSettlementPeriod();
  const changed = state.statsYear !== current.year || state.statsMonth !== current.month;
  state.statsYear = current.year;
  state.statsMonth = current.month;
  applyDefaultStatsRangeMode();
  return changed;
}
// 새 정산기간이 막 시작해 이번 기간에 기록된 근무일이 없으면, 사용자가 이번 세션에서
// 직접 기간을 고른 적이 없는 한 정산노트의 기본 선택을 "지난 정산"으로 둔다.
// 근무 기록이 생기거나 사용자가 직접 다른 기간을 고르면 더 이상 손대지 않는다.
// statsYear/statsMonth가 실제 "이번 정산기간"을 가리킬 때만 판단한다 — 사용자가
// "이번 정산" 탭에서 화살표로 다른 달을 보고 있을 때는 그 탐색을 건드리지 않는다.
function applyDefaultStatsRangeMode() {
  if (state.statsRangeModeUserSet) return;
  if (state.statsRangeMode !== "thisMonth" && state.statsRangeMode !== "lastMonth") return;
  const real = currentSettlementPeriod();
  if (state.statsYear !== real.year || state.statsMonth !== real.month) return;
  const prev = prevPeriod(state.statsYear, state.statsMonth);
  state.statsRangeMode = shouldShowPreviousPeriod({
    currentWorkDays: summarizePeriod(state.statsYear, state.statsMonth).workDays,
    previousWorkDays: summarizePeriod(prev.year, prev.month).workDays,
  }) ? "lastMonth" : "thisMonth";
}

let ocrDraftMap = null;
let toastTimer = null;
let profileSignaturePad = null;
let nativeAuthSubscription = null;
let nativeLogoutInProgress = false;
let nativeSessionSyncPromise = null;
let nativeSessionSyncTail = Promise.resolve();
let nativeSessionSyncRequested = false;
let accountBootTask = null;
let workPreferencesSaveTask = null;
let accountEpoch = 0;
let authEventEpoch = 0;
let activeAccountId = "";
let nativeSessionRevision = 0;
const usageSessionTrackedUsers = new Set();

function queueUsageEvent(eventName, properties = {}) {
  const expectedUserId = String(state.session?.user?.id || "");
  if (!state.db || state.profile?.status !== "approved" || !expectedUserId) return;
  void trackUsageEvent(state.db, eventName, properties, { expectedUserId });
}

function trackApprovedSessionStart() {
  const userId = String(state.session?.user?.id || "");
  if (!userId || usageSessionTrackedUsers.has(userId)) return;
  usageSessionTrackedUsers.add(userId);
  queueUsageEvent("app_session_started");
  queueUsageEvent("screen_viewed", { screen: el.app?.dataset.view || "home" });
}

function trackStatsControl(control) {
  queueUsageEvent("stats_control_used", { control });
}

function sessionUserId(session) {
  return String(session?.user?.id || "");
}
function isAuthOperationCurrent(capturedEpoch, currentEpoch, expectedUserId, session) {
  return capturedEpoch === currentEpoch
    && Boolean(expectedUserId)
    && expectedUserId === sessionUserId(session);
}
function sessionCredentialsMatch(left, right) {
  return sessionUserId(left) === sessionUserId(right)
    && String(left?.access_token || "") === String(right?.access_token || "")
    && String(left?.refresh_token || "") === String(right?.refresh_token || "");
}
function nextMonotonicRevision(currentRevision, storedRevision, nowMs) {
  const current = Number.isSafeInteger(currentRevision) && currentRevision >= 0 ? currentRevision : 0;
  const stored = Number.isSafeInteger(storedRevision) && storedRevision >= 0 ? storedRevision : 0;
  const now = Number.isSafeInteger(nowMs) && nowMs >= 0 ? nowMs : 0;
  return Math.max(current + 1, stored + 1, now);
}
function readStoredNativeSessionRevision() {
  try {
    const value = Number.parseInt(localStorage.getItem(NATIVE_SESSION_REVISION_KEY) || "0", 10);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  } catch (_) {
    return 0;
  }
}
function allocateNativeSessionRevision() {
  const stored = readStoredNativeSessionRevision();
  nativeSessionRevision = nextMonotonicRevision(nativeSessionRevision, stored, Date.now());
  try { localStorage.setItem(NATIVE_SESSION_REVISION_KEY, String(nativeSessionRevision)); } catch (_) {}
  return nativeSessionRevision;
}

function isValidSignatureData(value) {
  return typeof value === "string"
    && value.length <= 100000
    && /^data:image\/(?:png|webp);base64,[A-Za-z0-9+/=]+$/.test(value);
}

function createSignaturePad(canvas) {
  if (!canvas) return null;
  const context = canvas.getContext("2d");
  let drawing = false;
  let hasInk = false;
  const point = (event) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };
  const clear = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    drawing = false;
    hasInk = false;
  };
  const load = (value) => {
    clear();
    if (!isValidSignatureData(value)) return;
    const image = new Image();
    image.onload = () => {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      hasInk = true;
    };
    image.src = value;
  };
  const begin = (event) => {
    event.preventDefault();
    drawing = true;
    canvas.setPointerCapture?.(event.pointerId);
    const p = point(event);
    context.beginPath();
    context.moveTo(p.x, p.y);
  };
  const move = (event) => {
    if (!drawing) return;
    event.preventDefault();
    const p = point(event);
    context.lineWidth = 7;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = "#111827";
    context.lineTo(p.x, p.y);
    context.stroke();
    hasInk = true;
  };
  const end = (event) => {
    if (!drawing) return;
    drawing = false;
    canvas.releasePointerCapture?.(event.pointerId);
  };
  canvas.addEventListener("pointerdown", begin);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  return {
    clear,
    load,
    value: () => hasInk ? canvas.toDataURL("image/webp", 0.78) : "",
  };
}
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
  updateNoticeOverlay: $("updateNoticeOverlay"),
  updateNoticeDialog: $("updateNoticeDialog"),
  updateNoticeItems: $("updateNoticeItems"),
  acknowledgeUpdateNotice: $("acknowledgeUpdateNotice"),
  openMeasurementNotice: $("openMeasurementNotice"),
  salesOverrideOverlay: $("salesOverrideOverlay"),
  salesOverrideDialog: $("salesOverrideDialog"),
  salesOverrideTitle: $("salesOverrideTitle"),
  salesOverrideRows: $("salesOverrideRows"),
  salesOverrideAddRoute: $("salesOverrideAddRoute"),
  salesOverrideReason: $("salesOverrideReason"),
  salesOverrideStatus: $("salesOverrideStatus"),
  salesOverrideSave: $("salesOverrideSave"),
  salesOverrideClose: $("salesOverrideClose"),
  periodRange: $("periodRange"),
  summaryPeriodBadge: $("summaryPeriodBadge"),
  summaryPeriodNote: $("summaryPeriodNote"),
  periodRevenue: $("periodRevenue"),
  periodCount: $("periodCount"),
  averageCountHome: $("averageCountHome"),
  dailyAverage: $("dailyAverage"),
  workDaysHome: $("workDaysHome"),
  meterFill: $("meterFill"),
  meterPct: $("meterPct"),
  meterLabel: $("meterLabel"),
  goalChip: $("goalChip"),
  goalAmountInput: $("goalAmountInput"),
  saveAppSettings: $("saveAppSettings"),
  monthTitle: $("monthTitle"),
  monthCalendar: $("monthCalendar"),
  prevMonth: $("prevMonth"),
  nextMonth: $("nextMonth"),
  todayButton: $("todayButton"),
  homeDayDockInfo: $("homeDayDockInfo"),
  homeSelectedDate: $("homeSelectedDate"),
  homeSelectedTotal: $("homeSelectedTotal"),
  homeDayPanel: $("homeDayPanel"),
  homeRouteNotes: $("homeRouteNotes"),
  homeDayTitle: $("homeDayTitle"),
  homeDayToday: $("homeDayToday"),
  homeDayIcon: $("homeDayIcon"),
  homeDayValue: $("homeDayValue"),
  homeDayHint: $("homeDayHint"),
  homeDayState: $("homeDayState"),
  homeOffWideLabel: $("homeOffWideLabel"),
  homeOffToggle: $("homeOffToggle"),
  openRecord: $("openRecord"),
  selectedDateBreakdown: $("selectedDateBreakdown"),
  selectedDateBreakdownTitle: $("selectedDateBreakdownTitle"),
  selectedDateBreakdownRows: $("selectedDateBreakdownRows"),
  selectedDateBreakdownNote: $("selectedDateBreakdownNote"),
  openSalesOverride: $("openSalesOverride"),
  inspectionEntryCard: $("inspectionEntryCard"),
  inspectionEntryEyebrow: $("inspectionEntryEyebrow"),
  inspectionEntryTitle: $("inspectionEntryTitle"),
  inspectionEntryStatus: $("inspectionEntryStatus"),
  openInspection: $("openInspection"),
  backFromInspection: $("backFromInspection"),
  printInspectionMonth: $("printInspectionMonth"),
  saveInspectionMonthPdf: $("saveInspectionMonthPdf"),
  inspectionDate: $("inspectionDate"),
  inspectionDriverName: $("inspectionDriverName"),
  inspectionVehicleNumber: $("inspectionVehicleNumber"),
  inspectionLegacyBadge: $("inspectionLegacyBadge"),
  inspectionChecklist: $("inspectionChecklist"),
  inspectionDefectFields: $("inspectionDefectFields"),
  inspectionDefectNotes: $("inspectionDefectNotes"),
  inspectionActionNotes: $("inspectionActionNotes"),
  inspectionAllGood: $("inspectionAllGood"),
  inspectionReset: $("inspectionReset"),
  inspectionSignatureStatus: $("inspectionSignatureStatus"),
  inspectionSignaturePreview: $("inspectionSignaturePreview"),
  openSignatureSettings: $("openSignatureSettings"),
  inspectionConfirmed: $("inspectionConfirmed"),
  saveInspection: $("saveInspection"),
  markNoOperation: $("markNoOperation"),
  backToCalendar: $("backToCalendar"),
  prevDay: $("prevDay"),
  nextDay: $("nextDay"),
  selectedDateTitle: $("selectedDateTitle"),
  offToggle: $("offToggle"),
  addRoute: $("addRoute"),
  automaticRecordNotice: $("automaticRecordNotice"),
  openSalesOverrideFromRecord: $("openSalesOverrideFromRecord"),
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
  saveRecordLabel: $("saveRecordLabel"),
  saveRecordSpin: $("saveRecordSpin"),
  saveRecordCheck: $("saveRecordCheck"),
  saveRecordCheckPath: $("saveRecordCheckPath"),
  saveRecordStatus: $("saveRecordStatus"),
  measurementWorkDate: $("measurementWorkDate"),
  measurementScheduleMeta: $("measurementScheduleMeta"),
  measurementRouteText: $("measurementRouteText"),
  measurementRouteHint: $("measurementRouteHint"),
  openPaceApp: $("openPaceApp"),
  openPaceAppFallback: $("openPaceAppFallback"),
  measurementAppHint: $("measurementAppHint"),
  openMeasurementGuide: $("openMeasurementGuide"),
  measurementGuideOverlay: $("measurementGuideOverlay"),
  measurementGuideDialog: $("measurementGuideDialog"),
  closeMeasurementGuide: $("closeMeasurementGuide"),
  measurementGuideDone: $("measurementGuideDone"),
  statsMonthTitle: $("statsMonthTitle"),
  statsRange: $("statsRange"),
  statsHeroLabel: $("statsHeroLabel"),
  statsSummaryRange: $("statsSummaryRange"),
  statsSummaryTotal: $("statsSummaryTotal"),
  statsComparison: $("statsComparison"),
  statsCompareLabel: $("statsCompareLabel"),
  statsCompareValue: $("statsCompareValue"),
  statsCompareMeta: $("statsCompareMeta"),
  statsRevenue: $("statsRevenue"),
  statsGoalMeter: $("statsGoalMeter"),
  statsMeterFill: $("statsMeterFill"),
  statsMeterPct: $("statsMeterPct"),
  statsMeterLabel: $("statsMeterLabel"),
  statsRangeTabs: $("statsRangeTabs"),
  statsRangeCustom: $("statsRangeCustom"),
  statsRangeFrom: $("statsRangeFrom"),
  statsRangeTo: $("statsRangeTo"),
  statsRangeApply: $("statsRangeApply"),
  statsChart: $("statsChart"),
  statsChartSummary: $("statsChartSummary"),
  statsChartChange: $("statsChartChange"),
  statsChartEndpoints: $("statsChartEndpoints"),
  statsChartEmpty: $("statsChartEmpty"),
  routeStats: $("routeStats"),
  weekdayStats: $("weekdayStats"),
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
  profileBusinessName: $("profileBusinessName"),
  profileVehicleNumber: $("profileVehicleNumber"),
  signatureSettingsSection: $("signatureSettingsSection"),
  profileSignatureCanvas: $("profileSignatureCanvas"),
  profileSignatureOverlay: $("profileSignatureOverlay"),
  openProfileSignature: $("openProfileSignature"),
  closeProfileSignature: $("closeProfileSignature"),
  profileSignatureStatus: $("profileSignatureStatus"),
  clearProfileSignature: $("clearProfileSignature"),
  saveProfileSignature: $("saveProfileSignature"),
  fixedRoutesText: $("fixedRoutesText"),
  fixedRoutesInput: $("fixedRoutesInput"),
  saveProfile: $("saveProfile"),
  rateRoute: $("rateRoute"),
  rateUnit: $("rateUnit"),
  saveRate: $("saveRate"),
  rateList: $("rateList"),
  rateUpdateOffer: $("rateUpdateOffer"),
  rateUpdateHint: $("rateUpdateHint"),
  applyRateUpdate: $("applyRateUpdate"),
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
  adminProfiles: $("adminProfiles"),
  adminUsageSummary: $("adminUsageSummary"),
  pendingSignupsBanner: $("pendingSignupsBanner"),
  resetData: $("resetData"),
  requestAccountDelete: $("requestAccountDelete"),
  refreshApp: $("refreshApp"),
  openDbSettings: $("openDbSettings"),
  dbStatusBadge: $("dbStatusBadge"),
  dbOverlay: $("dbOverlay"),
  dbSheet: $("dbSheet"),
  closeDbSheet: $("closeDbSheet"),
  supabaseUrl: $("supabaseUrl"),
  supabaseAnonKey: $("supabaseAnonKey"),
  saveDbConfig: $("saveDbConfig"),
  syncNow: $("syncNow"),
  dbStatus: $("dbStatus"),
  toast: $("toast"),
  entryTemplate: $("entryTemplate"),
  summaryLedger: $("summaryLedger"),
  summaryExpense: $("summaryExpense"),
  summaryNet: $("summaryNet"),
  noahThread: $("noahThread"),
  noahAskForm: $("noahAskForm"),
  noahInput: $("noahInput"),
  navTabs: document.querySelectorAll(".nav-tab"),
  modeBtns: document.querySelectorAll(".mode-btn"),
  calendarModeToggle: $("calendarModeToggle"),
  calendarModeIndicator: $("calendarModeIndicator"),
  statsRangeIndicator: $("statsRangeIndicator"),
  statsTabs: document.querySelectorAll("[data-tab]"),
  statsPanels: document.querySelectorAll(".stats-panel"),
};

const MODAL_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");
const modalReturnFocus = new WeakMap();

function modalLayerIsOpen(layer) {
  if (layer === el.dbSheet) return layer.classList.contains("open");
  return layer?.classList.contains("visible");
}

function activeModalLayer() {
  return [el.updateNoticeOverlay, el.salesOverrideOverlay, el.pendingOverlay, el.authOverlay, el.setupOverlay, el.measurementGuideOverlay, el.profileSignatureOverlay, el.dbSheet]
    .find((layer) => layer && modalLayerIsOpen(layer)) || null;
}

function focusableIn(layer) {
  return [...layer.querySelectorAll(MODAL_FOCUSABLE_SELECTOR)].filter((node) => (
    !node.disabled
    && !node.hidden
    && !node.closest("[inert]")
    && node.getAttribute("aria-hidden") !== "true"
    && node.getClientRects().length > 0
  ));
}

function syncModalBackground() {
  const layers = [el.setupOverlay, el.authOverlay, el.pendingOverlay, el.updateNoticeOverlay, el.salesOverrideOverlay, el.measurementGuideOverlay, el.profileSignatureOverlay, el.dbSheet].filter(Boolean);
  const active = activeModalLayer();
  layers.forEach((layer) => {
    const available = layer === active;
    layer.setAttribute("aria-hidden", String(!available));
    layer.toggleAttribute("inert", !available);
  });
  [...el.app.children].forEach((child) => {
    if (layers.includes(child)) return;
    if (child === el.dbOverlay) {
      child.toggleAttribute("inert", active !== el.dbSheet);
      return;
    }
    child.toggleAttribute("inert", Boolean(active));
  });
  el.openDbSettings?.setAttribute("aria-expanded", String(active === el.dbSheet));
  el.openMeasurementGuide?.setAttribute("aria-expanded", String(active === el.measurementGuideOverlay));
}

function updateModalLayer(layer, open, initialFocus) {
  if (!layer) return;
  if (open) {
    const current = document.activeElement;
    if (current instanceof HTMLElement && current !== document.body && !layer.contains(current)) {
      modalReturnFocus.set(layer, current);
    }
  }
  const returnTarget = !open ? modalReturnFocus.get(layer) : null;
  if (!open) modalReturnFocus.delete(layer);
  syncModalBackground();
  window.requestAnimationFrame(() => {
    if (open && activeModalLayer() === layer) {
      const preferred = typeof initialFocus === "string" ? layer.querySelector(initialFocus) : initialFocus;
      const target = preferred && !preferred.disabled
        ? preferred
        : focusableIn(layer)[0] || layer.querySelector("[role='dialog']") || layer;
      target?.focus?.();
      return;
    }
    if (!open && !activeModalLayer()) {
      const fallback = [...el.navTabs].find((tab) => tab.getAttribute("aria-current") === "page" && !tab.hidden && !tab.disabled);
      const target = returnTarget?.isConnected && !returnTarget.closest("[inert]") ? returnTarget : fallback;
      target?.focus?.();
    }
  });
}

function bindModalAccessibility() {
  document.addEventListener("keydown", (event) => {
    const layer = activeModalLayer();
    if (!layer) return;
    if (event.key === "Escape" && layer === el.updateNoticeOverlay) {
      event.preventDefault();
      acknowledgeAppUpdateNotice();
      return;
    }
    if (event.key === "Escape" && layer === el.profileSignatureOverlay) {
      event.preventDefault();
      closeSignatureEditor();
      return;
    }
    if (event.key === "Escape" && layer === el.dbSheet) {
      event.preventDefault();
      closeSheet();
      return;
    }
    if (event.key === "Escape" && layer === el.salesOverrideOverlay) {
      event.preventDefault();
      closeSalesOverride();
      return;
    }
    if (event.key === "Escape" && layer === el.measurementGuideOverlay) {
      event.preventDefault();
      closeMeasurementGuide();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = focusableIn(layer);
    if (!focusable.length) {
      event.preventDefault();
      (layer.querySelector("[role='dialog']") || layer).focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!layer.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  syncModalBackground();
}

function toast(message, type = "") {
  clearTimeout(toastTimer);
  const isError = type === "error";
  el.toast.setAttribute("role", isError ? "alert" : "status");
  el.toast.setAttribute("aria-live", isError ? "assertive" : "polite");
  el.toast.setAttribute("aria-atomic", "true");
  el.toast.textContent = message;
  el.toast.className = `toast show${type ? ` ${type}` : ""}`;
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), isError ? 5500 : 3200);
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
  if (/^\d{3}[A-Z]$/.test(raw)) return raw;
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
    .flatMap((token) => {
      const parsed = parseScheduleRoutes(token);
      return parsed.length ? parsed : [token];
    })
    .flatMap(expandRouteText)
    .map((route) => correctRoute(route, candidates))
    .filter((route) => route && !seen.has(route) && seen.add(route));
  return completeRouteBundles(corrected);
}
function activeRouteBundles() {
  const dbBundles = (state.routeBundles || [])
    .filter((bundle) => bundle.active !== false && Array.isArray(bundle.routes) && bundle.routes.length >= 1)
    .map((bundle) => ({ routes: parseScheduleRoutes(bundle.routes), trusted: true }));
  const fallback = DEFAULT_ROUTE_BUNDLES
    // Two matching routes are the completion trigger. An administrator's
    // pattern owns that trigger, even when its remaining route differs.
    .filter((bundle) => !dbBundles.some(({ routes }) =>
      bundle.filter((route) => routes.includes(route)).length >= 2))
    .map((bundle) => ({ routes: bundle, trusted: false }));
  return [...dbBundles, ...fallback];
}
function completeRouteBundles(routes) {
  const result = [...routes];
  const seen = new Set(result);
  const observedInput = new Set(routes);
  activeRouteBundles().forEach(({ routes: bundle, trusted }) => {
    const observed = bundle.filter((route) => observedInput.has(route));
    const missing = bundle.filter((route) => !observedInput.has(route));
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
function captureAccountContext() {
  return { epoch: accountEpoch, userId: currentUserId() };
}
function isAccountContextCurrent(context) {
  return Boolean(context?.userId)
    && context.epoch === accountEpoch
    && context.userId === currentUserId();
}
function clearUserScopedState() {
  clearTimeout(state.saveTimer);
  if (el.updateNoticeOverlay?.classList.contains("visible")) closeAppUpdateNotice();
  if (el.salesOverrideOverlay?.classList.contains("visible")) closeSalesOverride(true);
  if (el.profileSignatureOverlay?.classList.contains("visible")) closeSignatureEditor(true);
  state.saveTimer = null;
  state.flushPromise = null;
  state.pendingDates.clear();
  state.pendingRates = false;
  state.passwordRecovery = false;
  state.saveConflict = false;
  state.saveConflictDate = "";
  state.retainedEdits = null;
  if ($("retainedEditsText")) { $("retainedEditsText").value = ""; $("retainedEditsText").hidden = true; }
  setSaveFeedback("saved");
  state.profile = null;
  state.rates = [];
  state.defaultRates = [];
  state.routeBundles = [];
  state.entries = {};
  state.workDateDataLoaded = false;
  state.workDateScheduleDates = new Set();
  state.activeMeasurementLease = null;
  state.receiptEntries = {};
  state.automaticSalesOverrides = {};
  state.workRouteDetails = {};
  state.salesOverrideContractAvailable = false;
  state.workRouteDetailsContractAvailable = false;
  state.salesOverrideDraft = null;
  state.inspections = {};
  state.inspectionSignature = "";
  state.inspectionDate = todayKey();
  state.inspectionDraft = inspectionDraftFromRecord(null);
  state.rateOfferPrompted = false;
  state.statsDetailDate = "";
  expensesController?.reset();
  noahController?.reset();
  routeNoteShareDialog?.reset();
  routeNotesController?.reset();
  postNativeMessage({ type: "set_route_notes_active", active: false });
  routeNotesService?.reset?.();
  exportsController?.reset();
  calendarSyncController?.dispose();
  calendarSyncController = null;
  state.recordDraftDate = "";
  state.recordDraft = null;
  state.recordDraftSalesRequestId = "";
  state.recordDraftSalesPayload = "";
  state.measurementDate = "";
  state.measurementDateAuto = false;
  ocrDraftMap = null;
  accountBootTask = null;
  workPreferencesSaveTask = null;
  profileSignaturePad?.clear();
  if (el.scheduleDraftSection) el.scheduleDraftSection.classList.add("hidden");
  if (el.scheduleDraftCards) el.scheduleDraftCards.innerHTML = "";
  if (el.salesOverrideRows) el.salesOverrideRows.innerHTML = "";
  if (el.salesOverrideReason) el.salesOverrideReason.value = "";
  if (el.salesOverrideStatus) el.salesOverrideStatus.textContent = "";
  [el.adminBundleList, el.adminProfiles, el.adminUsageSummary]
    .filter(Boolean)
    .forEach((node) => { node.innerHTML = ""; });
  state.adminUsageWindowDays = USAGE_SCREEN_SUMMARY_DEFAULT_WINDOW;
  applyPendingSignupsNotice(null);
}
function scheduleSignedInBoot(context) {
  Promise.resolve().then(async () => {
    if (!isAccountContextCurrent(context)) return;
    try {
      await bootSignedInUser(context);
    } catch (error) {
      if (!isAccountContextCurrent(context)) return;
      if (window.FlexNoteStartup?.fail()) return;
      showPending(false);
      showAuth(true);
      toast(`로그인 정보를 불러오지 못했습니다: ${error.message}`, "error");
    }
  });
}
function applyAuthSession(session, { event = "", scheduleBoot = true } = {}) {
  const previousUserId = activeAccountId || currentUserId();
  const nextSession = session || null;
  const nextUserId = sessionUserId(nextSession);
  const accountChanged = previousUserId !== nextUserId;
  const signedOut = event === "SIGNED_OUT" || !nextUserId;
  authEventEpoch += 1;
  if (accountChanged || signedOut) {
    nativeSessionSyncRequested = false;
    accountEpoch += 1;
    clearUserScopedState();
  }
  state.session = nextSession;
  activeAccountId = nextUserId;
  const context = captureAccountContext();
  if (accountChanged || signedOut) {
    showView("home");
    renderAll();
    showPending(false);
    showAuth(true);
  }
  if (nextUserId
    && accountChanged
    && scheduleBoot
    && event !== "PASSWORD_RECOVERY"
    && !isPasswordRecoveryUrl()) {
    scheduleSignedInBoot(context);
  }
  return { authEpoch: authEventEpoch, accountContext: context, accountChanged };
}
function isBackupDriver() { return (state.profile?.driver_type || "backup") === "backup"; }
function isNightShift() { return state.profile?.work_shift === "night"; }
function fixedRoutes() { return Array.isArray(state.profile?.fixed_routes) ? expandRouteText(state.profile.fixed_routes.join(",")) : []; }
function driverName() { return state.profile?.display_name || state.session?.user?.email || "매출노트"; }
function statusLabel(status) {
  if (status === "approved") return "승인";
  if (status === "blocked") return "차단";
  return "대기";
}
function driverTypeLabel(driverType) {
  return driverType === "fixed" ? "고정기사" : "백업기사";
}
function profileNameForDisplay(profile) {
  const displayName = String(profile?.display_name || "").trim();
  if (displayName && displayName !== "사용자" && displayName.toLowerCase() !== "user") return displayName;
  if (LEGACY_USER_NAMES.has(profile?.id)) return LEGACY_USER_NAMES.get(profile.id);
  const emailPrefix = String(profile?.email || "").split("@")[0].trim();
  return emailPrefix || displayName || "사용자";
}
function isDeleteRequestedProfile(profile) {
  return String(profile?.display_name || "").startsWith("[탈퇴요청]");
}
function formatDateTimeShort(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR", {
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
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
function freshbagModeForRecord(record) {
  const stored = record?.freshbagMode || record?.freshbag_mode;
  return stored === "dual" || stored === "single" ? stored : freshbagMode();
}
function emptyRecord() { return { off: false, rows: [], automaticWorks: [], freshCount: "", returnCount: "", cancellationCount: "", freshUnit: 100, freshSoloCount: "", freshLinkedCount: "", freshbagMode: freshbagMode(), backupUnit: DEFAULT_BACKUP_UNIT, driverType: isBackupDriver() ? "backup" : "fixed" }; }
function isAutomaticRow(row) { return row?.source === "automatic" || row?.source === "override" || row?.readOnly === true; }
function automaticRows(record) { return (record?.rows || []).filter(isAutomaticRow); }
function manualRows(record) { return (record?.rows || []).filter((row) => !isAutomaticRow(row)); }
function hasAutomaticEntries(record) { return automaticRows(record).length > 0 || (record?.automaticWorks || []).length > 0; }
function normalizeBaseSalesRoute(value) {
  const route = normalizeRoute(value);
  return /^\d{3}[A-Z]$/.test(route) ? route : "";
}
function jsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function salesOverridePayload(rows) {
  const issues = [];
  const sourceRows = Array.isArray(rows) ? rows : [];
  if (!sourceRows.length) issues.push("매출 수정은 A/B 구역을 1행 이상 남겨야 합니다.");
  if (sourceRows.length > 100) issues.push("매출 수정은 최대 100행까지 저장할 수 있습니다.");
  const seenRoutes = new Set();
  const routes = sourceRows.map((row, index) => {
    const route = normalizeBaseSalesRoute(row?.route);
    const deliveryCount = exactLedgerInteger(row?.delivery_count ?? row?.count);
    const unitSnapshot = exactLedgerInteger(row?.unit_snapshot ?? row?.unit);
    if (!route) issues.push(`${index + 1}행 구역은 318A 같은 A/B 구역으로 입력해 주세요.`);
    if (route && seenRoutes.has(route)) issues.push(`${route} 구역이 중복되었습니다. 한 행으로 합쳐 주세요.`);
    if (route) seenRoutes.add(route);
    if (deliveryCount === null) issues.push(`${index + 1}행 상품수는 0 이상의 정수여야 합니다.`);
    if (unitSnapshot === null) issues.push(`${index + 1}행 단가는 0 이상의 정수여야 합니다.`);
    return {
      route,
      delivery_count: deliveryCount,
      unit_snapshot: unitSnapshot,
      sort_order: index,
    };
  });
  return { issues: [...new Set(issues)], routes };
}
function automaticSalesRequestFingerprint(rows) {
  const payload = salesOverridePayload(rows);
  if (payload.issues.length) return JSON.stringify({ invalid: payload.issues, rows });
  return JSON.stringify(payload.routes
    .map((row) => ({ ...row }))
    .sort((left, right) => left.route.localeCompare(right.route)));
}
function normalizeAutomaticSalesOverride(row) {
  if (!row || typeof row !== "object") return null;
  const workDate = String(row.work_date || "");
  const revision = exactLedgerInteger(row.revision);
  const parsed = salesOverridePayload(jsonArray(row.routes));
  const totalItems = parsed.routes.reduce((sum, route) => sum + (route.delivery_count || 0), 0);
  const storedTotal = exactLedgerInteger(row.total_items);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)
    || revision === null
    || parsed.issues.length
    || storedTotal === null
    || storedTotal !== totalItems) {
    const error = new Error(`${workDate || "날짜 미상"} 매출 수정 스냅샷이 올바르지 않습니다.`);
    error.code = "QUICKFLEX_OVERRIDE_INVALID";
    throw error;
  }
  return {
    user_id: String(row.user_id || ""),
    work_date: workDate,
    routes: parsed.routes,
    total_items: totalItems,
    revision,
    reason: String(row.reason || ""),
    request_id: String(row.request_id || ""),
    updated_at: row.updated_at || "",
  };
}
function automaticSalesOverridesByDate(rows) {
  return Object.fromEntries((rows || []).map((row) => {
    const snapshot = normalizeAutomaticSalesOverride(row);
    return [snapshot.work_date, snapshot];
  }));
}
function overrideRecordRows(snapshot) {
  return (snapshot?.routes || []).map((route) => ({
    route: route.route,
    count: route.delivery_count,
    households: "",
    unit: route.unit_snapshot,
    source: "override",
    readOnly: true,
    overrideDate: snapshot.work_date,
    overrideRevision: snapshot.revision,
    sortOrder: route.sort_order,
  }));
}
function applyAutomaticSalesOverrideToRecord(record, snapshot) {
  const next = normalizeRecordShape(record);
  if (!snapshot || !hasAutomaticEntries(next)) return next;
  next.off = false;
  next.rows = overrideRecordRows(snapshot);
  return normalizeRecordShape(next);
}
function applyAutomaticSalesOverrides(entries, overrides) {
  const next = {};
  Object.entries(entries || {}).forEach(([dateKey, record]) => {
    next[dateKey] = applyAutomaticSalesOverrideToRecord(record, overrides?.[dateKey]);
  });
  return next;
}
function normalizeRecordShape(record) {
  const next = {
    off: Boolean(record?.off),
    rows: Array.isArray(record?.rows) ? record.rows.map((row) => ({ ...row })) : [],
    automaticWorks: Array.isArray(record?.automaticWorks) ? record.automaticWorks.map((work) => ({ ...work })) : [],
    salesBasisCounts: record?.salesBasisCounts ? { ...record.salesBasisCounts } : null,
    salesDayBasis: record?.salesDayBasis ? { ...record.salesDayBasis } : null,
    salesDayRevision: record?.salesDayRevision ?? 0,
    manualDayUpdatedAt: record?.manualDayUpdatedAt || null,
    freshCount: record?.freshCount ?? "",
    returnCount: record?.returnCount ?? "",
    cancellationCount: record?.cancellationCount ?? "",
    freshUnit: defaultFreshUnit(record?.freshUnit),
    freshSoloCount: record?.freshSoloCount ?? "",
    freshLinkedCount: record?.freshLinkedCount ?? "",
    freshbagMode: freshbagModeForRecord(record),
    backupUnit: defaultBackupUnit(record?.backupUnit),
    driverType: record?.driverType || (isBackupDriver() ? "backup" : "fixed"),
  };
  next.rows = next.rows
    .map((row) => {
      const automatic = isAutomaticRow(row);
      const normalized = {
        route: joinStoredRoutes(expandRouteText(row.route)),
        count: row.count ?? "",
        households: row.households ?? "",
        unit: row.unit ?? sharedRateForRoutes(row.route) ?? 0,
        draft: automatic ? false : Boolean(row.draft),
      };
      if (automatic) {
        normalized.source = row.source === "override" ? "override" : "automatic";
        normalized.readOnly = true;
        normalized.workId = String(row.workId || "");
        normalized.workShift = row.workShift === "night" ? "night" : "day";
        normalized.finalizedAt = row.finalizedAt || "";
        normalized.overrideDate = row.overrideDate || "";
        normalized.overrideRevision = exactLedgerInteger(row.overrideRevision) ?? 0;
        normalized.sortOrder = toNum(row.sortOrder);
      }
      return normalized;
    })
    .filter((row) => row.draft || row.route || toNum(row.count) > 0 || toNum(row.unit) > 0);
  const automaticWorksById = new Map();
  next.automaticWorks.forEach((work) => {
    const workId = String(work?.workId || "");
    if (!workId) return;
    automaticWorksById.set(workId, {
      workId,
      workShift: work.workShift === "night" ? "night" : "day",
      finalizedAt: work.finalizedAt || "",
      totalHouseholds: exactLedgerInteger(work.totalHouseholds) ?? null,
      totalItems: exactLedgerInteger(work.totalItems) ?? null,
      freshCount: exactLedgerInteger(work.freshCount) ?? 0,
      returnCount: exactLedgerInteger(work.returnCount) ?? 0,
    });
  });
  next.rows.filter(isAutomaticRow).forEach((row) => {
    if (!row.workId || automaticWorksById.has(row.workId)) return;
    automaticWorksById.set(row.workId, {
      workId: row.workId,
      workShift: row.workShift,
      finalizedAt: row.finalizedAt,
      totalHouseholds: null,
      totalItems: null,
      freshCount: 0,
      returnCount: 0,
    });
  });
  next.automaticWorks = [...automaticWorksById.values()];
  next.rows.forEach((row) => {
    if (!isAutomaticRow(row) && !toNum(row.unit) && row.route) row.unit = sharedRateForRoutes(row.route) || rateFor(row.route);
  });
  next.rows = mergeGroupedRows(next.rows);
  if (hasAutomaticEntries(next)) {
    next.off = false;
    // Manual sales can be a different shift on this date. Automatic receipts
    // add to them; only an explicit full-date override replaces both sources.
  }
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
function normalizeRecordDraftForCompare(record) {
  if (!record) return record;
  return {
    ...record,
    rows: Array.isArray(record.rows)
      ? record.rows.map((row) => ({ ...row, count: toNum(row.count), unit: toNum(row.unit), households: toNum(row.households) }))
      : [],
    freshCount: toNum(record.freshCount),
    returnCount: toNum(record.returnCount),
    cancellationCount: toNum(record.cancellationCount),
    freshUnit: toNum(record.freshUnit),
    freshSoloCount: toNum(record.freshSoloCount),
    freshLinkedCount: toNum(record.freshLinkedCount),
    backupUnit: toNum(record.backupUnit),
  };
}
function startRecordDraft(dateKey = state.selectedDate) {
  state.recordDraftDate = dateKey;
  state.recordDraft = cloneRecord(getRecord(dateKey, false));
  if (hasAutomaticEntries(state.recordDraft)) {
    const snapshot = hasAutomaticSalesOverride(dateKey) ? state.automaticSalesOverrides[dateKey] : null;
    const seed = seedSalesOverrideRows(dateKey, snapshot);
    state.recordDraft.rows = seed.rows.map((row) => ({
      ...row,
      households: "",
      source: "override",
      readOnly: true,
    }));
  }
  state.recordDraftSalesRequestId = "";
  state.recordDraftSalesPayload = "";
  state.recordDraftBaseline = JSON.stringify(normalizeRecordDraftForCompare(state.recordDraft));
  return state.recordDraft;
}
function confirmLeaveRecordDraft() {
  if (!state.recordDraft) return true;
  if (el.app.dataset.view === "record") syncFormToRecord();
  if (state.recordDraftBaseline === JSON.stringify(normalizeRecordDraftForCompare(state.recordDraft))) return true;
  return window.confirm("아직 저장하지 않은 입력이 있습니다. 입력을 버리고 이동할까요?");
}
function currentRecordDraft() {
  if (state.recordDraftDate !== state.selectedDate || !state.recordDraft) return startRecordDraft();
  return state.recordDraft;
}
function discardRecordDraft() {
  state.recordDraftDate = "";
  state.recordDraft = null;
  state.recordDraftSalesRequestId = "";
  state.recordDraftSalesPayload = "";
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
  return rec.off || hasAutomaticEntries(rec) || rec.rows.length > 0 || toNum(rec.freshCount) > 0 || toNum(rec.freshSoloCount) > 0 || toNum(rec.freshLinkedCount) > 0 || toNum(rec.returnCount) > 0 || toNum(rec.freshUnit) !== 100 || (isBackupDriver() && toNum(rec.backupUnit) !== DEFAULT_BACKUP_UNIT);
}
function hasEnteredCounts(record) {
  const rec = normalizeRecordShape(record);
  return hasAutomaticEntries(rec)
    || rec.rows.some((row) => toNum(row.count) > 0)
    || toNum(rec.freshCount) > 0
    || toNum(rec.returnCount) > 0
    || toNum(rec.freshSoloCount) > 0
    || toNum(rec.freshLinkedCount) > 0;
}
function isWorkedRecord(record, details = calcRecordDetails(record)) {
  return !record?.off && (details.revenue > 0 || hasAutomaticEntries(record));
}
function confirmOffWithExistingCounts(dateKeys) {
  const keys = (Array.isArray(dateKeys) ? dateKeys : [dateKeys]).filter(Boolean);
  if (!keys.length) return true;
  const automaticKeys = keys.filter((dateKey) => hasAutomaticEntries(getRecord(dateKey, false)));
  if (automaticKeys.length) {
    const automaticLabel = automaticKeys.slice(0, 5).map(formatLongShort).join(", ");
    const automaticSuffix = automaticKeys.length > 5 ? ` 외 ${automaticKeys.length - 5}일` : "";
    toast(`${automaticLabel}${automaticSuffix}에는 앱 자동 기록이 있어 휴무로 바꾸거나 날짜 기록을 삭제할 수 없습니다.`, "error");
    return false;
  }
  const label = keys.slice(0, 5).map(formatLongShort).join(", ");
  const suffix = keys.length > 5 ? ` 외 ${keys.length - 5}일` : "";
  return window.confirm(`${label}${suffix}에 이미 입력한 배송건수가 있습니다.\n휴무로 바꾸면 해당 날짜의 저장된 건수와 매출이 삭제될 수 있습니다.\n그래도 휴무로 바꿀까요?`);
}
function mergeGroupedRows(rows) {
  const merged = [];
  rows.forEach((row) => {
    const routes = splitStoredRoutes(row.route);
    if (isAutomaticRow(row)) {
      if (routes.length) {
        merged.push({
          ...row,
          route: joinStoredRoutes(routes),
          source: row.source === "override" ? "override" : "automatic",
          readOnly: true,
        });
      }
      return;
    }
    if (!routes.length) {
      if (row.draft) merged.push({ route: "", count: row.count ?? "", households: row.households ?? "", unit: row.unit ?? 0, draft: true });
      return;
    }
    const unit = toNum(row.unit) || sharedRateForRoutes(routes) || 0;
    const prefix = routes[0].slice(0, 3);
    // Group empty schedule placeholders only. Combining entered quantities loses
    // their route provenance and later turns 100/60 into an invented 80/80 split.
    const entered = (value) => value !== "" && value != null;
    const canGroup = !entered(row.count) && !entered(row.households)
      && unit > 0 && routes.every((route) => route.slice(0, 3) === prefix);
    const existing = canGroup ? merged.find((item) => {
      if (isAutomaticRow(item)) return false;
      if (entered(item.count) || entered(item.households)) return false;
      const itemRoutes = splitStoredRoutes(item.route);
      return itemRoutes.length && itemRoutes.every((route) => route.slice(0, 3) === prefix) && toNum(item.unit) === unit;
    }) : null;
    if (existing) {
      existing.route = joinStoredRoutes([...splitStoredRoutes(existing.route), ...routes]);
      existing.count = toNum(existing.count) || toNum(row.count) ? String(toNum(existing.count) + toNum(row.count)) : "";
      existing.households = toNum(existing.households) || toNum(row.households)
        ? String(toNum(existing.households) + toNum(row.households)) : "";
    } else {
      merged.push({ route: joinStoredRoutes(routes), count: row.count ?? "", households: row.households ?? "", unit });
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
function mergeScheduleRowsWithExisting(existingRows, scheduleRoutes) {
  const automatic = (existingRows || []).filter(isAutomaticRow);
  const scheduled = new Set(expandRouteText(scheduleRoutes));
  const manual = (existingRows || []).filter((row) => !isAutomaticRow(row));
  const retained = manual.filter((row) =>
    (row.count !== "" && row.count != null) || (row.households !== "" && row.households != null)
    || splitStoredRoutes(row.route).some((route) => scheduled.has(route)));
  const covered = new Set(retained.flatMap((row) => splitStoredRoutes(row.route)));
  const added = buildGroupedRows([...scheduled].filter((route) => !covered.has(route)));
  return [...automatic, ...retained.map((row) => ({ ...row })), ...added];
}
function ensureFixedRecordRows(record) {
  if (isBackupDriver()) return record;
  if (record.off || hasAutomaticEntries(record)) return record;
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
  if (isAutomaticRow(row)) return Math.max(0, explicit);
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
  if (rec.off) return { count: 0, routeRevenue: 0, freshCount: 0, returnCount: 0, cancellationCount: 0, freshUnit: toNum(defaultFreshUnit(rec.freshUnit)), freshRevenue: 0, backupUnit: toNum(defaultBackupUnit(rec.backupUnit)), backupRevenue: 0, backupRevenueIncluded: 0, backupRevenueAdditive: 0, revenue: 0 };
  const routeTotal = rec.rows.reduce((sum, row) => {
    const count = toNum(row.count);
    const automatic = isAutomaticRow(row);
    return {
      count: sum.count + count,
      manualCount: sum.manualCount + (automatic ? 0 : count),
      automaticCount: sum.automaticCount + (automatic ? count : 0),
      revenue: sum.revenue + count * effectiveUnit(row),
    };
  }, { count: 0, manualCount: 0, automaticCount: 0, revenue: 0 });
  const isDual = freshbagModeForRecord(rec) === "dual";
  const freshCount = isDual ? toNum(rec.freshSoloCount) + toNum(rec.freshLinkedCount) : toNum(rec.freshCount);
  const freshUnit = isDual ? 0 : toNum(defaultFreshUnit(rec.freshUnit));
  const freshRevenue = isDual ? toNum(rec.freshSoloCount) * 200 + toNum(rec.freshLinkedCount) * 100 : freshCount * freshUnit;
  // Android 자동 마감 unit_snapshot에는 마감 당시 백업단가가 이미 포함되어 있다.
  // 자동행은 저장 전에 unit_snapshot 자체를 백업단가 증감분만큼 조정하므로 여기서 다시 더하지 않는다.
  const backupApplies = rec.driverType === "backup" && routeTotal.count > 0;
  const backupUnit = backupApplies ? toNum(defaultBackupUnit(rec.backupUnit)) : 0;
  const backupRevenueIncluded = routeTotal.automaticCount * backupUnit;
  const backupRevenueAdditive = routeTotal.manualCount * backupUnit;
  const backupRevenue = backupRevenueIncluded + backupRevenueAdditive;
  return {
    count: routeTotal.count,
    routeRevenue: routeTotal.revenue,
    freshCount,
    returnCount: toNum(rec.returnCount),
    cancellationCount: toNum(rec.cancellationCount),
    freshUnit,
    freshRevenue,
    backupUnit,
    backupRevenue,
    backupRevenueIncluded,
    backupRevenueAdditive,
    revenue: routeTotal.revenue + freshRevenue + backupRevenueAdditive,
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
  const automaticBackupUnit = rec.driverType === "backup" ? toNum(defaultBackupUnit(rec.backupUnit)) : 0;
  rec.rows.forEach((row) => {
    splitStoredRoutes(row.route).forEach((r) => {
      const count = toNum(row.count);
      const unit = Math.max(0, effectiveUnit(row) - (isAutomaticRow(row) ? automaticBackupUnit : 0));
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
      workDays: sum.workDays + (isWorkedRecord(record, calc) ? 1 : 0),
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
  return formatMonthDayShort(key);
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
function setPlainNumberWithUnit(target, text) {
  const match = text.match(/^(.*?)(만원|원|건|일)$/);
  if (!match?.[1]) {
    target.textContent = text;
    return;
  }
  const unit = document.createElement("span");
  unit.className = "number-unit";
  unit.textContent = match[2];
  target.replaceChildren(document.createTextNode(match[1]), unit);
}
// `sameMetric` is only passed by call sites that track period/metric identity
// (currently renderSummary's headline numbers): true rolls only the digit
// columns that changed, false crossfades (the number now means something
// else, e.g. a different settlement period), and omitted keeps the original
// plain instant behavior every other call site already relies on.
function renderNumberWithUnit(target, formatted, { sameMetric } = {}) {
  const text = String(formatted ?? "");
  if (sameMetric === undefined) {
    setPlainNumberWithUnit(target, text);
    return;
  }
  const changed = target.__moText !== text;
  target.__moText = text;
  if (sameMetric) {
    motion.updateRollingNumber(target, text);
    return;
  }
  if (!changed) {
    setPlainNumberWithUnit(target, text);
    return;
  }
  motion.crossfade(target, () => setPlainNumberWithUnit(target, text));
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
      workDays: sum.workDays + (isWorkedRecord(record, calc) ? 1 : 0),
      offDays: sum.offDays + (record.off ? 1 : 0),
      fresh: sum.fresh + calc.freshCount,
    };
  }, { count: 0, revenue: 0, workDays: 0, offDays: 0, fresh: 0 });
  total.average = total.workDays ? total.revenue / total.workDays : 0;
  total.averageCount = total.workDays ? total.count / total.workDays : 0;
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
  updateModalLayer(el.setupOverlay, true, el.setupOverlay.querySelector("[role='dialog']"));
}
function buildClient(url, anonKey) {
  if (!window.supabase || !url || !anonKey) return null;
  return window.supabase.createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
}
function postNativeMessage(payload) {
  try {
    window.QuickFlexNative?.postMessage?.(JSON.stringify(payload));
  } catch (_) {}
}
function syncNativeRouteNotesState() {
  postNativeMessage({ type: "set_route_notes_active", active: el.app?.dataset.view === "routes" && Boolean(currentUserId()) });
}
function requestNativeMessage(payload, timeoutMs = 4000) {
  const bridge = window.QuickFlexNative;
  if (!bridge?.postMessage) return Promise.resolve({ ok: true, native: false });
  const requestId = globalThis.crypto?.randomUUID?.()
    || `native-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    const previousHandler = bridge.onmessage;
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      bridge.onmessage = previousHandler;
      resolve(result);
    };
    bridge.onmessage = (event) => {
      let response = null;
      try { response = JSON.parse(event?.data || "{}"); } catch (_) {}
      if (response?.requestId === requestId) return finish(response);
      if (typeof previousHandler === "function") previousHandler.call(bridge, event);
    };
    timer = setTimeout(() => finish({ ok: false, reason: "native_timeout" }), timeoutMs);
    try {
      bridge.postMessage(JSON.stringify({ ...payload, requestId }));
    } catch (_) {
      finish({ ok: false, reason: "native_error" });
    }
  });
}
function syncNativeSession(session, expectedAuthEpoch = authEventEpoch) {
  if (!session?.access_token || !session?.refresh_token) return Promise.resolve(false);
  const queuedSync = nativeSessionSyncTail.then(() => {
    if (!isAuthOperationCurrent(expectedAuthEpoch, authEventEpoch, sessionUserId(session), state.session)) return false;
    if (!sessionCredentialsMatch(session, state.session)) return false;
    postNativeMessage({
      type: "sync_session",
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at || 0,
      sessionRevision: allocateNativeSessionRevision(),
    });
    return true;
  });
  nativeSessionSyncTail = queuedSync.catch(() => false);
  return queuedSync;
}
function flushNativeSessionSyncRequest() {
  if (!nativeSessionSyncRequested || !state.db || !window.QuickFlexNative?.postMessage) {
    return Promise.resolve(false);
  }
  return syncCurrentSessionToNative();
}
function requestNativeSessionSync() {
  nativeSessionSyncRequested = true;
  return flushNativeSessionSyncRequest().catch(() => false);
}
function bindNativeAuthSync(client) {
  nativeAuthSubscription?.unsubscribe?.();
  const { data } = client.auth.onAuthStateChange((event, session) => {
    const transition = applyAuthSession(session, { event });
    if (event === "PASSWORD_RECOVERY" && session) {
      state.passwordRecovery = true;
      showPending(false);
      showAuth(true);
      setAuthMode("reset");
      window.FlexNoteStartup?.finish();
      return;
    }
    if (session && !nativeLogoutInProgress) void syncNativeSession(session, transition.authEpoch);
    // 세션 만료나 외부 로그아웃은 진행 업무의 네이티브 세션을 지우지 않는다.
    // 사용자가 누른 명시적 로그아웃은 logout()에서 네이티브 확인을 먼저 거친다.
  });
  nativeAuthSubscription = data?.subscription || null;
}
async function syncCurrentSessionToNative() {
  if (!state.db || !window.QuickFlexNative?.postMessage) return false;
  if (nativeSessionSyncPromise) return nativeSessionSyncPromise;
  const expectedAuthEpoch = authEventEpoch;
  const expectedUserId = currentUserId();
  nativeSessionSyncPromise = (async () => {
    let { data, error } = await state.db.auth.getSession();
    if (error) return;
    let session = data?.session || null;
    if (!isAuthOperationCurrent(expectedAuthEpoch, authEventEpoch, expectedUserId, state.session)) return false;
    if (!session) {
      nativeSessionSyncRequested = false;
      applyAuthSession(null, { event: "SIGNED_OUT", scheduleBoot: false });
      return false;
    }
    if (sessionUserId(session) !== expectedUserId) return false;
    const expiresSoon = session?.expires_at
      && session.expires_at <= Math.floor(Date.now() / 1000) + 120;
    if (expiresSoon) {
      ({ data, error } = await state.db.auth.refreshSession());
      if (error) return;
      session = data?.session || null;
    }
    if (!session || sessionUserId(session) !== expectedUserId) return false;
    if (!isAuthOperationCurrent(expectedAuthEpoch, authEventEpoch, expectedUserId, state.session)) return false;
    const transition = applyAuthSession(session, { event: "SESSION_OBSERVED", scheduleBoot: false });
    const sent = await syncNativeSession(session, transition.authEpoch);
    if (sent) nativeSessionSyncRequested = false;
    return sent;
  })();
  try {
    return await nativeSessionSyncPromise;
  } finally {
    nativeSessionSyncPromise = null;
  }
}
function getDbConfig() { return loadDbConfig(); }
function getEdgeFunctionUrl(name) {
  const cfg = getDbConfig();
  const base = normalizeUrl(cfg.url || "");
  return base ? `${base}/functions/v1/${name}` : "";
}
async function authHeaders(forceRefresh = false) {
  const cfg = getDbConfig();
  if (!state.db) throw new Error("로그인이 필요합니다. 다시 로그인해 주세요.");
  const expectedAuthEpoch = authEventEpoch;
  const expectedUserId = currentUserId();
  const { data, error } = forceRefresh
    ? await state.db.auth.refreshSession()
    : await state.db.auth.getSession();
  if (error) throw new Error("로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.");
  let session = data?.session || null;
  if (expectedAuthEpoch !== authEventEpoch) session = state.session;
  if (!session?.access_token || !expectedUserId || sessionUserId(session) !== expectedUserId) {
    if (expectedAuthEpoch === authEventEpoch) applyAuthSession(null, { event: "SIGNED_OUT", scheduleBoot: false });
    throw new Error("로그인이 만료되었습니다. 다시 로그인해 주세요.");
  }
  if (expectedAuthEpoch === authEventEpoch) {
    const transition = applyAuthSession(session, { event: "SESSION_OBSERVED", scheduleBoot: false });
    void syncNativeSession(session, transition.authEpoch);
  }
  return { "Content-Type": "application/json", apikey: cfg.anonKey, Authorization: `Bearer ${session.access_token}` };
}
async function fetchWithFreshAuth(url, body) {
  const send = async (forceRefresh = false) => fetch(url, {
    method: "POST",
    headers: await authHeaders(forceRefresh),
    body: JSON.stringify(body),
  });
  const response = await send();
  if (response.status !== 401) return response;
  const errorText = await response.clone().text();
  if (!/Invalid JWT|UNAUTHORIZED_/i.test(errorText)) return response;
  return send(true);
}
function showSetup(show) {
  const open = Boolean(show && canUseManualDbConfig());
  el.setupOverlay.classList.toggle("visible", open);
  updateModalLayer(el.setupOverlay, open, el.setupUrl);
}
function showAuth(show) {
  if (show) setAuthMode("login");
  el.authOverlay.classList.toggle("visible", show);
  updateModalLayer(el.authOverlay, Boolean(show), el.authEmail);
}
function showPending(show) {
  if (show) {
    const blocked = state.profile?.status === "blocked";
    $("pendingTitle").textContent = blocked ? "계정 이용이 제한되었습니다" : "승인 대기 중";
    $("pendingDescription").textContent = blocked
      ? "운영자에게 계정 상태를 문의해 주세요." : "관리자가 계정을 승인하면 사용할 수 있습니다.";
  }
  el.pendingOverlay.classList.toggle("visible", show);
  updateModalLayer(el.pendingOverlay, Boolean(show), el.pendingLogout);
}
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
  el.authSignupFields.setAttribute("aria-hidden", String(!signupMode));
  el.authSignupFields.toggleAttribute("inert", !signupMode);
  el.authName.required = signupMode;
  el.authDriverType.disabled = !signupMode;
  el.authEmail.disabled = false;
  el.authPassword.autocomplete = signupMode || resetMode ? "new-password" : "current-password";
  el.loginBtn.textContent = signupMode || resetMode ? "로그인으로" : "로그인";
  el.signupBtn.textContent = signupMode ? "가입 요청 보내기" : resetMode ? "비밀번호 저장" : "가입 요청";
  el.forgotPasswordBtn.classList.toggle("hidden", signupMode || resetMode);
  el.forgotPasswordBtn.setAttribute("aria-hidden", String(signupMode || resetMode));
  el.forgotPasswordBtn.toggleAttribute("inert", signupMode || resetMode);
  el.authError.textContent = "";
}
function setDbBadge(connected, text = "") {
  el.dbStatusBadge.textContent = connected ? (text || "연결됨") : "미연결";
  el.dbStatus.textContent = connected ? "DB에 연결되어 있습니다." : "DB 연결이 필요합니다.";
  el.syncStatus.textContent = connected ? (text || "DB 연결됨") : "미연결";
  el.syncStatus.classList.toggle("sync-ok", connected);
}
function setSaveFeedback(status) {
  state.saveStatus = status;
  const host = $("saveFeedback");
  if (!host) return;
  const messages = {
    pending: "변경 사항을 저장할 예정입니다.", saving: "저장 중…",
    failed: "저장하지 못했습니다. 입력은 현재 화면에 남아 있습니다.",
    conflict: "서버 기록이 달라 저장을 멈췄습니다. 입력을 비교해 주세요.",
    saved: state.retainedEdits ? "충돌 당시 입력을 이 화면에서 보관 중입니다." : "",
  };
  host.hidden = status === "saved" && !state.retainedEdits;
  $("saveFeedbackText").textContent = messages[status] || "";
  $("retryPendingSave").hidden = !["failed", "conflict"].includes(status);
  $("retryPendingSave").textContent = status === "conflict" ? "입력 비교" : "다시 저장";
  $("useServerRecord").hidden = status !== "conflict";
  $("showRetainedEdits").hidden = !state.retainedEdits;
}
function recordInputSummary(dateKey, record) {
  const rows = (record?.rows || []).map((row) =>
    `${splitStoredRoutes(row.route).join(" · ")}: ${toNum(row.count)}건 × ${toNum(row.unit)}원`);
  return `${dateKey}${record?.off ? " · 휴무" : ""}\n${rows.join("\n")}\n프레시백 ${toNum(record?.freshCount)}개`;
}
async function reviewPendingSave(useServer = false) {
  if (!state.saveConflict) return ensurePendingSavesFlushed();
  const context = captureAccountContext();
  const dateKey = state.saveConflictDate;
  if (!dateKey || !isAccountContextCurrent(context)) return;
  const entryBefore = JSON.stringify(getRecord(dateKey, false));
  const draftBefore = JSON.stringify(state.recordDraft);
  const visibleDraft = state.recordDraftDate === dateKey && state.recordDraft;
  const draft = cloneRecord(visibleDraft || getRecord(dateKey, false));
  const [day, items, ledger, overrides] = await Promise.all([
    state.db.from(TABLES.days).select("*").eq("user_id", context.userId).eq("work_date", dateKey).maybeSingle(),
    state.db.from(TABLES.items).select("*").eq("user_id", context.userId).eq("work_date", dateKey).order("sort_order"),
    loadVerifiedWorkLedger({ userId: context.userId }),
    fetchAutomaticSalesOverrides({ userId: context.userId }),
  ]);
  if (!isAccountContextCurrent(context)) return;
  if (day.error || items.error) throw day.error || items.error;
  const receipt = entriesFromDb(day.data ? [day.data] : [], items.data,
    ledger.workResults.filter((work) => work.work_date === dateKey),
    ledger.workRoutes.filter((route) => ledger.workResults.some((work) => work.work_date === dateKey && work.work_id === route.work_id)))[dateKey] || emptyRecord();
  const snapshots = automaticSalesOverridesByDate(overrides.rows);
  const latest = applyAutomaticSalesOverrideToRecord(receipt, snapshots[dateKey]);
  const summary = `내 입력\n${recordInputSummary(dateKey, draft)}\n\n서버 기록\n${recordInputSummary(dateKey, latest)}`;
  if (!useServer && hasAutomaticEntries(latest)) {
    window.alert(`${summary}\n\n새 자동 기록이 있습니다. 같은 업무인지 확인하고 '서버 기록 보기'를 선택하세요. 내 입력은 별도로 보관됩니다.`);
    return;
  }
  if (!window.confirm(`${summary}\n\n${useServer ? "내 입력을 이 화면에 별도로 보관하고 서버 기록을 표시할까요? 보관 입력은 새로고침하면 사라지므로 필요한 내용은 복사해 주세요." : "서버 기록을 확인했습니다. 내 입력으로 다시 저장할까요?"}`)) return;
  if (!isAccountContextCurrent(context)) return;
  // Do not apply confirmation to edits made while the server was being read.
  if (JSON.stringify(getRecord(dateKey, false)) !== entryBefore || JSON.stringify(state.recordDraft) !== draftBefore) return;
  if (useServer) {
    state.retainedEdits = [...(state.retainedEdits || []), { dateKey, record: draft }];
    state.receiptEntries[dateKey] = receipt;
    if (snapshots[dateKey]) state.automaticSalesOverrides[dateKey] = snapshots[dateKey];
    else delete state.automaticSalesOverrides[dateKey];
    setRecord(dateKey, latest);
    state.pendingDates.delete(dateKey);
    if (state.recordDraftDate === dateKey) discardRecordDraft();
    state.saveConflict = false;
    state.saveConflictDate = "";
    setSaveFeedback(state.pendingDates.size || state.pendingRates ? "pending" : "saved");
    renderAll();
    return;
  }
  getRecord(dateKey, false).manualDayUpdatedAt = latest.manualDayUpdatedAt;
  state.saveConflict = false;
  state.saveConflictDate = "";
  return ensurePendingSavesFlushed();
}
function applyWorkPreferencesUi(profile = state.profile, disabled = false) {
  const pendingTask = workPreferencesSaveTask && isAccountContextCurrent(workPreferencesSaveTask.context)
    ? workPreferencesSaveTask
    : null;
  const preferences = pendingTask?.next || profile;
  const controlsDisabled = disabled || Boolean(pendingTask);
  const mode = preferences?.freshbag_mode === "dual" ? "dual" : "single";
  document.querySelectorAll('input[name="freshbagMode"]').forEach((radio) => {
    radio.checked = radio.value === mode;
    radio.disabled = controlsDisabled;
  });
  const workShift = preferences?.work_shift === "night" ? "night" : "day";
  document.querySelectorAll('input[name="workShift"]').forEach((radio) => {
    radio.checked = radio.value === workShift;
    radio.disabled = controlsDisabled;
  });
}
function applyProfileUi() {
  const profile = state.profile || {};
  const isAdmin = profile.role === "admin";
  el.app.dataset.driverType = profile.driver_type || "backup";
  el.app.dataset.role = isAdmin ? "admin" : "driver";
  el.profileDisplayName.value = profile.display_name || "";
  el.profileBusinessName.value = profile.business_name || "";
  el.profileVehicleNumber.value = profile.vehicle_number || "";
  const fixedRouteText = (profile.fixed_routes || []).join(", ");
  el.fixedRoutesInput.value = fixedRouteText;
  if (el.fixedRoutesText) el.fixedRoutesText.textContent = fixedRouteText || "관리자가 지정한 라우트가 없습니다.";
  document.querySelectorAll(".admin-only").forEach((node) => node.classList.toggle("hidden", !isAdmin));
  if (el.app.dataset.view === "admin") showView("settings");
  el.openDbSettings.style.display = canUseManualDbConfig() ? "" : "none";
  applyWorkPreferencesUi(profile);
  const goal = getGoal();
  el.goalAmountInput.value = goal > 0 ? goal.toLocaleString("ko-KR") : "";
}
async function connectDb(url, key, persist = false) {
  const client = buildClient(url, key);
  if (!client) throw new Error("Supabase 라이브러리를 불러오지 못했습니다.");
  state.db = client;
  bindNativeAuthSync(client);
  if (persist && !hasPublicDbConfig()) saveDbConfig(url, key);
  el.setupUrl.value = normalizeUrl(url);
  el.setupKey.value = key;
  el.supabaseUrl.value = normalizeUrl(url);
  el.supabaseAnonKey.value = key;
  showSetup(false);
  setDbBadge(true);
  const { data, error } = await client.auth.getSession();
  if (error) throw error;
  applyAuthSession(data.session, { event: "SESSION_OBSERVED" });
  nativeSessionSyncRequested = true;
  await flushNativeSessionSyncRequest();
  if (state.session && (state.passwordRecovery || isPasswordRecoveryUrl())) {
    showAuth(true);
    setAuthMode("reset");
    window.FlexNoteStartup?.finish();
    return;
  }
  if (!state.session) {
    showAuth(true);
    window.FlexNoteStartup?.finish();
    return;
  }
  await bootSignedInUser(captureAccountContext());
}
async function bootSignedInUser(context = captureAccountContext()) {
  if (!isAccountContextCurrent(context)) return false;
  if (accountBootTask?.epoch === context.epoch && accountBootTask?.userId === context.userId) {
    return accountBootTask.promise;
  }
  const bootPromise = (async () => {
    if (!await loadProfile(context) || !isAccountContextCurrent(context)) return false;
    if (state.profile?.status !== "approved") {
      noahController?.reset();
      if (!isAccountContextCurrent(context)) return false;
      routeNotesController?.reset();
      routeNotesService?.reset?.();
      showAuth(false);
      showPending(true);
      window.FlexNoteStartup?.finish();
      return true;
    }
    showPending(false);
    applyProfileUi();
    if (!await loadFromDb(context) || !isAccountContextCurrent(context)) return false;
    renderAll();
    showAuth(false);
    trackApprovedSessionStart();
    void refreshPendingSignupsNotice(context);
    window.FlexNoteStartup?.finish();
    await maybeOfferRateUpdate(context);
    if (!isAccountContextCurrent(context)) return false;
    return isAccountContextCurrent(context);
  })();
  const task = { epoch: context.epoch, userId: context.userId, promise: bootPromise };
  accountBootTask = task;
  try {
    return await bootPromise;
  } finally {
    if (accountBootTask === task) accountBootTask = null;
  }
}
async function loadProfile(context = captureAccountContext()) {
  if (!isAccountContextCurrent(context)) return false;
  const user = state.session?.user;
  if (!user || user.id !== context.userId) return false;
  const { data, error } = await state.db.from(TABLES.profiles).select("*").eq("id", context.userId).maybeSingle();
  if (!isAccountContextCurrent(context)) return false;
  if (error) throw error;
  if (data) {
    state.profile = data;
    return true;
  }
  const displayName = user.user_metadata?.display_name || user.email?.split("@")[0] || "사용자";
  const driverType = user.user_metadata?.driver_type === "fixed" ? "fixed" : "backup";
  const { data: ensured, error: rpcError } = await state.db.rpc("quickflex_ensure_profile", {
    profile_email: user.email,
    profile_display_name: displayName,
    profile_driver_type: driverType,
  });
  if (!isAccountContextCurrent(context)) return false;
  if (!rpcError && ensured) {
    state.profile = Array.isArray(ensured) ? ensured[0] : ensured;
    return true;
  }
  if (rpcError) throw rpcError;
  // Profile creation and its initial permissions belong to the server, never to browser INSERT.
  throw new Error("가입 정보를 확인하지 못했습니다. 잠시 후 다시 로그인하거나 운영자에게 문의해 주세요.");
}
async function saveProfile() {
  const context = captureAccountContext();
  if (!isAccountContextCurrent(context)) return false;
  if (workPreferencesSaveTask?.promise) await workPreferencesSaveTask.promise;
  if (!isAccountContextCurrent(context)) return false;
  const selectedMode = document.querySelector('input[name="freshbagMode"]:checked')?.value || "single";
  const selectedWorkShift = document.querySelector('input[name="workShift"]:checked')?.value === "night" ? "night" : "day";
  const payload = {
    display_name: el.profileDisplayName.value.trim() || driverName(),
    business_name: el.profileBusinessName.value.trim(),
    vehicle_number: el.profileVehicleNumber.value.trim(),
    freshbag_mode: selectedMode,
    work_shift: selectedWorkShift,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await state.db.from(TABLES.profiles).update(payload).eq("id", context.userId).select("*").single();
  if (!isAccountContextCurrent(context)) return false;
  if (error) throw error;
  state.profile = data;
  applyProfileUi();
  renderAll();
  if (el.app.dataset.view === "record") renderEntryForm();
  toast("내 정보를 저장했습니다.", "success");
  return true;
}
async function saveWorkPreferences() {
  if (workPreferencesSaveTask) return workPreferencesSaveTask.promise;
  const context = captureAccountContext();
  if (!isAccountContextCurrent(context)) return false;
  const previous = {
    freshbag_mode: state.profile?.freshbag_mode === "dual" ? "dual" : "single",
    work_shift: state.profile?.work_shift === "night" ? "night" : "day",
  };
  const next = {
    freshbag_mode: document.querySelector('input[name="freshbagMode"]:checked')?.value === "dual" ? "dual" : "single",
    work_shift: document.querySelector('input[name="workShift"]:checked')?.value === "night" ? "night" : "day",
  };
  if (next.freshbag_mode === previous.freshbag_mode && next.work_shift === previous.work_shift) return true;

  const task = { context, next, promise: null };
  workPreferencesSaveTask = task;
  applyWorkPreferencesUi(next, true);
  task.promise = (async () => {
    try {
      const payload = { ...next, updated_at: new Date().toISOString() };
      const { data, error } = await state.db.from(TABLES.profiles)
        .update(payload)
        .eq("id", context.userId)
        .select("work_shift,freshbag_mode,updated_at")
        .single();
      if (!isAccountContextCurrent(context)) return false;
      if (error) throw error;
      state.profile = {
        ...state.profile,
        work_shift: data?.work_shift === "night" ? "night" : "day",
        freshbag_mode: data?.freshbag_mode === "dual" ? "dual" : "single",
        updated_at: data?.updated_at || payload.updated_at,
      };
      applyWorkPreferencesUi(state.profile);
      return true;
    } catch (error) {
      if (!isAccountContextCurrent(context)) return false;
      task.next = previous;
      applyWorkPreferencesUi(previous);
      error.quickflexHandled = true;
      toast(`근무 설정 저장 실패: ${error.message}`, "error");
      throw error;
    } finally {
      if (workPreferencesSaveTask === task) {
        workPreferencesSaveTask = null;
        if (isAccountContextCurrent(context)) {
          document.querySelectorAll('input[name="freshbagMode"], input[name="workShift"]').forEach((radio) => {
            radio.disabled = false;
          });
        }
      }
    }
  })();
  return task.promise;
}
function openSignatureEditor() {
  profileSignaturePad?.clear();
  el.profileSignatureStatus.textContent = "";
  el.profileSignatureOverlay.classList.add("visible");
  updateModalLayer(el.profileSignatureOverlay, true, el.closeProfileSignature);
}
function closeSignatureEditor(force = false) {
  if (!force && el.saveProfileSignature.disabled) return;
  el.profileSignatureOverlay.classList.remove("visible");
  profileSignaturePad?.clear();
  updateModalLayer(el.profileSignatureOverlay, false);
}
async function saveInspectionSignature() {
  const context = captureAccountContext();
  if (!isAccountContextCurrent(context)) return false;
  const signatureData = profileSignaturePad?.value() || "";
  if (!isValidSignatureData(signatureData)) {
    throw new Error("흰 공간에 손글씨로 서명해 주세요.");
  }
  const payload = {
    user_id: context.userId,
    signature_data: signatureData,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await state.db
    .from(TABLES.inspectionSignatures)
    .upsert(payload, { onConflict: "user_id" })
    .select("signature_data")
    .single();
  if (!isAccountContextCurrent(context)) return false;
  if (error) throw error;
  state.inspectionSignature = data.signature_data;
  if (el.app.dataset.view === "inspection") renderInspection(state.inspectionDate);
  toast("일상점검 서명을 저장했습니다.", "success");
  return true;
}
async function saveGoalAmount() {
  const context = captureAccountContext();
  if (!isAccountContextCurrent(context)) return false;
  const goal = goalRawValue();
  if (!goal || goal <= 0) return toast("올바른 목표 금액을 입력해 주세요.", "error");
  if (!state.db) throw new Error("DB 연결이 필요합니다.");
  const updatedAt = new Date().toISOString();
  const { data, error } = await state.db
    .from(TABLES.profiles)
    .update({ goal_amount: goal, updated_at: updatedAt })
    .eq("id", context.userId)
    .select("*")
    .single();
  if (!isAccountContextCurrent(context)) return false;
  if (error) throw error;
  state.profile = data || { ...(state.profile || {}), goal_amount: goal, updated_at: updatedAt };
  applyProfileUi();
  renderSummary();
  renderStats();
  renderSettingsSummary();
  toast("목표를 저장했습니다.", "success");
  return true;
}
async function login() {
  el.authError.textContent = "";
  const { data, error } = await state.db.auth.signInWithPassword({ email: el.authEmail.value.trim(), password: el.authPassword.value });
  if (error) throw error;
  const transition = applyAuthSession(data.session, { event: "SIGNED_IN" });
  await bootSignedInUser(transition.accountContext);
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
  const transition = data.session
    ? applyAuthSession(data.session, { event: "SIGNED_IN" })
    : null;
  if (data.session && transition) {
    try {
      await state.db.rpc("quickflex_ensure_profile", {
        profile_email: el.authEmail.value.trim(),
        profile_display_name: el.authName.value.trim(),
        profile_driver_type: el.authDriverType.value === "fixed" ? "fixed" : "backup",
      });
      if (!isAccountContextCurrent(transition.accountContext)) return;
    } catch (profileError) {
      throw new Error(`가입은 접수됐지만 프로필 생성 확인에 실패했습니다. 관리자에게 이메일을 알려 주세요. (${profileError.message})`);
    }
    await bootSignedInUser(transition.accountContext);
  } else {
    toast("가입 요청을 보냈습니다. 이메일 확인이 필요할 수 있습니다.", "success");
    el.authError.textContent = "가입 요청을 보냈습니다. 관리자 화면에 보이지 않으면 이메일 확인 후 다시 로그인해 주세요.";
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
  nativeLogoutInProgress = true;
  try {
    if (window.QuickFlexNative?.postMessage) {
      const nativeResult = await requestNativeMessage({ type: "sign_out" });
      if (!nativeResult?.ok) {
        const message = nativeResult?.reason === "active_work"
          ? "진행 중인 업무를 먼저 종료해야 로그아웃할 수 있습니다."
          : "앱의 업무 상태를 확인하지 못해 로그아웃하지 않았습니다. 잠시 후 다시 시도해 주세요.";
        toast(message, "error");
        return false;
      }
    }
    if (state.db) {
      const { error } = await state.db.auth.signOut({ scope: "local" });
      if (error) throw error;
    }
    applyAuthSession(null, { event: "SIGNED_OUT", scheduleBoot: false });
    return true;
  } catch (error) {
    if (state.session?.access_token && state.session?.refresh_token) {
      const transition = applyAuthSession(state.session, { event: "SESSION_OBSERVED", scheduleBoot: false });
      await syncNativeSession(state.session, transition.authEpoch);
    }
    throw error;
  } finally {
    nativeLogoutInProgress = false;
  }
}

function workLedgerKey(userId, workId) {
  return JSON.stringify([String(userId || ""), String(workId || "")]);
}
function userDateKey(userId, dateKey) {
  return JSON.stringify([String(userId || ""), String(dateKey || "")]);
}
const LEDGER_PAGE_SIZE = 500;
const LEDGER_WORK_ID_BATCH_SIZE = 40;
const LEDGER_VERIFY_ATTEMPTS = 2;
const WORK_RESULT_SELECT = "user_id,work_id,work_date,work_shift,total_households,total_items,fresh_count,return_count,cancel_count,canonical_payload,finalized_at";
const WORK_RESULT_ROUTE_SELECT = "user_id,work_id,route,delivery_count,household_count,unit_snapshot,sort_order";
const WORK_RESULT_ROUTE_DETAIL_SELECT = "user_id,work_id,detail_route,base_route,delivery_count";
const AUTOMATIC_SALES_OVERRIDE_SELECT = "user_id,work_date,routes,total_items,revision,reason,request_id,updated_at";

function isOptionalSalesContractMissing(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return code === "42P01"
    || code === "PGRST202"
    || code === "PGRST205"
    || message.includes("quickflex_automatic_sales_overrides") && (message.includes("not find") || message.includes("does not exist") || message.includes("schema cache"))
    || message.includes("quickflex_work_result_route_details") && (message.includes("not find") || message.includes("does not exist") || message.includes("schema cache"));
}

async function fetchPagedRows(buildQuery) {
  const rows = [];
  let expectedCount = null;
  let offset = 0;
  for (let page = 0; page < 10000; page += 1) {
    const { data, error, count } = await buildQuery(offset, offset + LEDGER_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = data || [];
    if (expectedCount === null && Number.isSafeInteger(count) && count >= 0) expectedCount = count;
    rows.push(...batch);
    if (!batch.length || (expectedCount !== null && rows.length >= expectedCount)) return rows;
    offset += batch.length;
  }
  throw new Error("자동 원장 조회량이 안전 한도를 넘었습니다.");
}

async function fetchWorkResultHeaders({ userId = "", startKey = "", endKey = "" } = {}) {
  return fetchPagedRows((from, to) => {
    let query = state.db
      .from(TABLES.salesWorkResults)
      .select(WORK_RESULT_SELECT, { count: "exact" });
    if (userId) query = query.eq("user_id", userId);
    if (startKey) query = query.gte("work_date", startKey);
    if (endKey) query = query.lte("work_date", endKey);
    return query
      .order("finalized_at")
      .order("user_id")
      .order("work_id")
      .range(from, to);
  });
}

async function fetchWorkResultRoutes(workResults) {
  const workIdsByUser = new Map();
  (workResults || []).forEach((work) => {
    const userId = String(work.user_id || "");
    const workId = String(work.work_id || "");
    if (!userId || !workId) return;
    if (!workIdsByUser.has(userId)) workIdsByUser.set(userId, new Set());
    workIdsByUser.get(userId).add(workId);
  });
  const rows = [];
  for (const [userId, workIdSet] of workIdsByUser) {
    const workIds = [...workIdSet];
    for (let offset = 0; offset < workIds.length; offset += LEDGER_WORK_ID_BATCH_SIZE) {
      const batchIds = workIds.slice(offset, offset + LEDGER_WORK_ID_BATCH_SIZE);
      const batchRows = await fetchPagedRows((from, to) => state.db
        .from(TABLES.salesWorkRoutes)
        .select(WORK_RESULT_ROUTE_SELECT, { count: "exact" })
        .eq("user_id", userId)
        .in("work_id", batchIds)
        .order("work_id")
        .order("sort_order")
        .order("route")
        .range(from, to));
      rows.push(...batchRows);
    }
  }
  return rows;
}

async function fetchWorkResultRouteDetails(workResults) {
  const workIdsByUser = new Map();
  (workResults || []).forEach((work) => {
    const userId = String(work.user_id || "");
    const workId = String(work.work_id || "");
    if (!userId || !workId) return;
    if (!workIdsByUser.has(userId)) workIdsByUser.set(userId, new Set());
    workIdsByUser.get(userId).add(workId);
  });
  const rows = [];
  try {
    for (const [userId, workIdSet] of workIdsByUser) {
      const workIds = [...workIdSet];
      for (let offset = 0; offset < workIds.length; offset += LEDGER_WORK_ID_BATCH_SIZE) {
        const batchIds = workIds.slice(offset, offset + LEDGER_WORK_ID_BATCH_SIZE);
        const batchRows = await fetchPagedRows((from, to) => state.db
          .from(TABLES.salesWorkDetails)
          .select(WORK_RESULT_ROUTE_DETAIL_SELECT, { count: "exact" })
          .eq("user_id", userId)
          .in("work_id", batchIds)
          .order("work_id")
          .order("detail_route")
          .range(from, to));
        rows.push(...batchRows);
      }
    }
  } catch (error) {
    if (!isOptionalSalesContractMissing(error)) console.warn("[work-route-details]", error);
    return { rows: [], available: false };
  }
  return { rows, available: true };
}

async function fetchAutomaticSalesOverrides({ userId = "", startKey = "", endKey = "" } = {}) {
  try {
    const rows = await fetchPagedRows((from, to) => {
      let query = state.db
        .from(TABLES.salesOverrides)
        .select(AUTOMATIC_SALES_OVERRIDE_SELECT, { count: "exact" });
      if (userId) query = query.eq("user_id", userId);
      if (startKey) query = query.gte("work_date", startKey);
      if (endKey) query = query.lte("work_date", endKey);
      return query.order("work_date").order("user_id").range(from, to);
    });
    rows.forEach(normalizeAutomaticSalesOverride);
    return { rows, available: true };
  } catch (error) {
    if (isOptionalSalesContractMissing(error)) return { rows: [], available: false };
    throw error;
  }
}

function workRouteDetailsByDate(workResults, details) {
  const headerByWork = new Map((workResults || []).map((work) => [workLedgerKey(work.user_id, work.work_id), work]));
  const byDate = {};
  const seenDetails = new Set();
  const cancellationsByWork = new Map();
  headerByWork.forEach((work, workKey) => {
    const value = parseCanonicalWorkPayload(work.canonical_payload)?.cancellation_detail_counts;
    const entries = value && typeof value === "object" && !Array.isArray(value) ? Object.entries(value) : [];
    const total = exactLedgerInteger(work.cancel_count) ?? 0;
    const valid = entries.every(([route, count]) => /^\d{3}[A-Z]\d{2}$/.test(route) && Number.isSafeInteger(count) && count >= 0)
      && entries.reduce((sum, [, count]) => sum + count, 0) <= total;
    cancellationsByWork.set(workKey, new Map(valid ? entries : []));
  });
  (details || []).forEach((detail) => {
    const workKey = workLedgerKey(detail.user_id, detail.work_id);
    const work = headerByWork.get(workKey);
    if (!work) return;
    const dateKey = String(work.work_date || "");
    if (!dateKey) return;
    const detailRoute = normalizeRoute(detail.detail_route);
    const detailKey = `${workKey}|${detailRoute}`;
    if (seenDetails.has(detailKey)) return;
    seenDetails.add(detailKey);
    const deliveryCount = exactLedgerInteger(detail.delivery_count);
    const cancellationCount = cancellationsByWork.get(workKey).get(detailRoute) || 0;
    if (!byDate[dateKey]) byDate[dateKey] = [];
    byDate[dateKey].push({
      workId: String(detail.work_id || ""),
      detailRoute,
      baseRoute: normalizeBaseSalesRoute(detail.base_route),
      deliveryCount,
      cancellationCount,
    });
  });
  headerByWork.forEach((work, workKey) => {
    const dateKey = String(work.work_date || "");
    if (!dateKey) return;
    cancellationsByWork.get(workKey).forEach((cancellationCount, detailRoute) => {
      if (!cancellationCount || seenDetails.has(`${workKey}|${detailRoute}`)) return;
      if (!byDate[dateKey]) byDate[dateKey] = [];
      byDate[dateKey].push({
        workId: String(work.work_id || ""), detailRoute, baseRoute: detailRoute.slice(0, 4),
        deliveryCount: null, cancellationCount,
      });
    });
  });
  return byDate;
}

function parseCanonicalWorkPayload(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) return value;
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function exactLedgerInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function validateWorkLedgerRows(workResults, workRoutes) {
  const issues = [];
  const headersByWork = new Map();
  const routesByWork = new Map();
  (workResults || []).forEach((work) => {
    const key = workLedgerKey(work.user_id, work.work_id);
    if (headersByWork.has(key)) issues.push(`${work.work_id}: 중복 원장 헤더`);
    headersByWork.set(key, work);
  });
  (workRoutes || []).forEach((route) => {
    const key = workLedgerKey(route.user_id, route.work_id);
    if (!headersByWork.has(key)) {
      issues.push(`${route.work_id}: 헤더 없는 구역 상세`);
      return;
    }
    if (!routesByWork.has(key)) routesByWork.set(key, []);
    routesByWork.get(key).push(route);
  });

  headersByWork.forEach((work, key) => {
    const actualRoutes = routesByWork.get(key) || [];
    const totalItems = exactLedgerInteger(work.total_items);
    const payload = parseCanonicalWorkPayload(work.canonical_payload);
    const expectedRoutes = Array.isArray(payload?.routes) ? payload.routes : null;
    const actualByRoute = new Map();
    let actualItems = 0;

    actualRoutes.forEach((route) => {
      const routeName = String(route.route || "");
      if (actualByRoute.has(routeName)) issues.push(`${work.work_id}: 중복 구역 ${routeName}`);
      actualByRoute.set(routeName, route);
      const deliveryCount = exactLedgerInteger(route.delivery_count);
      if (deliveryCount === null) {
        issues.push(`${work.work_id}: 잘못된 구역 합계`);
        return;
      }
      actualItems += deliveryCount;
    });

    if (totalItems === null) issues.push(`${work.work_id}: 잘못된 헤더 합계`);
    if (!actualRoutes.length) issues.push(`${work.work_id}: 구역 상세 없음`);
    if (totalItems !== null && actualItems !== totalItems) issues.push(`${work.work_id}: 상품 합계 불일치`);
    if (!expectedRoutes) {
      issues.push(`${work.work_id}: 원본 구역 목록 없음`);
      return;
    }
    if (String(payload.work_date || "") !== String(work.work_date || "")
      || String(payload.work_shift || "") !== String(work.work_shift || "")
      || exactLedgerInteger(payload.total_items) !== totalItems) {
      issues.push(`${work.work_id}: 헤더와 원본 불일치`);
    }
    if (expectedRoutes.length !== actualRoutes.length) issues.push(`${work.work_id}: 구역 행 수 불일치`);
    const expectedNames = new Set();
    expectedRoutes.forEach((expected) => {
      const routeName = String(expected?.route || "");
      if (!routeName || expectedNames.has(routeName)) {
        issues.push(`${work.work_id}: 잘못된 원본 구역`);
        return;
      }
      expectedNames.add(routeName);
      const actual = actualByRoute.get(routeName);
      if (!actual) {
        issues.push(`${work.work_id}: 구역 ${routeName} 누락`);
        return;
      }
      for (const field of ["delivery_count", "unit_snapshot", "sort_order"]) {
        if (exactLedgerInteger(expected[field]) !== exactLedgerInteger(actual[field])) {
          issues.push(`${work.work_id}: 구역 ${routeName} ${field} 불일치`);
        }
      }
    });
  });
  return [...new Set(issues)];
}

function workLedgerItems(workResults, workRoutes) {
  const headerByWork = new Map((workResults || []).map((work) => [workLedgerKey(work.user_id, work.work_id), work]));
  return (workRoutes || []).flatMap((route) => {
    const work = headerByWork.get(workLedgerKey(route.user_id, route.work_id));
    if (!work) return [];
    return [{
      ...route,
      work_date: work.work_date,
      work_shift: work.work_shift,
      finalized_at: work.finalized_at,
      source: "automatic",
      readOnly: true,
      workId: work.work_id,
      workShift: work.work_shift,
      finalizedAt: work.finalized_at,
      sortOrder: route.sort_order ?? 0,
    }];
  });
}

async function loadVerifiedWorkLedger(filters = {}) {
  let lastIssues = [];
  for (let attempt = 0; attempt < LEDGER_VERIFY_ATTEMPTS; attempt += 1) {
    const workResults = await fetchWorkResultHeaders(filters);
    const workRoutes = await fetchWorkResultRoutes(workResults);
    lastIssues = validateWorkLedgerRows(workResults, workRoutes);
    if (!lastIssues.length) {
      const detailResult = await fetchWorkResultRouteDetails(workResults);
      return {
        workResults,
        workRoutes,
        items: workLedgerItems(workResults, workRoutes),
        workRouteDetails: detailResult.rows,
        workRouteDetailsAvailable: detailResult.available,
      };
    }
    if (attempt + 1 < LEDGER_VERIFY_ATTEMPTS) {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
  }
  const error = new Error(`자동 마감 원장의 구역 상세가 완전하지 않습니다. 새로고침 후 다시 확인해 주세요. (${lastIssues.slice(0, 3).join(", ")})`);
  error.code = "QUICKFLEX_LEDGER_INCOMPLETE";
  error.ledgerIssues = lastIssues;
  throw error;
}

function entriesFromDb(dayRows, itemRows, workResultRows = [], workRouteRows = []) {
  const entries = {};
  (dayRows || []).forEach((row) => {
    entries[row.work_date] = normalizeRecordShape({
      off: row.is_off,
      rows: [],
      freshCount: row.fresh_count ?? "",
      returnCount: row.return_count ?? "",
      cancellationCount: row.cancel_count ?? "",
      freshUnit: row.fresh_unit ?? 100,
      freshSoloCount: row.fresh_solo_count ?? "",
      freshLinkedCount: row.fresh_linked_count ?? "",
      freshbagMode: row.freshbag_mode || "single",
      salesDayBasis: salesDayEditableValues(row),
      salesDayRevision: row.sales_edit_revision ?? 0,
      manualDayUpdatedAt: row.updated_at || null,
      backupUnit: row.backup_unit ?? DEFAULT_BACKUP_UNIT,
      driverType: row.driver_type || "backup",
    });
  });
  (itemRows || []).forEach((row) => {
    if (!entries[row.work_date]) entries[row.work_date] = emptyRecord();
    entries[row.work_date].rows.push({
      route: row.route,
      count: row.delivery_count ?? "",
      households: row.household_count ?? "",
      unit: row.unit_snapshot ?? 0,
    });
  });
  const routesByWork = new Map();
  (workRouteRows || []).forEach((row) => {
    const key = workLedgerKey(row.user_id, row.work_id);
    if (!routesByWork.has(key)) routesByWork.set(key, []);
    routesByWork.get(key).push(row);
  });
  (workResultRows || [])
    .slice()
    .sort((a, b) => String(a.finalized_at || "").localeCompare(String(b.finalized_at || "")) || String(a.work_id || "").localeCompare(String(b.work_id || "")))
    .forEach((work) => {
      if (!entries[work.work_date]) entries[work.work_date] = emptyRecord();
      entries[work.work_date].automaticWorks ||= [];
      entries[work.work_date].automaticWorks.push({
        workId: work.work_id,
        workShift: work.work_shift,
        finalizedAt: work.finalized_at || "",
        totalHouseholds: exactLedgerInteger(work.total_households),
        totalItems: exactLedgerInteger(work.total_items),
        freshCount: exactLedgerInteger(work.fresh_count) ?? 0,
        returnCount: exactLedgerInteger(work.return_count) ?? 0,
        cancellationCount: exactLedgerInteger(work.cancel_count) ?? 0,
      });
      const workRoutes = (routesByWork.get(workLedgerKey(work.user_id, work.work_id)) || [])
        .slice()
        .sort((a, b) => toNum(a.sort_order) - toNum(b.sort_order) || String(a.route || "").localeCompare(String(b.route || "")));
      workRoutes.forEach((row) => {
        entries[work.work_date].rows.push({
          route: row.route,
          count: row.delivery_count ?? "",
          households: row.household_count ?? "",
          unit: row.unit_snapshot ?? 0,
          source: "automatic",
          readOnly: true,
          workId: work.work_id,
          workShift: work.work_shift,
          finalizedAt: work.finalized_at || "",
          sortOrder: row.sort_order ?? 0,
        });
      });
    });
  Object.keys(entries).forEach((dateKey) => {
    entries[dateKey].salesBasisCounts = {};
    entries[dateKey].rows.filter((row) => row.source === "automatic").forEach((row) => {
      const basis = entries[dateKey].salesBasisCounts;
      basis[row.route] = (basis[row.route] || 0) + toNum(row.count);
    });
    entries[dateKey] = normalizeRecordShape(entries[dateKey]);
    if (!isBackupDriver() && !hasAutomaticEntries(entries[dateKey]) && !entries[dateKey].rows.length) ensureFixedRecordRows(entries[dateKey]);
  });
  return entries;
}
async function migrateLegacyGoalAmount(legacyGoal, context = captureAccountContext()) {
  if (!isAccountContextCurrent(context)) return false;
  const currentGoal = toNum(state.profile?.goal_amount);
  if (!legacyGoal || legacyGoal <= 0 || (currentGoal && currentGoal !== GOAL)) return true;
  state.profile = { ...(state.profile || {}), goal_amount: legacyGoal };
  if (!state.db) return true;
  const { data, error } = await state.db
    .from(TABLES.profiles)
    .update({ goal_amount: legacyGoal, updated_at: new Date().toISOString() })
    .eq("id", context.userId)
    .select("*")
    .single();
  if (!isAccountContextCurrent(context)) return false;
  if (!error && data) state.profile = data;
  return true;
}
async function fetchActiveMeasurementLease(userId) {
  try {
    const { data, error } = await state.db.from("quickflex_active_work_leases")
      .select("user_id,work_date,lease_expires_at,released_at")
      .eq("user_id", userId).maybeSingle();
    return error ? undefined : data;
  } catch { return undefined; }
}
async function loadFromDb(context = captureAccountContext()) {
  if (!state.db || !isAccountContextCurrent(context)) return false;
  // A refresh must never replace edits, including edits made while it is in flight.
  if (state.pendingDates.size || state.pendingRates || state.flushPromise || state.recordDraft) return false;
  const userId = context.userId;
  const defaultRatesQuery = Promise.resolve({ data: [], error: null });
  let loaded;
  try {
    loaded = await Promise.all([
      state.db.from(TABLES.rates).select("*").eq("user_id", userId).order("route"),
      defaultRatesQuery,
      fetchPagedRows((from, to) => state.db.from(TABLES.days).select("*", { count: "exact" }).eq("user_id", userId).order("work_date").order("id").range(from, to)).then((data) => ({ data })),
      fetchPagedRows((from, to) => state.db.from(TABLES.items).select("*", { count: "exact" }).eq("user_id", userId).order("work_date").order("sort_order").order("id").range(from, to)).then((data) => ({ data })),
      loadVerifiedWorkLedger({ userId }),
      fetchAutomaticSalesOverrides({ userId }),
      state.db.from(TABLES.bundles).select("*").eq("active", true).order("sort_order").order("label"),
      state.db.from(TABLES.inspections).select("*").eq("user_id", userId).order("inspection_date"),
      state.db.from(TABLES.inspectionSignatures).select("signature_data").eq("user_id", userId).maybeSingle(),
      fetchActiveMeasurementLease(userId),
    ]);
  } catch (error) {
    if (!isAccountContextCurrent(context)) return false;
    throw error;
  }
  const [ratesResult, defaultRatesResult, daysResult, itemsResult, ledger, overridesResult, bundlesResult, inspectionsResult, signatureResult, activeLease] = loaded;
  if (!isAccountContextCurrent(context)) return false;
  if (state.pendingDates.size || state.pendingRates || state.flushPromise || state.recordDraft) return false;
  if (ratesResult.error) throw ratesResult.error;
  if (defaultRatesResult.error) throw defaultRatesResult.error;
  if (daysResult.error) throw daysResult.error;
  if (itemsResult.error) throw itemsResult.error;
  if (bundlesResult.error) throw bundlesResult.error;
  if (inspectionsResult.error) throw inspectionsResult.error;
  if (signatureResult.error) throw signatureResult.error;
  const goalRate = (ratesResult.data || []).find((row) => normalizeRoute(row.route) === GOAL_SETTING_ROUTE);
  if (!await migrateLegacyGoalAmount(toNum(goalRate?.current_unit), context)) return false;
  if (!isAccountContextCurrent(context)) return false;
  if (state.pendingDates.size || state.pendingRates || state.flushPromise || state.recordDraft) return false;
  state.rates = ratesFromDb(ratesResult.data);
  state.defaultRates = ratesFromDb(defaultRatesResult.data);
  state.routeBundles = bundlesResult.data || [];
  state.automaticSalesOverrides = automaticSalesOverridesByDate(overridesResult.rows);
  state.salesOverrideContractAvailable = overridesResult.available;
  state.workRouteDetails = workRouteDetailsByDate(ledger.workResults, ledger.workRouteDetails);
  state.workRouteDetailsContractAvailable = ledger.workRouteDetailsAvailable;
  state.receiptEntries = entriesFromDb(daysResult.data, itemsResult.data, ledger.workResults, ledger.workRoutes);
  state.entries = applyAutomaticSalesOverrides(state.receiptEntries, state.automaticSalesOverrides);
  state.workDateDataLoaded = true;
  state.workDateScheduleDates = new Set((itemsResult.data || []).filter((row) => splitStoredRoutes(row.route).length).map((row) => row.work_date));
  // A failed refresh cannot erase a still-live, owner-scoped lease already seen.
  if (activeLease !== undefined) state.activeMeasurementLease = activeLease;
  state.inspections = Object.fromEntries((inspectionsResult.data || []).map((row) => [row.inspection_date, row]));
  state.inspectionSignature = isValidSignatureData(signatureResult.data?.signature_data) ? signatureResult.data.signature_data : "";
  const hadRates = state.rates.length > 0;
  if (state.profile?.role === "admin" && !state.rates.length) {
    state.rates = avgRates(SAMPLE_SETTLEMENT);
  }
  if (state.profile?.role === "admin" && !hadRates && state.rates.length) {
    const merged = mergeDefaultRouteMaster(state.rates);
    state.rates = merged.rates;
    if ((!hadRates || merged.changed) && !await persistRates(context)) return false;
  }
  if (!isAccountContextCurrent(context)) return false;
  setDbBadge(true, "동기화됨");
  return true;
}
async function persistRates(context = captureAccountContext()) {
  if (!state.db || !isAccountContextCurrent(context)) return false;
  const userId = context.userId;
  const cleanRates = state.rates
    .filter((rate) => normalizeRoute(rate.route) && normalizeRoute(rate.route) !== GOAL_SETTING_ROUTE && toNum(rate.unit) >= 0)
    .map((rate) => ({ ...rate }));
  const { error: upsertError } = await state.db.from(TABLES.rates).upsert(cleanRates.map((rate) => ({
    user_id: userId,
    route: normalizeRoute(rate.route),
    current_unit: toNum(rate.unit),
    updated_at: new Date().toISOString(),
  })), { onConflict: "user_id,route" });
  if (!isAccountContextCurrent(context)) return false;
  if (upsertError) throw upsertError;
  return true;
}
function pendingRateOfferChanges() {
  if (!state.profile || state.profile.role === "admin") return [];
  const currentByRoute = new Map(state.rates.map((rate) => [normalizeRoute(rate.route), toNum(rate.unit)]));
  return RATE_UPDATE_OFFER.rates.filter((rate) => currentByRoute.get(rate.route) !== rate.unit);
}
function renderRateUpdateOffer() {
  if (!el.rateUpdateOffer) return;
  const changes = pendingRateOfferChanges();
  el.rateUpdateOffer.classList.toggle("hidden", !changes.length);
  if (el.rateUpdateHint) {
    el.rateUpdateHint.textContent = changes.length
      ? `새 단가 ${changes.length}개가 대기 중입니다. 적용한 날짜 이후 새 기록부터 사용됩니다.`
      : "새 단가가 적용되어 있습니다.";
  }
}
async function refreshFutureZeroCountUnits(fromDate = todayKey(), context = captureAccountContext()) {
  if (!isAccountContextCurrent(context)) return false;
  const changedDates = [];
  Object.entries(state.entries).forEach(([dateKey, record]) => {
    if (dateKey < fromDate || record.off) return;
    let changed = false;
    record.rows.forEach((row) => {
      if (isAutomaticRow(row) || !row.route || toNum(row.count) > 0) return;
      const nextUnit = sharedRateForRoutes(row.route);
      if (!nextUnit || toNum(row.unit) === nextUnit) return;
      row.unit = nextUnit;
      changed = true;
    });
    if (changed) changedDates.push(dateKey);
  });
  for (const dateKey of changedDates) {
    if (!await persistDay(dateKey, context)) return false;
  }
  return changedDates;
}
async function applyRateUpdateOffer({ ask = true, context = captureAccountContext() } = {}) {
  if (!isAccountContextCurrent(context)) return false;
  const changes = pendingRateOfferChanges();
  if (!changes.length) {
    renderRateUpdateOffer();
    return toast("이미 새 단가가 적용되어 있습니다.", "success");
  }
  if (ask && !window.confirm(`구역 일부 단가가 업데이트되었습니다.\n\n새 단가 ${changes.length}개를 오늘부터 적용할까요?\n완료했거나 건수를 입력한 기존 기록의 단가는 유지됩니다.`)) return;
  if (!isAccountContextCurrent(context)) return false;
  const byRoute = new Map(state.rates.map((rate) => [normalizeRoute(rate.route), rate]));
  RATE_UPDATE_OFFER.rates.forEach((rate) => {
    const existing = byRoute.get(rate.route);
    if (existing) existing.unit = rate.unit;
    else state.rates.push({ ...rate, count: 0, amount: 0 });
  });
  state.rates.sort((a, b) => a.route.localeCompare(b.route));
  if (!await persistRates(context)) return false;
  const refreshedDates = await refreshFutureZeroCountUnits(todayKey(), context);
  if (refreshedDates === false || !isAccountContextCurrent(context)) return false;
  renderRates();
  renderAll();
  toast(refreshedDates.length
    ? `새 단가와 미입력 예정 기록 ${refreshedDates.length}일을 함께 반영했습니다.`
    : "새 단가를 오늘부터 적용했습니다.", "success");
}
function appNoticeStorageKey(userId) {
  return `${APP_NOTICE_LOCAL_KEY_PREFIX}${String(userId || "")}`;
}
function appNoticeSeenLocally(userId, noticeVersion = APP_UPDATE_NOTICE.id) {
  if (!userId || !noticeVersion) return false;
  try { return localStorage.getItem(appNoticeStorageKey(userId)) === noticeVersion; } catch (_) { return false; }
}
function rememberAppNoticeLocally(userId, noticeVersion = APP_UPDATE_NOTICE.id) {
  if (!userId || !noticeVersion) return false;
  try {
    localStorage.setItem(appNoticeStorageKey(userId), noticeVersion);
    return true;
  } catch (_) {
    return false;
  }
}
function isProductionSiteRuntime() {
  try { return window.location.origin === new URL(PUBLIC_SITE_URL).origin; } catch (_) { return false; }
}
function isNativeAppRuntime() {
  return Boolean(
    window.QuickFlexNative
    && typeof window.QuickFlexNative.postMessage === "function"
  );
}
function mayShowAppUpdateNotice(context = captureAccountContext()) {
  return isAccountContextCurrent(context)
    && state.profile?.id === context.userId
    && state.profile?.status === "approved";
}
function showAppUpdateNotice() {
  if (!mayShowAppUpdateNotice()) return false;
  if (!el.updateNoticeOverlay || !el.updateNoticeItems) return false;
  el.updateNoticeItems.innerHTML = APP_UPDATE_NOTICE.items
    .map((item) => `<li>${escapeAttr(item)}</li>`)
    .join("");
  el.updateNoticeOverlay.classList.add("visible");
  updateModalLayer(el.updateNoticeOverlay, true, el.openMeasurementNotice || el.updateNoticeDialog);
  return true;
}
function closeAppUpdateNotice() {
  el.updateNoticeOverlay?.classList.remove("visible");
  updateModalLayer(el.updateNoticeOverlay, false);
}
async function persistAppNoticeAudit(noticeVersion, context) {
  if (!isProductionSiteRuntime() || !state.db || !isAccountContextCurrent(context)) return false;
  try {
    const { data, error } = await state.db
      .from(TABLES.profiles)
      .update({ app_notice_version: noticeVersion, updated_at: new Date().toISOString() })
      .eq("id", context.userId)
      .select("*")
      .single();
    if (error || !isAccountContextCurrent(context)) return false;
    state.profile = data;
    return true;
  } catch (_) {
    return false;
  }
}
function acknowledgeAppUpdateNotice() {
  const context = captureAccountContext();
  if (!mayShowAppUpdateNotice(context)) { closeAppUpdateNotice(); return false; }
  const noticeVersion = APP_UPDATE_NOTICE.id;
  rememberAppNoticeLocally(context.userId, noticeVersion);
  closeAppUpdateNotice();
  void persistAppNoticeAudit(noticeVersion, context);
  return true;
}
function openMeasurementFromNotice() {
  if (!mayShowAppUpdateNotice()) return false;
  if (!acknowledgeAppUpdateNotice()) return false;
  showView("measurement");
  window.requestAnimationFrame(() => {
    if (el.app.dataset.view === "measurement" && !activeModalLayer()) el.openPaceApp?.focus();
  });
  return true;
}
async function maybeOfferRateUpdate(context = captureAccountContext()) {
  if (!mayShowAppUpdateNotice(context)) return false;
  const noticeVersion = APP_UPDATE_NOTICE.id;
  if (appNoticeSeenLocally(context.userId, noticeVersion) || state.rateOfferPrompted) return false;
  state.rateOfferPrompted = true;
  return showAppUpdateNotice();
}
function salesDayEditableValues(row) {
  return {
    fresh_count: row.fresh_count ?? 0, fresh_unit: row.fresh_unit ?? 100,
    fresh_solo_count: row.fresh_solo_count ?? 0, fresh_linked_count: row.fresh_linked_count ?? 0,
    backup_unit: row.backup_unit ?? DEFAULT_BACKUP_UNIT,
    freshbag_mode: row.freshbag_mode || "single", driver_type: row.driver_type || "backup",
  };
}
async function persistDay(dateKey, context = captureAccountContext()) {
  if (!state.db || !isAccountContextCurrent(context)) return false;
  const userId = context.userId;
  const rec = normalizeRecordShape(getRecord(dateKey, false));
  const hasAutomatic = hasAutomaticEntries(rec);
  const editableRec = normalizeRecordShape({
    ...rec,
    automaticWorks: [],
    off: hasAutomatic ? false : rec.off,
    rows: hasAutomatic ? [] : manualRows(rec),
  });
  const deleteManualDay = !hasMeaningfulRecord(editableRec) && !hasAutomatic;
  const dayPayload = {
    user_id: userId,
    work_date: dateKey,
    is_off: editableRec.off,
    fresh_count: editableRec.off ? 0 : toNum(editableRec.freshCount),
    fresh_unit: toNum(defaultFreshUnit(editableRec.freshUnit)),
    fresh_solo_count: editableRec.off ? 0 : toNum(editableRec.freshSoloCount),
    fresh_linked_count: editableRec.off ? 0 : toNum(editableRec.freshLinkedCount),
    freshbag_mode: freshbagModeForRecord(editableRec),
    backup_unit: editableRec.driverType === "backup" ? toNum(defaultBackupUnit(editableRec.backupUnit)) : 0,
    driver_type: editableRec.driverType === "fixed" ? "fixed" : "backup",
    updated_at: new Date().toISOString(),
  };
  const itemPayload = editableRec.off ? [] : editableRec.rows
    .filter((row) => row.route)
    .map((row, index) => ({
      user_id: userId,
      work_date: dateKey,
      route: joinStoredRoutes(row.route),
      delivery_count: toNum(row.count),
      household_count: toNum(row.households),
      unit_snapshot: effectiveUnit(row),
      sort_order: index,
      updated_at: new Date().toISOString(),
    }));

  if (!hasAutomatic) {
    const rpcItems = itemPayload.map(({ route, delivery_count, household_count, unit_snapshot, sort_order }) => ({
      route,
      delivery_count,
      household_count,
      unit_snapshot,
      sort_order,
    }));
    const { data: savedManualDay, error: replaceError } = await state.db.rpc(RPC.replaceManualDayRecordChecked, {
      p_expected_updated_at: rec.manualDayUpdatedAt || null,
      p_work_date: dateKey,
      p_delete_day: deleteManualDay,
      p_is_off: dayPayload.is_off,
      p_fresh_count: dayPayload.fresh_count,
      p_fresh_unit: dayPayload.fresh_unit,
      p_fresh_solo_count: dayPayload.fresh_solo_count,
      p_fresh_linked_count: dayPayload.fresh_linked_count,
      p_freshbag_mode: dayPayload.freshbag_mode,
      p_backup_unit: dayPayload.backup_unit,
      p_driver_type: dayPayload.driver_type,
      p_items: rpcItems,
    });
    if (!isAccountContextCurrent(context)) return false;
    if (replaceError) throw replaceError;
    if (deleteManualDay) {
      const current = state.entries[dateKey];
      // The server deleted the requested snapshot, not edits made while awaiting it.
      if (current && JSON.stringify(normalizeRecordShape(current)) !== JSON.stringify(rec)) {
        current.manualDayUpdatedAt = null;
      } else {
        delete state.entries[dateKey];
      }
      if (state.recordDraftDate === dateKey && state.recordDraft) state.recordDraft.manualDayUpdatedAt = null;
    }
    else {
      const saved = Array.isArray(savedManualDay) ? savedManualDay[0] : savedManualDay;
      if (!saved || saved.user_id !== userId || saved.work_date !== dateKey || !saved.updated_at) {
        throw new Error("저장 결과를 확인하지 못했습니다. 입력을 보관하고 있습니다.");
      }
      getRecord(dateKey, false).manualDayUpdatedAt = saved.updated_at;
      if (state.recordDraftDate === dateKey && state.recordDraft) state.recordDraft.manualDayUpdatedAt = saved.updated_at;
    }
    if (state.workDateDataLoaded) {
      if (!deleteManualDay && itemPayload.some((item) => splitStoredRoutes(item.route).length)) state.workDateScheduleDates.add(dateKey);
      else state.workDateScheduleDates.delete(dateKey);
      if (dateKey === koreanDateKey()) {
        renderMonth();
        renderMeasurementBridge();
      }
    }
    return true;
  }

  if (!rec.salesDayBasis) throw new Error("날짜 기록을 새로고침한 뒤 다시 저장해 주세요.");
  const { data: savedDay, error: dayError } = await state.db.rpc(RPC.updateSalesDay, {
    p_work_date: dateKey,
    p_expected_revision: rec.salesDayRevision,
    p_expected: rec.salesDayBasis,
    p_values: salesDayEditableValues(dayPayload),
  });
  if (!isAccountContextCurrent(context)) return false;
  if (dayError) throw dayError;
  if (!savedDay || savedDay.work_date !== dateKey || savedDay.user_id !== userId) {
    throw new Error("저장된 날짜 기록을 확인하지 못했습니다.");
  }
  const targets = new Set([getRecord(dateKey, false)]);
  if (state.recordDraftDate === dateKey && state.recordDraft) targets.add(state.recordDraft);
  for (const current of targets) {
    // Keep both the visible draft and persisted record on the same saved basis.
    // Any edit made during the request remains an unsaved delta, not overwritten.
    current.freshCount = Math.max(0, savedDay.fresh_count + toNum(current.freshCount) - dayPayload.fresh_count);
    current.salesDayBasis = salesDayEditableValues(savedDay);
    current.salesDayRevision = savedDay.sales_edit_revision;
  }
  return isAccountContextCurrent(context);
}
function scheduleSave({ dateKeys = [], rates = false, immediate = false } = {}) {
  dateKeys.forEach((key) => state.pendingDates.add(key));
  if (rates) state.pendingRates = true;
  if (!state.db || !currentUserId()) return;
  setSaveFeedback("pending");
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(() => {
    state.saveTimer = null;
    flushSaves().catch((error) => {
      if (error?.quickflexHandled || error?.quickflexReported) return;
      error.quickflexReported = true;
      toast(`DB 저장 실패: ${error.message}`, "error");
    });
  }, immediate ? 0 : 450);
}
function asSaveError(error, dateKey = "") {
  const next = error instanceof Error ? error : new Error(String(error?.message || error || "저장 실패"));
  if (error && typeof error === "object") {
    for (const key of ["code", "details", "hint"]) {
      if (error[key] != null && next[key] == null) next[key] = error[key];
    }
  }
  if (dateKey) next.quickflexDateKey = dateKey;
  return next;
}
function isAutomaticLedgerLockError(error) {
  return String(error?.code || "") === "55000";
}
function staleAccountSaveError() {
  const error = new Error("로그인 계정이 바뀌어 이전 계정의 저장을 중단했습니다.");
  error.quickflexStaleAccount = true;
  error.quickflexHandled = true;
  return error;
}
async function recoverAutomaticLedgerLock(error) {
  // Keep the conflicting date too: a fresh automatic receipt must not silently
  // discard the manual quantities the driver is trying to save.
  error.quickflexHandled = true;
  error.quickflexReported = true;
  state.saveConflict = true;
  state.saveConflictDate = error.quickflexDateKey || "";
  setSaveFeedback("conflict");
  toast("서버 기록이 변경되었습니다. 현재 입력을 보관했습니다. 저장 상태에서 충돌을 확인해 주세요.", "error");
}
async function flushSaves() {
  if (!state.db || !currentUserId()) return;
  if (state.saveConflict) throw new Error("서버 기록과 보관된 입력을 먼저 비교해 주세요.");
  if (state.flushPromise) {
    await state.flushPromise;
    if (state.pendingRates || state.pendingDates.size) return flushSaves();
    return;
  }
  if (!state.pendingRates && !state.pendingDates.size) return;
  const flushContext = captureAccountContext();
  setSaveFeedback("saving");
  const currentFlush = (async () => {
    try {
      while (state.pendingRates || state.pendingDates.size) {
        if (!isAccountContextCurrent(flushContext)) throw staleAccountSaveError();
        if (state.pendingRates) {
          state.pendingRates = false;
          try {
            if (!await persistRates(flushContext)) throw staleAccountSaveError();
          } catch (error) {
            if (isAccountContextCurrent(flushContext)) state.pendingRates = true;
            throw asSaveError(error);
          }
        }
        const dates = [...state.pendingDates];
        dates.forEach((dateKey) => state.pendingDates.delete(dateKey));
        for (let index = 0; index < dates.length; index += 1) {
          const dateKey = dates[index];
          try {
            if (!await persistDay(dateKey, flushContext)) throw staleAccountSaveError();
          } catch (error) {
            if (isAccountContextCurrent(flushContext)) {
              dates.slice(index).forEach((dirtyDate) => state.pendingDates.add(dirtyDate));
            }
            throw asSaveError(error, dateKey);
          }
        }
      }
      if (!isAccountContextCurrent(flushContext)) throw staleAccountSaveError();
      setDbBadge(true, `${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 저장됨`);
      setSaveFeedback("saved");
      return true;
    } catch (error) {
      if (error?.quickflexStaleAccount) return false;
      console.error("[DB save]", error);
      setSaveFeedback("failed");
      if (isAutomaticLedgerLockError(error) || String(error?.code || "") === "40001") await recoverAutomaticLedgerLock(error);
      throw error;
    }
  })();
  state.flushPromise = currentFlush;
  try {
    return await currentFlush;
  } finally {
    if (state.flushPromise === currentFlush) state.flushPromise = null;
  }
}
async function ensurePendingSavesFlushed() {
  clearTimeout(state.saveTimer);
  state.saveTimer = null;
  if (workPreferencesSaveTask) await workPreferencesSaveTask.promise;
  await flushSaves();
}

function inspectionResultsFromRecord(record) {
  const results = record?.results && typeof record.results === "object" ? record.results : {};
  return Object.fromEntries(INSPECTION_ITEMS.map((_, index) => [`item_${index + 1}`, results[`item_${index + 1}`] || ""]));
}
function inspectionDraftFromRecord(record) {
  return {
    results: inspectionResultsFromRecord(record),
    defectNotes: record?.defect_notes || "",
    actionNotes: record?.action_notes || "",
  };
}
function inspectionSignatureForRecord(record) {
  if (isValidSignatureData(record?.signature_data)) return record.signature_data;
  if (record) return "";
  return isValidSignatureData(state.inspectionSignature) ? state.inspectionSignature : "";
}
function inspectionSignatureForSave(record) {
  const stored = inspectionSignatureForRecord(record);
  if (stored || !record) return stored;
  if (!isValidSignatureData(state.inspectionSignature)) return "";
  if (!window.confirm("이 과거 기록에는 저장된 서명이 없습니다. 현재 등록된 서명과 오늘 시각으로 새로 서명해 저장할까요?")) {
    throw new Error("재서명을 취소했습니다. 기존 기록을 유지합니다.");
  }
  return state.inspectionSignature;
}
// The pre-driving inspection belongs to the Korean date driving starts. A night driver
// looking at tonight's work (tomorrow's closing date) therefore inspects today.
function inspectionDateForSelection(selectedDate = state.selectedDate, now = new Date()) {
  const today = koreanDateKey(now);
  if (isNightShift() && selectedDate > today && selectedDate === currentWorkDates(now).nextWorkDate) return today;
  return selectedDate;
}
function renderInspectionEntry() {
  const dateKey = inspectionDateForSelection();
  const available = dateKey >= "2026-06-30" && dateKey <= koreanDateKey();
  const record = available ? state.inspections[dateKey] : null;
  const complete = Boolean(record);
  el.inspectionEntryCard.classList.toggle("complete", complete);
  el.inspectionEntryEyebrow.textContent = complete ? "점검 완료" : "일상점검";
  el.inspectionEntryTitle.textContent = complete
    ? (record.status === "no_operation" ? "선택한 날짜는 미운행으로 기록했습니다" : "선택한 날짜의 차량 점검을 완료했습니다")
    : available ? "선택한 날짜의 차량 상태를 확인해주세요" : "오늘 이전 날짜만 점검할 수 있습니다";
  el.inspectionEntryStatus.textContent = complete
    ? `${record.signed_name || driverName()} · ${new Date(record.signed_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`
    : available ? "아직 점검하지 않았습니다" : "작성할 수 없는 날짜입니다";
  el.openInspection.disabled = !available;
  el.openInspection.textContent = !available ? "점검 불가" : complete ? "점검 완료" : "일상점검";
  const [, month, day] = dateKey.split("-");
  el.openInspection.setAttribute("aria-label", `${Number(month)}/${Number(day)} 운행 전 일상점검 · ${el.openInspection.textContent}`);
}
function renderInspection(dateKey = todayKey(), options = {}) {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : todayKey();
  const record = state.inspections[safeDate] || null;
  state.inspectionDate = safeDate;
  if (!options.preserveDraft) state.inspectionDraft = inspectionDraftFromRecord(record);
  el.inspectionDate.min = "2026-06-30";
  el.inspectionDate.max = todayKey();
  el.inspectionDate.value = safeDate;
  el.inspectionDriverName.textContent = state.profile?.business_name
    ? `${state.profile.business_name} · ${driverName()}`
    : driverName();
  el.inspectionVehicleNumber.textContent = state.profile?.vehicle_number || "차량번호 미설정";
  const legacy = record?.source === "legacy_paper";
  el.inspectionLegacyBadge.classList.toggle("hidden", !legacy);
  const grouped = new Map();
  INSPECTION_ITEMS.forEach(([group, label], index) => {
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push({ key: `item_${index + 1}`, number: index + 1, label });
  });
  el.inspectionChecklist.innerHTML = [...grouped.entries()].map(([group, items], groupIndex) => `
    <section class="inspection-group">
      <h2 class="inspection-group-title" id="inspectionGroup${groupIndex + 1}">${group}</h2>
      ${items.map((item) => {
        const value = state.inspectionDraft.results[item.key] || "";
        return `<div class="inspection-row" role="group" aria-labelledby="inspectionItem${item.number}"><p id="inspectionItem${item.number}">${item.number}. ${escapeAttr(item.label)}</p>
          <button type="button" class="inspection-choice${value === "good" ? " active" : ""}" data-inspection-item="${item.key}" data-result="good" aria-label="${item.number}번 양호" aria-pressed="${value === "good"}">○</button>
          <button type="button" class="inspection-choice${value === "bad" ? " active" : ""}" data-inspection-item="${item.key}" data-result="bad" aria-label="${item.number}번 이상" aria-pressed="${value === "bad"}">×</button>
        </div>`;
      }).join("")}
    </section>`).join("");
  const hasBad = Object.values(state.inspectionDraft.results).includes("bad");
  el.inspectionDefectFields.classList.toggle("hidden", !hasBad);
  el.inspectionDefectFields.hidden = !hasBad;
  el.inspectionDefectNotes.value = state.inspectionDraft.defectNotes;
  el.inspectionActionNotes.value = state.inspectionDraft.actionNotes;
  const signatureData = inspectionSignatureForRecord(record);
  el.inspectionSignaturePreview.classList.toggle("hidden", !signatureData);
  if (signatureData) {
    el.inspectionSignaturePreview.src = signatureData;
    el.inspectionSignaturePreview.alt = `${driverName()} 점검자 서명`;
  }
  else el.inspectionSignaturePreview.removeAttribute("src");
  el.inspectionSignatureStatus.textContent = signatureData
    ? (record?.signature_data ? "이 기록에 저장된 서명입니다." : "등록된 서명이 저장 시 함께 들어갑니다.")
    : "설정에서 서명을 등록해 주세요.";
  el.openSignatureSettings.textContent = signatureData ? "서명 변경" : "서명 등록";
  el.inspectionConfirmed.checked = Boolean(record);
  el.inspectionChecklist.querySelectorAll("button").forEach((button) => { button.disabled = false; });
  [el.inspectionAllGood, el.inspectionReset, el.inspectionConfirmed, el.saveInspection, el.markNoOperation].forEach((node) => { node.disabled = false; });
  el.inspectionDefectNotes.disabled = false;
  el.inspectionActionNotes.disabled = false;
  el.saveInspection.textContent = record ? "일상점검 수정 저장" : "일상점검 저장";
}
function openInspection() {
  const dateKey = inspectionDateForSelection();
  if (dateKey < "2026-06-30" || dateKey > koreanDateKey()) {
    toast("오늘 이전의 점검 대상 날짜를 선택해 주세요.", "error");
    return;
  }
  renderInspection(dateKey);
  showView("inspection");
}
function setAllInspectionResults(result) {
  state.inspectionDraft.results = Object.fromEntries(INSPECTION_ITEMS.map((_, index) => [`item_${index + 1}`, result]));
  state.inspectionDraft.defectNotes = el.inspectionDefectNotes.value;
  state.inspectionDraft.actionNotes = el.inspectionActionNotes.value;
  renderInspection(state.inspectionDate, { preserveDraft: true });
}
function resetInspectionDraft() {
  state.inspectionDraft = inspectionDraftFromRecord(null);
  renderInspection(state.inspectionDate, { preserveDraft: true });
}
async function saveInspection() {
  const context = captureAccountContext();
  if (!isAccountContextCurrent(context)) return false;
  const dateKey = state.inspectionDate;
  if (dateKey < "2026-06-30" || dateKey > todayKey()) throw new Error("점검일을 확인해 주세요.");
  const results = state.inspectionDraft.results;
  if (INSPECTION_ITEMS.some((_, index) => !["good", "bad"].includes(results[`item_${index + 1}`]))) {
    throw new Error("11개 항목을 모두 점검해 주세요.");
  }
  if (!el.inspectionConfirmed.checked) throw new Error("본인 점검 확인에 체크해 주세요.");
  const hasBad = Object.values(results).includes("bad");
  const defectNotes = el.inspectionDefectNotes.value.trim();
  const actionNotes = el.inspectionActionNotes.value.trim();
  if (hasBad && (!defectNotes || !actionNotes)) throw new Error("이상 내용과 조치 내용을 모두 적어 주세요.");
  const signatureData = inspectionSignatureForSave(state.inspections[dateKey]);
  if (!signatureData) throw new Error("설정에서 점검자 서명을 먼저 등록해 주세요.");
  const payload = {
    user_id: context.userId,
    inspection_date: dateKey,
    status: "completed",
    results,
    defect_notes: defectNotes,
    action_notes: actionNotes,
    signed_name: isValidSignatureData(state.inspections[dateKey]?.signature_data) ? state.inspections[dateKey].signed_name : driverName(),
    signed_at: isValidSignatureData(state.inspections[dateKey]?.signature_data) ? state.inspections[dateKey].signed_at : new Date().toISOString(),
    signature_data: signatureData,
    source: "app",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await state.db.from(TABLES.inspections).upsert(payload, { onConflict: "user_id,inspection_date" }).select("*").single();
  if (!isAccountContextCurrent(context)) return false;
  if (error) throw error;
  state.inspections[dateKey] = data;
  state.selectedDate = dateKey;
  renderInspectionEntry();
  renderMonth();
  renderHomeSelection();
  showView("home");
  toast("일상점검을 저장했습니다.", "success");
  return true;
}
async function setInspectionNoOperation() {
  const context = captureAccountContext();
  if (!isAccountContextCurrent(context)) return false;
  const signatureData = inspectionSignatureForSave(state.inspections[state.inspectionDate]);
  if (!signatureData) throw new Error("설정에서 점검자 서명을 먼저 등록해 주세요.");
  if (!window.confirm(`${formatLong(state.inspectionDate)}을 미운행으로 기록할까요?`)) return;
  const payload = {
    user_id: context.userId,
    inspection_date: state.inspectionDate,
    status: "no_operation",
    results: Object.fromEntries(INSPECTION_ITEMS.map((_, index) => [`item_${index + 1}`, "no_operation"])),
    defect_notes: "",
    action_notes: "",
    signed_name: isValidSignatureData(state.inspections[state.inspectionDate]?.signature_data) ? state.inspections[state.inspectionDate].signed_name : driverName(),
    signed_at: isValidSignatureData(state.inspections[state.inspectionDate]?.signature_data) ? state.inspections[state.inspectionDate].signed_at : new Date().toISOString(),
    signature_data: signatureData,
    source: "app",
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await state.db.from(TABLES.inspections).upsert(payload, { onConflict: "user_id,inspection_date" }).select("*").single();
  if (!isAccountContextCurrent(context)) return false;
  if (error) throw error;
  state.inspections[state.inspectionDate] = data;
  state.selectedDate = state.inspectionDate;
  renderInspectionEntry();
  renderMonth();
  renderHomeSelection();
  showView("home");
  toast("미운행으로 저장했습니다.", "success");
  return true;
}
function buildInspectionMonthSheet() {
  const [year, month] = state.inspectionDate.split("-").map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  const days = Array.from({ length: lastDay }, (_, index) => index + 1);
  document.querySelector(".inspection-print-sheet")?.remove();
  const sheet = document.createElement("section");
  sheet.className = "inspection-print-sheet";
  const statusMark = (day, itemKey) => {
    const row = state.inspections[`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`];
    const value = row?.results?.[itemKey];
    return value === "good" ? "○" : value === "bad" ? "×" : value === "no_operation" ? "미" : "";
  };
  sheet.innerHTML = `<h1>운수종사자 일상점검표</h1>
    <div class="inspection-print-meta">
      <span>점검월: ${year}년 ${month}월</span>
      <span>상호: ${escapeAttr(state.profile?.business_name || "")}</span>
      <span>차량번호: ${escapeAttr(state.profile?.vehicle_number || "")}</span>
      <span>운수종사자: ${escapeAttr(driverName())}</span>
    </div>
    <table class="inspection-print-table"><thead><tr><th>구분</th><th>점검항목</th>${days.map((day) => `<th>${day}</th>`).join("")}</tr></thead><tbody>
      ${INSPECTION_ITEMS.map(([group, label], index) => `<tr><td>${escapeAttr(group)}</td><td>${index + 1}. ${escapeAttr(label)}</td>${days.map((day) => `<td>${statusMark(day, `item_${index + 1}`)}</td>`).join("")}</tr>`).join("")}
      <tr><td colspan="2">점검자 확인(서명)</td>${days.map((day) => {
        const row = state.inspections[`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`];
        const signatureData = inspectionSignatureForRecord(row);
        return `<td class="inspection-print-signature">${row && signatureData ? `<img src="${signatureData}" alt="" />` : ""}</td>`;
      }).join("")}</tr>
      <tr><td colspan="2">결함 및 조치사항</td><td colspan="${lastDay}">${days.map((day) => {
        const row = state.inspections[`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`];
        return row?.defect_notes ? `${day}일 ${escapeAttr(row.defect_notes)} / ${escapeAttr(row.action_notes)}` : "";
      }).filter(Boolean).join(" · ")}</td></tr>
    </tbody></table><p class="inspection-print-legend">표시: 양호 ○ · 불량 × · 미운행 미</p>`;
  return { sheet, year, month };
}
function waitForInspectionSheetImages(sheet) {
  return Promise.all([...sheet.querySelectorAll("img")].map((image) => {
    if (image.complete) return Promise.resolve();
    return new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
  }));
}
async function printInspectionMonth() {
  const { sheet } = buildInspectionMonthSheet();
  document.body.appendChild(sheet);
  await waitForInspectionSheetImages(sheet);
  window.print();
  setTimeout(() => sheet.remove(), 1000);
}
async function saveInspectionMonthPdf() {
  if (typeof window.html2canvas !== "function" || !window.jspdf?.jsPDF) {
    throw new Error("PDF 기능을 불러오지 못했습니다. 인터넷 연결 후 다시 시도해 주세요.");
  }
  const { sheet, year, month } = buildInspectionMonthSheet();
  const button = el.saveInspectionMonthPdf;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "저장 중";
  sheet.classList.add("pdf-capture");
  document.body.appendChild(sheet);
  try {
    await waitForInspectionSheetImages(sheet);
    if (document.fonts?.ready) await document.fonts.ready;
    const canvas = await window.html2canvas(sheet, {
      scale: 2,
      backgroundColor: "#ffffff",
      logging: false,
      useCORS: true,
    });
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 6;
    const availableWidth = pageWidth - margin * 2;
    const availableHeight = pageHeight - margin * 2;
    const ratio = Math.min(availableWidth / canvas.width, availableHeight / canvas.height);
    const imageWidth = canvas.width * ratio;
    const imageHeight = canvas.height * ratio;
    const imageX = (pageWidth - imageWidth) / 2;
    const imageY = margin;
    pdf.addImage(canvas.toDataURL("image/jpeg", 0.95), "JPEG", imageX, imageY, imageWidth, imageHeight, undefined, "FAST");
    pdf.save(`일상점검표_${year}-${String(month).padStart(2, "0")}.pdf`);
    toast("월간 일상점검표 PDF를 저장했습니다.", "success");
  } finally {
    sheet.remove();
    button.disabled = false;
    button.textContent = originalText;
  }
}

function tabForView(view = el.app?.dataset.view || "home") {
  if (view === "expenses") return "home";
  if (["settings", "schedule"].includes(view)) return "";
  return view;
}

function syncNavSelection(view = el.app?.dataset.view || "home") {
  const target = tabForView(view);
  el.navTabs.forEach((tab) => {
    const selected = tab.dataset.view === target;
    tab.classList.toggle("active", selected);
    if (selected) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
}

function showView(view, options = {}) {
  if (view === "admin") view = "settings";
  if (!["home", "record", "measurement", "inspection", "stats", "settings", "expenses", "schedule", "routes", "noah"].includes(view)) view = "home";
  const previousView = el.app.dataset.view || "home";
  if (previousView === "routes" && view === "routes" && routeNotesController?.canClose && !routeNotesController.canClose()) return;
  if (previousView === "routes" && view !== "routes") {
    if (routeNotesController?.canClose && !routeNotesController.canClose()) return;
    routeNotesController?.close();
  }
  if (previousView === "record" && view !== "record" && state.recordDraft) {
    if (!confirmLeaveRecordDraft()) return;
    discardRecordDraft();
  }
  if (previousView === "expenses" && view !== "expenses") invalidateSummaryLedger();
  el.app.dataset.view = view;
  syncNativeRouteNotesState();
  if (typeof syncNavSelection === "function") syncNavSelection(view);
  if (view === "record") renderEntryForm();
  if (view === "measurement") {
    currentMeasurementWorkDate();
    renderMeasurementBridge();
    refreshMeasurementAppAvailability();
  }
  if (view === "inspection") renderInspection(state.inspectionDate);
  if (view === "stats") {
    if (state.statsRangeMode !== "custom") syncStatsToCurrentPeriod();
    renderStats();
  }
  if (view === "expenses") ensureExpenseController().refresh();
  if (view === "routes") void ensureRouteNotesController().open(options);
  if (view === "noah") void noahController?.open();
  if (view === "settings") {
    renderRates();
  }
  if (view !== previousView) queueUsageEvent("screen_viewed", { screen: view });
}

function nativeBackAction({ dbSheetOpen = false, salesOverrideOpen = false, blockingModalOpen = false, measurementGuideOpen = false, view = "home" } = {}) {
  if (dbSheetOpen) return "close-db-sheet";
  if (salesOverrideOpen) return "close-sales-override";
  if (blockingModalOpen) return "unhandled";
  if (measurementGuideOpen) return "close-measurement-guide";
  if (view === "record") return "leave-record";
  if (view === "schedule") return "go-settings";
  if (["inspection", "measurement", "expenses", "settings", "routes", "stats", "noah"].includes(view)) return "go-home";
  return "unhandled";
}

function quickflexHandleNativeBack() {
  if (routeNoteShareDialog?.handleBack?.()) return "handled";
  if (document.querySelector(".expense-dialog[open]")) { expensesController?.handleBack(); return "handled"; }
  if (document.querySelector(".exports-overlay:not([hidden])")) { exportsController?.close(); return "handled"; }
  const action = nativeBackAction({
    dbSheetOpen: Boolean(el.dbSheet?.classList.contains("open")),
    salesOverrideOpen: Boolean(el.salesOverrideOverlay?.classList.contains("visible")),
    blockingModalOpen: [el.setupOverlay, el.authOverlay, el.pendingOverlay]
      .some((layer) => Boolean(layer && modalLayerIsOpen(layer))),
    measurementGuideOpen: Boolean(el.measurementGuideOverlay?.classList.contains("visible")),
    view: el.app?.dataset.view || "home",
  });
  if (action === "close-db-sheet") {
    closeSheet();
    return "handled";
  }
  if (action === "close-sales-override") {
    closeSalesOverride();
    return "handled";
  }
  if (action === "close-measurement-guide") {
    closeMeasurementGuide();
    return "handled";
  }
  if (action === "leave-record") {
    if (typeof el.backToCalendar?.click === "function") el.backToCalendar.click();
    else {
      discardRecordDraft();
      renderAll();
      showView("home");
    }
    return "handled";
  }
  if (action === "go-settings") {
    showView("settings");
    return "handled";
  }
  if (action === "go-home") {
    if (el.app?.dataset.view === "routes" && routeNotesController?.handleBack?.()) return "handled";
    showView("home");
    return "handled";
  }
  return "unhandled";
}

window.quickflexHandleNativeBack = quickflexHandleNativeBack;

function currentWorkDates(now = new Date()) {
  const today = koreanDateKey(now);
  const record = getRecord(today, false);
  const lease = state.activeMeasurementLease;
  const activeWorkDate = lease?.user_id === state.session?.user?.id && !lease?.released_at
    && Date.parse(lease?.lease_expires_at) > now.getTime() ? lease.work_date : undefined;
  const dayState = state.workDateDataLoaded ? {
    isOff: Boolean(record.off),
    hasRecord: Boolean(state.entries[today]),
    hasSchedule: state.workDateScheduleDates.has(today),
    hasAutomaticCompletion: hasAutomaticEntries(record),
    activeWorkDate,
  } : { activeWorkDate };
  return resolveWorkDates({ now, workShift: isNightShift() ? "night" : "day", dayState });
}
function defaultMeasurementWorkDate(now = new Date()) {
  return currentWorkDates(now).activeWorkDate;
}
function currentMeasurementWorkDate(now = new Date()) {
  if (!state.measurementDate || state.measurementDateAuto) {
    state.measurementDate = defaultMeasurementWorkDate(now);
    state.measurementDateAuto = true;
  }
  return state.measurementDate;
}
function renderMeasurementBridge() {
  if (!el.measurementWorkDate) return;
  const workDate = currentMeasurementWorkDate();
  el.measurementWorkDate.value = workDate;
  const record = getRecord(workDate, false);
  // Rows can repeat a route after separate manual/automatic entries; keep the bridge display
  // truthful without changing the underlying sales rows or their quantities.
  const routes = record.off ? [] : routeListFromText(record.rows.flatMap((row) => splitStoredRoutes(row.route)));
  el.measurementRouteText.textContent = record.off ? "휴무" : routes.length ? routes.join(" · ") : "등록된 구역 없음";
  // 구역이 없을 땐 강조 숫자처럼 보이지 않게 본문 제목 크기로 낮춘다.
  el.measurementRouteText.toggleAttribute?.("data-empty", !routes.length);
  const households = record.rows.reduce((sum, row) => sum + toNum(row.households), 0);
  const automatic = hasAutomaticEntries(record);
  const measurementMonthDay = `${Number(workDate.slice(5, 7))}/${Number(workDate.slice(8, 10))}`;
  if (el.measurementScheduleMeta) {
    el.measurementScheduleMeta.textContent = record.off
      ? `${measurementMonthDay}${eunNeunParticle(workDate.slice(8, 10))} 휴무예요`
      : `${measurementMonthDay} 업무로 시작`;
  }
  el.measurementRouteHint.textContent = record.off
    ? "휴무로 표시된 날짜예요. 위 근무표 날짜에서 다른 날짜를 선택해 주세요."
    : automatic
      ? `완료 ${households}가구 · 반영된 매출은 기록 화면에서 수정할 수 있습니다.`
      : households > 0
        ? `기존 수동 가구수 ${households}가구 · 측정 종료는 페이스 구간만 저장합니다.`
        : isNightShift()
          ? "야간은 이 날짜의 근무표를 사용하며, 매출은 업무 종료 때 반영합니다."
          : "주간은 선택한 날짜의 근무표를 사용하며, 매출은 업무 종료 때 반영합니다.";
  applyMeasurementLaunchControls(record.off);
}
let measurementDetectionSequence = 0;
let measurementDetectionPromise = null;
function applyMeasurementLaunchControls(isOff = Boolean(getRecord(currentMeasurementWorkDate(), false).off)) {
  const mode = el.openPaceApp?.dataset.launchMode || "checking";
  const pending = Boolean(measurementDetectionPromise) || mode === "checking";
  if (el.openPaceApp) {
    el.openPaceApp.disabled = Boolean(isOff) || pending;
    if (pending) el.openPaceApp.setAttribute("aria-busy", "true");
    else el.openPaceApp.removeAttribute("aria-busy");
  }
  if (el.openPaceAppFallback) {
    el.openPaceAppFallback.hidden = Boolean(isOff) || mode === "native" || mode === "installed"
      || !/Android/i.test(navigator.userAgent || "");
  }
}
async function refreshMeasurementAppAvailability() {
  if (measurementDetectionPromise) return measurementDetectionPromise;
  const sequence = ++measurementDetectionSequence;
  const native = typeof window.QuickFlexNative?.postMessage === "function";
  if (native) {
    setMeasurementLaunchMode("native");
    return "installed";
  }
  const request = detectMeasurementApp({ timeoutMs: 1500 });
  measurementDetectionPromise = request;
  applyMeasurementLaunchControls();
  try {
    const result = await request;
    if (sequence !== measurementDetectionSequence || el.app?.dataset.view !== "measurement") return;
    setMeasurementLaunchMode(result === "installed" ? "installed" : "download");
  } finally {
    if (measurementDetectionPromise === request) measurementDetectionPromise = null;
    applyMeasurementLaunchControls();
  }
}
function setMeasurementLaunchMode(mode) {
  el.openPaceApp.dataset.launchMode = mode;
  el.openPaceApp.textContent = mode === "native" || mode === "installed" ? "측정 앱 열기" : "측정 앱 다운로드";
  applyMeasurementLaunchControls();
  if (el.measurementAppHint) {
    el.measurementAppHint.textContent = mode === "native" || mode === "installed"
      ? "측정 앱을 열어 배송 업무를 시작하세요."
      : /Android/i.test(navigator.userAgent || "")
        ? "처음 이용하면 앱을 설치해 주세요. 이미 설치했다면 아래에서 앱 열기를 눌러 보세요."
        : "측정 앱은 Android에서 사용할 수 있습니다. 설치 안내에서 APK를 내려받아 주세요.";
  }
}
async function openPaceMeasurementApp({ forceOpen = false } = {}) {
  const requestedWorkDate = currentMeasurementWorkDate();
  if (getRecord(requestedWorkDate, false).off) return toast("휴무일은 측정을 시작할 수 없습니다.", "error");
  if (!forceOpen && el.openPaceApp.dataset.launchMode === "download") {
    window.location.href = MEASUREMENT_APP_INSTALL_URL;
    return;
  }
  const measurementContext = captureAccountContext();
  const access = await checkBetaMeasurementAccess({
    session: state.session, db: state.db, profilesTable: TABLES.profiles,
    isCurrent: () => isAccountContextCurrent(measurementContext),
  });
  if (!isAccountContextCurrent(measurementContext)) return;
  if (access !== "allowed") {
    return toast(access === "not_enrolled"
      ? "측정앱은 가입 승인이 필요합니다. 운영자에게 문의해 주세요."
      : "측정 권한을 확인하지 못했습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.", "info");
  }
  const workDate = currentMeasurementWorkDate();
  if (getRecord(workDate, false).off) return toast("휴무일은 측정을 시작할 수 없습니다.", "error");
  const shift = isNightShift() ? "night" : "day";
  if (window.QuickFlexNative?.postMessage && state.db) {
    const expectedAuthEpoch = authEventEpoch;
    const accountContext = captureAccountContext();
    const { data, error } = await state.db.auth.getSession();
    let session = data?.session || null;
    if (expectedAuthEpoch !== authEventEpoch) session = state.session;
    if (error
      || !isAccountContextCurrent(accountContext)
      || sessionUserId(session) !== accountContext.userId
      || !session?.access_token
      || !session.refresh_token) {
      return toast("로그인 상태를 확인한 뒤 다시 시도해 주세요.", "error");
    }
    if (expectedAuthEpoch === authEventEpoch) {
      applyAuthSession(session, { event: "SESSION_OBSERVED", scheduleBoot: false });
    }
    postNativeMessage({
      type: "open_measurement",
      workDate,
      workShift: shift,
      theme: document.documentElement.dataset.theme === "light" ? "light" : "dark",
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at || 0,
      sessionRevision: allocateNativeSessionRevision(),
    });
    return;
  }
  if (!forceOpen && el.openPaceApp.dataset.launchMode !== "installed") {
    window.location.href = MEASUREMENT_APP_INSTALL_URL;
    return;
  }
  if (!/Android/i.test(navigator.userAgent || "")) {
    el.measurementAppHint.textContent = "측정 앱은 Android에서 사용할 수 있습니다. 설치 안내에서 APK를 내려받아 주세요.";
    window.location.href = MEASUREMENT_APP_INSTALL_URL;
    return;
  }
  if (navigator.userActivation && !navigator.userActivation.isActive) {
    el.measurementAppHint.textContent = "앱을 열 수 있는 시간이 지났습니다. 아래 앱 열기 버튼을 다시 누르거나 설치 안내를 이용하세요.";
    window.location.href = MEASUREMENT_APP_INSTALL_URL;
    return;
  }
  el.measurementAppHint.textContent = "측정 앱을 여는 중입니다. 열리지 않으면 아래 설치 안내를 이용하세요.";
  const openUrl = measurementAppIntentUrl({ workDate, shift });
  try {
    window.location.href = openUrl;
  } catch {
    el.measurementAppHint.textContent = "측정 앱을 열지 못했습니다. 앱을 설치했는지 확인하거나 설치 안내를 이용하세요.";
    window.location.href = MEASUREMENT_APP_INSTALL_URL;
  }
}
function openMeasurementGuide() {
  if (!el.measurementGuideOverlay) return;
  el.measurementGuideOverlay.classList.add("visible");
  updateModalLayer(el.measurementGuideOverlay, true, el.closeMeasurementGuide || el.measurementGuideDialog);
}
function closeMeasurementGuide() {
  if (!el.measurementGuideOverlay) return;
  el.measurementGuideOverlay.classList.remove("visible");
  updateModalLayer(el.measurementGuideOverlay, false);
}
/** Pull-to-refresh in the Android app: reload this account's data without reopening the page. */
async function refreshForPull() {
  if (!currentUserId()) return false;
  const context = captureAccountContext();
  await ensurePendingSavesFlushed();
  if (!isAccountContextCurrent(context) || state.recordDraft) return false;
  if (!await loadFromDb(context).catch(() => false)) return false;
  renderAll();
  if (el.app.dataset.view === "measurement") {
    renderMeasurementBridge();
    refreshMeasurementAppAvailability();
  }
  return true;
}
async function refreshAfterNativeMeasurement() {
  if (!currentUserId()) return;
  const context = captureAccountContext();
  try { await ensurePendingSavesFlushed(); }
  catch { return; }
  if (!isAccountContextCurrent(context) || state.recordDraft) return;
  if (!await loadFromDb(context).catch(() => false)) return;
  renderAll();
  if (el.app.dataset.view === "measurement") renderMeasurementBridge();
}
/** 설정 목록의 각 행은 카테고리 이름이 아니라 지금 설정된 값을 말한다. */
function renderSettingsSummary() {
  const profile = state.profile || {};
  const escapeText = (value) => String(value).replace(/[&<>"]/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;",
  }[ch]));
  const code = (value) => `<code>${escapeText(value)}</code>`;
  const set = (key, html) => {
    const slot = document.querySelector(`[data-settings-value="${key}"]`);
    if (slot) slot.innerHTML = html;
  };

  const name = (profile.display_name || "").trim();
  const vehicle = (profile.vehicle_number || "").trim();
  set("profile", [name ? escapeText(name) : "이름 미입력", vehicle ? code(vehicle) : null].filter(Boolean).join(" · "));

  const shift = profile.work_shift === "night" ? "야간" : "주간";
  const routes = (profile.fixed_routes || []).join(" · ");
  set("work", `${shift} · ${routes ? code(routes) : "고정 라우트 없음"}`);

  const goal = getGoal();
  const revenue = summarizePeriod().revenue;
  const percent = goal > 0 ? Math.min(100, Math.round(revenue / goal * 100)) : null;
  const rateCount = (state.rates || []).length;
  set("settlement", [
    rateCount ? `단가 <b>${rateCount}</b>구역` : "단가 미등록",
    percent === null ? null : `목표 <span class="value-accent">${percent}</span>%`,
  ].filter(Boolean).join(" · "));

  const theme = document.documentElement.dataset.theme === "dark" ? "다크" : "라이트";
  set("display", `${theme} · 라우트 ${shouldShowCalendarRoutes() ? "표시" : "숨김"}`);
}
function renderAll() {
  applyProfileUi();
  renderSummary();
  applyGoalMeterMotion();
  renderMonth();
  renderHomeSelection();
  renderInspectionEntry();
  renderMeasurementBridge();
  renderRates();
  renderStats();
  renderSettingsSummary();

}
// 새 정산기간이 막 시작해 이번 기간에 근무 기록이 아직 없으면, 헤드라인 카드는
// 방금 끝난 정산기간의 결과를 대신 보여준다(운전자가 지금 실제로 궁금한 숫자는
// 이미 끝난 정산이 얼마인지이다). 근무 기록이 하루라도 생기면 바로 원래대로 돌아온다.
function renderSummary() {
  const { start, end } = periodBounds();
  const total = summarizePeriod();
  el.monthTitle.textContent = `${state.year}년 ${String(state.month).padStart(2, "0")}월`;
  el.periodRange.textContent = `정산기간 ${formatPeriodRangeSimple(start, end)}`;

  const prev = prevPeriod(state.year, state.month);
  const previousTotal = summarizePeriod(prev.year, prev.month);
  const showPreviousPeriod = shouldShowPreviousPeriod({
    currentWorkDays: total.workDays,
    previousWorkDays: previousTotal.workDays,
  });
  const headline = showPreviousPeriod ? previousTotal : total;
  const headlineBounds = showPreviousPeriod ? periodBounds(prev.year, prev.month) : { start, end };

  if (el.summaryPeriodBadge) {
    el.summaryPeriodBadge.textContent = showPreviousPeriod
      ? `지난 정산 · ${formatPeriodRangeSimple(headlineBounds.start, headlineBounds.end)}`
      : "이번 정산기간";
  }
  if (el.summaryPeriodNote) {
    el.summaryPeriodNote.hidden = !showPreviousPeriod;
    el.summaryPeriodNote.textContent = showPreviousPeriod
      ? `이번 정산(${formatPeriodRangeSimple(start, end)})은 첫 근무를 기록하면 시작돼요`
      : "";
  }

  // Same settlement period as last render => this is a live update of the
  // same figure (roll the digits). A different period => the number means
  // something else entirely (crossfade instead). Tracked as a plain
  // expando so this works whether `el.periodRevenue` is a real element or
  // a test double, without any module-level state.
  const headlineKey = `${headlineBounds.start.getTime()}_${headlineBounds.end.getTime()}`;
  const sameMetric = el.periodRevenue.__moKey === headlineKey;
  el.periodRevenue.__moKey = headlineKey;
  renderNumberWithUnit(el.periodRevenue, fmtWon(headline.revenue), { sameMetric });
  renderNumberWithUnit(el.periodCount, fmtCount(headline.count), { sameMetric });
  renderNumberWithUnit(el.averageCountHome, fmtCount(Math.round(headline.averageCount || 0)));
  renderNumberWithUnit(el.dailyAverage, formatCompactWonWithUnit(headline.average), { sameMetric });
  renderNumberWithUnit(el.workDaysHome, `${headline.workDays}일`, { sameMetric });
  const goal = getGoal();
  const pct = goal > 0 ? headline.revenue / goal * 100 : 0;
  const cappedPct = Math.min(100, Math.max(0, pct));
  el.meterFill.style.width = `${cappedPct}%`;
  el.meterFill.__moSameMetric = sameMetric;
  el.meterPct.textContent = `${Math.round(pct)}%`;
  const overGoal = goal > 0 && headline.revenue > goal;
  el.meterLabel.textContent = overGoal
    ? `목표 ${fmtWon(goal)} 대비 +${fmtWon(headline.revenue - goal)}`
    : `목표 ${fmtWon(goal)} 대비 진행률`;
  renderSummaryLedger(headline.revenue, headlineBounds.start, headlineBounds.end, { sameMetric });
}
// 정산 카드 아래 한 줄: 이 정산기간의 확정 지출과 남는 돈. 지출은 서버에서 한 번 읽어 기간별로 기억한다.
// start/end를 넘기지 않으면 지금 보고 있는(state.year/month) 정산기간을 쓴다 — 헤드라인이
// 지난 정산으로 대체된 상태에서는 renderSummary가 그 기간의 start/end를 명시적으로 넘긴다.
const summaryLedgerCache = { key: "", total: null, loading: "" };
function renderSummaryExpenseText(text) {
  el.summaryExpense.textContent = text;
}
function renderSummaryLedger(revenue, start = periodBounds().start, end = periodBounds().end, { sameMetric } = {}) {
  if (!el.summaryLedger) return;
  const from = toDateKey(start), to = toDateKey(end);
  const key = `${currentUserId() || ""}:${from}:${to}`;
  if (summaryLedgerCache.key === key && summaryLedgerCache.total !== null) {
    const expenseText = `지출 ${fmtWon(summaryLedgerCache.total)}`;
    if (sameMetric === undefined) {
      renderSummaryExpenseText(expenseText);
    } else {
      const changed = el.summaryExpense.__moText !== expenseText;
      el.summaryExpense.__moText = expenseText;
      if (sameMetric) motion.updateRollingNumber(el.summaryExpense, expenseText);
      else if (changed) motion.crossfade(el.summaryExpense, () => renderSummaryExpenseText(expenseText));
      else renderSummaryExpenseText(expenseText);
    }
    renderNumberWithUnit(el.summaryNet, fmtWon(revenue - summaryLedgerCache.total), { sameMetric });
    el.summaryLedger.hidden = false;
    return;
  }
  el.summaryLedger.hidden = true;
  if (summaryLedgerCache.loading === key || !currentUserId()) return;
  summaryLedgerCache.loading = key;
  (async () => {
    try {
      const rows = await ownExpenseService().list({ from, to, includeDrafts: true, includeTrashed: false });
      const total = (rows || []).filter((row) => row.status === "confirmed" && row.actual_date >= from && row.actual_date <= to)
        .reduce((sum, row) => sum + Number(row.gross_amount || 0) - (row.adjustments || []).filter((item) => item.kind === "refund").reduce((amount, item) => amount + Number(item.amount || 0), 0), 0);
      if (summaryLedgerCache.loading !== key) return;
      Object.assign(summaryLedgerCache, { key, total, loading: "" });
      renderSummary();
    } catch {
      if (summaryLedgerCache.loading === key) summaryLedgerCache.loading = "";
    }
  })();
}
function invalidateSummaryLedger() {
  Object.assign(summaryLedgerCache, { key: "", total: null, loading: "" });
}
// The goal meter fill and its "목표 달성" chip: renderSummary() already set
// el.meterFill.style.width/el.meterFill.__moSameMetric and el.meterPct's
// text synchronously (that part stays untouched for test compatibility);
// this layers the transform-scaled grow animation and the once-per-session
// crossing chip on top, called after renderSummary() from renderAll().
const goalMeterMotion = { group: motion.createAnimationGroup(), lastPct: null, reachedThisSession: false };
function applyGoalMeterMotion() {
  if (!el.meterFill) return;
  const targetPct = Math.max(0, Math.min(100, parseFloat(el.meterFill.style.width || "0") || 0));
  const rawPct = Number(String(el.meterPct?.textContent || "0").replace(/[^\d.-]/g, "")) || 0;
  const reached = rawPct >= 100;
  const sameMetric = el.meterFill.__moSameMetric;
  const firstRender = goalMeterMotion.lastPct === null;
  const animateGrowth = sameMetric === true && motion.shouldAnimate();

  if (!animateGrowth) {
    goalMeterMotion.group.cancelAll();
    el.meterFill.style.transform = "";
  } else if (goalMeterMotion.lastPct !== targetPct) {
    const from = targetPct > 0 ? goalMeterMotion.lastPct / targetPct : 1;
    el.meterFill.style.transform = `scaleX(${from})`;
    goalMeterMotion.group.run("fill", from, 1, {
      ...motion.SPRING,
      onUpdate: (v) => { el.meterFill.style.transform = `scaleX(${v})`; },
      onDone: () => { el.meterFill.style.transform = ""; },
    });
  }
  goalMeterMotion.lastPct = targetPct;

  const justCrossed = !firstRender && sameMetric === true && reached && !goalMeterMotion.reachedThisSession;
  goalMeterMotion.reachedThisSession = reached;
  if (el.goalChip) {
    if (justCrossed) {
      el.goalChip.hidden = false;
      motion.popIn(el.goalChip);
    } else if (!reached || firstRender || sameMetric === false) {
      el.goalChip.hidden = true;
    }
    // else: still reached from an earlier crossing this period — leave the chip as already shown.
  }
}
// One persistent overlay ring, moved with a spring between whichever cell is
// selected — renderMonth() rebuilds all 42-ish day cells from scratch on
// every call (unrelated to this effect), so the ring can't live inside that
// markup; it's created once and re-appended after each rebuild instead.
let daySelectionRing = null;
function getDaySelectionRing() {
  if (!daySelectionRing) {
    daySelectionRing = document.createElement("div");
    daySelectionRing.className = "day-selection-ring";
    daySelectionRing.setAttribute("aria-hidden", "true");
  }
  return daySelectionRing;
}
const daySelectionRingGroup = motion.createAnimationGroup();
let daySelectionRingPos = null; // { x, y } in #monthCalendar-relative px, once placed
function positionDaySelectionRing(cell, previousRect, animate) {
  const ring = getDaySelectionRing();
  if (!cell) {
    ring.style.opacity = "0";
    daySelectionRingGroup.cancelAll();
    daySelectionRingPos = null;
    return;
  }
  const panelRect = el.monthCalendar.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  const targetX = cellRect.left - panelRect.left;
  const targetY = cellRect.top - panelRect.top;
  ring.style.width = `${cellRect.width}px`;
  ring.style.height = `${cellRect.height}px`;
  ring.style.opacity = "1";
  if (!animate || !previousRect || !daySelectionRingPos || !motion.shouldAnimate()) {
    daySelectionRingGroup.cancelAll();
    daySelectionRingPos = { x: targetX, y: targetY };
    ring.style.transform = `translate(${targetX}px, ${targetY}px)`;
    return;
  }
  const place = () => { ring.style.transform = `translate(${daySelectionRingPos.x}px, ${daySelectionRingPos.y}px)`; };
  daySelectionRingGroup.run("x", daySelectionRingPos.x, targetX, {
    ...motion.SPRING,
    onUpdate: (x) => { daySelectionRingPos.x = x; place(); },
  });
  daySelectionRingGroup.run("y", daySelectionRingPos.y, targetY, {
    ...motion.SPRING,
    onUpdate: (y) => { daySelectionRingPos.y = y; place(); },
  });
}
// renderMonth() is run in isolation (its own text sliced out and executed in
// a fresh VM sandbox) by a regression test, with only a minimal { el, state,
// ... } fixture — no closure over this file's other functions or imports.
// So renderMonth() itself only ever touches `el`/`state` (safe there) and,
// at the very end, calls the optional el.monthCalendar.__moAfterRender()
// hook — a plain property that's simply undefined in that test's fixture
// (a no-op via `?.()`) and is wired up once, below, in the real app.
function applyCalendarRingMotion() {
  const container = el.monthCalendar;
  if (!container || typeof container.getBoundingClientRect !== "function") return;
  container.appendChild(getDaySelectionRing());
  const newSelectedCell = container.querySelector(".day-cell.selected");
  positionDaySelectionRing(newSelectedCell, container.__moPreviousSelectedRect, container.__moSameMonth);
}
if (el.monthCalendar) el.monthCalendar.__moAfterRender = applyCalendarRingMotion;

function renderMonth() {
  const todayWorkDate = isNightShift() ? currentWorkDates().nextWorkDate : "";
  el.modeBtns.forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode)));
  const { start, end } = periodBounds();
  const first = new Date(start);
  first.setDate(first.getDate() - first.getDay());
  const last = new Date(end);
  last.setDate(last.getDate() + (6 - last.getDay()));
  const cellCount = Math.max(35, Math.ceil((last - first) / 86400000) + 1);
  // The ring overlay needs a real element (getBoundingClientRect, querySelector);
  // a minimal test double for el.monthCalendar (just { appendChild }) skips it
  // entirely rather than crashing — the cell-building loop below is unaffected.
  // Everything the ring needs is stashed as plain expandos on el.monthCalendar
  // itself (never a module-level variable) so this function keeps working
  // when its source is sliced out and run alone with a bare { el, state }.
  const ringCapable = typeof el.monthCalendar.getBoundingClientRect === "function"
    && typeof el.monthCalendar.querySelector === "function";
  const previousSelectedCell = ringCapable ? el.monthCalendar.querySelector(".day-cell.selected") : null;
  el.monthCalendar.__moPreviousSelectedRect = previousSelectedCell ? previousSelectedCell.getBoundingClientRect() : null;
  const periodKey = `${state.year}-${state.month}`;
  el.monthCalendar.__moSameMonth = el.monthCalendar.__moLastPeriod === periodKey;
  el.monthCalendar.__moLastPeriod = periodKey;
  el.monthCalendar.innerHTML = "";
  for (let i = 0; i < cellCount; i += 1) {
    const date = new Date(first);
    date.setDate(first.getDate() + i);
    const dateKey = toDateKey(date);
    const record = getRecord(dateKey, false);
    const inspection = state.inspections[dateKey] || null;
    const calc = calcRecord(record);
    const inPeriod = periodKeys().includes(dateKey);
    const holidayName = koreanHoliday(dateKey);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `day-cell${inPeriod ? "" : " outside"}${dateKey === state.selectedDate ? " selected" : ""}${dateKey === todayKey() ? " today-cell" : ""}${record.off ? " off" : ""}${holidayName ? " holiday" : ""}${dateKey === todayWorkDate ? " work-date-cell" : ""}`;
    const routeText = record.off || !shouldShowCalendarRoutes() ? "" : formatRecordRoutes(record.rows);
    const displayValue = record.off ? "휴무" : state.mode === "count" ? (calc.count ? fmtCount(calc.count) : "") : formatCalendarWon(calc.revenue);
    const displayRouteOrHoliday = routeText || holidayName;
    const inspectionLabel = inspection?.status === "no_operation" ? "일상점검 미운행 기록" : inspection ? "일상점검 완료" : "";
    const valueLabel = record.off
      ? "휴무"
      : state.mode === "count"
        ? (calc.count ? `배송 ${fmtCount(calc.count)}` : "배송 기록 없음")
        : (calc.revenue ? `매출 ${fmtWon(calc.revenue)}` : "매출 기록 없음");
    const routeLabel = routeText ? `구역 ${routeText}` : "";
    const labels = [
      formatLong(dateKey),
      dateKey === todayKey() ? "오늘" : "",
      dateKey === todayWorkDate ? "오늘 업무" : "",
      dateKey === state.selectedDate ? "선택됨" : "",
      holidayName || "",
      valueLabel,
      routeLabel,
      inspectionLabel,
    ].filter(Boolean);
    cell.setAttribute("aria-label", labels.join(" · "));
    cell.setAttribute("aria-pressed", String(dateKey === state.selectedDate));
    if (dateKey === todayKey()) cell.setAttribute("aria-current", "date");
    if (holidayName) cell.title = holidayName;
    const inspectionDot = inspection && inspection.status !== "no_operation"
      ? `<span class="inspection-day-dot" aria-hidden="true"></span>`
      : "";
    cell.innerHTML = `<span class="day-number">${date.getDate()}</span>${inspectionDot}<span class="day-value">${displayValue}</span><span class="day-routes">${displayRouteOrHoliday}</span>`;
    cell.addEventListener("click", () => selectDate(dateKey));
    el.monthCalendar.appendChild(cell);
  }
  el.monthCalendar.__moAfterRender?.();
}
function hasAutomaticSalesOverride(dateKey) {
  return Object.prototype.hasOwnProperty.call(state.automaticSalesOverrides, dateKey);
}
function automaticBaseBreakdown(record) {
  const byRoute = new Map();
  (record?.rows || []).forEach((row) => {
    const routes = splitStoredRoutes(row.route);
    const share = routes.length || 1;
    routes.forEach((route) => {
      const baseRoute = normalizeBaseSalesRoute(route);
      if (!baseRoute) return;
      const current = byRoute.get(baseRoute) || { route: baseRoute, count: 0, revenue: 0 };
      current.count += toNum(row.count) / share;
      const manualBackup = !isAutomaticRow(row) && record.driverType === "backup"
        ? toNum(defaultBackupUnit(record.backupUnit)) : 0;
      current.revenue += (toNum(row.count) * (effectiveUnit(row) + manualBackup)) / share;
      byRoute.set(baseRoute, current);
    });
  });
  return byRoute;
}
function rawDetailBreakdown(details) {
  const byBase = new Map();
  const cancellationByRoute = new Map();
  let invalidCount = 0;
  (details || []).forEach((detail) => {
    const detailRoute = normalizeRoute(detail.detailRoute ?? detail.detail_route);
    const baseRoute = normalizeBaseSalesRoute(detail.baseRoute ?? detail.base_route)
      || normalizeBaseSalesRoute(detailRoute.slice(0, 4));
    const rawCount = detail.deliveryCount ?? detail.delivery_count;
    const count = rawCount == null ? null : exactLedgerInteger(rawCount);
    const cancellationCount = Number.isSafeInteger(detail.cancellationCount) && detail.cancellationCount > 0 ? detail.cancellationCount : 0;
    if (!baseRoute || !/^\d{3}[A-Z]\d{2}$/.test(detailRoute) || (count === null && !cancellationCount)) {
      invalidCount += 1;
      return;
    }
    if (!byBase.has(baseRoute)) byBase.set(baseRoute, new Map());
    const detailCounts = byBase.get(baseRoute);
    const incomplete = count === null || (detailCounts.has(detailRoute) && detailCounts.get(detailRoute) === null);
    detailCounts.set(detailRoute, incomplete ? null : (detailCounts.get(detailRoute) || 0) + count);
    if (cancellationCount) {
      cancellationByRoute.set(detailRoute, (cancellationByRoute.get(detailRoute) || 0) + cancellationCount);
    }
  });
  return { byBase, cancellationByRoute, invalidCount };
}
function formatDetailRouteCount(route, count, cancellationCount = 0) {
  const quantity = count === null ? "" : ` ${fmtCount(count)}`;
  const cancellation = cancellationCount > 0 ? `${count === null ? " " : ", "}취소 ${fmtCount(cancellationCount)}` : "";
  return `${escapeAttr(route)}${quantity}${cancellation}`;
}
function selectedDateSalesBreakdown(record, details) {
  const effective = automaticBaseBreakdown(record);
  const raw = rawDetailBreakdown(details);
  const bases = [...new Set([...effective.keys(), ...raw.byBase.keys()])].sort();
  return {
    invalidDetailRows: raw.invalidCount,
    rows: bases.map((baseRoute) => {
      const sales = effective.get(baseRoute) || { route: baseRoute, count: 0, revenue: 0 };
      const detailRows = [...(raw.byBase.get(baseRoute) || new Map()).entries()]
        .map(([route, count]) => ({ route, count, cancellationCount: raw.cancellationByRoute.get(route) || 0 }))
        .sort((a, b) => a.route.localeCompare(b.route));
      const detailCount = detailRows.some((row) => row.count === null)
        ? null : detailRows.reduce((sum, row) => sum + row.count, 0);
      return {
        route: baseRoute,
        count: Math.round(sales.count),
        revenue: Math.round(sales.revenue),
        detailRows,
        detailCount,
        difference: detailCount === null ? null : Math.round(sales.count) - detailCount,
      };
    }),
  };
}
function renderSelectedDateBreakdown(record) {
  if (!el.selectedDateBreakdown) return;
  const automatic = hasAutomaticEntries(record);
  el.selectedDateBreakdown.classList.toggle("hidden", !automatic);
  if (!automatic) return;
  const model = selectedDateSalesBreakdown(record, state.workRouteDetails[state.selectedDate]);
  const totals = calcRecordDetails(record);
  el.selectedDateBreakdownTitle.textContent = `${formatMonthDay(state.selectedDate)} 구역별 매출`;
  const routeRows = model.rows.length ? model.rows.map((row) => {
    const details = row.detailRows.length
      ? `<div class="selected-detail-routes">${row.detailRows.map((detail) => `<span>${formatDetailRouteCount(detail.route, detail.count, detail.cancellationCount)}</span>`).join("")}</div>`
      : `<div class="selected-detail-empty">세부구역 기록 없음 (이전 앱 기록 포함)</div>`;
    return `<article class="selected-breakdown-row">
      <div><strong>${escapeAttr(row.route)}</strong><span>${fmtCount(row.count)}</span></div>
      <strong>${fmtWon(row.revenue)}</strong>
      ${details}
    </article>`;
  }).join("") : `<div class="selected-detail-empty">매출 상품수가 0건으로 보정되어 있습니다.</div>`;
  const auxiliaryRows = [
    totals.freshCount > 0
      ? `<article class="selected-breakdown-row"><div><strong>프레시백</strong><span>${fmtCount(totals.freshCount)}</span></div><strong>${fmtWon(totals.freshRevenue)}</strong></article>`
      : "",
    totals.returnCount > 0
      ? `<article class="selected-breakdown-row"><div><strong>반품</strong><span>${fmtCount(totals.returnCount)}</span></div><strong>배송 매출에 포함</strong></article>`
      : "",
    totals.cancellationCount > 0
      ? `<article class="selected-breakdown-row"><div><strong>취소</strong><span>${fmtCount(totals.cancellationCount)}</span></div><strong>배송 매출에 포함</strong></article>`
      : "",
  ].join("");
  el.selectedDateBreakdownRows.innerHTML = routeRows + auxiliaryRows;
  const notes = [];
  if (!state.workRouteDetailsContractAvailable) notes.push("세부구역 조회 서버 업데이트가 아직 적용되지 않았습니다.");
  if (model.invalidDetailRows) notes.push(`형식이 올바르지 않은 세부구역 ${model.invalidDetailRows}행은 표시하지 않았습니다.`);
  el.selectedDateBreakdownNote.textContent = notes.join(" ");
  el.selectedDateBreakdownNote.hidden = notes.length === 0;
  el.openSalesOverride.title = "이 날짜의 기록을 수정합니다.";
}
function renderHomeSelection() {
  const record = getRecord(state.selectedDate, false);
  const calc = calcRecord(record);
  const automatic = hasAutomaticEntries(record);
  const dayChanged = el.homeDayDockInfo && el.homeDayDockInfo.__moDate !== state.selectedDate;
  if (el.homeDayDockInfo) el.homeDayDockInfo.__moDate = state.selectedDate;
  const paintDayDock = () => {
    el.homeSelectedDate.textContent = formatMonthDay(state.selectedDate);
    if (record.off) el.homeSelectedTotal.textContent = "휴무";
    else renderNumberWithUnit(el.homeSelectedTotal, fmtWon(calc.revenue));
  };
  if (dayChanged && el.homeDayDockInfo.__moPainted) motion.crossfade(el.homeDayDockInfo, paintDayDock);
  else paintDayDock();
  el.homeDayDockInfo && (el.homeDayDockInfo.__moPainted = true);
  el.homeOffToggle.classList.toggle("active", record.off);
  el.homeOffToggle.setAttribute("aria-checked", String(record.off));
  el.homeOffToggle.disabled = automatic;
  el.homeOffToggle.title = automatic ? "앱 자동 기록이 있는 날짜는 휴무로 바꿀 수 없습니다." : "";
  renderHomeDayOverview(record, calc, automatic);
  renderSelectedDateBreakdown(record);
}
function renderHomeDayOverview(record, calc, automatic) {
  const routeLinks = el.homeRouteNotes;
  if (routeLinks) {
    const routes = [...new Set(record.rows.flatMap((row) => splitStoredRoutes(row.route)).filter(Boolean))];
    routeLinks.replaceChildren(...routes.map((route) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "secondary-btn";
      button.dataset.openRouteNote = route;
      button.textContent = `${route} 구역노트`;
      return button;
    }));
    routeLinks.hidden = record.off || routes.length === 0;
  }
  const recorded = automatic || calc.revenue !== 0 || hasEnteredCounts(record);
  const planned = !recorded && record.rows.some((row) => Boolean(row.route));
  const dayState = record.off ? "off" : recorded ? "recorded" : planned ? "planned" : "missing";
  el.homeDayPanel.dataset.dayState = dayState;
  el.homeDayTitle.textContent = formatMonthDayFull(state.selectedDate);
  el.homeDayToday.hidden = state.selectedDate !== toDateKey(new Date());
  el.homeDayIcon.toggleAttribute("hidden", !record.off);
  if (dayState === "recorded") renderNumberWithUnit(el.homeDayValue, fmtWon(calc.revenue));
  else el.homeDayValue.textContent = record.off ? "휴무일" : "매출 미기록";
  el.homeDayHint.textContent = record.off
    ? "휴무로 기록된 날이에요."
    : recorded
      ? "이 날짜에 기록된 매출이에요."
      : planned
        ? "근무표가 등록되어 있어요. 실적을 기록해주세요."
        : "아직 기록이 없어요. 근무 내역을 남겨보세요.";
  el.homeDayState.textContent = record.off ? "휴무" : recorded ? "기록 있음" : planned ? "근무표 등록" : "미기록";
  el.homeOffWideLabel.textContent = record.off ? "근무로 변경" : "휴무로 설정";
}
function selectDate(dateKey) {
  if (dateKey !== state.selectedDate && state.recordDraft) {
    if (!confirmLeaveRecordDraft()) return;
    discardRecordDraft();
  }
  state.selectedDate = dateKey;
  renderMonth();
  renderHomeSelection();
  renderInspectionEntry();
}
function selectToday() {
  const dateKey = isNightShift() ? currentWorkDates().nextWorkDate : koreanDateKey();
  const todayDate = parseDateKey(dateKey);
  const period = periodForDate(todayDate);
  state.year = period.year;
  state.month = period.month;
  selectDate(dateKey);
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
  renderInspectionEntry();
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
  const automatic = hasAutomaticEntries(record);
  if (automatic) {
    record.off = false;
  }
  else if (record.off) record.rows = [];
  el.selectedDateTitle.textContent = formatMonthDayFull(state.selectedDate);
  el.offToggle.checked = record.off;
  el.offToggle.disabled = automatic;
  el.offToggle.title = automatic ? "앱 자동 기록이 있는 날짜는 휴무로 바꿀 수 없습니다." : "";
  el.offToggle.closest(".off-toggle")?.classList.remove("is-locked");
  el.addRoute.disabled = false;
  el.addRoute.title = "";
  el.automaticRecordNotice?.classList.add("hidden");
  el.entryRows.innerHTML = "";
  record.rows.forEach((row, index) => renderEntryRow(row, index));
  const defaultRows = defaultEntryRows();
  if (!existed && !record.rows.length && !record.off && defaultRows.length) {
    record.rows = defaultRows;
    record.rows.forEach((row, index) => renderEntryRow(row, index));
  }
  const dual = freshbagModeForRecord(record) === "dual";
  el.freshSingleRow.classList.toggle("hidden", dual);
  el.freshDualRow.classList.toggle("hidden", !dual);
  el.freshCount.value = record.freshCount || "";
  el.freshUnit.value = defaultFreshUnit(record.freshUnit);
  el.freshSoloCount.value = record.freshSoloCount || "";
  el.freshLinkedCount.value = record.freshLinkedCount || "";
  el.backupUnit.value = defaultBackupUnit(record.backupUnit);
  el.backupUnit.disabled = false;
  el.backupUnit.title = "이 날짜의 백업단가입니다.";
  refreshTotals();
}
function displayedRouteUnit(record, row) {
  const storedUnit = effectiveUnit(row);
  if (!isAutomaticRow(row) || record.driverType !== "backup") return storedUnit;
  return Math.max(0, storedUnit - toNum(defaultBackupUnit(record.backupUnit)));
}
function storedRouteUnit(record, row, displayedUnit) {
  const baseUnit = Math.max(0, toNum(displayedUnit));
  if (!isAutomaticRow(row) || record.driverType !== "backup") return baseUnit;
  return baseUnit + toNum(defaultBackupUnit(record.backupUnit));
}
function renderEntryRow(row, index) {
  const node = el.entryTemplate.content.firstElementChild.cloneNode(true);
  const automatic = isAutomaticRow(row);
  const record = currentRecordDraft();
  const routeInput = node.querySelector(".route");
  const count = node.querySelector(".count");
  const households = node.querySelector(".households");
  const householdField = node.querySelector(".household-field");
  const unit = node.querySelector(".unit");
  const output = node.querySelector("output");
  const del = node.querySelector(".del-btn");
  routeInput.value = formatRouteLabel(row.route);
  routeInput.readOnly = false;
  count.value = row.count ?? "";
  households.value = row.households ?? "";
  unit.value = displayedRouteUnit(record, row) || "";
  unit.title = "이 날짜에만 적용되는 단가입니다. 기본 단가는 바뀌지 않습니다.";
  unit.setAttribute("aria-label", "이 날짜 단가");
  output.textContent = fmtWon(toNum(count.value) * toNum(unit.value));
  del.style.visibility = "visible";
  if (automatic) householdField?.classList.add("hidden");
  routeInput.addEventListener("input", () => {
    routeInput.value = routeInput.value.toUpperCase();
    const expanded = expandRouteText(routeInput.value);
    const joined = joinStoredRoutes(expanded);
    const current = currentRecordDraft();
    current.rows[index].route = joined || routeInput.value;
    current.rows[index].draft = automatic ? false : !joined;
    const autoUnit = autoUnitForRoutes(joined || expanded);
    current.rows[index].unit = storedRouteUnit(current, current.rows[index], autoUnit);
    unit.value = autoUnit || "";
    output.textContent = fmtWon(toNum(count.value) * autoUnit);
    refreshTotals();
  });
  routeInput.addEventListener("blur", () => {
    const expanded = expandRouteText(routeInput.value);
    const joined = joinStoredRoutes(expanded);
    const current = currentRecordDraft();
    current.rows[index].route = joined || routeInput.value;
    current.rows[index].draft = automatic ? false : !joined;
    routeInput.value = joined ? formatRouteLabel(joined) : routeInput.value.trim().toUpperCase();
    const displayedUnit = displayedRouteUnit(current, current.rows[index]);
    unit.value = displayedUnit || "";
    output.textContent = fmtWon(toNum(count.value) * displayedUnit);
    refreshTotals();
  });
  count.addEventListener("input", () => {
    const current = currentRecordDraft();
    current.rows[index].count = count.value;
    refreshTotals();
  });
  households.addEventListener("input", () => {
    const current = currentRecordDraft();
    current.rows[index].households = households.value;
  });
  unit.addEventListener("input", () => {
    const current = currentRecordDraft();
    current.rows[index].unit = storedRouteUnit(current, current.rows[index], unit.value);
    refreshTotals();
  });
  del.addEventListener("click", () => {
    const current = currentRecordDraft();
    current.rows.splice(index, 1);
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
  record.freshbagMode = freshbagModeForRecord(record);
  const nextBackupUnit = isBackupDriver() ? toNum(defaultBackupUnit(el.backupUnit.value)) : 0;
  const previousBackupUnit = isBackupDriver() ? toNum(defaultBackupUnit(record.backupUnit)) : 0;
  if (hasAutomaticEntries(record) && nextBackupUnit !== previousBackupUnit) {
    const delta = nextBackupUnit - previousBackupUnit;
    record.rows.filter(isAutomaticRow).forEach((row) => {
      row.unit = Math.max(0, effectiveUnit(row) + delta);
    });
  }
  record.backupUnit = nextBackupUnit;
  return record;
}
function refreshTotals() {
  const record = syncFormToRecord();
  const details = calcRecordDetails(record);
  el.entryRows.querySelectorAll(".entry-row").forEach((node, index) => {
    const row = record.rows[index];
    node.querySelector("output").textContent = fmtWon(toNum(row?.count) * displayedRouteUnit(record, row || {}));
    const unitInput = node.querySelector(".unit");
    if (!toNum(unitInput.value) && row?.unit) unitInput.value = displayedRouteUnit(record, row);
  });
  el.freshRevenue.textContent = fmtWon(details.freshRevenue);
  el.freshDualRevenue.textContent = fmtWon(details.freshRevenue);
  el.backupCount.textContent = fmtCount(details.count);
  el.backupRevenue.textContent = fmtWon(details.backupRevenue);
  renderNumberWithUnit(el.selectedDayTotal, fmtWon(details.revenue));
  renderSummary();
  renderMonth();
  renderHomeSelection();
}
async function saveCurrentRecordAndGoHome() {
  const draft = syncFormToRecord();
  if (draft.rows.some((row) => toNum(row.count) > 0 && effectiveUnit(row) <= 0)) {
    toast("건수를 입력한 구역의 단가를 확인해 주세요. 0원으로 저장하지 않았습니다.", "error");
    return false;
  }
  const dateKey = state.selectedDate;
  const automatic = hasAutomaticEntries(draft);
  if (automatic) {
    if (!state.db || !currentUserId()) {
      toast("로그인 상태를 확인한 뒤 다시 저장해 주세요.", "error");
      return false;
    }
    const context = captureAccountContext();
    const requestPayload = automaticSalesRequestFingerprint(draft.rows);
    if (!state.recordDraftSalesRequestId || state.recordDraftSalesPayload !== requestPayload) {
      state.recordDraftSalesRequestId = makeSalesOverrideRequestId();
      state.recordDraftSalesPayload = requestPayload;
    }
    try {
      const snapshot = await persistAutomaticSalesSnapshot({
        dateKey,
        revision: state.automaticSalesOverrides[dateKey]?.revision ?? 0,
        requestId: state.recordDraftSalesRequestId,
        reason: "기록 화면에서 매출 수정",
        rows: draft.rows,
        basisCounts: draft.salesBasisCounts,
        context,
      });
      applyAutomaticSalesSnapshot(dateKey, snapshot, draft);
    } catch (error) {
      const conflict = String(error?.message || "").toLowerCase().includes("revision") || String(error?.code || "") === "40001";
      toast(conflict
        ? "다른 기기에서 이 날짜를 먼저 수정했습니다. 새로고침 후 다시 확인해 주세요."
        : `기록 저장 실패: ${error.message || "알 수 없는 오류"}`, "error");
      return false;
    }
  } else {
    commitRecordDraft();
  }
  scheduleSave({ dateKeys: [dateKey], immediate: true });
  try {
    await ensurePendingSavesFlushed();
  } catch (error) {
    if (!error?.quickflexHandled && !error?.quickflexReported) {
      error.quickflexReported = true;
      toast(`기록 저장 실패: ${error.message}`, "error");
    }
    return false;
  }
  if (automatic) commitRecordDraft();
  renderAll();
  showView("home");
  toast("기록을 저장했습니다.", "success");
  return true;
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
      const editLabel = escapeAttr(`${rate.route} ${fmtWon(rate.unit)} 단가 편집`);
      return `<div class="rate-chip" role="group" aria-label="${route} 단가"><button class="rate-chip-select" data-route="${route}" type="button" aria-label="${editLabel}"><strong>${route}</strong><span>${fmtWon(rate.unit)}</span></button>${deleteButton}</div>`;
    }).join("")
    : `<div class="daily-card"><span>${isBackupDriver() ? "등록된 단가가 없습니다." : "고정 라우트를 먼저 등록하면 해당 단가만 표시됩니다."}</span></div>`;
  el.rateList.querySelectorAll(".rate-chip-select").forEach((button) => {
    const selectRate = () => {
      const rate = mergedRates.find((item) => item.route === button.dataset.route);
      if (!rate) return;
      el.rateRoute.value = rate.route;
      el.rateUnit.value = rate.unit;
    };
    button.addEventListener("click", selectRate);
  });
  el.rateList.querySelectorAll(".rate-delete").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteRate(button.dataset.route).catch((error) => toast(`구역 삭제 실패: ${error.message}`, "error"));
    });
  });
  renderRateUpdateOffer();
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
  if (!window.confirm(`${createdPreview}\n${changedPreview}\n\n내 DB 기본 단가에 반영할까요?`)) {
    toast("단가 반영을 취소했습니다.", "error");
    return false;
  }
  selectedRates.forEach((rate) => {
    const existing = state.rates.find((item) => item.route === rate.route);
    if (existing) Object.assign(existing, rate);
    else state.rates.push(rate);
  });
  state.rates = mergeDefaultRouteMaster(state.rates).rates;
  await persistRates();
  renderRates();
  renderAll();
  toast(`정산표 단가와 기본 구역 ${state.rates.length}개를 내 계정에 반영했습니다.`, "success");
  return true;
}

function statsDailyRecords() {
  return Object.entries(state.entries).map(([dateKey, record]) => {
    const details = calcRecordDetails(record);
    const delivery = [...recordRouteAggregates(record).values()].reduce((sum, row) => ({
      revenue: sum.revenue + row.revenue,
      count: sum.count + row.count,
    }), { revenue: 0, count: 0 });
    return {
      dateKey,
      revenue: details.revenue,
      deliveryRevenue: delivery.revenue,
      freshRevenue: details.freshRevenue,
      backupRevenue: details.backupRevenue,
      volumeKnown: delivery.count > 0 && Math.abs(delivery.count - details.count) < 0.000001,
      planned: !record.off && (record.rows || []).some((row) => !isAutomaticRow(row) && splitStoredRoutes(row.route).some((route) => /^\d{3}[A-Z]$/.test(route))),
      count: details.count,
      freshCount: details.freshCount,
      returnCount: details.returnCount,
      worked: isWorkedRecord(record, details),
      off: Boolean(record.off),
    };
  });
}

function statsModeTitle(mode) {
  return ({
    thisMonth: "이번 정산",
    lastMonth: "지난 정산",
    last3: "최근 3개월",
    last12: "최근 1년",
    custom: "직접 조회",
  })[mode] || "이번 정산";
}

function renderStatsComparison(report) {
  if (!el.statsComparison) return;
  const show = state.statsRangeMode === "thisMonth";
  el.statsComparison.hidden = !show;
  if (!show) return;

  const comparison = report.comparison;
  el.statsComparison.classList.remove("is-positive", "is-negative", "is-neutral", "is-empty");
  if (comparison.available) {
    const delta = Math.round(comparison.revenueDelta || 0);
    const rate = comparison.revenueDeltaRate;
    el.statsCompareLabel.textContent = `지난 정산 동일 ${comparison.requiredWorkDays}일 대비`;
    el.statsCompareValue.innerHTML = `${delta > 0 ? "+" : ""}${statsMetric(delta)}`;
    const rateText = rate === null
      ? "이전 매출 0원"
      : `${rate > 0 ? "+" : ""}${Math.round(rate * 100)}%`;
    el.statsCompareMeta.textContent = `지난 정산 ${fmtWon(comparison.previous.revenue)} · ${rateText}`;
    el.statsComparison.classList.add(delta > 0 ? "is-positive" : (delta < 0 ? "is-negative" : "is-neutral"));
    return;
  }

  // 비교값이 없을 땐 안내 문장이므로 큰 숫자 대신 본문 제목 크기로 보여 준다.
  el.statsComparison.classList.add("is-neutral", "is-empty");
  el.statsCompareLabel.textContent = "지난 정산 동일 근무일수 대비";
  if (comparison.reason === "current_no_workdays") {
    el.statsCompareValue.textContent = "근무 기록 후 비교됩니다";
    el.statsCompareMeta.textContent = "매출이 기록된 근무일을 기준으로 비교합니다.";
    return;
  }
  el.statsCompareValue.textContent = "비교할 이전 기록 부족";
  el.statsCompareMeta.textContent = `이번 ${comparison.requiredWorkDays}일 · 지난 정산 ${comparison.availablePreviousWorkDays}일 기록`;
}

function statsMetric(value, unit = "원", digits = 0) {
  if (value === null || !Number.isFinite(value)) return "—";
  return `<span class="stats-numeric">${value.toLocaleString("ko-KR", { maximumFractionDigits: digits })}</span><small class="stats-unit">${unit}</small>`;
}
function renderDriverInsights(report) {
  const days = statsDailyRecords();
  const { outlook, drivers, typical } = buildStatsInsights({ days, report, asOfDate: todayKey() });
  const heading = $("statsHeroLabel");
  const value = $("statsOutlookValue");
  const message = $("statsOutlookMessage");
  const plan = $("statsOutlookPlan");
  const planWasOpen = Boolean(plan?.querySelector("details")?.open);
  if (!value) return;
  const current = outlook.applicable;
  heading.textContent = `${statsModeTitle(state.statsRangeMode)} 누적 매출`;
  value.innerHTML = statsMetric(report.summary.revenue);
  if (!current) {
    message.textContent = `${report.summary.workDays}일의 근무 기록을 모았습니다.`;
    plan.innerHTML = "";
  } else {
    message.textContent = !report.summary.workDays ? "매출을 기록하면 하루 평균과 지난 정산을 비교할 수 있습니다."
      : outlook.target && outlook.remainingAmount === 0 ? "이번 정산 목표를 채웠습니다."
      : outlook.target ? `목표까지 ${fmtWon(outlook.remainingAmount)} 남았습니다.` : `${report.summary.workDays}일의 근무 기록을 모았습니다.`;
    const required = outlook.requiredDailyRevenue === null ? "일정 확인 필요" : statsMetric(Math.ceil(outlook.requiredDailyRevenue));
    const caveats = [];
    if (outlook.pendingToday) caveats.push("오늘 기록이 끝나면 전망을 계산합니다.");
    if (outlook.unknownDays) caveats.push(`남은 ${outlook.unknownDays}일은 일정이 비어 있습니다.`);
    if (!outlook.plannedDays) caveats.push("등록된 남은 근무일이 없습니다.");
    if (!outlook.pendingToday && outlook.plannedDays && report.summary.workDays < 3) caveats.push("3일 이상 기록이 쌓이면 예상액을 보여드립니다.");
    if (outlook.requiredDailyRevenue !== null && outlook.unknownDays) caveats.push("필요 매출은 등록된 일정만 기준으로 합니다.");
    plan.innerHTML = !outlook.plannedDays ? "" : `<details class="stats-disclosure"><summary>남은 일정으로 전망 보기</summary><div class="stats-plan-pair"><div><span>등록된 남은 근무</span><strong>${statsMetric(outlook.plannedDays, "일")}</strong></div><div><span>근무일당 필요한 매출</span><strong>${outlook.target ? required : "목표 미설정"}</strong></div></div>`
      + (outlook.projectedRevenue !== null ? `<p class="stats-projection">이 평균이 이어지면 <strong>${statsMetric(Math.round(outlook.projectedRevenue))}</strong><small>현재 근무일당 평균 × 남은 등록 일정 · 예상값</small></p>` : "")
      + (caveats.length ? `<p class="stats-reading-note">${caveats.join(" ")}</p>` : "") + "</details>";
  }
  if (planWasOpen) plan.querySelector("details")?.setAttribute("open", "");
  $("statsSummaryTotal").innerHTML = statsMetric(report.summary.revenue);
  $("statsAverage").innerHTML = statsMetric(Math.round(report.summary.averageRevenue));
  $("statsWorkDays").innerHTML = statsMetric(report.summary.workDays, "일");
  $("statsChangeSection").hidden = report.mode !== "thisSettlement";
  $("statsDriverDisclosure").hidden = !drivers.available;
  const signed = (number, unit, digits) => `${number > 0 ? "+" : ""}${statsMetric(number, unit, digits)}`;
  const driverFields = [
    ["하루 배송 물량", "averageCount", "건", 1],
    ["배송 평균단가", "averageDeliveryUnit", "원", 0],
    ["하루 부가매출", "averageExtraRevenue", "원", 0],
  ].filter(([, field]) => drivers.current[field] !== null && drivers.previous[field] !== null);
  $("statsDrivers").innerHTML = drivers.available ? driverFields.map(([label, field, unit, digits]) => {
    const now = drivers.current[field], previous = drivers.previous[field];
    return `<div><span>${label}</span><strong>${statsMetric(now, unit, digits)}</strong><small class="stats-previous"><span>지난번</span><span>${statsMetric(previous, unit, digits)}</span></small><em>${now === null || previous === null ? "비교 불가" : signed(now - previous, unit, digits)}</em></div>`;
  }).join("") : "";
  $("statsDriversNote").textContent = drivers.available && drivers.current.averageCount === null ? "물량이 없는 기록이 포함되어 물량·단가는 비교하지 않습니다. 매출 비교에는 모두 포함했습니다." : "부가매출은 백업수당·프레시백 합계입니다. 같은 근무일수라도 물량과 업무 구성은 다를 수 있습니다.";
  $("statsTypical").innerHTML = typical.days ? `<div><span>기록된 하루 매출의 중간값</span><strong>${statsMetric(Math.round(typical.medianRevenue))}</strong></div><p>${typical.days}일 기록${typical.days < 4 ? " · 표본이 적어 참고만 해주세요." : ` · 가운데 절반은 ${fmtWon(Math.round(typical.lowRevenue))}~${fmtWon(Math.round(typical.highRevenue))}`}</p>` : `<p>근무 기록이 쌓이면 나의 평소 매출을 확인할 수 있습니다.</p>`;
  $("statsReview").innerHTML = outlook.reviewDates.length ? `<details class="stats-disclosure"><summary>일정은 있지만 실적이 없는 ${outlook.reviewDates.length}일</summary><p class="stats-reading-note">미입력·일정 변경·실제 0건 근무일 수 있습니다. 날짜별 기록에서 확인하세요.</p><p>${outlook.reviewDates.map(formatMonthDay).join(" · ")}</p></details>` : "";
  $("statsDailyTitle").textContent = `날짜별 기록 보기 · ${report.summary.recordDays}일`;
}

function renderStats() {
  applyDefaultStatsRangeMode();
  const mode = state.statsRangeMode || "thisMonth";
  const report = buildStatsReport({
    dailyRecords: statsDailyRecords(),
    currentPeriod: { year: state.statsYear, month: state.statsMonth },
    mode,
    customRange: state.statsRangeCustom,
    asOfDate: todayKey(),
    goal: getGoal(),
  });
  const keys = getStatsKeys().filter((dateKey) => dateKey >= report.range.start && dateKey <= report.range.end);
  const title = statsModeTitle(mode);
  const start = parseDateKey(report.range.start);
  const end = parseDateKey(report.range.end);
  const total = report.summary;

  if (el.statsMonthTitle) el.statsMonthTitle.textContent = title;
  if (el.statsRange) el.statsRange.textContent = formatRangeLabel(start, end);
  if (el.statsHeroLabel) el.statsHeroLabel.textContent = `${title} 누적`;
  if (el.statsSummaryRange) el.statsSummaryRange.textContent = formatRangeLabel(start, end);
  if (el.statsSummaryTotal) el.statsSummaryTotal.textContent = fmtWon(total.revenue);
  if (el.statsRevenue) el.statsRevenue.textContent = fmtWon(total.revenue);
  if (el.statsWorkDays) el.statsWorkDays.textContent = `${total.workDays}일`;
  if (el.statsAverage) el.statsAverage.textContent = formatCompactWonWithUnit(total.averageRevenue);
  if (el.statsOffDays) el.statsOffDays.textContent = `${total.offDays}일`;
  if (el.statsCount) el.statsCount.textContent = fmtCount(total.count);
  if (el.statsFresh) el.statsFresh.textContent = fmtCount(total.freshCount);
  if (el.statsAvgCount) el.statsAvgCount.textContent = fmtCount(Math.round(total.averageCount));

  renderStatsComparison(report);
  renderDriverInsights(report);
  const showGoal = mode === "thisMonth" && report.goal.target;
  if (el.statsGoalMeter) el.statsGoalMeter.hidden = !showGoal;
  if (showGoal) {
    el.statsMeterFill.style.width = `${report.goal.cappedProgressPct}%`;
    el.statsMeterPct.textContent = `${Math.round(report.goal.progressPct)}%`;
    el.statsMeterLabel.textContent = `목표 ${fmtWon(report.goal.target)}`;
  }

  syncStatsRangeButtons();
  renderStatsChart(report.trend);
  renderRevenueList(keys);
  renderRouteStats(keys);
  $("statsRouteDisclosure").hidden = !el.routeStats.querySelector(".route-stat-card");
  renderDailyStatsFor(keys);
  renderWeekdayStats(keys);
}
const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];
// Rebuilding these 7 columns from scratch every render (the old innerHTML
// approach) meant a bar could never *grow into* its new height — it just
// popped there. Kept as 7 persistent, keyed columns instead: built once,
// then only their text and fill transform are ever updated, so a data
// change can animate from the old value instead of jumping.
const weekdayBars = motion.createAnimationGroup();
function renderWeekdayStats(keys) {
  if (!el.weekdayStats) return;
  const buckets = WEEKDAY_LABELS.map((label, index) => ({ label, index, revenue: 0, count: 0, days: 0 }));
  (keys || []).forEach((dateKey) => {
    const record = getRecord(dateKey, false);
    if (!hasMeaningfulRecord(record) || normalizeRecordShape(record).off) return;
    const details = calcRecordDetails(record);
    if (!isWorkedRecord(record, details)) return;
    const bucket = buckets[parseDateKey(dateKey).getDay()];
    bucket.revenue += details.revenue;
    bucket.count += details.count;
    bucket.days += 1;
  });
  const worked = buckets.filter((bucket) => bucket.days > 0);
  if (!worked.length) {
    weekdayBars.cancelAll();
    el.weekdayStats.innerHTML = `<div class="rs-empty">기록된 근무일이 없습니다.</div>`;
    return;
  }
  // 요일마다 근무일수가 다르므로 합계가 아니라 근무일당 평균으로 비교해야 공정하다.
  const averages = buckets.map((bucket) => (bucket.days ? bucket.revenue / bucket.days : 0));
  const max = Math.max(...averages, 1);
  const best = worked.reduce((a, b) => ((b.revenue / b.days) > (a.revenue / a.days) ? b : a));
  const bestAverage = best.revenue / best.days;
  const lowest = worked.reduce((a, b) => ((b.revenue / b.days) < (a.revenue / a.days) ? b : a));
  const gap = bestAverage - (lowest.revenue / lowest.days);
  const note = worked.length > 1 && gap > 0
    ? `${best.label}요일이 ${lowest.label}요일보다 근무일당 ${fmtWon(Math.round(gap))} 많습니다.`
    : "요일을 비교하려면 근무 기록이 더 필요합니다.";

  const freshBuild = el.weekdayStats.querySelectorAll(".wd-col").length !== 7;
  if (freshBuild) {
    weekdayBars.cancelAll();
    const cols = buckets.map((bucket, index) => {
      const tone = index === 0 ? " is-sun" : (index === 6 ? " is-sat" : "");
      return `<div class="wd-col${tone}" data-weekday="${index}">
        <span class="wd-avg"></span>
        <div class="wd-track"><span></span></div>
        <span class="wd-label">${bucket.label}</span>
        <span class="wd-days"></span>
      </div>`;
    }).join("");
    el.weekdayStats.innerHTML = `<div class="wd-bars">${cols}</div><p class="wd-note"></p>`;
  }
  const animateFirstPaint = freshBuild && motion.shouldAnimate();
  buckets.forEach((bucket, index) => {
    const col = el.weekdayStats.querySelector(`.wd-col[data-weekday="${index}"]`);
    if (!col) return;
    col.classList.toggle("is-best", index === best.index);
    col.querySelector(".wd-avg").textContent = bucket.days ? compactMoneyLabel(averages[index]) : "-";
    col.querySelector(".wd-days").textContent = bucket.days ? bucket.days + "일" : "";
    const fill = col.querySelector(".wd-track > span");
    const target = (bucket.days ? Math.max(4, Math.round((averages[index] / max) * 100)) : 0) / 100;
    const from = freshBuild ? 0 : Number(fill.dataset.moScale || 0);
    fill.dataset.moScale = String(target);
    if (!freshBuild && Math.abs(from - target) < 0.001) return;
    const start = () => weekdayBars.run(`wd-${index}`, from, target, {
      ...motion.SPRING,
      onUpdate: (v) => { fill.style.transform = `scaleY(${v})`; },
    });
    if (animateFirstPaint) {
      fill.style.transform = `scaleY(0)`;
      setTimeout(start, index * 30);
    } else {
      start();
    }
  });
  el.weekdayStats.querySelector(".wd-note").textContent = note;
}
function compactMoneyLabel(value) {
  const won = Math.round(value || 0);
  if (won >= 10000) return `${Math.round(won / 10000)}만`;
  return String(won);
}

function renderRouteStats(keys) {
  if (!el.routeStats) return;
  const routes = new Map();
  const rawDetails = rawDetailBreakdown((keys || []).flatMap((dateKey) => state.workRouteDetails[dateKey] || []));
  let workDays = 0;
  (keys || []).forEach((dateKey) => {
    const record = getRecord(dateKey, false);
    const aggregates = recordRouteAggregates(record);
    if (aggregates.size) workDays += 1;
    aggregates.forEach((agg, route) => {
      const entry = routes.get(route) || { count: 0, revenue: 0, days: 0, automaticCount: 0 };
      entry.count += agg.count;
      entry.revenue += agg.revenue;
      if (agg.count > 0 || agg.revenue > 0) entry.days += 1;
      routes.set(route, entry);
    });
    automaticRows(record).forEach((row) => {
      const rowRoutes = splitStoredRoutes(row.route);
      const share = rowRoutes.length || 1;
      rowRoutes.forEach((route) => {
        const entry = routes.get(route) || { count: 0, revenue: 0, days: 0, automaticCount: 0 };
        entry.automaticCount += toNum(row.count) / share;
        routes.set(route, entry);
      });
    });
  });
  rawDetails.byBase.forEach((_, baseRoute) => {
    if (!routes.has(baseRoute)) routes.set(baseRoute, { count: 0, revenue: 0, days: 0, automaticCount: 0 });
  });
  const rows = Array.from(routes.entries())
    .map(([route, agg]) => ({ route, count: Math.round(agg.count), revenue: Math.round(agg.revenue), days: agg.days, automaticCount: Math.round(agg.automaticCount) }))
    .filter((row) => row.days > 0 && (row.count > 0 || row.revenue > 0))
    .sort((a, b) => b.revenue / b.days - a.revenue / a.days);
  if (!rows.length) {
    el.routeStats.innerHTML = `<div class="rs-empty">기록된 구역이 없습니다.</div>`;
    return;
  }
  const routeCards = rows.map((row) => {
    const unit = row.count ? Math.round(row.revenue / row.count) : 0;
    const detailRows = [...(rawDetails.byBase.get(normalizeBaseSalesRoute(row.route)) || new Map()).entries()]
      .sort((a, b) => a[0].localeCompare(b[0]));
    const detailMarkup = detailRows.length
      ? `<div class="rs-detail-routes">${detailRows.map(([route, count]) => `<span>${formatDetailRouteCount(route, count, rawDetails.cancellationByRoute.get(route) || 0)}</span>`).join("")}</div>`
      : "";
    return `<div class="route-stat-card">
      <div class="rs-top">
        <span class="rs-name">${escapeAttr(formatRouteLabel(row.route))}</span>
        <strong class="rs-amount">${fmtWon(Math.round(row.revenue / row.days))}<small> / 근무일</small></strong>
      </div>
      <div class="rs-meta">
        <span>평균 ${fmtCount(Math.round(row.count / row.days))}</span>
        <span>적용 평균단가 ${fmtWon(unit)}</span>
        <span>${row.days}일 기록${row.days < 3 ? " · 표본 적음" : ""}</span>
      </div>
      <details class="stats-route-detail"><summary>누적 ${fmtCount(row.count)} · ${fmtWon(row.revenue)}</summary>${detailMarkup}</details>

    </div>`;
  });
  el.routeStats.innerHTML = routeCards.slice(0, 5).join("") + (routeCards.length > 5 ? `<details class="stats-disclosure"><summary>나머지 ${routeCards.length - 5}개 구역 보기</summary>${routeCards.slice(5).join("")}</details>` : "");
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
    const detailId = `stats-day-detail-${dateKey}`;
    const routes = record.rows.map((row) => {
      const unit = displayedRouteUnit(record, row);
      const sub = toNum(row.count) * unit;
      return `<div class="dd-row"><span>${formatRouteLabel(row.route)} · ${fmtCount(row.count)} × ${fmtWon(unit)}</span><strong>${fmtWon(sub)}</strong></div>`;
    }).join("");
    const routePreview = record.off ? "휴무" : (formatRecordRoutes(record.rows) || "라우트 없음");
    return `<div class="daily-card stat-day-card">
      <button type="button" data-date="${dateKey}" aria-expanded="${open}" aria-controls="${detailId}">
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
          ${details.returnCount ? `<span>반품 ${fmtCount(details.returnCount)}</span>` : ""}
          ${details.cancellationCount ? `<span>취소 ${fmtCount(details.cancellationCount)}</span>` : ""}
          ${details.backupRevenue ? `<span>백업 ${fmtWon(details.backupRevenue)}</span>` : ""}
        </div>
      </button>
      <div class="daily-detail" id="${detailId}"${open ? "" : " hidden"}>${
        record.off ? "<div class=\"dd-row\"><span>휴무</span></div>" :
        `${routes || "<div class=\"dd-row\"><span>라우트 없음</span></div>"}` +
        `${details.freshRevenue ? `<div class="dd-row"><span>프레시백 ${fmtCount(details.freshCount)}</span><strong>${fmtWon(details.freshRevenue)}</strong></div>` : ""}` +
        `${details.returnCount ? `<div class="dd-row"><span>반품 ${fmtCount(details.returnCount)}</span><strong>배송 매출에 포함</strong></div>` : ""}` +
        `${details.cancellationCount ? `<div class="dd-row"><span>취소 ${fmtCount(details.cancellationCount)}</span><strong>배송 매출에 포함</strong></div>` : ""}` +
        `${details.backupRevenue ? `<div class="dd-row"><span>백업수당</span><strong>${fmtWon(details.backupRevenue)}</strong></div>` : ""}` +
        `<div class="dd-row dd-total"><span>합계</span><strong>${fmtWon(details.revenue)}</strong></div>`
      }</div>
    </div>`;
  }).join("") : `<div class="daily-card"><span>기록된 날짜가 없습니다.</span></div>`;
  el.dailyList.querySelectorAll("button[data-date]").forEach((button) => {
    button.addEventListener("click", () => {
      state.statsDetailDate = state.statsDetailDate === button.dataset.date ? "" : button.dataset.date;
      renderDailyStatsFor(allKeys);
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
      workDays: sum.workDays + (isWorkedRecord(record, details) ? 1 : 0),
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
let statsRangeIndicatorCtl = null;
function statsRangeIndicator() {
  if (!statsRangeIndicatorCtl && el.statsRangeTabs && el.statsRangeIndicator) {
    statsRangeIndicatorCtl = motion.createTabIndicator(el.statsRangeTabs, el.statsRangeIndicator);
  }
  return statsRangeIndicatorCtl;
}
function syncStatsRangeButtons() {
  if (!el.statsRangeTabs) return;
  let activeButton = null;
  el.statsRangeTabs.querySelectorAll("button[data-range]").forEach((btn) => {
    const selected = btn.dataset.range === state.statsRangeMode;
    btn.classList.toggle("active", selected);
    btn.setAttribute("aria-pressed", String(selected));
    if (selected) activeButton = btn;
  });
  statsRangeIndicator()?.moveTo(activeButton);
  if (el.statsRangeCustom) el.statsRangeCustom.hidden = state.statsRangeMode !== "custom";
  const navDisabled = state.statsRangeMode !== "thisMonth";
  [el.statsPrevMonth, el.statsNextMonth].filter(Boolean).forEach((button) => {
    button.classList.toggle("is-disabled", navDisabled);
    button.disabled = navDisabled;
    button.setAttribute("aria-disabled", String(navDisabled));
  });
}
function renderRevenueList(keys) {
  if (!el.revenueList) return;
  const total = (keys || []).reduce((sum, key) => {
    const value = calcRecordDetails(getRecord(key, false));
    sum.revenue += value.revenue;
    sum.fresh += value.freshRevenue;
    sum.backup += value.backupRevenue;
    return sum;
  }, { revenue: 0, fresh: 0, backup: 0 });
  const rows = [["배송 매출", total.revenue - total.fresh - total.backup], ["백업수당", total.backup], ["프레시백", total.fresh]];
  el.revenueList.innerHTML = rows.map(([label, amount]) => `<div class="rev-row"><span class="rev-label">${label}</span><strong class="rev-amount">${statsMetric(amount)}</strong></div>`).join("")
    + `<div class="rev-row rev-sum"><span class="rev-label">합계</span><strong class="rev-amount">${statsMetric(total.revenue)}</strong></div>`;
}
function renderStatsChart(trend) {
  const canvas = el.statsChart;
  if (!canvas) return;
  // Omit non-working buckets entirely, preserving genuine zero-revenue work.
  const series = (Array.isArray(trend?.buckets) ? trend.buckets : [])
    .filter((bucket) => bucket.workDays > 0 || bucket.revenue > 0);
  canvas.hidden = !series.length;
  if (el.statsChartChange) el.statsChartChange.hidden = !series.length;
  if (el.statsChartEndpoints) el.statsChartEndpoints.hidden = !series.length;
  if (el.statsChartEmpty) el.statsChartEmpty.hidden = Boolean(series.length);
  if (!series.length) {
    const emptySummary = "선택한 기간에 표시할 근무 기록이 없습니다.";
    canvas.setAttribute("aria-label", emptySummary);
    if (el.statsChartSummary) el.statsChartSummary.textContent = emptySummary;
    return;
  }
  const first = series[0];
  const last = series.at(-1);
  const granularity = trend?.granularity || "day";
  const compactAmount = (amount) => Math.abs(amount) >= 100000000
    ? statsMetric(amount / 100000000, "억원", 1)
    : (Math.abs(amount) >= 10000 ? statsMetric(amount / 10000, "만원", 1) : statsMetric(amount));
  if (el.statsChartChange) {
    const delta = last.revenue - first.revenue;
    if (granularity !== "day") {
      // Partial weeks/settlements have different coverage; avoid a misleading change rate.
      el.statsChartChange.textContent = granularity === "week" ? "주별 합계" : "정산별 합계";
    } else if (series.length === 1) {
      el.statsChartChange.textContent = "기록 1일";
    } else {
      const percent = first.revenue ? Math.abs(delta / first.revenue * 100) : null;
      const change = !delta ? "변동 없음" : (percent === null ? compactAmount(Math.abs(delta))
        : statsMetric(percent < 0.1 ? 0.1 : percent, percent < 0.1 ? "% 미만" : "%", 1));
      el.statsChartChange.innerHTML = `<span>첫 근무일 대비</span><strong>${change}${delta ? (delta > 0 ? " 증가" : " 감소") : ""}</strong>`;
    }
  }
  if (el.statsChartEndpoints) {
    const includeYear = first.start?.slice(0, 4) !== last.end?.slice(0, 4);
    const shortDate = (key) => key ? `${includeYear ? key.slice(2, 4) + "." : ""}${Number(key.slice(5, 7))}.${Number(key.slice(8, 10))}` : "";
    const dateLabel = (bucket) => bucket.start === bucket.end ? shortDate(bucket.start)
      : `${shortDate(bucket.start)}–${shortDate(bucket.end)}`;
    const endpoint = (bucket, label) => `<div><span>${dateLabel(bucket)} · ${label}</span><strong>${compactAmount(bucket.revenue)}</strong></div>`;
    el.statsChartEndpoints.innerHTML = endpoint(first, "시작") + (series.length > 1 ? endpoint(last, "최근") : "");
  }
  const chartSummary = `매출 흐름. 휴무·미기록을 제외한 ${series.length}개 근무 구간을 순서대로 연결했습니다. 첫 구간 ${fmtWon(series[0].revenue)}, 마지막 구간 ${fmtWon(series.at(-1).revenue)}.`;
  canvas.setAttribute("aria-label", chartSummary);
  if (el.statsChartSummary) el.statsChartSummary.textContent = chartSummary;
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 320;
  const cssH = 112;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const inset = 4;
  const baseline = cssH - inset;
  const maxRevenue = Math.max(...series.map((item) => item.revenue), 1);
  const points = series.map((item, index) => ({
    x: series.length === 1 ? cssW / 2 : inset + index * (cssW - inset * 2) / (series.length - 1),
    y: baseline - (item.revenue / maxRevenue) * (cssH - 20),
  }));
  const primaryColor = getComputedStyle(document.documentElement).getPropertyValue("--gold").trim();
  const trace = () => {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const middle = (previous.x + current.x) / 2;
      // Horizontal control points soften the line without overshooting recorded values.
      ctx.bezierCurveTo(middle, previous.y, middle, current.y, current.x, current.y);
    }
  };
  const fill = ctx.createLinearGradient(0, 0, 0, baseline);
  fill.addColorStop(0, primaryColor);
  fill.addColorStop(1, `${primaryColor}00`);
  trace();
  ctx.lineTo(points.at(-1).x, baseline);
  ctx.lineTo(points[0].x, baseline);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.globalAlpha = 0.14;
  ctx.fill();
  ctx.globalAlpha = 1;
  trace();
  ctx.strokeStyle = primaryColor;
  ctx.lineWidth = 2;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  if (points.length === 1) {
    ctx.lineTo(points[0].x + 0.1, points[0].y);
  }
  ctx.stroke();
}

function effectiveAutomaticLedgerItems(ledgerItems, overrideRows) {
  const snapshots = new Map((overrideRows || []).map((row) => {
    const snapshot = normalizeAutomaticSalesOverride(row);
    return [userDateKey(snapshot.user_id, snapshot.work_date), snapshot];
  }));
  const effective = (ledgerItems || []).filter((item) => !snapshots.has(userDateKey(item.user_id, item.work_date)));
  snapshots.forEach((snapshot) => {
    snapshot.routes.forEach((route) => {
      effective.push({
        user_id: snapshot.user_id,
        work_date: snapshot.work_date,
        route: route.route,
        delivery_count: route.delivery_count,
        unit_snapshot: route.unit_snapshot,
        sort_order: route.sort_order,
        source: "override",
        readOnly: true,
        overrideRevision: snapshot.revision,
      });
    });
  });
  return effective;
}

function manualLedgerItemsForSales(items, overrideRows) {
  const overriddenDates = new Set((overrideRows || []).map((row) => userDateKey(row.user_id, row.work_date)));
  return (items || []).filter((item) => !overriddenDates.has(userDateKey(item.user_id, item.work_date)));
}
function normalizeBundleRows(rows) {
  return (rows || [])
    .map((row) => ({
      ...row,
      label: String(row.label || "").trim(),
      routes: parseScheduleRoutes(row.routes),
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
      const routes = parseScheduleRoutes(routeText);
      const label = (parts.length > 1 ? parts[0] : compactRouteList(routes)).trim();
      return { label, routes, sort_order: index };
    })
    .filter((row) => row.label && row.routes.length >= 1);
}
async function saveRouteBundle({ id = null, label, routes, active = true, sort_order = 0 }) {
  const cleanRoutes = parseScheduleRoutes(routes);
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
function routesFromCell(value) {
  const clean = String(value || "").toUpperCase();
  if (/휴무|OFF/.test(clean)) return null;
  return parseScheduleRoutes(clean);
}
function parseHeaderDate(value) {
  const match = String(value || "").match(/(\d{1,2})\s*[./-]\s*(\d{1,2})/);
  if (!match) return "";
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = month === 12 && state.month === 1 ? state.year - 1
    : month === 1 && state.month === 12 ? state.year + 1 : state.year;
  const parsed = new Date(year, month - 1, day);
  if (parsed.getMonth() + 1 !== month || parsed.getDate() !== day) return "";
  return toDateKey(parsed);
}
async function applySchedule(map) {
  const unresolved = Object.entries(map || {}).filter(([dateKey, routes]) =>
    /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && routes !== null && !routeListFromText(routes).length);
  if (unresolved.length) {
    toast(`구역이 확인되지 않은 ${unresolved.length}일의 근무 구역을 입력하거나 휴무로 선택해 주세요.`, "error");
    return false;
  }
  const changed = [];
  const offKeysWithCounts = Object.entries(map || {})
    .filter(([dateKey, routes]) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && routes === null && hasEnteredCounts(getRecord(dateKey, false)))
    .map(([dateKey]) => dateKey);
  if (offKeysWithCounts.length && !confirmOffWithExistingCounts(offKeysWithCounts)) return;
  const changedEnteredDays = Object.entries(map || {}).filter(([dateKey, routes]) => {
    if (routes === null) return false;
    const record = getRecord(dateKey, false);
    return hasEnteredCounts(record)
      && joinStoredRoutes(record.rows.flatMap((row) => splitStoredRoutes(row.route))) !== joinStoredRoutes(routeListFromText(routes));
  });
  if (changedEnteredDays.length && !window.confirm(`입력한 실적이 있는 ${changedEnteredDays.length}일의 근무표가 바뀝니다.\n${changedEnteredDays.slice(0, 10).map(([dateKey, routes]) => `${dateKey}: ${routeListFromText(routes).join(" · ")}`).join("\n")}\n기존 입력 행과 단가는 보존하고 새 구역을 추가할까요?`)) return false;
  Object.entries(map || {}).forEach(([dateKey, routes]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    const record = getRecord(dateKey, true);
    record.off = routes === null;
    if (routes !== null) record.rows = mergeScheduleRowsWithExisting(record.rows, routes);
    setRecord(dateKey, record);
    changed.push(dateKey);
  });
  if (!changed.length) return;
  scheduleSave({ dateKeys: changed, immediate: true });
  renderAll();
  if (el.app.dataset.view === "record") renderEntryForm();
  try {
    await ensurePendingSavesFlushed();
  } catch (error) {
    if (!error?.quickflexHandled && !error?.quickflexReported) {
      error.quickflexReported = true;
      toast(`스케줄 저장 실패: ${error.message}`, "error");
    }
    return false;
  }
  toast(`스케줄 ${changed.length}일 반영 완료`, "success");
  return true;
}
function extractScheduleJson(text) {
  const raw = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  const source = raw.startsWith("{") ? raw : raw.match(/\{[\s\S]*\}/)?.[0];
  if (!source) return null;
  try {
    const parsed = JSON.parse(source);
    const map = {};
    Object.entries(parsed || {}).forEach(([dateKey, routes]) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey) && (routes === null || Array.isArray(routes) || typeof routes === "string")) {
        map[dateKey] = routes === null ? null : parseScheduleRoutes(routes);
      }
    });
    return Object.keys(map).length ? map : null;
  } catch {
    return null;
  }
}
async function parseScheduleCsv(text) {
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
  return applySchedule(map);
}
function shiftDateMap(dateMap, days) {
  const shifted = {};
  Object.entries(dateMap || {}).forEach(([dateKey, routes]) => { shifted[addDays(dateKey, days)] = routes; });
  return shifted;
}
function setOcrDraft(map, { preserveUnresolved = false } = {}) {
  if (!map) {
    ocrDraftMap = null;
  } else {
    ocrDraftMap = {};
    Object.entries(map).forEach(([dateKey, routes]) => {
      if (routes === null) {
        ocrDraftMap[dateKey] = null;
      } else {
        const corrected = correctRouteList(routes);
        // OCR blanks require confirmation; manual blank workdays may use fixed routes.
        ocrDraftMap[dateKey] = corrected.length ? corrected
          : preserveUnresolved || routeListFromText(routes).length ? [] : draftWorkRoutes();
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
    const readableDate = formatLongShort(dateKey);
    const chips = (routes || []).map((route) => {
      const safeRoute = escapeAttr(route);
      return `<span class="draft-chip">${safeRoute}<button type="button" data-action="remove" data-date="${dateKey}" data-route="${safeRoute}" aria-label="${escapeAttr(`${readableDate} ${route} 구역 삭제`)}">×</button></span>`;
    }).join("");
    const addControl = `<span class="draft-add-row"><input class="draft-add-input" data-date="${dateKey}" type="text" placeholder="구역" autocapitalize="characters" /><button class="draft-add-btn" type="button" data-action="add" data-date="${dateKey}">추가</button></span>`;
    const off = routes === null;
    const missingHint = !off && !routes?.length ? '<p class="hint">구역 확인이 필요합니다. 근무 구역을 추가해 주세요.</p>' : "";
    return `<div class="draft-card"><div class="draft-card-header"><strong>${readableDate}</strong><button class="draft-off-btn${off ? " active" : ""}" type="button" data-action="off" data-date="${dateKey}" aria-pressed="${off}" aria-label="${readableDate} ${off ? "휴무" : "근무"}">${off ? "휴무" : "근무"}</button></div><div>${off ? "휴무" : `${missingHint}${chips}${addControl}`}</div></div>`;
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
    const response = await fetchWithFreshAuth(baseUrl, {
      mode: "vision-schedule",
      imageBase64: image.base64,
      mimeType: image.mimeType,
      ownerName: owner,
      year: state.year,
      month: state.month,
    });
    const result = await readOcrResponse(response);
    const { schedule } = result;
    const pinkOffDates = await detectPinkOffDates(file, result?.debug).catch(() => new Set());
    const map = {};
    Object.entries(schedule || {}).forEach(([dateKey, routes]) => {
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
        map[dateKey] = pinkOffDates.has(dateKey) || routes === null ? null : Array.isArray(routes) ? routes : [];
      }
    });
    if (!Object.keys(map).length) throw new Error("유효한 스케줄이 없습니다.");
    setOcrDraft(map, { preserveUnresolved: true });
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
    const response = await fetchWithFreshAuth(url, {
      kind: "settlement",
      imageBase64: image.base64,
      mimeType: image.mimeType,
      ownerName: driverName(),
      year: state.year,
      month: state.month,
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
  if (!el.adminProfiles || state.profile?.role !== "admin" || !state.db) return;
  const context = captureAccountContext();
  el.adminProfiles.textContent = "가입 정보를 불러오고 있습니다.";
  const { data, error } = await state.db.rpc("quickflex_list_admin_members");
  if (!isAccountContextCurrent(context)) return;
  if (error) { el.adminProfiles.textContent = `가입 정보를 불러오지 못했습니다. ${error.message}`; return; }
  el.adminProfiles.innerHTML = (data || []).filter((profile) => profile.id !== context.userId).map((profile) => `<div class="admin-card" data-id="${escapeAttr(profile.id)}">
    <div class="admin-profile-head"><strong>${escapeAttr(profileNameForDisplay(profile))}</strong><span class="admin-status-pill">${profile.deletion_requested_at ? "탈퇴 요청" : statusLabel(profile.status)}</span></div>
    <div class="admin-card-row"><select data-field="status" aria-label="가입 승인 상태"><option value="pending"${profile.status === "pending" ? " selected" : ""}>대기</option><option value="approved"${profile.status === "approved" ? " selected" : ""}>승인</option><option value="blocked"${profile.status === "blocked" ? " selected" : ""}>차단</option></select><select data-field="driver_type" aria-label="기사 유형"><option value="backup"${profile.driver_type === "backup" ? " selected" : ""}>백업</option><option value="fixed"${profile.driver_type === "fixed" ? " selected" : ""}>고정</option></select><button class="secondary-btn" data-action="save-admin" type="button">저장</button></div>
    <label class="admin-route-field"><span>고정 구역</span><input data-field="fixed_routes" value="${escapeAttr((profile.fixed_routes || []).join(", "))}" placeholder="예: 322A, 322B" /></label>
    <p class="admin-beta-option" role="note">가입 승인 시 측정앱도 함께 사용할 수 있습니다.</p>
  </div>`).join("") || '<p class="hint">표시할 가입 요청이 없습니다.</p>';
}
async function saveAdminProfile(card) {
  const context = captureAccountContext();
  if (!isAccountContextCurrent(context) || state.profile?.role !== "admin") return;
  const driverType = card.querySelector('[data-field="driver_type"]').value;
  const { error } = await state.db.rpc("quickflex_update_admin_member", {
    p_member_id: card.dataset.id,
    p_beta_enabled: card.querySelector('[data-field="status"]').value === "approved",
    p_status: card.querySelector('[data-field="status"]').value,
    p_driver_type: driverType,
    p_fixed_routes: driverType === "fixed" ? expandRouteText(card.querySelector('[data-field="fixed_routes"]').value) : [],
  });
  if (!isAccountContextCurrent(context)) return;
  if (error) throw error;
  toast("가입 정보를 저장했습니다.", "success");
  await renderAdminProfiles();
  void refreshPendingSignupsNotice(context);
}

function syncAdminUsageWindowButtons(windowDays) {
  document.querySelectorAll("[data-usage-window]").forEach((button) => {
    const active = Number(button.dataset.usageWindow) === windowDays;
    button.classList.toggle("is-on", active);
    button.setAttribute("aria-pressed", String(active));
  });
}
async function renderAdminUsageSummary(windowDays = state.adminUsageWindowDays) {
  if (!el.adminUsageSummary || state.profile?.role !== "admin" || !state.db) return;
  state.adminUsageWindowDays = windowDays === 7 ? 7 : USAGE_SCREEN_SUMMARY_DEFAULT_WINDOW;
  syncAdminUsageWindowButtons(state.adminUsageWindowDays);
  const context = captureAccountContext();
  el.adminUsageSummary.innerHTML = '<p class="hint">사용 현황을 불러오고 있습니다.</p>';
  try {
    const rows = await fetchUsageScreenSummary(state.db, { windowDays: state.adminUsageWindowDays });
    if (!isAccountContextCurrent(context)) return;
    if (!rows.length) {
      el.adminUsageSummary.innerHTML = '<p class="hint">아직 모인 사용 기록이 없어요</p>';
      return;
    }
    el.adminUsageSummary.innerHTML = formatUsageScreenSummary(rows).map((row) => `<div class="usage-summary-row"><span class="usage-summary-label">${escapeAttr(row.label)}</span><span class="usage-summary-counts">${escapeAttr(row.countsText)}</span></div>`).join("");
  } catch (error) {
    if (!isAccountContextCurrent(context)) return;
    el.adminUsageSummary.innerHTML = `<p class="hint admin-usage-error">사용 현황을 불러오지 못했습니다. ${escapeAttr(error.message)}</p>`;
  }
}
function applyPendingSignupsNotice(data) {
  const visible = shouldShowPendingSignupsNotice(data);
  state.pendingSignupsNotice = visible ? data : null;
  if (el.pendingSignupsBanner) {
    el.pendingSignupsBanner.textContent = visible ? pendingSignupsBannerText(data) : "";
    el.pendingSignupsBanner.classList.toggle("hidden", !visible);
  }
  const gearLabel = pendingSignupsGearLabel(visible ? data : null);
  document.querySelectorAll("[data-open-settings]").forEach((button) => {
    button.classList.toggle("has-pending-dot", visible);
    button.setAttribute("aria-label", gearLabel);
  });
}
async function refreshPendingSignupsNotice(context = captureAccountContext()) {
  if (!isAccountContextCurrent(context) || state.profile?.role !== "admin" || !state.db) {
    if (isAccountContextCurrent(context)) applyPendingSignupsNotice(null);
    return;
  }
  try {
    const data = await fetchPendingSignups(state.db);
    if (!isAccountContextCurrent(context)) return;
    applyPendingSignupsNotice(data);
  } catch (error) {
    if (!isAccountContextCurrent(context)) return;
    console.warn("[QuickFlex] 가입 승인 대기 조회 실패", error);
    applyPendingSignupsNotice(null);
  }
}
function openPendingSignupsApproval() {
  showView("settings");
  const operationDetails = $("operationSettings");
  const memberDetails = $("memberSettings");
  if (operationDetails) operationDetails.open = true;
  if (memberDetails) memberDetails.open = true;
  renderAdminProfiles().catch(() => {});
  requestAnimationFrame(() => {
    el.adminProfiles?.scrollIntoView({ behavior: "smooth", block: "start" });
    el.adminProfiles?.focus({ preventScroll: true });
  });
}

function makeSalesOverrideRequestId() {
  return globalThis.crypto?.randomUUID?.()
    || `sales-override-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function seedSalesOverrideRows(dateKey, snapshot) {
  if (snapshot) {
    return {
      rows: snapshot.routes.map((row) => ({ route: row.route, count: row.delivery_count, unit: row.unit_snapshot })),
      warning: "",
    };
  }
  const receipt = state.receiptEntries[dateKey] || getRecord(dateKey, false);
  const groups = new Map();
  let hasGroupedManualRoute = false;
  (receipt.rows || []).forEach((row) => {
    const baseRoute = normalizeBaseSalesRoute(row.route);
    const route = baseRoute || (!isAutomaticRow(row) ? joinStoredRoutes(row.route) : "");
    if (!route) return;
    if (!baseRoute) hasGroupedManualRoute = true;
    const count = toNum(row.count);
    // Override unit snapshots include backup pay, unlike original manual rows.
    const unit = effectiveUnit(row) + (!isAutomaticRow(row) && receipt.driverType === "backup"
      ? toNum(defaultBackupUnit(receipt.backupUnit)) : 0);
    const current = groups.get(route) || { route, count: 0, revenue: 0, units: new Set() };
    current.count += count;
    current.revenue += count * unit;
    current.units.add(unit);
    groups.set(route, current);
  });
  let mergedDifferentUnits = false;
  const rows = [...groups.values()].sort((a, b) => a.route.localeCompare(b.route)).map((row) => {
    if (row.units.size > 1) mergedDifferentUnits = true;
    return {
      route: row.route,
      count: row.count,
      unit: row.count > 0 ? Math.round(row.revenue / row.count) : [...row.units][0] || rateFor(row.route),
    };
  });
  return {
    rows: rows.length ? rows : [{ route: "", count: 0, unit: 0 }],
    warning: [
      mergedDifferentUnits ? "같은 A/B 구역에 서로 다른 원본 단가가 있어 가중 평균 단가로 시작했습니다. 저장 전 단가를 확인해 주세요." : "",
      hasGroupedManualRoute ? "수기 묶음 구역의 합계는 보존했습니다. 매출을 수정해 저장하려면 A/B 구역별 건수를 나눠 입력해 주세요." : "",
    ].filter(Boolean).join(" "),
  };
}
function setSalesOverrideStatus(message, type = "") {
  if (!el.salesOverrideStatus) return;
  el.salesOverrideStatus.textContent = message || "";
  el.salesOverrideStatus.className = `sales-override-status${type ? ` ${type}` : ""}`;
  el.salesOverrideStatus.setAttribute("role", type === "error" ? "alert" : "status");
  el.salesOverrideStatus.setAttribute("aria-live", type === "error" ? "assertive" : "polite");
}
function markSalesOverrideDraftDirty() {
  if (!state.salesOverrideDraft) return;
  state.salesOverrideDraft.dirty = true;
  state.salesOverrideDraft.requestId = "";
  setSalesOverrideStatus("");
}
function renderSalesOverrideRows() {
  const draft = state.salesOverrideDraft;
  if (!draft || !el.salesOverrideRows) return;
  el.salesOverrideRows.innerHTML = draft.rows.length ? draft.rows.map((row, index) => {
    const revenue = toNum(row.count) * toNum(row.unit);
    return `<div class="sales-override-row" data-index="${index}">
      <label class="sales-override-route-field" for="salesOverrideRoute${index}"><span>구역</span><input id="salesOverrideRoute${index}" class="sales-override-route" type="text" autocapitalize="characters" autocomplete="off" placeholder="318A" value="${escapeAttr(row.route)}" /></label>
      <label class="sales-override-count-field" for="salesOverrideCount${index}"><span>상품수</span><input id="salesOverrideCount${index}" class="sales-override-count" type="number" min="0" step="1" inputmode="numeric" value="${escapeAttr(row.count)}" /></label>
      <label class="sales-override-unit-field" for="salesOverrideUnit${index}"><span>단가</span><input id="salesOverrideUnit${index}" class="sales-override-unit" type="number" min="0" step="1" inputmode="numeric" value="${escapeAttr(row.unit)}" /></label>
      <output aria-label="행 매출">${fmtWon(revenue)}</output>
      <button class="sales-override-delete" type="button" aria-label="${index + 1}행 삭제">×</button>
    </div>`;
  }).join("") : `<p class="sales-override-empty">구역을 1행 이상 추가해 주세요.</p>`;
  el.salesOverrideRows.querySelectorAll(".sales-override-row").forEach((node) => {
    const index = Number(node.dataset.index);
    const route = node.querySelector(".sales-override-route");
    const count = node.querySelector(".sales-override-count");
    const unit = node.querySelector(".sales-override-unit");
    const output = node.querySelector("output");
    [route, count, unit].forEach((input) => { input.disabled = Boolean(draft.saving); });
    node.querySelector(".sales-override-delete").disabled = Boolean(draft.saving);
    const refreshRow = () => { output.textContent = fmtWon(toNum(count.value) * toNum(unit.value)); };
    route.addEventListener("input", () => {
      route.value = route.value.toUpperCase();
      draft.rows[index].route = route.value;
      markSalesOverrideDraftDirty();
    });
    route.addEventListener("blur", () => {
      route.value = normalizeRoute(route.value);
      draft.rows[index].route = route.value;
    });
    count.addEventListener("input", () => {
      draft.rows[index].count = count.value;
      markSalesOverrideDraftDirty();
      refreshRow();
    });
    unit.addEventListener("input", () => {
      draft.rows[index].unit = unit.value;
      markSalesOverrideDraftDirty();
      refreshRow();
    });
    node.querySelector(".sales-override-delete").addEventListener("click", () => {
      draft.rows.splice(index, 1);
      markSalesOverrideDraftDirty();
      renderSalesOverrideRows();
    });
  });
  el.salesOverrideAddRoute.disabled = draft.saving || draft.rows.length >= 100;
  el.salesOverrideSave.disabled = Boolean(draft.saving);
  el.salesOverrideClose.disabled = Boolean(draft.saving);
  el.salesOverrideReason.disabled = Boolean(draft.saving);
}
function openSalesOverride(dateKey = state.selectedDate) {
  const receipt = state.receiptEntries[dateKey] || getRecord(dateKey, false);
  if (!hasAutomaticEntries(receipt)) {
    toast("앱 자동기록이 있는 날짜만 매출을 수정할 수 있습니다.", "error");
    return false;
  }
  const snapshot = hasAutomaticSalesOverride(dateKey) ? state.automaticSalesOverrides[dateKey] : null;
  const seed = seedSalesOverrideRows(dateKey, snapshot);
  state.salesOverrideDraft = {
    dateKey,
    revision: snapshot?.revision ?? null,
    rows: seed.rows,
    basisCounts: { ...receipt.salesBasisCounts },
    reason: snapshot?.reason || "",
    requestId: "",
    dirty: false,
    saving: false,
  };
  el.salesOverrideTitle.textContent = `${formatLongShort(dateKey)} 매출 수정`;
  el.salesOverrideReason.value = state.salesOverrideDraft.reason;
  renderSalesOverrideRows();
  const contractWarning = state.salesOverrideContractAvailable
    ? ""
    : "서버 업데이트 전이라 저장은 실패할 수 있습니다. 실패해도 입력은 이 창에 유지됩니다.";
  setSalesOverrideStatus([seed.warning, contractWarning].filter(Boolean).join(" "), seed.warning ? "warning" : "");
  el.salesOverrideOverlay.classList.add("visible");
  updateModalLayer(el.salesOverrideOverlay, true, ".sales-override-route");
  return true;
}
function closeSalesOverride(force = false) {
  const draft = state.salesOverrideDraft;
  if (!force && draft?.saving) return false;
  if (!force && draft?.dirty && !window.confirm("저장하지 않은 매출 수정 입력이 있습니다. 닫을까요?")) return false;
  el.salesOverrideOverlay?.classList.remove("visible");
  updateModalLayer(el.salesOverrideOverlay, false);
  state.salesOverrideDraft = null;
  return true;
}
function automaticSalesOverrideResult(data) {
  let value = Array.isArray(data) ? data[0] : data;
  if (typeof value === "string") {
    try { value = JSON.parse(value); } catch (_) {}
  }
  value = value?.override || value?.snapshot || value;
  return value && typeof value === "object" && value.work_date && Array.isArray(value.routes)
    ? normalizeAutomaticSalesOverride(value)
    : null;
}
async function persistAutomaticSalesSnapshot({ dateKey, revision, requestId, reason, rows, basisCounts, context }) {
  const payload = salesOverridePayload(rows);
  if (payload.issues.length) {
    const error = new Error(payload.issues.slice(0, 3).join(" "));
    error.code = "QUICKFLEX_OVERRIDE_INPUT";
    error.issues = payload.issues;
    throw error;
  }
  if (!basisCounts || !Object.keys(basisCounts).length) {
    throw new Error("자동 배송 기록을 새로고침한 뒤 다시 수정해 주세요.");
  }
  const { data, error } = await state.db.rpc(RPC.replaceTeamSalesOverride, {
    p_work_date: dateKey,
    p_expected_revision: revision ?? 0,
    p_request_id: requestId,
    p_reason: reason || "사용자 날짜별 매출 수정",
    p_routes: payload.routes,
    p_basis_counts: basisCounts,
  });
  if (!isAccountContextCurrent(context)) throw staleAccountSaveError();
  if (error) throw error;
  let snapshot = automaticSalesOverrideResult(data);
  if (!snapshot) {
    const refreshed = await fetchAutomaticSalesOverrides({ userId: context.userId, startKey: dateKey, endKey: dateKey });
    snapshot = refreshed.rows.map(normalizeAutomaticSalesOverride).find((row) => row.work_date === dateKey) || null;
  }
  if (!isAccountContextCurrent(context)) throw staleAccountSaveError();
  if (!snapshot || snapshot.work_date !== dateKey) throw new Error("저장된 매출 수정본을 확인하지 못했습니다.");
  return snapshot;
}
function applyAutomaticSalesSnapshot(dateKey, snapshot, sourceRecord = state.entries[dateKey]) {
  state.automaticSalesOverrides[dateKey] = snapshot;
  state.salesOverrideContractAvailable = true;
  const effective = applyAutomaticSalesOverrideToRecord(sourceRecord, snapshot);
  state.entries[dateKey] = effective;
  if (state.recordDraftDate === dateKey && state.recordDraft) {
    state.recordDraft = applyAutomaticSalesOverrideToRecord(state.recordDraft, snapshot);
  }
  return effective;
}
async function saveSalesOverride() {
  const draft = state.salesOverrideDraft;
  if (!draft || draft.saving || !state.db || !currentUserId()) return false;
  const payload = salesOverridePayload(draft.rows);
  if (payload.issues.length) {
    setSalesOverrideStatus(payload.issues.slice(0, 3).join(" "), "error");
    el.salesOverrideRows.querySelector("input")?.focus();
    return false;
  }
  const context = captureAccountContext();
  draft.saving = true;
  draft.reason = el.salesOverrideReason.value.trim();
  draft.requestId ||= makeSalesOverrideRequestId();
  renderSalesOverrideRows();
  setSalesOverrideStatus("매출 수정본을 저장하는 중입니다.");
  try {
    const snapshot = await persistAutomaticSalesSnapshot({
      dateKey: draft.dateKey,
      revision: draft.revision,
      requestId: draft.requestId,
      reason: draft.reason,
      rows: draft.rows,
      basisCounts: draft.basisCounts,
      context,
    });
    applyAutomaticSalesSnapshot(draft.dateKey, snapshot);
    draft.dirty = false;
    closeSalesOverride(true);
    renderAll();
    if (el.app.dataset.view === "record" && state.selectedDate === snapshot.work_date) renderEntryForm();
    toast("매출 수정본을 저장했습니다. 자동기록 원본은 그대로 보존됩니다.", "success");
    return true;
  } catch (error) {
    draft.saving = false;
    renderSalesOverrideRows();
    const missing = isOptionalSalesContractMissing(error);
    const conflict = String(error?.message || "").toLowerCase().includes("revision") || String(error?.code || "") === "40001";
    const message = missing
      ? "매출 수정 서버 업데이트가 아직 적용되지 않았습니다. 입력은 이 창에 유지됩니다."
      : conflict
        ? "다른 기기에서 이 날짜를 먼저 수정했습니다. 입력은 유지됩니다. 새로고침 후 다시 확인해 주세요."
        : `매출 수정본 저장 실패: ${error.message || "알 수 없는 오류"} 입력은 유지됩니다.`;
    setSalesOverrideStatus(message, "error");
    return false;
  }
}

function openSheet() {
  el.dbOverlay.classList.add("open");
  el.dbSheet.classList.add("open");
  updateModalLayer(el.dbSheet, true, el.supabaseUrl);
}
function closeSheet() {
  el.dbOverlay.classList.remove("open");
  el.dbSheet.classList.remove("open");
  updateModalLayer(el.dbSheet, false);
}

// Welcome text and suggested questions depend on the work phase; nothing here is stored.
function currentNoahBriefing(now = new Date()) {
  const today = koreanDateKey(now);
  const dates = currentWorkDates(now);
  const todayRecord = getRecord(today, false);
  const nextRecord = getRecord(dates.nextWorkDate, false);
  const lease = state.activeMeasurementLease;
  const active = lease?.user_id === currentUserId() && !lease?.released_at
    && Date.parse(lease?.lease_expires_at) > now.getTime();
  const routes = state.workDateDataLoaded && !nextRecord.off
    ? [...new Set((nextRecord.rows || []).flatMap((row) => splitStoredRoutes(row.route)))] : [];
  const known = state.workDateDataLoaded;
  const phase = active ? "active" : known && hasAutomaticEntries(todayRecord) ? "completed"
    : known && todayRecord.off ? "off" : routes.length ? "beforeShift" : "default";
  const [, month, day] = dates.nextWorkDate.split("-");
  const workDateLabel = `${Number(month)}/${Number(day)}`;
  const workShift = isNightShift() ? "night" : "day";
  const period = periodForDate(parseDateKey(today));
  const keys = periodKeysFor(period.year, period.month);
  return { phase, workShift, nextWorkDate: dates.nextWorkDate, workDateLabel,
    workDateCaption: workShift === "night"
      ? `${dates.nextWorkDate > today ? "오늘 밤 " : ""}${workDateLabel} 마감` : `${workDateLabel} 업무`,
    routes,
    closing: keys.slice(-3).includes(today),
  };
}

function openNoahLink(link) {
  const target = link?.target;
  const validDate = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T12:00:00Z`))
    && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
  if (!target || state.profile?.status !== "approved") return;
  if (link.kind === "day" && validDate(target.date)) {
    const period = periodForDate(parseDateKey(target.date));
    state.year = period.year; state.month = period.month;
    selectDate(target.date);
    if (state.selectedDate !== target.date) return;
    showView("record");
  } else if (link.kind === "route" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(target.zoneId || "")) {
    showView("routes", { route: target.zoneId });
  } else if (link.kind === "stats" && validDate(target.from) && validDate(target.to)
      && target.from <= target.to && dateRangeDayCount(target.from, target.to) <= MAX_CUSTOM_RANGE_DAYS) {
    state.statsRangeMode = "custom";
    state.statsRangeModeUserSet = true;
    state.statsRangeCustom = { from: target.from, to: target.to };
    showView("stats");
  } else if (link.kind === "expenses" || link.kind === "settings") {
    showView(link.kind);
  }
}

function bindNoah() {
  if (noahController) return;
  noahController = createNoahController({
    thread: el.noahThread, form: el.noahAskForm, input: el.noahInput,
    suggestions: document.querySelector(".noah-suggestions"),
    getContext: () => ({ client: state.db, userId: currentUserId(), epoch: accountEpoch,
      approved: state.profile?.status === "approved",
      supabaseUrl: el.supabaseUrl.value, anonKey: el.supabaseAnonKey.value,
      noticeAcknowledgedAt: state.profile?.noah_notice_acknowledged_at }),
    getBriefingContext: currentNoahBriefing,
    onNavigate: openNoahLink,
    onNoticeAcknowledged: (timestamp) => {
      if (state.profile) state.profile.noah_notice_acknowledged_at = timestamp;
    },
    onChanged: async () => {
      const context = captureAccountContext();
      invalidateSummaryLedger();
      if (!await loadProfile(context) || !isAccountContextCurrent(context)) return;
      applyProfileUi();
      await loadFromDb(context);
      if (isAccountContextCurrent(context)) renderAll();
    },
  });
}

function bindEvents() {
  $("homeRouteNotes")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-open-route-note]");
    if (button) showView("routes", { route: button.dataset.openRouteNote });
  });
  document.querySelectorAll("[data-open-expenses]").forEach((button) => button.addEventListener("click", () => showView("expenses")));
  document.querySelectorAll("[data-open-stats]").forEach((button) => button.addEventListener("click", () => showView("stats")));
  document.querySelectorAll("[data-open-settings]").forEach((button) => button.addEventListener("click", () => {
    showView("settings");
    if (button.hasAttribute("data-open-admin")) { const panel = $("operationSettings"); if (panel) panel.open = true; }
  }));
  document.querySelectorAll("[data-ledger]").forEach((button) => button.addEventListener("click", () => {
    motion.pressPop(button);
    showView(button.dataset.ledger);
  }));
  el.pendingSignupsBanner?.addEventListener("click", () => openPendingSignupsApproval());
  document.querySelectorAll("[data-usage-window]").forEach((button) => button.addEventListener("click", () => {
    renderAdminUsageSummary(Number(button.dataset.usageWindow) === 7 ? 7 : 30);
  }));
  bindNoah();
  $("retryPendingSave")?.addEventListener("click", () => reviewPendingSave().catch((error) => toast(error.message, "error")));
  $("useServerRecord")?.addEventListener("click", () => reviewPendingSave(true).catch((error) => toast(error.message, "error")));
  $("showRetainedEdits")?.addEventListener("click", () => {
    if (!state.retainedEdits) return;
    $("retainedEditsText").value = state.retainedEdits.map((item) => recordInputSummary(item.dateKey, item.record)).join("\n\n────────\n\n");
    $("retainedEditsText").hidden = false;
    $("retainedEditsText").focus();
    $("retainedEditsText").select();
  });
  $("pendingRefresh")?.addEventListener("click", async () => {
    const button = $("pendingRefresh");
    button.disabled = true;
    try { await bootSignedInUser(); } catch (error) { toast(error.message, "error"); }
    finally { button.disabled = false; }
  });
  window.addEventListener("online", () => {
    if (state.pendingDates.size || state.pendingRates) void flushSaves().catch(() => {});
  });
  window.addEventListener("beforeunload", (event) => {
    if (!state.pendingDates.size && !state.pendingRates && !state.flushPromise && !state.retainedEdits && !state.recordDraft && !routeNotesController?.isDirty?.()) return;
    event.preventDefault();
    event.returnValue = "";
  });
  const shared = {
    el,
    state,
    TABLES,
    addAdminBundleFromInputs,
    addDays,
    applySchedule,
    applySettlementRows,
    applyTheme,
    applyRateUpdateOffer,
    clearProfileSignature: () => profileSignaturePad?.clear(),
    openSignatureEditor,
    closeSignatureEditor,
    closeSheet,
    confirmOffWithExistingCounts,
    confirmLeaveRecordDraft,
    connectDb,
    correctRouteList,
    currentRecordDraft,
    currentUserId,
    clearNoahHistory: (userId = currentUserId()) => noahController?.clearAccount(userId),
    captureAccountContext,
    isAccountContextCurrent,
    defaultEntryRows,
    deleteAdminBundleCard,
    discardRecordDraft,
    draftWorkRoutes,
    driverName,
    ensurePendingSavesFlushed,
    getRecord,
    hasAutomaticEntries,
    hasEnteredCounts,
    importAdminBundles,
    isBackupDriver,
    isKnownRateRoute,
    loadFromDb,
    login,
    logout,
    moveMonth,
    moveStatsMonth,
    normalizeRoute,
    ocrDraftState: { get: () => ocrDraftMap },
    openSheet,
    openInspection,
    parseScheduleCsv,
    parseSettlementCsv,
    previewImageFile,
    refreshTotals,
    renderAdminProfiles,
    renderAdminBundles,
    renderAdminUsageSummary,
    renderAll,
    renderDraftCards,
    renderEntryForm,
    renderInspection,
    renderMonth,
    renderRates,
    renderStats,
    routeListFromText,
    runOcr,
    runSettlementOcr,
    saveAdminBundleCard,
    saveAdminProfile,
    saveCurrentRecordAndGoHome,
    saveGoalAmount,
    saveInspection,
    saveInspectionSignature,
    saveProfile,
    saveWorkPreferences,
    scheduleSave,
    selectDate,
    selectToday,
    setAllInspectionResults,
    setInspectionNoOperation,
    sendPasswordReset,
    setAuthMode,
    setOcrDraft,
    setCalendarRoutesPreference,
    shouldShowCalendarRoutes,
    showView,
    signup,
    startRecordDraft,
    syncFormToRecord,
    trackStatsControl,
    statsRangeDayCount: dateRangeDayCount,
    maxStatsCustomRangeDays: MAX_CUSTOM_RANGE_DAYS,
    syncStatsToCurrentPeriod,
    toDateKey,
    toast,
    printInspectionMonth,
    saveInspectionMonthPdf,
    resetInspectionDraft,
    updatePassword,
    upsertRate,
  };
  bindAuthEvents(shared);
  bindCalendarEvents(shared);
  bindInspectionEvents(shared);
  bindRecordEvents(shared);
  bindStatsEvents(shared);
  bindAdminEvents(shared);
  bindSettingsEvents(shared);
  bindFinanceEvents();
  bindOcrEvents(shared);
  el.openSalesOverride?.addEventListener("click", () => {
    startRecordDraft(state.selectedDate);
    showView("record");
  });
  el.salesOverrideAddRoute?.addEventListener("click", () => {
    const draft = state.salesOverrideDraft;
    if (!draft || draft.rows.length >= 100) return;
    draft.rows.push({ route: "", count: 0, unit: 0 });
    markSalesOverrideDraftDirty();
    renderSalesOverrideRows();
    el.salesOverrideRows.querySelector(".sales-override-row:last-child .sales-override-route")?.focus();
  });
  el.salesOverrideReason?.addEventListener("input", () => {
    if (!state.salesOverrideDraft) return;
    state.salesOverrideDraft.reason = el.salesOverrideReason.value;
    markSalesOverrideDraftDirty();
  });
  el.salesOverrideSave?.addEventListener("click", saveSalesOverride);
  el.salesOverrideClose?.addEventListener("click", () => closeSalesOverride());
  el.acknowledgeUpdateNotice?.addEventListener("click", acknowledgeAppUpdateNotice);
  el.openMeasurementNotice?.addEventListener("click", openMeasurementFromNotice);
  bindModalAccessibility();
  el.measurementWorkDate?.addEventListener("change", () => {
    if (!el.measurementWorkDate.value) return;
    state.measurementDate = el.measurementWorkDate.value;
    state.measurementDateAuto = false;
    renderMeasurementBridge();
  });
  el.openPaceApp?.addEventListener("click", openPaceMeasurementApp);
  el.openPaceAppFallback?.addEventListener("click", (event) => {
    event.preventDefault();
    openPaceMeasurementApp({ forceOpen: true });
  });
  el.openMeasurementGuide?.addEventListener("click", openMeasurementGuide);
  el.closeMeasurementGuide?.addEventListener("click", closeMeasurementGuide);
  el.measurementGuideDone?.addEventListener("click", closeMeasurementGuide);
  el.measurementGuideOverlay?.addEventListener("click", (event) => {
    if (event.target === el.measurementGuideOverlay) closeMeasurementGuide();
  });
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible") return;
    syncNativeRouteNotesState();
    void requestNativeSessionSync();
    if (!currentUserId()) return;
    if (el.app.dataset.view === "measurement") refreshMeasurementAppAvailability();
    await refreshAfterNativeMeasurement();
  });
  window.addEventListener("quickflex-native-resume", () => {
    syncNativeRouteNotesState();
    void requestNativeSessionSync();
    void refreshAfterNativeMeasurement();
  });
  window.addEventListener("quickflex-native-synced", refreshAfterNativeMeasurement);
  window.addEventListener("quickflex-native-session-request", () => {
    syncNativeRouteNotesState();
    void requestNativeSessionSync();
  });
}

async function init() {
  purgeLegacyNoahStorage();
  profileSignaturePad = createSignaturePad(el.profileSignatureCanvas);
  bindEvents();
  if (isNativeShell(window)) {
    // It watches screen, popup and focus changes itself; see src/ui/native-pull-refresh.js.
    createNativePullRefresh({
      getView: () => el.app?.dataset.view || "home",
      isSignedIn: () => Boolean(currentUserId()),
      isModalOpen: () => Boolean(activeModalLayer()),
      refresh: refreshForPull,
      post: postNativeMessage,
      notify: (ok) => toast(
        ok ? "최신 기록을 불러왔어요." : "새로 불러오지 못했어요. 잠시 뒤 다시 당겨 주세요.",
        ok ? "success" : "error"
      ),
    });
  }
  renderAll();
  const cfg = getDbConfig();
  if (!cfg.url || !cfg.anonKey) {
    if (canUseManualDbConfig()) {
      showSetup(true);
    } else {
      showDeploymentConfigError();
    }
    window.FlexNoteStartup?.finish();
    return;
  }
  try {
    await connectDb(cfg.url, cfg.anonKey, false);
  } catch (error) {
    console.error("[init]", error);
    if (window.FlexNoteStartup?.fail()) return;
    if (canUseManualDbConfig()) {
      showSetup(true);
      el.setupError.textContent = error.message;
    } else {
      showDeploymentConfigError();
    }
  }
}


let expensesController = null;
let noahController = null;
let exportsController = null;
let calendarSyncController = null;
let routeNotesController = null;
let routeNotesService = null;
let routeNoteShareService = null;
let routeNoteShareDialog = null;

function ensureRouteNotesController() {
  if (!routeNotesService) routeNotesService = createRouteNotesService({
    getContext: () => ({ client: state.db, user: state.session?.user, profile: state.profile, epoch: accountEpoch }),
  });
  if (!routeNoteShareService) routeNoteShareService = createRouteNoteShareService({
    getContext: () => ({ client: state.db, user: state.session?.user, profile: state.profile, epoch: accountEpoch }),
  });
  if (!routeNoteShareDialog) routeNoteShareDialog = createRouteNoteShareDialog({
    service: routeNoteShareService,
    getShareBaseUrl: () => PUBLIC_SITE_URL || window.location.href,
  });
  if (!routeNotesController) routeNotesController = createRouteNotesController({
    root: $("routeNotesContent"), service: routeNotesService,
    shareDialog: routeNoteShareDialog,
    getUser: () => state.session?.user, getProfile: () => state.profile,
    notify: (message, kind) => toast(message, kind), mapClientId: ROUTE_NOTES_CONFIG.mapClientId,
  });
  return routeNotesController;
}

function requireFinanceAccount(context = captureAccountContext()) {
  if (!context.userId || !state.db || !isAccountContextCurrent(context)) throw new Error("로그인 상태가 변경되었습니다. 다시 열어 주세요.");
  return context;
}
function ownExpenseService() {
  const context = requireFinanceAccount();
  const service = createExpenseService(state.db);
  return Object.fromEntries(Object.entries(service).map(([name, action]) => [name, async (...args) => {
    requireFinanceAccount(context);
    const result = await action(...args);
    requireFinanceAccount(context);
    return result;
  }]));
}
function ensureExpenseController() {
  if (!expensesController) expensesController = createExpensesController({ host: $("expensesContent"), getService: ownExpenseService, toast });
  return expensesController;
}
async function currentFinanceSnapshot(from, to) {
  const context = requireFinanceAccount();
  await ensurePendingSavesFlushed();
  requireFinanceAccount(context);
  const loaded = await loadFromDb(context);
  requireFinanceAccount(context);
  if (!loaded) throw new Error("최신 매출 자료를 확인하지 못했습니다. 다시 시도해 주세요.");
  return { context, days: statsDailyRecords().filter((day) => day.dateKey >= from && day.dateKey <= to) };
}
async function getCalendarSyncDays(from, to) {
  const { days } = await currentFinanceSnapshot(from, to);
  return days.map((day) => ({ date: day.dateKey, off: day.off, worked: day.worked, hasSchedule: day.planned,
    revenue: !day.off && (day.worked || hasEnteredCounts(state.entries[day.dateKey])) ? day.revenue : null,
    routeLabel: (state.entries[day.dateKey]?.rows || []).map((row) => row.route).filter(Boolean).join(" "),
    workShift: state.profile?.work_shift === "night" ? "night" : "day" }));
}
async function getExportInput({ from, to }) {
  const { context, days } = await currentFinanceSnapshot(from, to);
  const sales = days.filter((day) => day.worked && !day.off).map((day) => ({
    date: day.dateKey, revenue: day.revenue, count: day.count,
    deliveryRevenue: day.revenue - day.freshRevenue - day.backupRevenue,
    freshRevenue: day.freshRevenue, backupRevenue: day.backupRevenue,
    source: state.automaticSalesOverrides?.[day.dateKey] ? "매출 수정 적용" : "내 매출 기록",
  }));
  const expenses = await ownExpenseService().list({ from, to, includeDrafts: true });
  requireFinanceAccount(context);
  return { sales, expenses, businessInfo: { name: state.profile?.display_name || "", businessName: state.profile?.business_name || "" } };
}
function openRecordsExport() {
  if (!exportsController) exportsController = createExportsController({ host: $("exportsContent"), getExportInput,
    fetchReceipt: async (receipt) => {
      const context = requireFinanceAccount();
      const url = await ownExpenseService().receiptUrl(receipt);
      requireFinanceAccount(context);
      const response = await fetch(url, { cache: "no-store", credentials: "omit" });
      if (!response.ok) throw new Error("증빙 파일을 내려받지 못했습니다.");
      const blob = await response.blob();
      requireFinanceAccount(context);
      return blob;
    } });
  exportsController.open();
}
function bindFinanceEvents() {
  document.querySelectorAll("[data-open-export]").forEach((button) => button.addEventListener("click", openRecordsExport));
  document.querySelectorAll("[data-open-schedule]").forEach((button) => button.addEventListener("click", () => showView("schedule")));
  document.querySelectorAll("[data-back-settings]").forEach((button) => button.addEventListener("click", () => showView("settings")));
  document.querySelectorAll("[data-open-inspection]").forEach((button) => button.addEventListener("click", () => openInspection()));
  $("calendarSyncSettings").addEventListener("toggle", () => {
    if (!$("calendarSyncSettings").open || calendarSyncController) return;
    calendarSyncController = mountCalendarSync({ host: $("calendarSyncContent"), db: state.db, getDays: getCalendarSyncDays, toast });
  });
}


init().catch((error) => {
  console.error("[startup]", error);
  window.FlexNoteStartup?.fail();
});
