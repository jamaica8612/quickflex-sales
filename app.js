"use strict";

/* ══ 포맷터 ══ */
const fmt = new Intl.NumberFormat("ko-KR");
const fmtWon = (n) => `₩${fmt.format(Math.round(n))}`;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/* ══ 상수 ══ */
const GOAL = 6_000_000;
const DB_KEY = "quickflex-supabase-config";
const OWNER_ID = "kim-gwanhyun";

/* ══ 샘플 데이터 ══ */
const SAMPLE_SETTLEMENT = [
  ["302C",237,231075],["303B",573,544350],["304C",53,49025],["308B",165,159225],
  ["308C",154,148610],["310C",473,404415],["310D",370,334895],["311C",139,142475],
  ["311D",173,173865],["313B",194,163930],["313C",57,52725],["313D",186,162750],
  ["314A",305,236375],["314B",210,166950],["316C",177,146025],["316D",80,70000],
  ["318A",179,142305],["318B",132,108900],["318C",360,286200],["318D",58,46110],
  ["319A",212,174900],["319B",189,155925],["319C",106,108650],["322A",281,231825],
  ["322B",230,212750],["322C",224,229600],["322D",179,183475],["324C",127,117475],
  ["324D",50,53750],["407B",218,179850],["407D",54,44550],
];

const SAMPLE_SCHEDULE = {
  "2026-04-20":["313B","313C"],"2026-04-21":["303A","302B"],
  "2026-04-22":["303C","302D"],"2026-04-23":["319A","319B","319C","319D"],
  "2026-04-24":["310C","310D"],"2026-04-25":["303A","302B"],
};

/* ══ 상태 ══ */
const state = {
  year: 2026, month: 4,
  selectedDate: toDateKey(new Date()),
  mode: "amount",
  statsTab: "monthly",
  statsYear: null, statsMonth: null,   // null = 홈과 동기화
  rates: loadRates(),
  entries: loadEntries(),
};

/* ══ DOM 참조 ══ */
const $ = (id) => document.getElementById(id);
const el = {
  app: document.querySelector(".app"),
  // 홈
  periodRevenue: $("periodRevenue"), periodCount: $("periodCount"),
  dailyAverage: $("dailyAverage"), workDaysHome: $("workDaysHome"),
  meterFill: $("meterFill"), periodRange: $("periodRange"),
  monthTitle: $("monthTitle"), periodRangeShort: $("periodRangeShort"),
  monthCalendar: $("monthCalendar"),
  prevMonth: $("prevMonth"), nextMonth: $("nextMonth"), todayButton: $("todayButton"),
  homeSelectedDate: $("homeSelectedDate"), homeSelectedTotal: $("homeSelectedTotal"),
  openRecord: $("openRecord"), openSettings: $("openSettings"),
  // 기록
  backToCalendar: $("backToCalendar"),
  prevDay: $("prevDay"), nextDay: $("nextDay"),
  selectedDateTitle: $("selectedDateTitle"),
  offToggle: $("offToggle"), recordBody: $("recordBody"),
  copySchedule: $("copySchedule"), addRoute: $("addRoute"),
  entryRows: $("entryRows"),
  freshCount: $("freshCount"), freshUnit: $("freshUnit"), freshRevenue: $("freshRevenue"),
  selectedDayTotal: $("selectedDayTotal"),
  // 통계
  statsMonthTitle: $("statsMonthTitle"), statsRange: $("statsRange"),
  statsRevenue: $("statsRevenue"), statsMeterFill: $("statsMeterFill"),
  statsWorkDays: $("statsWorkDays"), statsOffDays: $("statsOffDays"),
  statsCount: $("statsCount"), statsFresh: $("statsFresh"),
  statsAverage: $("statsAverage"), statsBestDay: $("statsBestDay"), statsBestAmount: $("statsBestAmount"),
  deltaWorkDays: $("deltaWorkDays"), deltaOffDays: $("deltaOffDays"),
  deltaCount: $("deltaCount"), deltaFresh: $("deltaFresh"), deltaAverage: $("deltaAverage"),
  statsPrevMonth: $("statsPrevMonth"), statsNextMonth: $("statsNextMonth"),
  dailyList: $("dailyList"), routeList: $("routeList"),
  // 설정
  backFromSettings: $("backFromSettings"),
  rateRoute: $("rateRoute"), rateUnit: $("rateUnit"), saveRate: $("saveRate"),
  rateList: $("rateList"),
  scheduleImage: $("scheduleImage"), runScheduleOcr: $("runScheduleOcr"),
  ocrStatus: $("ocrStatus"), schedulePreview: $("schedulePreview"),
  scheduleCsvInput: $("scheduleCsvInput"), parseSchedule: $("parseSchedule"),
  csvInput: $("csvInput"), parseCsv: $("parseCsv"),
  resetData: $("resetData"), openDbSettings: $("openDbSettings"),
  dbStatusBadge: $("dbStatusBadge"),
  // DB 시트
  dbOverlay: $("dbOverlay"), dbSheet: $("dbSheet"),
  supabaseUrl: $("supabaseUrl"), supabaseAnonKey: $("supabaseAnonKey"),
  saveDbConfig: $("saveDbConfig"), syncNow: $("syncNow"), dbStatus: $("dbStatus"),
  // 탭
  navTabs: document.querySelectorAll(".nav-tab"),
  statsTabs: document.querySelectorAll(".stats-tab"),
  statsPanels: document.querySelectorAll(".stats-panel"),
  // 토스트
  toast: $("toast"),
};

