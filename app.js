const won = new Intl.NumberFormat("ko-KR", {
  style: "currency",
  currency: "KRW",
  maximumFractionDigits: 0,
});

const number = new Intl.NumberFormat("ko-KR", {
  maximumFractionDigits: 0,
});

const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const DB_CONFIG_KEY = "quickflex-supabase-config";
const OWNER_ID = "kim-gwanhyun";

let dbClient = null;
let dbSaveTimer = null;
let isLoadingRemote = false;

const sampleSettlement = [
  ["302C", 237, 231075],
  ["303B", 573, 544350],
  ["304C", 53, 49025],
  ["308B", 165, 159225],
  ["308C", 154, 148610],
  ["310C", 473, 404415],
  ["310D", 370, 334895],
  ["311C", 139, 142475],
  ["311D", 173, 173865],
  ["313B", 194, 163930],
  ["313C", 57, 52725],
  ["313D", 186, 162750],
  ["314A", 305, 236375],
  ["314B", 210, 166950],
  ["316C", 177, 146025],
  ["316D", 80, 70000],
  ["318A", 179, 142305],
  ["318B", 132, 108900],
  ["318C", 360, 286200],
  ["318D", 58, 46110],
  ["319A", 212, 174900],
  ["319B", 189, 155925],
  ["319C", 106, 108650],
  ["322A", 281, 231825],
  ["322B", 230, 212750],
  ["322C", 224, 229600],
  ["322D", 179, 183475],
  ["324C", 127, 117475],
  ["324D", 50, 53750],
  ["407B", 218, 179850],
  ["407D", 54, 44550],
];

const sampleSchedule = {
  "2026-04-20": ["313B", "313C"],
  "2026-04-21": ["303A", "302B"],
  "2026-04-22": ["303C", "302D"],
  "2026-04-23": ["319A", "319B", "319C", "319D"],
  "2026-04-24": ["310C", "310D"],
  "2026-04-25": ["303A", "302B"],
};

const state = {
  settlementYear: 2026,
  settlementMonth: 4,
  selectedDate: "2026-04-25",
  mode: "amount",
  rates: loadRates(),
  entries: loadEntries(),
};

const el = {
  appShell: document.querySelector(".app-shell"),
  periodRevenue: document.querySelector("#periodRevenue"),
  periodCount: document.querySelector("#periodCount"),
  dailyAverage: document.querySelector("#dailyAverage"),
  meterFill: document.querySelector("#meterFill"),
  monthTitle: document.querySelector("#monthTitle"),
  periodRange: document.querySelector("#periodRange"),
  monthCalendar: document.querySelector("#monthCalendar"),
  prevMonth: document.querySelector("#prevMonth"),
  nextMonth: document.querySelector("#nextMonth"),
  todayButton: document.querySelector("#todayButton"),
  modeButtons: document.querySelectorAll(".mode"),
  selectedDateTitle: document.querySelector("#selectedDateTitle"),
  prevDay: document.querySelector("#prevDay"),
  nextDay: document.querySelector("#nextDay"),
  homeSelectedDate: document.querySelector("#homeSelectedDate"),
  homeSelectedTotal: document.querySelector("#homeSelectedTotal"),
  openRecord: document.querySelector("#openRecord"),
  openStats: document.querySelector("#openStats"),
  backToCalendar: document.querySelector("#backToCalendar"),
  backFromStats: document.querySelector("#backFromStats"),
  statsMonthTitle: document.querySelector("#statsMonthTitle"),
  statsRange: document.querySelector("#statsRange"),
  statsRevenue: document.querySelector("#statsRevenue"),
  statsMeterFill: document.querySelector("#statsMeterFill"),
  statsWorkDays: document.querySelector("#statsWorkDays"),
  statsOffDays: document.querySelector("#statsOffDays"),
  statsCount: document.querySelector("#statsCount"),
  statsFresh: document.querySelector("#statsFresh"),
  statsAverage: document.querySelector("#statsAverage"),
  statsBestDay: document.querySelector("#statsBestDay"),
  statsBestAmount: document.querySelector("#statsBestAmount"),
  deltaWorkDays: document.querySelector("#deltaWorkDays"),
  deltaOffDays: document.querySelector("#deltaOffDays"),
  deltaCount: document.querySelector("#deltaCount"),
  deltaFresh: document.querySelector("#deltaFresh"),
  deltaAverage: document.querySelector("#deltaAverage"),
  copySchedule: document.querySelector("#copySchedule"),
  offToggle: document.querySelector("#offToggle"),
  addRoute: document.querySelector("#addRoute"),
  entryRows: document.querySelector("#entryRows"),
  entryTemplate: document.querySelector("#entryTemplate"),
  freshCount: document.querySelector("#freshCount"),
  freshUnit: document.querySelector("#freshUnit"),
  freshRevenue: document.querySelector("#freshRevenue"),
  selectedDayTotal: document.querySelector("#selectedDayTotal"),
  scheduleImage: document.querySelector("#scheduleImage"),
  settlementImage: document.querySelector("#settlementImage"),
  previews: document.querySelector("#previews"),
  scheduleCsvInput: document.querySelector("#scheduleCsvInput"),
  runScheduleOcr: document.querySelector("#runScheduleOcr"),
  ocrStatus: document.querySelector("#ocrStatus"),
  parseSchedule: document.querySelector("#parseSchedule"),
  csvInput: document.querySelector("#csvInput"),
  parseCsv: document.querySelector("#parseCsv"),
  resetData: document.querySelector("#resetData"),
  rateRoute: document.querySelector("#rateRoute"),
  rateUnit: document.querySelector("#rateUnit"),
  saveRate: document.querySelector("#saveRate"),
  rateList: document.querySelector("#rateList"),
  supabaseUrl: document.querySelector("#supabaseUrl"),
  supabaseAnonKey: document.querySelector("#supabaseAnonKey"),
  saveDbConfig: document.querySelector("#saveDbConfig"),
  syncNow: document.querySelector("#syncNow"),
  dbStatus: document.querySelector("#dbStatus"),
};

