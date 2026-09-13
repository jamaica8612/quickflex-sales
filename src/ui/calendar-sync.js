import {
  CALENDAR_SYNC_FUNCTION,
  DEFAULT_CALENDAR_SYNC_SETTINGS,
  buildCalendarDesiredEvent,
  expandCalendarSyncRange,
  normalizeCalendarSyncDays,
  normalizeCalendarSyncSettings,
} from "../lib/calendar-sync.js";

const styleId = "quickflex-calendar-sync-style";
const statusPollIntervalMs = 10_000;
const statusPollMaxDurationMs = 6 * 60_000;

function addStyles() {
  if (document.getElementById(styleId)) return;
  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
    .calendar-sync-card { display:grid; gap:12px; }
    .calendar-sync-card h2 { margin:0; }
    .calendar-sync-status { margin:4px 0 0; font-size:12px; font-weight:500; color:var(--muted); font-variant-numeric:tabular-nums; }
    .calendar-sync-card .hint { margin:0; font-size:12px; font-weight:500; }
    .calendar-sync-controls { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .calendar-sync-controls label { display:flex; align-items:center; gap:7px; font-size:13px; font-weight:500; }
    .calendar-sync-range { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
    .calendar-sync-actions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; }
    #calendarSyncContent .calendar-sync-actions .secondary-btn { min-height:36px; font-size:13px; font-weight:600; background:var(--panel2); color:var(--text); border:0; box-shadow:none; }
    .calendar-sync-preview { margin:0; padding-left:18px; font-size:12px; font-weight:500; color:var(--muted); font-variant-numeric:tabular-nums; }
    .calendar-sync-warning { color:var(--red); font-size:12px; font-weight:500; margin:0; }
  `;
  document.head.append(style);
}

function monthRange() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = new Date(year, month, 0).getDate();
  return { startDate, endDate: `${year}-${String(month).padStart(2, "0")}-${String(end).padStart(2, "0")}` };
}

function escaped(value) {
  return String(value || "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

export function calendarSyncStatusCopy(status) {
  if (!status) return "연결 상태를 확인하고 있습니다.";
  if (status.state === "setup_required") return "Google Cloud OAuth 설정이 필요합니다.";
  if (status.state === "unavailable") return "캘린더 서버에 연결하지 못했습니다. 잠시 후 다시 확인해 주세요.";
  if (status.state === "connected") {
    const pendingJobs = Math.max(0, Number(status.pendingJobs) || 0);
    if (pendingJobs > 0) return `동기화 중 · 서버 처리 대기 ${pendingJobs}건`;
    if (status.lastJobStatus === "failed") return `동기화 실패 · ${status.lastJobError || "다시 예약해 주세요."}`;
    if (status.lastJobStatus === "conflict") return `일정 확인 필요 · ${status.lastJobError || "Google에서 바뀐 일정이 있어 보류했습니다."}`;
    return status.lastSuccessfulAt
      ? `연결됨 · 마지막 성공 ${new Date(status.lastSuccessfulAt).toLocaleString("ko-KR")}`
      : "연결됨 · 동기화 대기";
  }
  if (status.state === "needs_reconnect") return "다시 연결 필요 · Google 권한을 갱신하세요.";
  if (status.state === "disconnected") return "연결 해제됨 · 기존 Google 일정은 보존됩니다.";
  return "연결 전 · QuickFlex가 만든 전용 Google 캘린더만 관리합니다.";
}

export function calendarSyncShouldPoll(status, pollUntil, now, visibilityState) {
  return status?.state === "connected"
    && Number(status.pendingJobs) > 0
    && now < pollUntil
    && visibilityState !== "hidden";
}

/**
 * Settings-panel controller. getDays(startDate, endDate) must return only the
 * signed-in user's canonical day snapshots; it may be asynchronous.
 */
export function mountCalendarSync({ host, db, getDays, toast }) {
  if (!host) throw new Error("calendar sync host is required");
  addStyles();
  const range = monthRange();
  const details = host.closest?.("details") || null;
  const model = {
    status: null,
    startDate: range.startDate,
    endDate: range.endDate,
    settings: { ...DEFAULT_CALENDAR_SYNC_SETTINGS },
    disposed: false,
    lifecycle: 0,
    refreshRequest: 0,
    previewRequest: 0,
    queueing: false,
    pollTimer: null,
    pollUntil: 0,
  };

  function isCurrent(lifecycle) {
    return !model.disposed && lifecycle === model.lifecycle;
  }

  function clearStatusPoll(resetWindow = false) {
    if (model.pollTimer) clearTimeout(model.pollTimer);
    model.pollTimer = null;
    if (resetWindow) model.pollUntil = 0;
  }

  function syncStatusPoll() {
    clearStatusPoll();
    const pending = Number(model.status?.pendingJobs) > 0;
    const visibilityState = document.visibilityState === "hidden" || (details && !details.open) ? "hidden" : "visible";
    if (!calendarSyncShouldPoll(model.status, model.pollUntil, Date.now(), visibilityState)) {
      if (!pending) model.pollUntil = 0;
      return;
    }
    const lifecycle = model.lifecycle;
    model.pollTimer = setTimeout(() => {
      model.pollTimer = null;
      if (isCurrent(lifecycle)) refresh();
    }, statusPollIntervalMs);
  }

  function onVisibilityChange() {
    if (document.visibilityState === "hidden") {
      clearStatusPoll();
    } else if ((!details || details.open) && Number(model.status?.pendingJobs) > 0) {
      clearStatusPoll();
      const lifecycle = model.lifecycle;
      model.pollTimer = setTimeout(() => {
        model.pollTimer = null;
        if (isCurrent(lifecycle)) refresh();
      }, 0);
    }
  }

  function onPanelToggle() {
    if (!details?.open) {
      clearStatusPoll(true);
      return;
    }
    if (Number(model.status?.pendingJobs) > 0) model.pollUntil = Date.now() + statusPollMaxDurationMs;
    refresh();
  }

  document.addEventListener("visibilitychange", onVisibilityChange);
  details?.addEventListener("toggle", onPanelToggle);

  async function invoke(action, body = {}) {
    if (!db?.functions?.invoke) throw new Error("로그인 연결을 먼저 확인하세요.");
    const { data, error } = await db.functions.invoke(CALENDAR_SYNC_FUNCTION, { body: { action, ...body } });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    return data || {};
  }

  function renderStatus() {
    const status = host.querySelector(".calendar-sync-status");
    if (status) status.textContent = calendarSyncStatusCopy(model.status);
  }

  function render() {
    if (model.disposed) return;
    const status = model.status || {};
    const setup = status.state === "setup_required";
    const connected = status.state === "connected";
    const unavailable = status.state === "unavailable";
    const options = normalizeCalendarSyncSettings(model.settings);
    const preview = normalizeCalendarSyncDays([]).map(() => "");
    host.innerHTML = `
      <section class="settings-section calendar-sync-card" aria-labelledby="calendarSyncHeading">
        <div><h2 id="calendarSyncHeading">Google 캘린더 연동</h2><p class="calendar-sync-status" role="status" aria-live="polite">${escaped(calendarSyncStatusCopy(model.status))}</p></div>
        <p class="hint">퀵플렉스 전용 Google 보조 캘린더에만 단방향으로 반영됩니다. 삼성 캘린더에서는 같은 Google 계정을 동기화해 확인합니다.</p>
        ${setup ? '<p class="calendar-sync-warning">Google 연결을 준비 중입니다.</p>' : ""}
        <div class="calendar-sync-range">
          <label class="settings-field"><span>시작일</span><input data-calendar-start type="date" value="${escaped(model.startDate)}"></label>
          <label class="settings-field"><span>종료일</span><input data-calendar-end type="date" value="${escaped(model.endDate)}"></label>
        </div>
        <div class="calendar-sync-controls" aria-label="동기화 항목">
          <label><input data-calendar-option="includeWork" type="checkbox" ${options.includeWork ? "checked" : ""}>근무</label>
          <label><input data-calendar-option="includeOff" type="checkbox" ${options.includeOff ? "checked" : ""}>휴무</label>
          <label><input data-calendar-option="includeRoute" type="checkbox" ${options.includeRoute ? "checked" : ""}>구역명</label>
          <label><input data-calendar-option="includeRevenue" type="checkbox" ${options.includeRevenue ? "checked" : ""}>매출액 표시</label>
        </div>
        <ul class="calendar-sync-preview" data-calendar-preview>${preview.length ? preview.join("") : "<li>매출액 표시는 기본으로 꺼져 있습니다. 미기록 금액은 0원으로 만들지 않습니다.</li>"}</ul>
        <div class="calendar-sync-actions">
          ${connected ? `<button class="primary-pill" type="button" data-calendar-sync ${model.queueing ? "disabled" : ""}>${model.queueing ? "예약 중…" : "동기화 예약"}</button><button class="secondary-btn" type="button" data-calendar-reapply ${model.queueing ? "disabled" : ""}>불일치 다시 반영</button><button class="secondary-btn" type="button" data-calendar-disconnect>연결 해제</button>` : unavailable ? '<button class="secondary-btn" type="button" data-calendar-refresh>다시 확인</button>' : `<button class="primary-pill" type="button" data-calendar-connect ${setup || !model.status ? "disabled" : ""}>Google 연결</button>`}
        </div>
      </section>`;
    bindRenderedEvents();
  }

  async function renderPreview() {
    const container = host.querySelector("[data-calendar-preview]");
    if (!container) return;
    const lifecycle = model.lifecycle;
    const request = ++model.previewRequest;
    try {
      const days = expandCalendarSyncRange(await getDays(model.startDate, model.endDate), model.startDate, model.endDate);
      if (!isCurrent(lifecycle) || request !== model.previewRequest || !host.contains(container)) return;
      const events = days.map((day) => buildCalendarDesiredEvent(day, model.settings)).filter(Boolean).slice(0, 3);
      container.innerHTML = events.length
        ? events.map((event) => `<li>${escaped(event.date)} · ${escaped(event.title)}</li>`).join("")
        : "<li>선택한 기간에 내보낼 근무·휴무·매출 기록이 없습니다.</li>";
    } catch (error) {
      if (!isCurrent(lifecycle) || request !== model.previewRequest || !host.contains(container)) return;
      container.innerHTML = `<li>미리보기를 불러오지 못했습니다: ${escaped(error.message)}</li>`;
    }
  }

  function bindRenderedEvents() {
    host.querySelector("[data-calendar-refresh]")?.addEventListener("click", refresh);
    host.querySelector("[data-calendar-start]")?.addEventListener("change", (event) => { model.startDate = event.target.value; renderPreview(); });
    host.querySelector("[data-calendar-end]")?.addEventListener("change", (event) => { model.endDate = event.target.value; renderPreview(); });
    host.querySelectorAll("[data-calendar-option]").forEach((input) => input.addEventListener("change", () => {
      model.settings[input.dataset.calendarOption] = input.checked;
      renderPreview();
    }));
    host.querySelector("[data-calendar-connect]")?.addEventListener("click", async () => {
      const lifecycle = model.lifecycle;
      try {
        const result = await invoke("oauth_start", { returnTo: window.location.href });
        if (!isCurrent(lifecycle)) return;
        if (!result.authorizationUrl) throw new Error("Google 연결 주소를 만들지 못했습니다.");
        window.location.assign(result.authorizationUrl);
      } catch (error) {
        if (isCurrent(lifecycle)) toast(`Google 연결을 시작하지 못했습니다: ${error.message}`, "error");
      }
    });
    host.querySelector("[data-calendar-sync]")?.addEventListener("click", () => queue(false));
    host.querySelector("[data-calendar-reapply]")?.addEventListener("click", () => queue(true));
    host.querySelector("[data-calendar-disconnect]")?.addEventListener("click", async () => {
      const lifecycle = model.lifecycle;
      try {
        await invoke("disconnect");
        if (!isCurrent(lifecycle)) return;
        await refresh();
        if (isCurrent(lifecycle)) toast("후속 동기화를 중단했습니다. 기존 Google 일정은 유지됩니다.", "success");
      } catch (error) {
        if (isCurrent(lifecycle)) toast(`연결 해제 실패: ${error.message}`, "error");
      }
    });
    renderPreview();
  }

  async function queue(force) {
    if (model.queueing || model.disposed) return;
    const lifecycle = model.lifecycle;
    model.queueing = true;
    render();
    try {
      if (!model.startDate || !model.endDate || model.startDate > model.endDate) throw new Error("동기화 기간을 확인하세요.");
      const startDate = model.startDate;
      const endDate = model.endDate;
      const settings = normalizeCalendarSyncSettings(model.settings);
      const days = expandCalendarSyncRange(await getDays(startDate, endDate), startDate, endDate);
      if (!isCurrent(lifecycle)) return;
      const result = await invoke(force ? "reapply" : "queue", { startDate, endDate, settings, days });
      if (!isCurrent(lifecycle)) return;
      model.refreshRequest += 1;
      model.status = { ...(model.status || {}), pendingJobs: result.pendingJobs || 1 };
      model.pollUntil = Date.now() + statusPollMaxDurationMs;
      render();
      syncStatusPoll();
      toast(force ? "불일치 일정 재반영을 예약했습니다." : "캘린더 동기화를 예약했습니다.", "success");
    } catch (error) {
      if (isCurrent(lifecycle)) toast(`동기화 예약 실패: ${error.message}`, "error");
    } finally {
      if (isCurrent(lifecycle)) {
        model.queueing = false;
        render();
        syncStatusPoll();
      }
    }
  }

  async function refresh() {
    const lifecycle = model.lifecycle;
    const request = ++model.refreshRequest;
    const previousState = model.status?.state;
    let nextStatus;
    try { nextStatus = await invoke("status"); }
    catch (error) { nextStatus = { state: "unavailable", detail: error.message }; }
    if (!isCurrent(lifecycle) || request !== model.refreshRequest) return model.status;
    model.status = nextStatus;
    if (Number(nextStatus?.pendingJobs) > 0 && !model.pollUntil) model.pollUntil = Date.now() + statusPollMaxDurationMs;
    if (previousState === nextStatus?.state && previousState != null) renderStatus();
    else render();
    syncStatusPoll();
    return model.status;
  }

  refresh();
  return {
    refresh,
    reset() {
      model.lifecycle += 1;
      model.refreshRequest += 1;
      model.previewRequest += 1;
      clearStatusPoll(true);
      model.status = null;
      model.settings = { ...DEFAULT_CALENDAR_SYNC_SETTINGS };
      model.queueing = false;
      render();
    },
    dispose() {
      model.lifecycle += 1;
      model.refreshRequest += 1;
      model.previewRequest += 1;
      model.disposed = true;
      clearStatusPoll(true);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      details?.removeEventListener("toggle", onPanelToggle);
      host.replaceChildren();
    },
  };
}
