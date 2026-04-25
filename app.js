"use strict";

/* ══ 포맷터 ══ */
const fmt    = new Intl.NumberFormat("ko-KR");
const fmtWon = (n) => `₩${fmt.format(Math.round(n))}`;
const WEEKDAYS = ["일","월","화","수","목","금","토"];

/* ══ 상수 ══ */
const GOAL     = 6_000_000;
const DB_KEY   = "quickflex-supabase-config";
const CACHE_RATES   = "quickflex-rates-v2";
const CACHE_ENTRIES = "quickflex-entries-v2";
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
  statsYear: null, statsMonth: null,
  rates:   [],
  entries: {},
  // DB
  db:       null,   // Supabase client
  saving:   false,
  saveTimer: null,
  synced:   false,  // DB에서 최초 로드 완료 여부
};

/* ══ DOM ══ */
const $ = (id) => document.getElementById(id);
const el = {
  app: document.querySelector(".app"),
  // 셋업 오버레이
  setupOverlay: $("setupOverlay"),
  setupUrl: $("setupUrl"), setupKey: $("setupKey"), setupConnect: $("setupConnect"),
  setupError: $("setupError"),
  // 홈
  periodRevenue: $("periodRevenue"), periodCount: $("periodCount"),
  dailyAverage: $("dailyAverage"), workDaysHome: $("workDaysHome"),
  meterFill: $("meterFill"), periodRange: $("periodRange"),
  monthTitle: $("monthTitle"), periodRangeShort: $("periodRangeShort"),
  monthCalendar: $("monthCalendar"),
  prevMonth: $("prevMonth"), nextMonth: $("nextMonth"), todayButton: $("todayButton"),
  homeSelectedDate: $("homeSelectedDate"), homeSelectedTotal: $("homeSelectedTotal"),
  openRecord: $("openRecord"), openSettings: $("openSettings"),
  syncIndicator: $("syncIndicator"),
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
  navTabs:    document.querySelectorAll(".nav-tab"),
  statsTabs:  document.querySelectorAll(".stats-tab"),
  statsPanels: document.querySelectorAll(".stats-panel"),
  // 토스트
  toast: $("toast"),
};

/* ══════════════════════════════════════
   토스트
══════════════════════════════════════ */
let toastTimer;
function toast(msg, type = "") {
  clearTimeout(toastTimer);
  el.toast.textContent = msg;
  el.toast.className = "toast show" + (type ? " " + type : "");
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2800);
}

/* ══════════════════════════════════════
   날짜 유틸
══════════════════════════════════════ */
function toDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function parseDateKey(k) { return new Date(`${k}T00:00:00`); }
function addDays(k, n) { const d = parseDateKey(k); d.setDate(d.getDate()+n); return toDateKey(d); }
function todayKey() { return toDateKey(new Date()); }
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

/* ══════════════════════════════════════
   정산기간
══════════════════════════════════════ */
function periodBounds(y = state.year, m = state.month) {
  return { start: new Date(y, m-2, 26), end: new Date(y, m-1, 25) };
}
function periodKeysFor(y, m) {
  const { start, end } = periodBounds(y, m);
  const keys = []; const cur = new Date(start);
  while (cur <= end) { keys.push(toDateKey(cur)); cur.setDate(cur.getDate()+1); }
  return keys;
}
function periodKeys() { return periodKeysFor(state.year, state.month); }
function prevPeriod(y = state.year, m = state.month) {
  const d = new Date(y, m-2, 1); return { year: d.getFullYear(), month: d.getMonth()+1 };
}

/* ══════════════════════════════════════
   Supabase 연결
══════════════════════════════════════ */
function loadDbConfig() {
  try { return JSON.parse(localStorage.getItem(DB_KEY)) || {}; } catch { return {}; }
}
function normalizeUrl(v) {
  const raw = String(v||"").trim(); if (!raw) return "";
  try { const u = new URL(raw); return `${u.protocol}//${u.host}`; }
  catch { return raw.replace(/\/rest\/v1\/?$/i,"").replace(/\/+$/,""); }
}
function saveDbConfig(url, anonKey) {
  localStorage.setItem(DB_KEY, JSON.stringify({ url: normalizeUrl(url), anonKey }));
}
function buildClient(url, anonKey) {
  if (!window.supabase || !url || !anonKey) return null;
  return window.supabase.createClient(url, anonKey);
}