function normalizeRoute(route) {
  return String(route || "").trim().toUpperCase();
}

function toNumber(value) {
  return Number(String(value ?? "").replace(/[^\d.-]/g, "")) || 0;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(dateKey) {
  return new Date(`${dateKey}T00:00:00`);
}

function addDays(dateKey, amount) {
  const date = parseDateKey(dateKey);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

function averageRates(rows) {
  const bucket = new Map();
  rows.forEach(([route, count, amount]) => {
    const key = normalizeRoute(route);
    const qty = toNumber(count);
    const money = toNumber(amount);
    if (!key || qty <= 0 || money <= 0) return;
    const current = bucket.get(key) || { count: 0, amount: 0 };
    current.count += qty;
    current.amount += money;
    bucket.set(key, current);
  });

  return [...bucket.entries()]
    .map(([route, item]) => ({
      route,
      count: item.count,
      amount: item.amount,
      unit: Math.round(item.amount / item.count),
    }))
    .sort((a, b) => a.route.localeCompare(b.route, "ko-KR"));
}

function loadRates() {
  const saved = localStorage.getItem("quickflex-rates-v2");
  return saved ? JSON.parse(saved) : averageRates(sampleSettlement);
}

function saveRates() {
  localStorage.setItem("quickflex-rates-v2", JSON.stringify(state.rates));
  scheduleDbSave();
}

function loadEntries() {
  const saved = localStorage.getItem("quickflex-entries-v2");
  return saved ? JSON.parse(saved) : {};
}

function saveEntries() {
  localStorage.setItem("quickflex-entries-v2", JSON.stringify(state.entries));
  scheduleDbSave();
}

function loadDbConfig() {
  const saved = localStorage.getItem(DB_CONFIG_KEY);
  return saved ? JSON.parse(saved) : { url: "", anonKey: "" };
}

function normalizeSupabaseUrl(value) {
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
  localStorage.setItem(DB_CONFIG_KEY, JSON.stringify({ url: normalizeSupabaseUrl(url), anonKey }));
}

function setDbStatus(message, connected = false) {
  el.dbStatus.textContent = message;
  el.dbStatus.parentElement.classList.toggle("connected", connected);
}

function getDbClient() {
  if (dbClient) return dbClient;
  const config = loadDbConfig();
  if (!config.url || !config.anonKey || !window.supabase) return null;
  dbClient = window.supabase.createClient(normalizeSupabaseUrl(config.url), config.anonKey);
  return dbClient;
}

async function loadFromDb() {
  const client = getDbClient();
  if (!client) {
    setDbStatus("DB 미연결: 이 기기에만 저장됩니다.");
    return;
  }

  isLoadingRemote = true;
  setDbStatus("DB에서 데이터를 불러오는 중...");
  const { data, error } = await client
    .from("quickflex_data")
    .select("rates, entries, updated_at")
    .eq("user_id", OWNER_ID)
    .maybeSingle();
  isLoadingRemote = false;

  if (error) {
    setDbStatus(`DB 불러오기 실패: ${error.message}`);
    return;
  }

  if (data) {
    state.rates = Array.isArray(data.rates) ? data.rates : state.rates;
    state.entries = data.entries && typeof data.entries === "object" ? data.entries : state.entries;
    localStorage.setItem("quickflex-rates-v2", JSON.stringify(state.rates));
    localStorage.setItem("quickflex-entries-v2", JSON.stringify(state.entries));
    renderAll();
    setDbStatus(`DB 연결됨: ${new Date(data.updated_at).toLocaleString("ko-KR")} 기준`, true);
    return;
  }

  await saveToDb();
}

async function saveToDb() {
  if (isLoadingRemote) return;
  const client = getDbClient();
  if (!client) return;

  const payload = {
    user_id: OWNER_ID,
    rates: state.rates,
    entries: state.entries,
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from("quickflex_data").upsert(payload, { onConflict: "user_id" });
  if (error) {
    setDbStatus(`DB 저장 실패: ${error.message}`);
    return;
  }
  setDbStatus(`DB 저장됨: ${new Date().toLocaleString("ko-KR")}`, true);
}

function scheduleDbSave() {
  if (!getDbClient()) return;
  clearTimeout(dbSaveTimer);
  dbSaveTimer = setTimeout(saveToDb, 450);
}

function renderDbConfig() {
  const config = loadDbConfig();
  el.supabaseUrl.value = normalizeSupabaseUrl(config.url) || "";
  el.supabaseAnonKey.value = config.anonKey || "";
  if (config.url && config.anonKey) {
    setDbStatus("DB 설정 있음: 연결 확인 중...", true);
  }
}

function periodBounds(year = state.settlementYear, month = state.settlementMonth) {
  return {
    start: new Date(year, month - 2, 26),
    end: new Date(year, month - 1, 25),
  };
}

function rateFor(route) {
  return state.rates.find((item) => item.route === normalizeRoute(route))?.unit || 0;
}

function effectiveUnit(row) {
  const savedUnit = toNumber(row.unit);
  const tableUnit = rateFor(row.route);
  if (savedUnit > 0) return savedUnit;
  if (tableUnit > 0) {
    row.unit = tableUnit;
    return tableUnit;
  }
  return 0;
}

function dayRecord(dateKey) {
  if (!state.entries[dateKey]) {
    const rows = (sampleSchedule[dateKey] || []).map((route) => ({
      route,
      count: "",
      unit: rateFor(route),
    }));
    state.entries[dateKey] = {
      off: false,
      rows,
      freshCount: "",
      freshUnit: 100,
    };
  }
  state.entries[dateKey].rows = Array.isArray(state.entries[dateKey].rows) ? state.entries[dateKey].rows : [];
  state.entries[dateKey].rows.forEach((row) => {
    effectiveUnit(row);
  });
  if (state.entries[dateKey].freshUnit === undefined || state.entries[dateKey].freshUnit === "") {
    state.entries[dateKey].freshUnit = 100;
  }
  state.entries[dateKey].off = Boolean(state.entries[dateKey].off);
  return state.entries[dateKey];
}

function routeOptions(selected) {
  const current = normalizeRoute(selected);
  const routes = new Set([...state.rates.map((item) => item.route), current].filter(Boolean));
  return [...routes]
    .sort((a, b) => a.localeCompare(b, "ko-KR"))
    .map((route) => `<option value="${route}" ${route === current ? "selected" : ""}>${route}</option>`)
    .join("");
}

function calculateRecord(record) {
  if (record.off) return { count: 0, revenue: 0 };
  const routeTotal = record.rows.reduce(
    (sum, row) => {
      const count = toNumber(row.count);
      const unit = effectiveUnit(row);
      return {
        count: sum.count + count,
        revenue: sum.revenue + count * unit,
      };
    },
    { count: 0, revenue: 0 },
  );
  const freshCount = toNumber(record.freshCount);
  return {
    count: routeTotal.count + freshCount,
    revenue: routeTotal.revenue + freshCount * toNumber(record.freshUnit),
  };
}

function periodKeys() {
  return periodKeysFor(state.settlementYear, state.settlementMonth);
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

function summarizePeriod(year = state.settlementYear, month = state.settlementMonth) {
  let best = { dateKey: "", revenue: 0 };
  const total = periodKeysFor(year, month).reduce(
    (sum, dateKey) => {
      const record = dayRecord(dateKey);
      const day = calculateRecord(record);
      const fresh = record.off ? 0 : toNumber(record.freshCount);
      if (day.revenue > best.revenue) best = { dateKey, revenue: day.revenue };
      return {
        count: sum.count + day.count,
        revenue: sum.revenue + day.revenue,
        workDays: sum.workDays + (day.revenue > 0 ? 1 : 0),
        offDays: sum.offDays + (record.off ? 1 : 0),
        fresh: sum.fresh + fresh,
      };
    },
    { count: 0, revenue: 0, workDays: 0, offDays: 0, fresh: 0 },
  );
  total.average = total.workDays ? total.revenue / total.workDays : 0;
  total.best = best;
  return total;
}

function formatShortDate(date) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function formatLongDate(dateKey) {
  const date = parseDateKey(dateKey);
  return `${date.getFullYear()}년 ${String(date.getMonth() + 1).padStart(2, "0")}월 ${String(date.getDate()).padStart(2, "0")}일(${weekdays[date.getDay()]})`;
}

function renderSummary() {
  const total = summarizePeriod();
  el.periodRevenue.textContent = won.format(total.revenue);
  el.periodCount.textContent = `${number.format(total.count)}건`;
  el.dailyAverage.textContent = won.format(total.average);
  el.meterFill.style.width = `${Math.min((total.revenue / 6000000) * 100, 100)}%`;
}

function renderMonth() {
  const { start, end } = periodBounds();
  const gridStart = new Date(start);
  gridStart.setDate(gridStart.getDate() - gridStart.getDay());
  const gridEnd = new Date(end);
  gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));

  el.monthTitle.textContent = `${state.settlementYear}년 ${String(state.settlementMonth).padStart(2, "0")}월`;
  el.periodRange.textContent = `${formatShortDate(start)} ~ ${formatShortDate(end)}`;
  el.monthCalendar.innerHTML = "";

  const todayKey = toDateKey(new Date());
  const cursor = new Date(gridStart);
  while (cursor <= gridEnd) {
    const dateKey = toDateKey(cursor);
    const record = dayRecord(dateKey);
    const calc = calculateRecord(record);
    const inPeriod = cursor >= start && cursor <= end;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = ["day-cell", inPeriod ? "" : "outside", record.off ? "off" : "", dateKey === state.selectedDate ? "selected" : ""]
      .filter(Boolean)
      .join(" ");

    const dayText = cursor.getDate() === 1 ? `${cursor.getMonth() + 1} / 01` : String(cursor.getDate()).padStart(2, "0");
    const value = record.off
      ? "휴무"
      : state.mode === "count"
        ? calc.count > 0 ? `${number.format(calc.count)}건` : ""
        : state.mode === "off"
          ? ""
          : calc.revenue > 0 ? number.format(calc.revenue) : "";

    cell.innerHTML = `
      <span class="day-number">${dayText}</span>
      ${dateKey === todayKey ? '<span class="today-dot">오늘</span>' : ""}
      <span class="day-value">${value}</span>
    `;
    cell.addEventListener("click", () => selectDate(dateKey));
    el.monthCalendar.append(cell);
    cursor.setDate(cursor.getDate() + 1);
  }
}

function refreshLiveTotals() {
  const record = dayRecord(state.selectedDate);
  el.freshRevenue.textContent = won.format(toNumber(record.freshCount) * toNumber(record.freshUnit));
  el.selectedDayTotal.textContent = won.format(calculateRecord(record).revenue);
  renderSummary();
  renderMonth();
}

function renderEntryForm() {
  const record = dayRecord(state.selectedDate);
  el.selectedDateTitle.textContent = formatLongDate(state.selectedDate);
  el.offToggle.checked = record.off;
  el.freshCount.value = record.freshCount ?? "";
  el.freshUnit.value = record.freshUnit ?? 100;
  el.entryRows.innerHTML = "";

  if (record.rows.length === 0 && !record.off) {
    const first = state.rates[0] || { route: "", unit: 0 };
    record.rows.push({ route: first.route, count: "", unit: first.unit });
  }

  record.rows.forEach((row, index) => {
    const item = el.entryTemplate.content.firstElementChild.cloneNode(true);
    const select = item.querySelector("select");
    const count = item.querySelector(".count");
    const unit = item.querySelector(".unit");
    const output = item.querySelector("output");
    const remove = item.querySelector("button");

    select.innerHTML = routeOptions(row.route);
    count.value = row.count ?? "";
    unit.value = effectiveUnit(row) || "";
    output.textContent = won.format(toNumber(row.count) * effectiveUnit(row));

    select.addEventListener("change", () => {
      row.route = normalizeRoute(select.value);
      row.unit = rateFor(row.route);
      saveEntries();
      renderAll();
    });
    count.addEventListener("input", () => {
      row.count = count.value;
      output.textContent = won.format(toNumber(row.count) * effectiveUnit(row));
      saveEntries();
      refreshLiveTotals();
    });
    unit.addEventListener("input", () => {
      row.unit = unit.value;
      output.textContent = won.format(toNumber(row.count) * effectiveUnit(row));
      saveEntries();
      refreshLiveTotals();
    });
    remove.addEventListener("click", () => {
      record.rows.splice(index, 1);
      saveEntries();
      renderAll();
    });

    el.entryRows.append(item);
  });

  el.freshRevenue.textContent = won.format(toNumber(record.freshCount) * toNumber(record.freshUnit));
  el.selectedDayTotal.textContent = won.format(calculateRecord(record).revenue);
}

function renderHomeSelection() {
  const record = dayRecord(state.selectedDate);
  el.homeSelectedDate.textContent = formatLongDate(state.selectedDate);
  el.homeSelectedTotal.textContent = won.format(calculateRecord(record).revenue);
}

function previousPeriod() {
  const prev = new Date(state.settlementYear, state.settlementMonth - 2, 1);
  return { year: prev.getFullYear(), month: prev.getMonth() + 1 };
}

function deltaText(current, previous, unit = "") {
  const delta = Math.round(current - previous);
  if (delta === 0) return "";
  return `${number.format(Math.abs(delta))}${unit}${delta > 0 ? "↑" : "↓"}`;
}

function renderStats() {
  const { start, end } = periodBounds();
  const prev = previousPeriod();
  const current = summarizePeriod();
  const previous = summarizePeriod(prev.year, prev.month);

  el.statsMonthTitle.textContent = `${state.settlementYear}년 ${String(state.settlementMonth).padStart(2, "0")}월`;
  el.statsRange.textContent = `${formatShortDate(start)} ~ ${formatShortDate(end)}`;
  el.statsRevenue.textContent = won.format(current.revenue);
  el.statsMeterFill.style.width = `${Math.min((current.revenue / 6000000) * 100, 100)}%`;
  el.statsWorkDays.textContent = `${number.format(current.workDays)}일`;
  el.statsOffDays.textContent = `${number.format(current.offDays)}일`;
  el.statsCount.textContent = `${number.format(current.count)}건`;
  el.statsFresh.textContent = `${number.format(current.fresh)}건`;
  el.statsAverage.textContent = won.format(current.average);
  el.statsBestDay.textContent = current.best.dateKey ? formatLongDate(current.best.dateKey).replace(/^\d{4}년\s*/, "") : "-";
  el.statsBestAmount.textContent = current.best.revenue ? won.format(current.best.revenue) : "";

  el.deltaWorkDays.textContent = deltaText(current.workDays, previous.workDays, "일");
  el.deltaOffDays.textContent = deltaText(current.offDays, previous.offDays, "일");
  el.deltaCount.textContent = deltaText(current.count, previous.count, "건");
  el.deltaFresh.textContent = deltaText(current.fresh, previous.fresh, "건");
  el.deltaAverage.textContent = deltaText(current.average, previous.average, "원");
}

function renderRates() {
  el.rateList.innerHTML = state.rates
    .map((item) => `<button class="rate-chip" type="button" data-route="${item.route}" data-unit="${item.unit}"><strong>${item.route}</strong>${number.format(item.unit)}원</button>`)
    .join("");

  el.rateList.querySelectorAll(".rate-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      el.rateRoute.value = chip.dataset.route;
      el.rateUnit.value = chip.dataset.unit;
    });
  });
}