/* ══ 토스트 ══ */
let toastTimer;
function toast(msg, type = "") {
  clearTimeout(toastTimer);
  el.toast.textContent = msg;
  el.toast.className = "toast show" + (type ? " " + type : "");
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2800);
}

/* ══ 날짜 유틸 ══ */
function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseDateKey(k) { return new Date(`${k}T00:00:00`); }
function addDays(k, n) {
  const d = parseDateKey(k); d.setDate(d.getDate() + n); return toDateKey(d);
}
function todayKey() { return toDateKey(new Date()); }

/* ══ 정산기간 ══ */
function periodBounds(y = state.year, m = state.month) {
  return { start: new Date(y, m - 2, 26), end: new Date(y, m - 1, 25) };
}
function periodKeysFor(y, m) {
  const { start, end } = periodBounds(y, m);
  const keys = []; const cur = new Date(start);
  while (cur <= end) { keys.push(toDateKey(cur)); cur.setDate(cur.getDate() + 1); }
  return keys;
}
function periodKeys() { return periodKeysFor(state.year, state.month); }

function formatShort(d) {
  return `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}`;
}
function formatLong(k) {
  const d = parseDateKey(k);
  return `${d.getFullYear()}년 ${String(d.getMonth()+1).padStart(2,"0")}월 ${String(d.getDate()).padStart(2,"0")}일(${WEEKDAYS[d.getDay()]})`;
}
function formatLongShort(k) {
  const d = parseDateKey(k);
  return `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}(${WEEKDAYS[d.getDay()]})`;
}

/* ══ 스토어 ══ */
function loadRates() {
  try { return JSON.parse(localStorage.getItem("quickflex-rates-v2")) || avgRates(SAMPLE_SETTLEMENT); }
  catch { return avgRates(SAMPLE_SETTLEMENT); }
}
function saveRates() {
  localStorage.setItem("quickflex-rates-v2", JSON.stringify(state.rates));
  scheduleDbSave();
}
function loadEntries() {
  try { return JSON.parse(localStorage.getItem("quickflex-entries-v2")) || {}; }
  catch { return {}; }
}
function saveEntries() {
  localStorage.setItem("quickflex-entries-v2", JSON.stringify(state.entries));
  scheduleDbSave();
}

/* ══ 단가 ══ */
function normalizeRoute(r) { return String(r || "").trim().toUpperCase(); }
function toNum(v) { return Number(String(v ?? "").replace(/[^\d.-]/g, "")) || 0; }

function avgRates(rows) {
  const bucket = new Map();
  rows.forEach(([route, count, amount]) => {
    const k = normalizeRoute(route); const q = toNum(count); const a = toNum(amount);
    if (!k || q <= 0 || a <= 0) return;
    const cur = bucket.get(k) || { count: 0, amount: 0 };
    bucket.set(k, { count: cur.count + q, amount: cur.amount + a });
  });
  return [...bucket.entries()]
    .map(([route, v]) => ({ route, count: v.count, amount: v.amount, unit: Math.round(v.amount / v.count) }))
    .sort((a, b) => a.route.localeCompare(b.route));
}

function rateFor(route) {
  return state.rates.find(r => r.route === normalizeRoute(route))?.unit || 0;
}
function effectiveUnit(row) {
  const saved = toNum(row.unit);
  if (saved > 0) return saved;
  const tbl = rateFor(row.route);
  if (tbl > 0) { row.unit = tbl; return tbl; }
  return 0;
}
function upsertRate(route, unit) {
  const k = normalizeRoute(route); const p = toNum(unit);
  if (!k || p <= 0) return;
  const ex = state.rates.find(r => r.route === k);
  if (ex) ex.unit = p; else state.rates.push({ route: k, count: 0, amount: 0, unit: p });
  state.rates.sort((a, b) => a.route.localeCompare(b.route));
  state.entries[state.selectedDate]?.rows.forEach(row => {
    if (normalizeRoute(row.route) === k) row.unit = p;
  });
  saveRates(); saveEntries();
}