/* ══════════════════════════════════════
   DB 저장/불러오기 (Primary)
══════════════════════════════════════ */
function setSyncStatus(status) {
  // status: "idle" | "saving" | "error"
  const ind = el.syncIndicator;
  if (!ind) return;
  ind.dataset.status = status;
  ind.title = status === "saving" ? "저장 중..." : status === "error" ? "저장 실패" : "저장됨";
}

async function saveToDb() {
  if (!state.db) return;
  setSyncStatus("saving");
  try {
    const { error } = await state.db.from("quickflex_data").upsert({
      user_id: OWNER_ID,
      rates:   state.rates,
      entries: state.entries,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error) throw error;
    // 로컬 캐시도 갱신
    localStorage.setItem(CACHE_RATES,   JSON.stringify(state.rates));
    localStorage.setItem(CACHE_ENTRIES, JSON.stringify(state.entries));
    setSyncStatus("idle");
  } catch (err) {
    console.error("[DB] save failed", err);
    setSyncStatus("error");
    toast("DB 저장 실패 — 로컬에 임시 저장됨", "error");
    // 실패해도 로컬 캐시는 저장
    localStorage.setItem(CACHE_RATES,   JSON.stringify(state.rates));
    localStorage.setItem(CACHE_ENTRIES, JSON.stringify(state.entries));
  }
}

/** 연속 입력 시 마지막 변경 500ms 후 한 번만 저장 */
function scheduleSave() {
  clearTimeout(state.saveTimer);
  // 즉시 로컬 캐시 (UI 반응성)
  localStorage.setItem(CACHE_RATES,   JSON.stringify(state.rates));
  localStorage.setItem(CACHE_ENTRIES, JSON.stringify(state.entries));
  // DB는 디바운스
  state.saveTimer = setTimeout(saveToDb, 500);
}

async function loadFromDb() {
  if (!state.db) return false;
  try {
    const { data, error } = await state.db
      .from("quickflex_data")
      .select("rates,entries,updated_at")
      .eq("user_id", OWNER_ID)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      state.rates   = Array.isArray(data.rates)                              ? data.rates   : state.rates;
      state.entries = data.entries && typeof data.entries === "object"       ? data.entries : state.entries;
      // 로컬 캐시 갱신
      localStorage.setItem(CACHE_RATES,   JSON.stringify(state.rates));
      localStorage.setItem(CACHE_ENTRIES, JSON.stringify(state.entries));
      setDbBadge(true, new Date(data.updated_at));
    } else {
      // DB에 데이터 없음 → 현재 상태(로컬 캐시)를 DB에 업로드
      await saveToDb();
    }
    state.synced = true;
    return true;
  } catch (err) {
    console.error("[DB] load failed", err);
    toast("DB 불러오기 실패 — 로컬 캐시 사용 중", "error");
    setDbBadge(false);
    return false;
  }
}

function setDbBadge(connected, updatedAt) {
  if (!el.dbStatusBadge) return;
  el.dbStatusBadge.textContent = connected
    ? (updatedAt ? `${updatedAt.toLocaleTimeString("ko-KR", {hour:"2-digit",minute:"2-digit"})} 저장됨` : "연결됨")
    : "미연결";
  el.dbStatusBadge.className = "badge" + (connected ? " connected" : "");
}

/* ══════════════════════════════════════
   초기화 — DB 연결 & 데이터 로드
══════════════════════════════════════ */
async function init() {
  const cfg = loadDbConfig();

  if (!cfg.url || !cfg.anonKey) {
    // 최초 실행: 셋업 오버레이 표시
    showSetupOverlay();
    return;
  }

  // 로컬 캐시로 일단 렌더 (빠른 초기 표시)
  state.rates   = readCache(CACHE_RATES,   avgRates(SAMPLE_SETTLEMENT));
  state.entries = readCache(CACHE_ENTRIES, {});
  renderAll();

  // DB 연결 후 최신 데이터로 교체
  state.db = buildClient(cfg.url, cfg.anonKey);
  const ok = await loadFromDb();
  if (ok) renderAll();

  // 설정 시트 초기값
  el.supabaseUrl.value     = normalizeUrl(cfg.url) || "";
  el.supabaseAnonKey.value = cfg.anonKey || "";
}

function readCache(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) || fallback; } catch { return fallback; }
}

/* ══════════════════════════════════════
   셋업 오버레이 (최초 DB 연결)
══════════════════════════════════════ */
function showSetupOverlay() {
  el.setupOverlay.classList.add("visible");
}
function hideSetupOverlay() {
  el.setupOverlay.classList.remove("visible");
}