function renderAll() {
  renderSummary();
  renderMonth();
  renderHomeSelection();
  renderStats();
  renderEntryForm();
  renderRates();
}

function showView(view) {
  el.appShell.dataset.view = view;
  if (view === "record") {
    renderEntryForm();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

function selectDate(dateKey) {
  state.selectedDate = dateKey;
  const date = parseDateKey(dateKey);
  state.settlementYear = date.getDate() <= 25 ? date.getFullYear() : new Date(date.getFullYear(), date.getMonth() + 1, 1).getFullYear();
  state.settlementMonth = date.getDate() <= 25 ? date.getMonth() + 1 : date.getMonth() + 2;
  if (state.settlementMonth > 12) state.settlementMonth = 1;
  renderAll();
}

function moveMonth(amount) {
  const next = new Date(state.settlementYear, state.settlementMonth - 1 + amount, 1);
  state.settlementYear = next.getFullYear();
  state.settlementMonth = next.getMonth() + 1;
  state.selectedDate = toDateKey(periodBounds().end);
  renderAll();
}

function upsertRate(route, unit) {
  const key = normalizeRoute(route);
  const price = toNumber(unit);
  if (!key || price <= 0) return;
  const existing = state.rates.find((item) => item.route === key);
  if (existing) existing.unit = price;
  else state.rates.push({ route: key, count: 0, amount: 0, unit: price });
  state.rates.sort((a, b) => a.route.localeCompare(b.route, "ko-KR"));

  const record = dayRecord(state.selectedDate);
  record.rows.forEach((row) => {
    if (normalizeRoute(row.route) === key) row.unit = price;
  });
  if (record.rows.length === 1 && !record.rows[0].route) {
    record.rows[0].route = key;
    record.rows[0].unit = price;
  }

  saveRates();
  saveEntries();
  renderAll();
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (const char of line) {
    if (char === '"') quoted = !quoted;
    else if ((char === "," || char === "\t") && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseSettlementCsv(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((cell) => cell.replace(/\s/g, ""));
  const routeIndex = header.findIndex((cell) => /route|구역|노선/i.test(cell));
  const countIndex = header.findIndex((cell) => /배송건수|건수|합계/i.test(cell));
  const amountIndex = header.findIndex((cell) => /금액|매출|정산/i.test(cell));
  if (routeIndex < 0 || countIndex < 0 || amountIndex < 0) {
    alert("Route, 배송건수, 금액 열을 찾지 못했습니다.");
    return [];
  }
  return lines.slice(1).map((line) => {
    const cells = splitCsvLine(line);
    return [cells[routeIndex], cells[countIndex], cells[amountIndex]];
  });
}

function parseHeaderDate(value) {
  const text = String(value || "").trim();
  const full = text.match(/(20\d{2})[-./년\s]+(\d{1,2})[-./월\s]+(\d{1,2})/);
  if (full) return `${full[1]}-${String(full[2]).padStart(2, "0")}-${String(full[3]).padStart(2, "0")}`;
  const short = text.match(/(\d{1,2})\s*[./월]\s*(\d{1,2})/);
  if (!short) return "";
  const month = Number(short[1]);
  const year = month > state.settlementMonth ? state.settlementYear - 1 : state.settlementYear;
  return `${year}-${String(month).padStart(2, "0")}-${String(short[2]).padStart(2, "0")}`;
}

function routesFromCell(value) {
  const text = String(value || "").trim();
  if (!text || /휴무|off/i.test(text)) return [];
  return text.split(/[,/·\s]+/).map(normalizeRoute).filter(Boolean);
}

function routeTokensFromText(text) {
  const clean = String(text || "").toUpperCase().replace(/[()]/g, " ");
  const tokens = clean.match(/휴무|OFF|\d{3}[A-D]/g) || [];
  const groups = [];
  let current = [];

  tokens.forEach((token) => {
    if (token === "휴무" || token === "OFF") {
      if (current.length) groups.push(current);
      groups.push([]);
      current = [];
      return;
    }
    current.push(token);
  });

  if (current.length) groups.push(current);
  return groups;
}

function dateKeysFromOcrText(text) {
  const matches = [...String(text || "").matchAll(/(\d{1,2})\s*[./월]\s*(\d{1,2})/g)];
  const seen = new Set();
  return matches
    .map((match) => parseHeaderDate(`${match[1]}.${match[2]}`))
    .filter((dateKey) => {
      if (!dateKey || seen.has(dateKey)) return false;
      seen.add(dateKey);
      return true;
    });
}

function parseScheduleOcrText(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const workerLine = lines.find((line) => /김\s*관\s*현/.test(line.replace(/\s+/g, " ")));
  if (!workerLine) {
    alert("OCR 결과에서 김관현님 행을 찾지 못했습니다. 인식 텍스트를 확인해 주세요.");
    return false;
  }

  const dateKeys = dateKeysFromOcrText(text);
  const groups = routeTokensFromText(workerLine.replace(/김\s*관\s*현/g, ""));
  const fallbackKeys = periodKeys();
  const targetKeys = dateKeys.length ? dateKeys : fallbackKeys;

  groups.forEach((routes, index) => {
    const dateKey = targetKeys[index];
    if (!dateKey) return;
    state.entries[dateKey] = {
      off: routes.length === 0,
      rows: routes.map((route) => ({ route, count: "", unit: rateFor(route) })),
      freshCount: "",
      freshUnit: 100,
    };
  });

  saveEntries();
  renderAll();
  return true;
}

function parseScheduleCsv(text) {
  const rows = text.split(/\r?\n/).map((line) => splitCsvLine(line)).filter((row) => row.some(Boolean));
  if (rows.length < 2) {
    parseScheduleOcrText(text);
    return;
  }
  const header = rows[0];
  const target = rows.find((row, index) => index > 0 && row.some((cell) => String(cell).trim() === "김관현"));
  if (!target) {
    alert("김관현 기사님 행을 찾지 못했습니다.");
    return;
  }
  header.forEach((cell, index) => {
    const dateKey = parseHeaderDate(cell);
    if (!dateKey) return;
    const routes = routesFromCell(target[index]);
    state.entries[dateKey] = {
      off: routes.length === 0,
      rows: routes.map((route) => ({ route, count: "", unit: rateFor(route) })),
      freshCount: "",
      freshUnit: 100,
    };
  });
  saveEntries();
  renderAll();
}

function previewImage(input, label) {
  const file = input.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const item = document.createElement("div");
    item.className = "preview";
    item.innerHTML = `
      <img src="${reader.result}" alt="${label} 미리보기" />
      <div><strong>${label}</strong><span>${file.name}</span></div>
    `;
    el.previews.prepend(item);
  });
  reader.readAsDataURL(file);
}

async function runScheduleOcr() {
  const file = el.scheduleImage.files?.[0];
  if (!file) {
    alert("먼저 스케줄표 이미지를 선택해 주세요.");
    return;
  }
  if (!window.Tesseract) {
    alert("OCR 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해 주세요.");
    return;
  }

  el.runScheduleOcr.disabled = true;
  el.ocrStatus.textContent = "OCR 준비 중...";

  try {
    const result = await window.Tesseract.recognize(file, "kor+eng", {
      logger(message) {
        if (message.status === "recognizing text") {
          el.ocrStatus.textContent = `OCR 인식 중 ${Math.round(message.progress * 100)}%`;
        } else if (message.status) {
          el.ocrStatus.textContent = `OCR ${message.status}`;
        }
      },
    });

    const text = result.data.text.trim();
    el.scheduleCsvInput.value = text;
    const applied = parseScheduleOcrText(text);
    el.ocrStatus.textContent = applied
      ? "OCR 완료: 김관현님 스케줄을 반영했습니다. 인식 내용은 아래 텍스트에서 확인할 수 있어요."
      : "OCR 완료: 인식 텍스트를 확인한 뒤 스케줄 반영을 눌러 주세요.";
  } catch (error) {
    console.error(error);
    el.ocrStatus.textContent = "OCR 실패: 이미지가 흐리거나 인터넷 연결이 불안정할 수 있습니다.";
  } finally {
    el.runScheduleOcr.disabled = false;
  }
}

el.prevMonth.addEventListener("click", () => moveMonth(-1));
el.nextMonth.addEventListener("click", () => moveMonth(1));
el.todayButton.addEventListener("click", () => selectDate(toDateKey(new Date())));
el.openRecord.addEventListener("click", () => showView("record"));
el.openStats.addEventListener("click", () => showView("stats"));
el.backToCalendar.addEventListener("click", () => showView("home"));
el.backFromStats.addEventListener("click", () => showView("home"));
el.prevDay.addEventListener("click", () => selectDate(addDays(state.selectedDate, -1)));
el.nextDay.addEventListener("click", () => selectDate(addDays(state.selectedDate, 1)));

el.modeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    el.modeButtons.forEach((item) => item.classList.toggle("active", item === button));
    renderMonth();
  });
});