/* ══ 일 기록 ══ */
function dayRecord(k) {
  if (!state.entries[k]) {
    state.entries[k] = {
      off: false,
      rows: (SAMPLE_SCHEDULE[k] || []).map(r => ({ route: r, count: "", unit: rateFor(r) })),
      freshCount: "", freshUnit: 100,
    };
  }
  const rec = state.entries[k];
  if (!Array.isArray(rec.rows)) rec.rows = [];
  rec.rows.forEach(row => effectiveUnit(row));
  if (rec.freshUnit == null || rec.freshUnit === "") rec.freshUnit = 100;
  rec.off = Boolean(rec.off);
  return rec;
}

function calcRecord(rec) {
  if (rec.off) return { count: 0, revenue: 0 };
  const r = rec.rows.reduce((s, row) => {
    const c = toNum(row.count); const u = effectiveUnit(row);
    return { count: s.count + c, revenue: s.revenue + c * u };
  }, { count: 0, revenue: 0 });
  const fc = toNum(rec.freshCount);
  return { count: r.count + fc, revenue: r.revenue + fc * toNum(rec.freshUnit) };
}

function summarizePeriod(y = state.year, m = state.month) {
  let best = { dateKey: "", revenue: 0 };
  const total = periodKeysFor(y, m).reduce((s, k) => {
    const rec = dayRecord(k); const day = calcRecord(rec);
    const fresh = rec.off ? 0 : toNum(rec.freshCount);
    if (day.revenue > best.revenue) best = { dateKey: k, revenue: day.revenue };
    return {
      count: s.count + day.count, revenue: s.revenue + day.revenue,
      workDays: s.workDays + (day.revenue > 0 ? 1 : 0),
      offDays: s.offDays + (rec.off ? 1 : 0), fresh: s.fresh + fresh,
    };
  }, { count: 0, revenue: 0, workDays: 0, offDays: 0, fresh: 0 });
  total.average = total.workDays ? total.revenue / total.workDays : 0;
  total.best = best;
  return total;
}