el.setupConnect.addEventListener("click", async () => {
  const url = normalizeUrl(el.setupUrl.value);
  const key = el.setupKey.value.trim();
  el.setupError.textContent = "";
  if (!url || !key) { el.setupError.textContent = "URL과 key를 모두 입력해주세요."; return; }

  el.setupConnect.disabled = true;
  el.setupConnect.textContent = "연결 중...";

  const client = buildClient(url, key);
  if (!client) { el.setupError.textContent = "Supabase 라이브러리 로딩 실패. 새로고침 후 재시도하세요."; el.setupConnect.disabled = false; el.setupConnect.textContent = "연결하기"; return; }

  // 테스트 쿼리
  const { error } = await client.from("quickflex_data").select("user_id").eq("user_id", OWNER_ID).maybeSingle();
  if (error && error.code !== "PGRST116") {
    el.setupError.textContent = `연결 실패: ${error.message}`;
    el.setupConnect.disabled = false; el.setupConnect.textContent = "연결하기";
    return;
  }

  saveDbConfig(url, key);
  state.db = client;
  state.rates   = avgRates(SAMPLE_SETTLEMENT);
  state.entries = {};
  await loadFromDb();
  hideSetupOverlay();
  renderAll();
  el.supabaseUrl.value     = url;
  el.supabaseAnonKey.value = key;
  toast("DB 연결 완료!", "success");
  el.setupConnect.disabled = false; el.setupConnect.textContent = "연결하기";
});

/* ══════════════════════════════════════
   단가 로직
══════════════════════════════════════ */
function normalizeRoute(r) { return String(r||"").trim().toUpperCase(); }
function toNum(v) { return Number(String(v??"").replace(/[^\d.-]/g,""))||0; }

function avgRates(rows) {
  const b = new Map();
  rows.forEach(([route, count, amount]) => {
    const k = normalizeRoute(route); const q = toNum(count); const a = toNum(amount);
    if (!k||q<=0||a<=0) return;
    const c = b.get(k)||{count:0,amount:0};
    b.set(k,{count:c.count+q,amount:c.amount+a});
  });
  return [...b.entries()]
    .map(([route,v])=>({route,count:v.count,amount:v.amount,unit:Math.round(v.amount/v.count)}))
    .sort((a,b)=>a.route.localeCompare(b.route));
}
function rateFor(route) {
  return state.rates.find(r=>r.route===normalizeRoute(route))?.unit||0;
}
function effectiveUnit(row) {
  const s = toNum(row.unit); if (s>0) return s;
  const t = rateFor(row.route); if (t>0){row.unit=t;return t;} return 0;
}
function upsertRate(route, unit) {
  const k = normalizeRoute(route); const p = toNum(unit);
  if (!k||p<=0) return;
  const ex = state.rates.find(r=>r.route===k);
  if (ex) ex.unit=p; else state.rates.push({route:k,count:0,amount:0,unit:p});
  state.rates.sort((a,b)=>a.route.localeCompare(b.route));
  state.entries[state.selectedDate]?.rows.forEach(row=>{
    if (normalizeRoute(row.route)===k) row.unit=p;
  });
  scheduleSave();
}

/* ══════════════════════════════════════
   일 기록
══════════════════════════════════════ */
function dayRecord(k) {
  if (!state.entries[k]) {
    state.entries[k] = {
      off: false,
      rows: (SAMPLE_SCHEDULE[k]||[]).map(r=>({route:r,count:"",unit:rateFor(r)})),
      freshCount:"", freshUnit:100,
    };
  }
  const rec = state.entries[k];
  if (!Array.isArray(rec.rows)) rec.rows=[];
  rec.rows.forEach(row=>effectiveUnit(row));
  if (rec.freshUnit==null||rec.freshUnit==="") rec.freshUnit=100;
  rec.off = Boolean(rec.off);
  return rec;
}
function calcRecord(rec) {
  if (rec.off) return {count:0,revenue:0};
  const r = rec.rows.reduce((s,row)=>{
    const c=toNum(row.count); const u=effectiveUnit(row);
    return {count:s.count+c, revenue:s.revenue+c*u};
  },{count:0,revenue:0});
  const fc = toNum(rec.freshCount);
  return {count:r.count+fc, revenue:r.revenue+fc*toNum(rec.freshUnit)};
}
function summarizePeriod(y=state.year, m=state.month) {
  let best={dateKey:"",revenue:0};
  const total = periodKeysFor(y,m).reduce((s,k)=>{
    const rec=dayRecord(k); const day=calcRecord(rec);
    const fresh=rec.off?0:toNum(rec.freshCount);
    if (day.revenue>best.revenue) best={dateKey:k,revenue:day.revenue};
    return {count:s.count+day.count,revenue:s.revenue+day.revenue,
      workDays:s.workDays+(day.revenue>0?1:0),
      offDays:s.offDays+(rec.off?1:0),fresh:s.fresh+fresh};
  },{count:0,revenue:0,workDays:0,offDays:0,fresh:0});
  total.average = total.workDays?total.revenue/total.workDays:0;
  total.best = best;
  return total;
}