el.copySchedule.addEventListener("click", () => {
  const record = dayRecord(state.selectedDate);
  record.rows = (sampleSchedule[state.selectedDate] || []).map((route) => ({ route, count: "", unit: rateFor(route) }));
  record.off = record.rows.length === 0;
  saveEntries();
  renderAll();
});

el.offToggle.addEventListener("change", () => {
  dayRecord(state.selectedDate).off = el.offToggle.checked;
  saveEntries();
  renderAll();
});

el.addRoute.addEventListener("click", () => {
  const record = dayRecord(state.selectedDate);
  const first = state.rates[0] || { route: "", unit: 0 };
  record.off = false;
  record.rows.push({ route: first.route, count: "", unit: first.unit });
  saveEntries();
  renderAll();
});

el.freshCount.addEventListener("input", () => {
  dayRecord(state.selectedDate).freshCount = el.freshCount.value;
  saveEntries();
  refreshLiveTotals();
});

el.freshUnit.addEventListener("input", () => {
  dayRecord(state.selectedDate).freshUnit = el.freshUnit.value;
  saveEntries();
  refreshLiveTotals();
});

el.parseCsv.addEventListener("click", () => {
  const rows = parseSettlementCsv(el.csvInput.value);
  if (!rows.length) return;
  state.rates = averageRates(rows);
  saveRates();
  renderAll();
});