function prevPeriod(y = state.year, m = state.month) {
  const d = new Date(y, m - 2, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/* ══ 렌더: 홈 요약 ══ */
function renderSummary() {
  const t = summarizePeriod();
  el.periodRevenue.textContent = fmtWon(t.revenue);
  el.periodCount.textContent = `${fmt.format(t.count)}건`;
  el.dailyAverage.textContent = fmtWon(t.average);
  el.workDaysHome.textContent = `${t.workDays}일`;
  el.meterFill.style.width = `${Math.min((t.revenue / GOAL) * 100, 100)}%`;
}

/* ══ 렌더: 달력 ══ */
function renderMonth() {
  const { start, end } = periodBounds();
  const gs = new Date(start); gs.setDate(gs.getDate() - gs.getDay());
  const ge = new Date(end); ge.setDate(ge.getDate() + (6 - ge.getDay()));

  el.monthTitle.textContent = `${state.year}년 ${String(state.month).padStart(2,"0")}월`;
  const fmt2 = (d) => `${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}`;
  el.periodRangeShort.textContent = `${fmt2(start)} ~ ${fmt2(end)}`;
  el.periodRange.textContent = `${formatShort(start)} ~ ${formatShort(end)}`;

  el.monthCalendar.innerHTML = "";
  const today = todayKey();
  const cur = new Date(gs);
  while (cur <= ge) {
    const k = toDateKey(cur);
    const rec = dayRecord(k);
    const calc = calcRecord(rec);
    const inPeriod = cur >= start && cur <= end;
    const cell = document.createElement("button");
    cell.type = "button";
    const classes = ["day-cell"];
    if (!inPeriod) classes.push("outside");
    if (rec.off) classes.push("off");
    if (k === state.selectedDate) classes.push("selected");
    if (k === today) classes.push("today-cell");
    cell.className = classes.join(" ");

    const dayNum = cur.getDate() === 1 ? `${cur.getMonth()+1}/1` : cur.getDate();
    let val = "";
    if (rec.off) val = "휴무";
    else if (state.mode === "count" && calc.count > 0) val = `${fmt.format(calc.count)}건`;
    else if (state.mode === "amount" && calc.revenue > 0) val = fmt.format(calc.revenue);

    cell.innerHTML = `<span class="day-number">${dayNum}</span><span class="day-value">${val}</span>`;
    cell.addEventListener("click", () => selectDate(k));
    el.monthCalendar.appendChild(cell);
    cur.setDate(cur.getDate() + 1);
  }
}

/* ══ 렌더: 홈 날짜 미리보기 ══ */
function renderHomeSelection() {
  const rec = dayRecord(state.selectedDate);
  el.homeSelectedDate.textContent = formatLong(state.selectedDate);
  el.homeSelectedTotal.textContent = rec.off ? "휴무" : fmtWon(calcRecord(rec).revenue);
}

/* ══ 렌더: 기록 폼 ══ */
function renderEntryForm() {
  const rec = dayRecord(state.selectedDate);
  el.selectedDateTitle.textContent = formatLong(state.selectedDate);
  el.offToggle.checked = rec.off;
  el.recordBody.classList.toggle("is-off", rec.off);
  el.freshCount.value = rec.freshCount ?? "";
  el.freshUnit.value = rec.freshUnit ?? 100;
  el.freshRevenue.textContent = fmtWon(toNum(rec.freshCount) * toNum(rec.freshUnit));
  el.selectedDayTotal.textContent = fmtWon(calcRecord(rec).revenue);
  el.entryRows.innerHTML = "";

  if (rec.rows.length === 0 && !rec.off) {
    const first = state.rates[0] || { route: "", unit: 0 };
    rec.rows.push({ route: first.route, count: "", unit: first.unit });
  }

  rec.rows.forEach((row, idx) => {
    const item = document.getElementById("entryTemplate").content.firstElementChild.cloneNode(true);
    const sel = item.querySelector("select");
    const cnt = item.querySelector(".count");
    const unit = item.querySelector(".unit");
    const out = item.querySelector("output");
    const del = item.querySelector(".del-btn");

    // 옵션 채우기
    const routes = new Set([...state.rates.map(r => r.route), normalizeRoute(row.route)].filter(Boolean));
    const cur = normalizeRoute(row.route);
    sel.innerHTML = [...routes].sort().map(r => `<option value="${r}"${r === cur ? " selected" : ""}>${r}</option>`).join("");
    cnt.value = row.count ?? "";
    unit.value = effectiveUnit(row) || "";
    out.textContent = fmtWon(toNum(row.count) * effectiveUnit(row));

    sel.addEventListener("change", () => {
      row.route = normalizeRoute(sel.value);
      row.unit = rateFor(row.route);
      saveEntries(); renderEntryForm();
    });
    cnt.addEventListener("input", () => {
      row.count = cnt.value;
      out.textContent = fmtWon(toNum(cnt.value) * effectiveUnit(row));
      saveEntries(); refreshTotals();
    });
    unit.addEventListener("input", () => {
      row.unit = unit.value;
      out.textContent = fmtWon(toNum(cnt.value) * toNum(unit.value));
      saveEntries(); refreshTotals();
    });
    del.addEventListener("click", () => {
      rec.rows.splice(idx, 1); saveEntries(); renderEntryForm(); refreshTotals();
    });

    el.entryRows.appendChild(item);
  });
}

function refreshTotals() {
  const rec = dayRecord(state.selectedDate);
  const calc = calcRecord(rec);
  el.freshRevenue.textContent = fmtWon(toNum(rec.freshCount) * toNum(rec.freshUnit));
  el.selectedDayTotal.textContent = fmtWon(calc.revenue);
  renderSummary(); renderMonth(); renderHomeSelection();
}

/* ══ 렌더: 통계 ══ */
function getStatsPeriod() {
  return { year: state.statsYear ?? state.year, month: state.statsMonth ?? state.month };
}

function renderStats() {
  const { year, month } = getStatsPeriod();
  const { start, end } = periodBounds(year, month);
  const prev = prevPeriod(year, month);
  const cur = summarizePeriod(year, month);
  const prv = summarizePeriod(prev.year, prev.month);

  el.statsMonthTitle.textContent = `${year}년 ${String(month).padStart(2,"0")}월`;
  el.statsRange.textContent = `${formatShort(start)} ~ ${formatShort(end)}`;
  el.statsRevenue.textContent = fmtWon(cur.revenue);
  el.statsMeterFill.style.width = `${Math.min((cur.revenue / GOAL) * 100, 100)}%`;

  const delta = (c, p, unit = "") => {
    const d = Math.round(c - p); if (!d) return "";
    const em = document.createElement("em");
    em.className = d > 0 ? "up" : "dn";
    em.textContent = `${fmt.format(Math.abs(d))}${unit}${d > 0 ? "↑" : "↓"}`;
    return em;
  };

  const setDelta = (elId, c, p, unit = "") => {
    const el2 = $(elId); el2.innerHTML = "";
    const d = delta(c, p, unit); if (d) el2.appendChild(d);
  };

  el.statsWorkDays.textContent = `${cur.workDays}일`;
  el.statsOffDays.textContent = `${cur.offDays}일`;
  el.statsCount.textContent = `${fmt.format(cur.count)}건`;
  el.statsFresh.textContent = `${fmt.format(cur.fresh)}건`;
  el.statsAverage.textContent = fmtWon(cur.average);
  el.statsBestDay.textContent = cur.best.dateKey ? formatLongShort(cur.best.dateKey) : "-";
  el.statsBestAmount.textContent = cur.best.revenue ? fmtWon(cur.best.revenue) : "";
  setDelta("deltaWorkDays", cur.workDays, prv.workDays, "일");
  setDelta("deltaOffDays", cur.offDays, prv.offDays, "일");
  setDelta("deltaCount", cur.count, prv.count, "건");
  setDelta("deltaFresh", cur.fresh, prv.fresh, "건");
  setDelta("deltaAverage", cur.average, prv.average, "원");

  renderDailyList(year, month);
  renderRouteList(year, month);
}

function renderDailyList(year, month) {
  el.dailyList.innerHTML = "";
  const keys = periodKeysFor(year, month).reverse();
  keys.forEach(k => {
    const rec = dayRecord(k); const calc = calcRecord(rec);
    const item = document.createElement("div");
    item.className = "daily-item" + (rec.off ? " off" : "");
    item.innerHTML = `<span class="date">${formatLongShort(k)}</span><span class="amt">${rec.off ? "휴무" : fmtWon(calc.revenue)}</span>`;
    el.dailyList.appendChild(item);
  });
}

function renderRouteList(year, month) {
  el.routeList.innerHTML = "";
  const acc = new Map();
  periodKeysFor(year, month).forEach(k => {
    const rec = dayRecord(k); if (rec.off) return;
    rec.rows.forEach(row => {
      const r = normalizeRoute(row.route); if (!r) return;
      const c = toNum(row.count); const u = effectiveUnit(row);
      const cur = acc.get(r) || { count: 0, revenue: 0 };
      acc.set(r, { count: cur.count + c, revenue: cur.revenue + c * u });
    });
  });
  [...acc.entries()].sort((a, b) => b[1].revenue - a[1].revenue).forEach(([route, v]) => {
    const item = document.createElement("div");
    item.className = "route-item";
    item.innerHTML = `<span class="route-id">${route}</span><div class="route-detail"><span class="route-amt">${fmtWon(v.revenue)}</span><span class="route-count">${fmt.format(v.count)}건</span></div>`;
    el.routeList.appendChild(item);
  });
}

/* ══ 렌더: 단가 목록 ══ */
function renderRates() {
  el.rateList.innerHTML = state.rates
    .map(r => `<div class="rate-chip" data-route="${r.route}" data-unit="${r.unit}"><strong>${r.route}</strong><span>${fmt.format(r.unit)}원</span></div>`)
    .join("");
  el.rateList.querySelectorAll(".rate-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      el.rateRoute.value = chip.dataset.route;
      el.rateUnit.value = chip.dataset.unit;
    });
  });
}