/* ══════════════════════════════════════
   렌더
══════════════════════════════════════ */
function renderSummary() {
  const t = summarizePeriod();
  el.periodRevenue.textContent = fmtWon(t.revenue);
  el.periodCount.textContent   = `${fmt.format(t.count)}건`;
  el.dailyAverage.textContent  = fmtWon(t.average);
  el.workDaysHome.textContent  = `${t.workDays}일`;
  el.meterFill.style.width     = `${Math.min((t.revenue/GOAL)*100,100)}%`;
}

function renderMonth() {
  const {start,end} = periodBounds();
  const gs=new Date(start); gs.setDate(gs.getDate()-gs.getDay());
  const ge=new Date(end);   ge.setDate(ge.getDate()+(6-ge.getDay()));
  const p2=(d)=>`${String(d.getMonth()+1).padStart(2,"0")}.${String(d.getDate()).padStart(2,"0")}`;
  el.monthTitle.textContent       = `${state.year}년 ${String(state.month).padStart(2,"0")}월`;
  el.periodRangeShort.textContent = `${p2(start)} ~ ${p2(end)}`;
  el.periodRange.textContent      = `${formatShort(start)} ~ ${formatShort(end)}`;
  el.monthCalendar.innerHTML = "";
  const today = todayKey(); const cur=new Date(gs);
  while (cur<=ge) {
    const k=toDateKey(cur); const rec=dayRecord(k); const calc=calcRecord(rec);
    const inPeriod = cur>=start && cur<=end;
    const cell=document.createElement("button"); cell.type="button";
    const cls=["day-cell"];
    if (!inPeriod) cls.push("outside"); if (rec.off) cls.push("off");
    if (k===state.selectedDate) cls.push("selected"); if (k===today) cls.push("today-cell");
    cell.className=cls.join(" ");
    const dn = cur.getDate()===1?`${cur.getMonth()+1}/1`:cur.getDate();
    let val="";
    if (rec.off) val="휴무";
    else if (state.mode==="count"&&calc.count>0) val=`${fmt.format(calc.count)}건`;
    else if (state.mode==="amount"&&calc.revenue>0) val=fmt.format(calc.revenue);
    cell.innerHTML=`<span class="day-number">${dn}</span><span class="day-value">${val}</span>`;
    cell.addEventListener("click",()=>selectDate(k));
    el.monthCalendar.appendChild(cell);
    cur.setDate(cur.getDate()+1);
  }
}

function renderHomeSelection() {
  const rec=dayRecord(state.selectedDate);
  el.homeSelectedDate.textContent  = formatLong(state.selectedDate);
  el.homeSelectedTotal.textContent = rec.off?"휴무":fmtWon(calcRecord(rec).revenue);
}