el.parseSchedule.addEventListener("click", () => parseScheduleCsv(el.scheduleCsvInput.value));
el.runScheduleOcr.addEventListener("click", runScheduleOcr);
el.resetData.addEventListener("click", () => {
  state.rates = averageRates(sampleSettlement);
  state.entries = {};
  saveRates();
  saveEntries();
  renderAll();
});
el.saveRate.addEventListener("click", () => {
  upsertRate(el.rateRoute.value, el.rateUnit.value);
  el.rateRoute.value = "";
  el.rateUnit.value = "";
});
el.saveDbConfig.addEventListener("click", async () => {
  const url = normalizeSupabaseUrl(el.supabaseUrl.value);
  const anonKey = el.supabaseAnonKey.value.trim();
  if (!url || !anonKey) {
    setDbStatus("Project URL과 anon public key를 모두 입력해 주세요.");
    return;
  }
  el.supabaseUrl.value = url;
  saveDbConfig(url, anonKey);
  dbClient = null;
  await loadFromDb();
});
el.syncNow.addEventListener("click", async () => {
  await saveToDb();
  await loadFromDb();
});
el.scheduleImage.addEventListener("change", () => previewImage(el.scheduleImage, "스케줄표"));
el.settlementImage.addEventListener("change", () => previewImage(el.settlementImage, "정산표"));

renderDbConfig();
renderAll();
loadFromDb();