/* ══ 뷰 전환 ══ */
function showView(view) {
  el.app.dataset.view = view;
  el.navTabs.forEach(t => t.classList.toggle("active", t.dataset.view === view));
  if (view === "record") renderEntryForm();
  if (view === "stats") renderStats();
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ══ 날짜 선택 ══ */
function selectDate(k) {
  state.selectedDate = k;
  const d = parseDateKey(k);
  if (d.getDate() <= 25) { state.year = d.getFullYear(); state.month = d.getMonth() + 1; }
  else { const n = new Date(d.getFullYear(), d.getMonth() + 1, 1); state.year = n.getFullYear(); state.month = n.getMonth() + 1; }
  renderSummary(); renderMonth(); renderHomeSelection();
}

function moveMonth(n) {
  const d = new Date(state.year, state.month - 1 + n, 1);
  state.year = d.getFullYear(); state.month = d.getMonth() + 1;
  state.selectedDate = toDateKey(periodBounds().end);
  renderSummary(); renderMonth(); renderHomeSelection();
}

/* ══ 통계 월 이동 ══ */
function moveStatsMonth(n) {
  const { year, month } = getStatsPeriod();
  const d = new Date(year, month - 1 + n, 1);
  state.statsYear = d.getFullYear(); state.statsMonth = d.getMonth() + 1;
  renderStats();
}

/* ══ CSV/OCR 파싱 ══ */
function splitLine(line) {
  const cells = []; let cur = "", q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if ((ch === "," || ch === "\t") && !q) { cells.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  cells.push(cur.trim()); return cells;
}

function parseSettlementCsv(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitLine(lines[0]).map(c => c.replace(/\s/g, ""));
  const ri = header.findIndex(c => /route|구역|노선/i.test(c));
  const ci = header.findIndex(c => /배송건수|건수|합계/i.test(c));
  const ai = header.findIndex(c => /금액|매출|정산/i.test(c));
  if (ri < 0 || ci < 0 || ai < 0) { toast("Route, 배송건수, 금액 열을 찾지 못했습니다", "error"); return []; }
  return lines.slice(1).map(l => { const c = splitLine(l); return [c[ri], c[ci], c[ai]]; });
}

function parseHeaderDate(value) {
  const text = String(value || "").trim();
  const full = text.match(/(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (full) return `${full[1]}-${String(full[2]).padStart(2,"0")}-${String(full[3]).padStart(2,"0")}`;
  const short = text.match(/(\d{1,2})\s*[./월]\s*(\d{1,2})/);
  if (!short) return "";
  const mon = Number(short[1]);
  const yr = mon > state.month ? state.year - 1 : state.year;
  return `${yr}-${String(mon).padStart(2,"0")}-${String(short[2]).padStart(2,"0")}`;
}
function routesFromCell(v) {
  const t = String(v || "").trim();
  if (!t || /휴무|off/i.test(t)) return null; // null = 휴무
  const r = t.split(/[,/·\s]+/).map(normalizeRoute).filter(Boolean);
  return r.length ? r : null;
}

function applySchedule(dateMap) {
  let n = 0;
  for (const [k, routes] of Object.entries(dateMap)) {
    state.entries[k] = {
      off: routes === null || routes.length === 0,
      rows: (routes || []).map(r => ({ route: r, count: "", unit: rateFor(r) })),
      freshCount: "", freshUnit: 100,
    };
    n++;
  }
  saveEntries();
  renderSummary(); renderMonth(); renderHomeSelection();
  toast(`스케줄 ${n}일 반영됨`, "success");
}

function parseScheduleCsv(text) {
  const rows = text.split(/\r?\n/).map(l => splitLine(l)).filter(r => r.some(Boolean));
  if (rows.length < 2) { parseScheduleOcrText(text); return; }
  const header = rows[0];
  const target = rows.find((r, i) => i > 0 && r.some(c => String(c).trim() === "김관현"));
  if (!target) { toast("김관현 행을 찾지 못했습니다", "error"); return; }
  const map = {};
  header.forEach((cell, i) => {
    const k = parseHeaderDate(cell); if (!k) return;
    map[k] = routesFromCell(target[i]);
  });
  applySchedule(map);
}

function routeTokensFromText(text) {
  const clean = String(text || "").toUpperCase().replace(/[()]/g, " ");
  const tokens = clean.match(/휴무|OFF|\d{3}[A-D]/g) || [];
  const groups = []; let cur = [];
  tokens.forEach(t => {
    if (t === "휴무" || t === "OFF") { groups.push(cur.length ? cur : []); cur = []; }
    else cur.push(t);
  });
  if (cur.length) groups.push(cur);
  return groups;
}
function dateKeysFromOcrText(text) {
  const matches = [...String(text || "").matchAll(/(\d{1,2})\s*[./월]\s*(\d{1,2})/g)];
  const seen = new Set();
  return matches.map(m => parseHeaderDate(`${m[1]}.${m[2]}`)).filter(k => {
    if (!k || seen.has(k)) return false; seen.add(k); return true;
  });
}

function parseScheduleOcrText(text) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const workerLine = lines.find(l => /김\s*관\s*현/.test(l));
  if (!workerLine) { toast("김관현 행을 찾지 못했습니다. 텍스트를 확인해주세요", "error"); return; }
  const dateKeys = dateKeysFromOcrText(text);
  const groups = routeTokensFromText(workerLine.replace(/김\s*관\s*현/g, ""));
  const targetKeys = dateKeys.length ? dateKeys : periodKeys();
  const map = {};
  groups.forEach((routes, i) => {
    const k = targetKeys[i]; if (!k) return;
    map[k] = routes.length ? routes : null;
  });
  applySchedule(map);
}

async function runOcr() {
  const file = el.scheduleImage.files?.[0];
  if (!file) { toast("이미지를 먼저 선택해주세요", "error"); return; }
  if (!window.Tesseract) { toast("OCR 라이브러리 로딩 실패", "error"); return; }
  el.runScheduleOcr.disabled = true;
  el.ocrStatus.textContent = "OCR 준비 중...";
  try {
    const result = await window.Tesseract.recognize(file, "kor+eng", {
      logger(msg) {
        if (msg.status === "recognizing text")
          el.ocrStatus.textContent = `인식 중 ${Math.round(msg.progress * 100)}%`;
        else if (msg.status)
          el.ocrStatus.textContent = msg.status;
      },
    });
    const text = result.data.text.trim();
    el.scheduleCsvInput.value = text;
    parseScheduleOcrText(text);
    el.ocrStatus.textContent = "OCR 완료";
  } catch (e) {
    console.error(e);
    el.ocrStatus.textContent = "OCR 실패 — 이미지가 흐리거나 연결이 불안정합니다";
    toast("OCR 실패", "error");
  } finally {
    el.runScheduleOcr.disabled = false;
  }
}

/* ══ Supabase ══ */
let dbClient = null, dbTimer = null, dbLoading = false;

function loadDbConfig() {
  try { return JSON.parse(localStorage.getItem(DB_KEY)) || {}; } catch { return {}; }
}
function normalizeUrl(v) {
  const raw = String(v || "").trim(); if (!raw) return "";
  try { const u = new URL(raw); return `${u.protocol}//${u.host}`; }
  catch { return raw.replace(/\/rest\/v1\/?$/i, "").replace(/\/+$/, ""); }
}
function getDbClient() {
  if (dbClient) return dbClient;
  const cfg = loadDbConfig();
  if (!cfg.url || !cfg.anonKey || !window.supabase) return null;
  dbClient = window.supabase.createClient(normalizeUrl(cfg.url), cfg.anonKey);
  return dbClient;
}
function setDbStatus(msg, connected = false) {
  el.dbStatus.textContent = msg;
  el.dbStatusBadge.textContent = connected ? "연결됨" : "미연결";
  el.dbStatusBadge.className = "badge" + (connected ? " connected" : "");
}
function scheduleDbSave() {
  if (!getDbClient()) return;
  clearTimeout(dbTimer);
  dbTimer = setTimeout(saveToDb, 500);
}
async function saveToDb() {
  if (dbLoading) return;
  const client = getDbClient(); if (!client) return;
  const { error } = await client.from("quickflex_data").upsert({
    user_id: OWNER_ID, rates: state.rates, entries: state.entries,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) { setDbStatus(`저장 실패: ${error.message}`); return; }
  setDbStatus(`저장됨: ${new Date().toLocaleString("ko-KR")}`, true);
}
async function loadFromDb() {
  const client = getDbClient();
  if (!client) { setDbStatus("미연결 — 이 기기에만 저장됩니다."); return; }
  dbLoading = true; setDbStatus("불러오는 중...");
  const { data, error } = await client.from("quickflex_data")
    .select("rates,entries,updated_at").eq("user_id", OWNER_ID).maybeSingle();
  dbLoading = false;
  if (error) { setDbStatus(`불러오기 실패: ${error.message}`); return; }
  if (data) {
    state.rates = Array.isArray(data.rates) ? data.rates : state.rates;
    state.entries = data.entries && typeof data.entries === "object" ? data.entries : state.entries;
    localStorage.setItem("quickflex-rates-v2", JSON.stringify(state.rates));
    localStorage.setItem("quickflex-entries-v2", JSON.stringify(state.entries));
    renderAll(); setDbStatus(`${new Date(data.updated_at).toLocaleString("ko-KR")} 기준`, true);
    return;
  }
  await saveToDb();
}

function initDbConfig() {
  const cfg = loadDbConfig();
  el.supabaseUrl.value = normalizeUrl(cfg.url) || "";
  el.supabaseAnonKey.value = cfg.anonKey || "";
  if (cfg.url && cfg.anonKey) setDbStatus("연결 확인 중...", true);
}

/* ══ 바텀시트 ══ */
function openSheet() {
  el.dbOverlay.classList.add("open"); el.dbSheet.classList.add("open");
}
function closeSheet() {
  el.dbOverlay.classList.remove("open"); el.dbSheet.classList.remove("open");
}

/* ══ 전체 렌더 ══ */
function renderAll() {
  renderSummary(); renderMonth(); renderHomeSelection(); renderRates();
}

/* ══ 이벤트 ══ */

// 탭바
el.navTabs.forEach(tab => tab.addEventListener("click", () => showView(tab.dataset.view)));

// 홈
el.prevMonth.addEventListener("click", () => moveMonth(-1));
el.nextMonth.addEventListener("click", () => moveMonth(1));
el.todayButton.addEventListener("click", () => selectDate(todayKey()));
el.openRecord.addEventListener("click", () => showView("record"));
el.openSettings.addEventListener("click", () => showView("settings"));

// 기록
el.backToCalendar.addEventListener("click", () => showView("home"));
el.prevDay.addEventListener("click", () => { selectDate(addDays(state.selectedDate, -1)); renderEntryForm(); });
el.nextDay.addEventListener("click", () => { selectDate(addDays(state.selectedDate, 1)); renderEntryForm(); });
el.offToggle.addEventListener("change", () => {
  dayRecord(state.selectedDate).off = el.offToggle.checked;
  saveEntries(); renderEntryForm(); refreshTotals();
});
el.copySchedule.addEventListener("click", () => {
  const rec = dayRecord(state.selectedDate);
  rec.rows = (SAMPLE_SCHEDULE[state.selectedDate] || []).map(r => ({ route: r, count: "", unit: rateFor(r) }));
  rec.off = rec.rows.length === 0;
  saveEntries(); renderEntryForm(); refreshTotals();
});
el.addRoute.addEventListener("click", () => {
  const rec = dayRecord(state.selectedDate);
  rec.off = false;
  rec.rows.push({ route: state.rates[0]?.route || "", count: "", unit: state.rates[0]?.unit || 0 });
  saveEntries(); renderEntryForm();
});
el.freshCount.addEventListener("input", () => {
  dayRecord(state.selectedDate).freshCount = el.freshCount.value;
  saveEntries(); refreshTotals();
});
el.freshUnit.addEventListener("input", () => {
  dayRecord(state.selectedDate).freshUnit = el.freshUnit.value;
  saveEntries(); refreshTotals();
});

// 모드 버튼
document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    state.mode = btn.dataset.mode;
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.toggle("active", b === btn));
    renderMonth();
  });
});