function renderEntryForm() {
  const rec=dayRecord(state.selectedDate);
  el.selectedDateTitle.textContent = formatLong(state.selectedDate);
  el.offToggle.checked = rec.off;
  el.recordBody.classList.toggle("is-off",rec.off);
  el.freshCount.value = rec.freshCount??"";
  el.freshUnit.value  = rec.freshUnit??100;
  el.freshRevenue.textContent   = fmtWon(toNum(rec.freshCount)*toNum(rec.freshUnit));
  el.selectedDayTotal.textContent = fmtWon(calcRecord(rec).revenue);
  el.entryRows.innerHTML="";
  if (rec.rows.length===0&&!rec.off) {
    const first=state.rates[0]||{route:"",unit:0};
    rec.rows.push({route:first.route,count:"",unit:first.unit});
  }
  rec.rows.forEach((row,idx)=>{
    const item=document.getElementById("entryTemplate").content.firstElementChild.cloneNode(true);
    const sel=item.querySelector("select"); const cnt=item.querySelector(".count");
    const unit=item.querySelector(".unit"); const out=item.querySelector("output"); const del=item.querySelector(".del-btn");
    const routes=new Set([...state.rates.map(r=>r.route),normalizeRoute(row.route)].filter(Boolean));
    const cur=normalizeRoute(row.route);
    sel.innerHTML=[...routes].sort().map(r=>`<option value="${r}"${r===cur?" selected":""}>${r}</option>`).join("");
    cnt.value=row.count??""; unit.value=effectiveUnit(row)||"";
    out.textContent=fmtWon(toNum(row.count)*effectiveUnit(row));
    sel.addEventListener("change",()=>{row.route=normalizeRoute(sel.value);row.unit=rateFor(row.route);scheduleSave();renderEntryForm();});
    cnt.addEventListener("input",()=>{row.count=cnt.value;out.textContent=fmtWon(toNum(cnt.value)*effectiveUnit(row));scheduleSave();refreshTotals();});
    unit.addEventListener("input",()=>{row.unit=unit.value;out.textContent=fmtWon(toNum(cnt.value)*toNum(unit.value));scheduleSave();refreshTotals();});
    del.addEventListener("click",()=>{rec.rows.splice(idx,1);scheduleSave();renderEntryForm();refreshTotals();});
    el.entryRows.appendChild(item);
  });
}

function refreshTotals() {
  const rec=dayRecord(state.selectedDate); const calc=calcRecord(rec);
  el.freshRevenue.textContent     = fmtWon(toNum(rec.freshCount)*toNum(rec.freshUnit));
  el.selectedDayTotal.textContent = fmtWon(calc.revenue);
  renderSummary(); renderMonth(); renderHomeSelection();
}

function getStatsPeriod() {
  return {year:state.statsYear??state.year, month:state.statsMonth??state.month};
}

function renderStats() {
  const {year,month}=getStatsPeriod();
  const {start,end}=periodBounds(year,month);
  const prev=prevPeriod(year,month);
  const cur=summarizePeriod(year,month), prv=summarizePeriod(prev.year,prev.month);
  el.statsMonthTitle.textContent=`${year}년 ${String(month).padStart(2,"0")}월`;
  el.statsRange.textContent=`${formatShort(start)} ~ ${formatShort(end)}`;
  el.statsRevenue.textContent=fmtWon(cur.revenue);
  el.statsMeterFill.style.width=`${Math.min((cur.revenue/GOAL)*100,100)}%`;
  const setDelta=(id,c,p,unit="")=>{
    const e2=$(id); e2.innerHTML="";
    const d=Math.round(c-p); if (!d) return;
    const em=document.createElement("em"); em.className=d>0?"up":"dn";
    em.textContent=`${fmt.format(Math.abs(d))}${unit}${d>0?"↑":"↓"}`; e2.appendChild(em);
  };
  el.statsWorkDays.textContent=`${cur.workDays}일`; el.statsOffDays.textContent=`${cur.offDays}일`;
  el.statsCount.textContent=`${fmt.format(cur.count)}건`; el.statsFresh.textContent=`${fmt.format(cur.fresh)}건`;
  el.statsAverage.textContent=fmtWon(cur.average);
  el.statsBestDay.textContent=cur.best.dateKey?formatLongShort(cur.best.dateKey):"-";
  el.statsBestAmount.textContent=cur.best.revenue?fmtWon(cur.best.revenue):"";
  setDelta("deltaWorkDays",cur.workDays,prv.workDays,"일");
  setDelta("deltaOffDays",cur.offDays,prv.offDays,"일");
  setDelta("deltaCount",cur.count,prv.count,"건");
  setDelta("deltaFresh",cur.fresh,prv.fresh,"건");
  setDelta("deltaAverage",cur.average,prv.average,"원");
  renderDailyList(year,month); renderRouteList(year,month);
}

function renderDailyList(y,m) {
  el.dailyList.innerHTML="";
  periodKeysFor(y,m).reverse().forEach(k=>{
    const rec=dayRecord(k); const calc=calcRecord(rec);
    const item=document.createElement("div");
    item.className="daily-item"+(rec.off?" off":"");
    item.innerHTML=`<span class="date">${formatLongShort(k)}</span><span class="amt">${rec.off?"휴무":fmtWon(calc.revenue)}</span>`;
    el.dailyList.appendChild(item);
  });
}

function renderRouteList(y,m) {
  el.routeList.innerHTML="";
  const acc=new Map();
  periodKeysFor(y,m).forEach(k=>{
    const rec=dayRecord(k); if (rec.off) return;
    rec.rows.forEach(row=>{
      const r=normalizeRoute(row.route); if (!r) return;
      const c=toNum(row.count); const u=effectiveUnit(row);
      const cur=acc.get(r)||{count:0,revenue:0};
      acc.set(r,{count:cur.count+c,revenue:cur.revenue+c*u});
    });
  });
  [...acc.entries()].sort((a,b)=>b[1].revenue-a[1].revenue).forEach(([route,v])=>{
    const item=document.createElement("div"); item.className="route-item";
    item.innerHTML=`<span class="route-id">${route}</span><div class="route-detail"><span class="route-amt">${fmtWon(v.revenue)}</span><span class="route-count">${fmt.format(v.count)}건</span></div>`;
    el.routeList.appendChild(item);
  });
}

function renderRates() {
  el.rateList.innerHTML=state.rates
    .map(r=>`<div class="rate-chip" data-route="${r.route}" data-unit="${r.unit}"><strong>${r.route}</strong><span>${fmt.format(r.unit)}원</span></div>`)
    .join("");
  el.rateList.querySelectorAll(".rate-chip").forEach(chip=>{
    chip.addEventListener("click",()=>{el.rateRoute.value=chip.dataset.route;el.rateUnit.value=chip.dataset.unit;});
  });
}

function renderAll() { renderSummary(); renderMonth(); renderHomeSelection(); renderRates(); }

/* ══════════════════════════════════════
   뷰 전환
══════════════════════════════════════ */
function showView(view) {
  el.app.dataset.view=view;
  el.navTabs.forEach(t=>t.classList.toggle("active",t.dataset.view===view));
  if (view==="record") renderEntryForm();
  if (view==="stats")  renderStats();
  window.scrollTo({top:0,behavior:"instant"});
}
function selectDate(k) {
  state.selectedDate=k;
  const d=parseDateKey(k);
  if (d.getDate()<=25){state.year=d.getFullYear();state.month=d.getMonth()+1;}
  else{const n=new Date(d.getFullYear(),d.getMonth()+1,1);state.year=n.getFullYear();state.month=n.getMonth()+1;}
  renderSummary(); renderMonth(); renderHomeSelection();
}
function moveMonth(n) {
  const d=new Date(state.year,state.month-1+n,1);
  state.year=d.getFullYear(); state.month=d.getMonth()+1;
  state.selectedDate=toDateKey(periodBounds().end);
  renderSummary(); renderMonth(); renderHomeSelection();
}
function moveStatsMonth(n) {
  const {year,month}=getStatsPeriod();
  const d=new Date(year,month-1+n,1);
  state.statsYear=d.getFullYear(); state.statsMonth=d.getMonth()+1; renderStats();
}