// 통계 탭
el.statsTabs.forEach(tab => {
  tab.addEventListener("click", () => {
    state.statsTab = tab.dataset.tab;
    el.statsTabs.forEach(t => t.classList.toggle("active", t === tab));
    el.statsPanels.forEach(p => p.classList.toggle("active", p.dataset.panel === tab.dataset.tab));
  });
});
el.statsPrevMonth.addEventListener("click", () => moveStatsMonth(-1));
el.statsNextMonth.addEventListener("click", () => moveStatsMonth(1));

// 설정
el.backFromSettings.addEventListener("click", () => showView("home"));
el.saveRate.addEventListener("click", () => {
  upsertRate(el.rateRoute.value, el.rateUnit.value);
  el.rateRoute.value = ""; el.rateUnit.value = "";
  renderRates(); renderAll(); toast("단가 저장됨", "success");
});
el.scheduleImage.addEventListener("change", () => {
  const file = el.scheduleImage.files?.[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    el.schedulePreview.innerHTML = `<div class="img-preview"><img src="${reader.result}" alt="스케줄표" /><span>${file.name}</span></div>`;
  };
  reader.readAsDataURL(file);
});
el.runScheduleOcr.addEventListener("click", runOcr);
el.parseSchedule.addEventListener("click", () => parseScheduleCsv(el.scheduleCsvInput.value));
el.parseCsv.addEventListener("click", () => {
  const rows = parseSettlementCsv(el.csvInput.value);
  if (!rows.length) return;
  state.rates = avgRates(rows);
  saveRates(); renderRates(); renderAll();
  toast(`단가 ${state.rates.length}개 업데이트됨`, "success");
});
el.resetData.addEventListener("click", () => {
  if (!confirm("예시 데이터로 초기화할까요?")) return;
  state.rates = avgRates(SAMPLE_SETTLEMENT); state.entries = {};
  saveRates(); saveEntries(); renderAll(); renderRates();
  toast("초기화 완료", "success");
});

// DB 바텀시트
el.openDbSettings.addEventListener("click", openSheet);
el.dbOverlay.addEventListener("click", closeSheet);
el.saveDbConfig.addEventListener("click", async () => {
  const url = normalizeUrl(el.supabaseUrl.value);
  const key = el.supabaseAnonKey.value.trim();
  if (!url || !key) { toast("URL과 key를 모두 입력해주세요", "error"); return; }
  el.supabaseUrl.value = url;
  localStorage.setItem(DB_KEY, JSON.stringify({ url, anonKey: key }));
  dbClient = null;
  await loadFromDb(); closeSheet();
  toast("DB 연결됨", "success");
});
el.syncNow.addEventListener("click", async () => {
  await saveToDb(); await loadFromDb();
  toast("동기화 완료", "success");
});

/* ══ 초기화 ══ */
state.statsYear = state.year; state.statsMonth = state.month;
initDbConfig(); renderAll(); loadFromDb();