/* ══════════════════════════════════════
   CSV / OCR 파싱
══════════════════════════════════════ */
function splitLine(line) {
  const cells=[]; let cur="",q=false;
  for (const ch of line){if(ch==='"')q=!q;else if((ch===","||ch==="\t")&&!q){cells.push(cur.trim());cur="";}else cur+=ch;}
  cells.push(cur.trim()); return cells;
}
function parseSettlementCsv(text) {
  const lines=text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if (lines.length<2) return [];
  const header=splitLine(lines[0]).map(c=>c.replace(/\s/g,""));
  const ri=header.findIndex(c=>/route|구역|노선/i.test(c));
  const ci=header.findIndex(c=>/배송건수|건수|합계/i.test(c));
  const ai=header.findIndex(c=>/금액|매출|정산/i.test(c));
  if (ri<0||ci<0||ai<0){toast("Route, 배송건수, 금액 열을 찾지 못했습니다","error");return [];}
  return lines.slice(1).map(l=>{const c=splitLine(l);return[c[ri],c[ci],c[ai]];});
}
function parseHeaderDate(value) {
  const text=String(value||"").trim();
  const full=text.match(/(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (full) return `${full[1]}-${String(full[2]).padStart(2,"0")}-${String(full[3]).padStart(2,"0")}`;
  const short=text.match(/(\d{1,2})\s*[./월]\s*(\d{1,2})/);
  if (!short) return "";
  const mon=Number(short[1]);
  return `${mon>state.month?state.year-1:state.year}-${String(mon).padStart(2,"0")}-${String(short[2]).padStart(2,"0")}`;
}
function routesFromCell(v) {
  const t=String(v||"").trim();
  if (!t||/휴무|off/i.test(t)) return null;
  const r=t.split(/[,/·\s]+/).map(normalizeRoute).filter(Boolean);
  return r.length?r:null;
}
function applySchedule(dateMap) {
  let n=0;
  for (const [k,routes] of Object.entries(dateMap)) {
    state.entries[k]={off:routes===null||routes.length===0,
      rows:(routes||[]).map(r=>({route:r,count:"",unit:rateFor(r)})),
      freshCount:"",freshUnit:100}; n++;
  }
  scheduleSave(); renderSummary(); renderMonth(); renderHomeSelection();
  toast(`스케줄 ${n}일 반영됨`,"success");
}
function parseScheduleCsv(text) {
  const rows=text.split(/\r?\n/).map(l=>splitLine(l)).filter(r=>r.some(Boolean));
  if (rows.length<2){parseScheduleOcrText(text);return;}
  const header=rows[0];
  const target=rows.find((r,i)=>i>0&&r.some(c=>String(c).trim()==="김관현"));
  if (!target){toast("김관현 행을 찾지 못했습니다","error");return;}
  const map={};
  header.forEach((cell,i)=>{const k=parseHeaderDate(cell);if(!k)return;map[k]=routesFromCell(target[i]);});
  applySchedule(map);
}
function routeTokensFromText(text) {
  const clean=String(text||"").toUpperCase().replace(/[()]/g," ");
  const tokens=clean.match(/휴무|OFF|\d{3}[A-D]/g)||[];
  const groups=[]; let cur=[];
  tokens.forEach(t=>{if(t==="휴무"||t==="OFF"){groups.push(cur.length?cur:[]);cur=[];}else cur.push(t);});
  if (cur.length) groups.push(cur); return groups;
}
function dateKeysFromOcrText(text) {
  const matches=[...String(text||"").matchAll(/(\d{1,2})\s*[./월]\s*(\d{1,2})/g)];
  const seen=new Set();
  return matches.map(m=>parseHeaderDate(`${m[1]}.${m[2]}`)).filter(k=>{if(!k||seen.has(k))return false;seen.add(k);return true;});
}
function parseScheduleOcrText(text) {
  const lines=String(text||"").split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const workerLine=lines.find(l=>/김\s*관\s*현/.test(l));
  if (!workerLine){toast("김관현 행을 찾지 못했습니다","error");return;}
  const dateKeys=dateKeysFromOcrText(text);
  const groups=routeTokensFromText(workerLine.replace(/김\s*관\s*현/g,""));
  const targetKeys=dateKeys.length?dateKeys:periodKeys();
  const map={};
  groups.forEach((routes,i)=>{const k=targetKeys[i];if(!k)return;map[k]=routes.length?routes:null;});
  applySchedule(map);
}
async function runOcr() {
  const file=el.scheduleImage.files?.[0];
  if (!file){toast("이미지를 먼저 선택해주세요","error");return;}
  if (!window.Tesseract){toast("OCR 라이브러리 로딩 실패","error");return;}
  el.runScheduleOcr.disabled=true; el.ocrStatus.textContent="OCR 준비 중...";
  try {
    const result=await window.Tesseract.recognize(file,"kor+eng",{
      logger(msg){if(msg.status==="recognizing text")el.ocrStatus.textContent=`인식 중 ${Math.round(msg.progress*100)}%`;},
    });
    const text=result.data.text.trim();
    el.scheduleCsvInput.value=text; parseScheduleOcrText(text);
    el.ocrStatus.textContent="OCR 완료";
  } catch(e){console.error(e);el.ocrStatus.textContent="OCR 실패";toast("OCR 실패","error");}
  finally{el.runScheduleOcr.disabled=false;}
}

/* ══════════════════════════════════════
   DB 바텀시트 (설정 변경)
══════════════════════════════════════ */
function openSheet(){el.dbOverlay.classList.add("open");el.dbSheet.classList.add("open");}
function closeSheet(){el.dbOverlay.classList.remove("open");el.dbSheet.classList.remove("open");}

/* ══════════════════════════════════════
   이벤트 바인딩
══════════════════════════════════════ */
el.navTabs.forEach(tab=>tab.addEventListener("click",()=>showView(tab.dataset.view)));
el.prevMonth.addEventListener("click",()=>moveMonth(-1));
el.nextMonth.addEventListener("click",()=>moveMonth(1));
el.todayButton.addEventListener("click",()=>selectDate(todayKey()));
el.openRecord.addEventListener("click",()=>showView("record"));
el.openSettings.addEventListener("click",()=>showView("settings"));
el.backToCalendar.addEventListener("click",()=>showView("home"));
el.prevDay.addEventListener("click",()=>{selectDate(addDays(state.selectedDate,-1));renderEntryForm();});
el.nextDay.addEventListener("click",()=>{selectDate(addDays(state.selectedDate,1));renderEntryForm();});
el.offToggle.addEventListener("change",()=>{
  dayRecord(state.selectedDate).off=el.offToggle.checked;
  scheduleSave(); renderEntryForm(); refreshTotals();
});
el.copySchedule.addEventListener("click",()=>{
  const rec=dayRecord(state.selectedDate);
  rec.rows=(SAMPLE_SCHEDULE[state.selectedDate]||[]).map(r=>({route:r,count:"",unit:rateFor(r)}));
  rec.off=rec.rows.length===0; scheduleSave(); renderEntryForm(); refreshTotals();
});
el.addRoute.addEventListener("click",()=>{
  const rec=dayRecord(state.selectedDate); rec.off=false;
  rec.rows.push({route:state.rates[0]?.route||"",count:"",unit:state.rates[0]?.unit||0});
  scheduleSave(); renderEntryForm();
});
el.freshCount.addEventListener("input",()=>{dayRecord(state.selectedDate).freshCount=el.freshCount.value;scheduleSave();refreshTotals();});
el.freshUnit.addEventListener("input",()=>{dayRecord(state.selectedDate).freshUnit=el.freshUnit.value;scheduleSave();refreshTotals();});
document.querySelectorAll(".mode-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    state.mode=btn.dataset.mode;
    document.querySelectorAll(".mode-btn").forEach(b=>b.classList.toggle("active",b===btn));
    renderMonth();
  });
});
el.statsTabs.forEach(tab=>{
  tab.addEventListener("click",()=>{
    el.statsTabs.forEach(t=>t.classList.toggle("active",t===tab));
    el.statsPanels.forEach(p=>p.classList.toggle("active",p.dataset.panel===tab.dataset.tab));
  });
});
el.statsPrevMonth.addEventListener("click",()=>moveStatsMonth(-1));
el.statsNextMonth.addEventListener("click",()=>moveStatsMonth(1));
el.backFromSettings.addEventListener("click",()=>showView("home"));
el.saveRate.addEventListener("click",()=>{
  upsertRate(el.rateRoute.value,el.rateUnit.value);
  el.rateRoute.value=""; el.rateUnit.value="";
  renderRates(); renderAll(); toast("단가 저장됨","success");
});
el.scheduleImage.addEventListener("change",()=>{
  const file=el.scheduleImage.files?.[0]; if (!file) return;
  const reader=new FileReader();
  reader.onload=()=>{el.schedulePreview.innerHTML=`<div class="img-preview"><img src="${reader.result}" alt="스케줄표"/><span>${file.name}</span></div>`;};
  reader.readAsDataURL(file);
});
el.runScheduleOcr.addEventListener("click",runOcr);
el.parseSchedule.addEventListener("click",()=>parseScheduleCsv(el.scheduleCsvInput.value));
el.parseCsv.addEventListener("click",()=>{
  const rows=parseSettlementCsv(el.csvInput.value); if (!rows.length) return;
  state.rates=avgRates(rows); scheduleSave(); renderRates(); renderAll();
  toast(`단가 ${state.rates.length}개 업데이트됨`,"success");
});
el.resetData.addEventListener("click",()=>{
  if (!confirm("예시 데이터로 초기화할까요?")) return;
  state.rates=avgRates(SAMPLE_SETTLEMENT); state.entries={};
  scheduleSave(); renderAll(); renderRates(); toast("초기화 완료","success");
});
el.openDbSettings.addEventListener("click",openSheet);
el.dbOverlay.addEventListener("click",closeSheet);
el.saveDbConfig.addEventListener("click",async()=>{
  const url=normalizeUrl(el.supabaseUrl.value); const key=el.supabaseAnonKey.value.trim();
  if (!url||!key){toast("URL과 key를 모두 입력해주세요","error");return;}
  el.supabaseUrl.value=url;
  saveDbConfig(url,key); state.db=buildClient(url,key);
  const ok=await loadFromDb();
  if (ok){closeSheet();toast("DB 재연결 완료","success");renderAll();}
  else toast("연결 실패 — URL/key를 확인해주세요","error");
});
el.syncNow.addEventListener("click",async()=>{
  await saveToDb(); await loadFromDb(); renderAll(); toast("동기화 완료","success");
});

/* ══ 시작 ══ */
state.statsYear=state.year; state.statsMonth=state.month;
init();
