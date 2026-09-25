import { createRouteNoteMap, hasPolygon } from "../lib/route-note-map.js?v=9";
import { MARKER_ICONS, ALERT_MARKERS, createRouteNoteIcon, createRouteNoteMapIcon } from "../lib/route-note-icons.js?v=3";
import { appendAgriculturalMarketTip, isAgriculturalMarketTip, isAgriculturalMarketZone, openAgriculturalMarketRouteMap } from "../lib/agricultural-market-route-map.js?v=2";
import { ROUTE_NOTE_MARKER_TYPES, formatRouteNoteZoneLabel } from "../lib/route-notes.js?v=2";
import { isPointInRouteNoteZone } from "../lib/route-note-rules.js";
import { createRouteNoteZoneEditor } from "./route-note-zone-editor.js?v=7";
import { parseScheduleRoutes } from "../lib/route.js";

const MARKER_TYPES = ROUTE_NOTE_MARKER_TYPES;
const MARKER_LABELS = {
  market_map: "시장 지도",
  note: "일반 팁",
  parking: "주차", entrance: "출입구", vehicle_entrance: "차량 출입", delivery_spot: "배송 위치",
  warning: "주의", access_code: "공동현관", important: "중요", elevator: "엘리베이터",
  stairs: "계단", restroom: "화장실", dog: "개 주의", cat: "고양이", construction: "공사 중",
  security: "경비실", storage: "보관 장소", walk_in: "도보 진입", unloading: "하차 장소",
  locked: "잠긴 출입구", quiet: "소음 주의", no_entry: "진입 금지",
};
const TEXT = {
  loading: "회사 구역 팁을 불러오는 중입니다.", empty: "등록된 구역 팁이 없습니다.",
  notReady: "구역 팁을 사용할 준비가 되지 않았습니다.", map: "지도를 준비하는 중입니다.",
};
const SHEET_PEEK = 0;
const SUGGEST_LIMIT = 6;
const WIDE_LAYOUT = "(min-width:768px) and (orientation:landscape), (min-width:1100px)";

function icon(name) { return createRouteNoteIcon(document, name); }
function tipIcon(type) {
  const svg = createRouteNoteMapIcon(document, type);
  svg.setAttribute("class", "route-notes-icon");
  return svg;
}

function node(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key === "hidden") element.hidden = Boolean(value);
    else if (key === "disabled") element.disabled = Boolean(value);
    else if (key === "selected") element.selected = Boolean(value);
    else if (key === "checked") element.checked = Boolean(value);
    else if (key.startsWith("on")) element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, String(value));
  }
  children.flat().filter(Boolean).forEach((child) => element.append(child));
  return element;
}

function button(text, action, options = {}) {
  const control = node("button", { type: "button", class: `route-notes-button ${options.class || ""}`, disabled: options.disabled, "aria-pressed": options.pressed, "aria-expanded": options.expanded, onClick: action }, []);
  if (options.markerType) control.append(tipIcon(options.markerType));
  else if (options.icon) control.append(icon(options.icon));
  if (text) control.append(node("span", { text }));
  return control;
}

/** Icon-only controls always carry their label for assistive technology and hover. */
function iconButton(name, label, action, options = {}) {
  return node("button", {
    type: "button", class: `route-notes-icon-button ${options.class || ""}`, title: label, "aria-label": label,
    disabled: options.disabled, "aria-pressed": options.pressed, "aria-expanded": options.expanded, onClick: action,
  }, [icon(name)]);
}

function input(label, name, value = "", options = {}) {
  const control = options.multiline ? node("textarea", { id: name, name, rows: options.rows || 3, placeholder: options.placeholder, text: value })
    : node("input", { id: name, name, value, type: options.type || "text", placeholder: options.placeholder, inputmode: options.inputmode });
  return node("label", { class: "route-notes-field", for: name }, [node("span", { text: label }), control]);
}

function safeImageUrl(value) {
  try { const url = new URL(value, window.location.href); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; }
}

function errorText(error) {
  const code = String(error?.code || "");
  if (/[가-힣]/.test(error?.message || "")) return error.message;
  const message = String(error?.message || "").toLowerCase();
  if (["PGRST205", "42P01"].includes(code)) return "구역 노트를 사용할 준비가 되지 않았습니다.";
  if (/permission|forbidden|not allowed|rls/.test(message)) return "이 작업을 할 권한이 없습니다.";
  if (/auth|login|session|sign in/.test(message)) return "로그인 상태를 확인해 주세요.";
  if (/company|membership/.test(message)) return "회사 구역 정보를 확인할 수 없습니다.";
  if (/photo must|jpeg|png|webp|5 mb/.test(message)) return "사진은 JPEG, PNG, WebP 형식의 5MB 이하 파일만 올릴 수 있습니다.";
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

/** Only explicit route codes in a zone name are eligible for a fixed driver's filter. */
export function fixedRouteZoneIds(zones, profile) {
  if (profile?.status !== "approved" || profile?.driver_type !== "fixed") return new Set();
  const fixed = new Set(parseScheduleRoutes(profile.fixed_routes || []));
  if (!fixed.size) return new Set();
  return new Set((zones || []).filter((zone) => parseScheduleRoutes(zone?.name || "").some((code) => fixed.has(code))).map((zone) => zone.id));
}

/** Company context and all persistence are supplied by the trusted caller. */
export function createRouteNotesController({ root, service, shareDialog = null, getUser = () => null, getProfile = () => null, notify = () => {}, mapClientId } = {}) {
  if (!root) throw new Error("구역 팁 화면을 표시할 위치가 없습니다.");
  let disposed = false, generation = 0, data = null, selected = null, tab = "all", query = "", loadError = null;
  let selectedTipId = null, tipDetailsOpen = false;
  let pickedPoint = null, locationMenuOpen = false, zoneEditor = null;
  let fullscreen = false, marketRouteMap = null;
  let map = null, mapRequest = 0, mapMode = null, zoneDraft = null, tipDraft = null, formDirty = false, saving = false;
  let workspace = null, sheetSnap = "half", suggestOpen = false, searchOpen = false, workspaceAbort = null, workspaceResize = null, mapFocusZoneId = null;
  const abort = new AbortController();
  const isCurrent = (token) => !disposed && token === generation;
  const membershipRole = () => data?.membership?.role || "member";
  const userId = () => getUser()?.id || getUser()?.user_id || getProfile()?.id || getProfile()?.user_id || null;
  const canCreateZone = () => Boolean(userId());
  const ownsZone = (zone) => Boolean(userId() && zone?.created_by === userId());
  const canManageZone = (zone) => ownsZone(zone) || ["admin", "editor"].includes(membershipRole());
  const canManageTip = (tip) => Boolean(userId() && tip?.created_by === userId());
  const isWide = () => Boolean(window.matchMedia?.(WIDE_LAYOUT)?.matches);

  function clearMap() { zoneEditor?.destroy(); zoneEditor = null; workspaceAbort?.abort(); workspaceAbort = null; workspaceResize?.disconnect(); workspaceResize = null; marketRouteMap?.close?.(); marketRouteMap = null; mapRequest += 1; try { map?.destroy(); } catch { /* Optional map cleanup must not block notes. */ } map = null; mapMode = null; mapFocusZoneId = null; workspace = null; }
  function showAgriculturalMarketRouteMap() {
    if (marketRouteMap) return;
    marketRouteMap = openAgriculturalMarketRouteMap({ onClose: () => { marketRouteMap = null; } });
  }
  function reset() {
    shareDialog?.reset?.();
    generation += 1; clearMap(); data = null; selected = null; zoneDraft = null; tipDraft = null; formDirty = false; saving = false; loadError = null; tab = "all"; query = ""; sheetSnap = "half"; suggestOpen = false;
    selectedTipId = null; pickedPoint = null; locationMenuOpen = false; searchOpen = false; fullscreen = false; root.setAttribute("data-route-notes-fullscreen", "false"); root.replaceChildren();
  }
  function destroy() { disposed = true; abort.abort(); reset(); }
  function showState(kind, message, retry) {
    clearMap(); root.replaceChildren(node("section", { class: `route-notes-state ${kind}` }, [
      node("p", { text: message }), retry ? button("다시 시도", retry, { class: "secondary" }) : null,
    ]));
  }
  async function open({ route } = {}) {
    const token = ++generation; clearMap(); selected = null; zoneDraft = null; tipDraft = null; formDirty = false; loadError = null; suggestOpen = false; sheetSnap = "half";
    selectedTipId = null; pickedPoint = null; locationMenuOpen = false; searchOpen = false; fullscreen = false; root.setAttribute("data-route-notes-fullscreen", "false");
    if (!service?.load) { showState("not-ready", TEXT.notReady); return; }
    showState("loading", TEXT.loading);
    try {
      const next = await service.load();
      if (!isCurrent(token)) return;
      if (!next?.company?.id || !next?.membership?.company_id) throw new Error(TEXT.notReady);
      data = { ...next, zones: Array.isArray(next.zones) ? next.zones : [], favorites: Array.isArray(next.favorites) ? next.favorites : [] };
      tab = fixedRouteZoneIds(data.zones, getProfile()).size ? "mine" : "all";
      const requested = route && data.zones.find((zone) => zone.id === route || zone.name.toLocaleUpperCase() === route.toLocaleUpperCase());
      if (route && !requested) { query = route; tab = "all"; }
      render();
      if (requested) await openZone(requested.id, token);
    } catch (error) { if (isCurrent(token)) { loadError = error; showState("error", errorText(error), () => open({ route })); } }
  }
  function matches(zone, needle) {
    return `${zone?.name || ""} ${zone?.memo || ""}`.toLocaleLowerCase().includes(needle);
  }
  function filteredZones() {
    const needle = query.trim().toLocaleLowerCase(); const favorites = new Set(data?.favorites || []);
    const mine = fixedRouteZoneIds(data?.zones, getProfile());
    return (data?.zones || []).filter((zone) => (tab !== "favorites" || favorites.has(zone.id)) && (tab !== "mine" || mine.has(zone.id)) &&
      (!needle || matches(zone, needle)));
  }
  /** Search reaches every zone plus the open zone's memos, which are the only tips held in memory. */
  function searchResults() {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    const zones = (data?.zones || []).filter((zone) => matches(zone, needle)).slice(0, SUGGEST_LIMIT)
      .map((zone) => ({ kind: "zone", key: `zone-${zone.id}`, badge: "구역", glyph: "pin", title: zone.name ? formatRouteNoteZoneLabel(zone.name) : "이름 없는 구역", subtitle: zone.memo || "공유 팁이 없습니다.", zone }));
    const tips = (selected?.tips || []).filter((tip) => `${tip.title || ""} ${tip.memo || ""}`.toLocaleLowerCase().includes(needle)).slice(0, SUGGEST_LIMIT)
      .map((tip) => ({ kind: "tip", key: `tip-${tip.id}`, badge: "팁", glyph: MARKER_ICONS[tip.marker_type] || "note", title: tip.title || "제목 없는 팁", subtitle: `${MARKER_LABELS[tip.marker_type] || "팁"}${tip.memo ? ` · ${tip.memo}` : ""}`, tip }));
    return [...zones, ...tips];
  }
  async function openZone(zoneId, token = generation) {
    if (!service?.loadZone) return;
    if ((tipDraft || zoneDraft) && !abandonDraft()) return;
    if (selected?.id !== zoneId) { sheetSnap = "peek"; selectedTipId = null; }
    suggestOpen = false; query = ""; pickedPoint = null; locationMenuOpen = false;
    workspace?.search.blur();
    selected = { id: zoneId, loading: true }; tipDraft = null; zoneDraft = null; formDirty = false; render();
    if (sheetSnap === "peek") (fullscreen ? workspace?.fullscreenButton : workspace?.sheetToggle)?.focus({ preventScroll: true });
    try {
      const loaded = await service.loadZone(zoneId);
      if (!isCurrent(token) || selected?.id !== zoneId) return;
      const detail = appendAgriculturalMarketTip(loaded);
      selected = { ...detail, id: zoneId, loading: false, tips: Array.isArray(detail?.tips) ? detail.tips : [] };
      if (!selected.tips.some((tip) => tip.id === selectedTipId)) selectedTipId = null;
      render();
    } catch (error) { if (isCurrent(token) && selected?.id === zoneId) { selected = { id: zoneId, error }; sheetSnap = "half"; render(); } }
  }
  async function toggleFavorite(zoneId) {
    if (!canClose()) return;
    tipDraft = null; zoneDraft = null; formDirty = false;
    const wanted = !(data?.favorites || []).includes(zoneId); const token = generation;
    try { await service.setFavorite(zoneId, wanted); if (!isCurrent(token)) return; data.favorites = wanted ? [...data.favorites, zoneId] : data.favorites.filter((id) => id !== zoneId); render(); }
    catch (error) { notify(errorText(error), "error"); }
  }
  function render() {
    if (!data) return showState(loadError ? "error" : "not-ready", loadError ? errorText(loadError) : TEXT.notReady, () => open());
    if (zoneDraft) {
      if (zoneEditor) return;
      clearMap(); root.replaceChildren(); renderZoneEditor(); return;
    }
    ensureWorkspace(); updateWorkspace();
  }

  /* ── Sheet snapping ─────────────────────────────────────────────── */
  function snapHeights() {
    const total = workspace?.shell?.clientHeight || 0;
    const peek = Math.min(SHEET_PEEK, total);
    const full = Math.max(peek, total - (tipDraft ? 8 : 88));
    const half = (selectedTipId || locationMenuOpen) && !tipDraft ? Math.min(336, Math.round(total * 0.64)) : Math.round(total * 0.64);
    return { peek, half: Math.max(peek, Math.min(full, half)), full };
  }
  function applySnap(snap) {
    sheetSnap = snap;
    if (!workspace) return;
    workspace.sheet.dataset.snap = snap;
    const mapOnly = Boolean(selected && !tipDraft && !selectedTipId && !locationMenuOpen);
    workspace.sheet.hidden = mapOnly;
    workspace.shell.dataset.mapOnly = String(mapOnly);
    workspace.fullscreenNotes.hidden = true;
    workspace.sheetToggle.setAttribute("aria-expanded", String(snap !== "peek"));
    const toggleLabel = snap === "peek" ? (tipDraft ? "작성 계속" : selected ? "팁 보기" : "구역 선택") : tipDraft ? "위치 수정" : "지도 크게";
    workspace.sheetToggle.setAttribute("aria-label", toggleLabel);
    workspace.sheetToggle.title = toggleLabel;
    workspace.sheetToggle.replaceChildren(icon(snap === "peek" ? "up" : "down"), node("span", { text: toggleLabel }));
    workspace.sheetToggle.hidden = true;
    workspace.sheetBody.inert = Boolean(selected && snap === "peek");
    workspace.grip.hidden = true;
    workspace.grip.setAttribute("aria-expanded", String(snap !== "peek"));
    workspace.shell.style.setProperty("--route-note-sheet-h", `${mapOnly ? 0 : snapHeights()[snap]}px`);
  }
  function setSnap(snap, { preserveViewport = true } = {}) {
    applySnap(snap);
    if (snap === "peek") (fullscreen && !tipDraft ? workspace?.fullscreenButton : workspace?.sheetToggle)?.focus({ preventScroll: true });
    if (snap !== "peek" && workspace && !workspace.sheetBody.childNodes.length) updateWorkspace({ preserveViewport });
    else renderOverviewMap({ zones: filteredZones(), zone: currentZone(), selectedZoneId: selected?.id || null, tips: selected?.tips || [], preserveViewport, padding: overviewMapPadding() });
  }
  function expandSheet() { if (sheetSnap === "peek") sheetSnap = "half"; }
  function setFullscreen(value) {
    fullscreen = Boolean(value);
    root.setAttribute("data-route-notes-fullscreen", String(fullscreen));
    if (zoneEditor) window.requestAnimationFrame?.(() => zoneEditor?.resize());
    if (workspace) {
      workspace.updateViewport?.();
      syncFullscreenControls();
      if (fullscreen && selected && !tipDraft) setSnap("peek");
      else applySnap(sheetSnap);
      (tipDraft ? workspace.sheetTitle : selected ? workspace.fullscreenButton : workspace.pickerFullscreenButton).focus({ preventScroll: true });
      window.requestAnimationFrame?.(() => { if (!disposed) { map?.resize?.(); workspace.updateViewport?.(); applySnap(sheetSnap); } });
    }
  }
  function syncFullscreenControls() {
    const label = fullscreen ? "전체 화면 닫기" : "전체 화면 보기";
    [workspace.fullscreenButton, workspace.pickerFullscreenButton].filter(Boolean).forEach((control) => {
      control.setAttribute("aria-label", label); control.title = label;
      control.setAttribute("aria-pressed", String(fullscreen));
      control.replaceChildren(icon(fullscreen ? "collapse" : "expand"));
    });
    workspace.fullscreenExit.hidden = !fullscreen || !tipDraft;
  }
  function nearestSnap(height) {
    const heights = snapHeights();
    return Object.entries(heights).sort((left, right) => Math.abs(left[1] - height) - Math.abs(right[1] - height))[0][0];
  }
  /** Dragging the grip resizes the sheet the way the original RouteNote sheet behaves on a phone. */
  function attachSheetDrag(handle, shell) {
    let pointer = null, startY = 0, startHeight = 0, moved = 0;
    handle.addEventListener("pointerdown", (event) => {
      if (isWide() || (event.button != null && event.button !== 0)) return;
      pointer = event.pointerId; startY = event.clientY; moved = 0;
      startHeight = workspace?.sheet?.getBoundingClientRect().height || SHEET_PEEK;
      shell.dataset.dragging = "true";
      handle.setPointerCapture?.(pointer);
    }, { signal: workspaceAbort.signal });
    handle.addEventListener("pointermove", (event) => {
      if (pointer !== event.pointerId) return;
      const delta = startY - event.clientY;
      moved = Math.max(moved, Math.abs(delta));
      const heights = snapHeights();
      const next = Math.min(heights.full, Math.max(heights.peek, startHeight + delta));
      shell.style.setProperty("--route-note-sheet-h", `${next}px`);
      if (moved > 6) event.preventDefault();
    }, { signal: workspaceAbort.signal });
    const finish = (event) => {
      if (pointer !== event.pointerId) return;
      pointer = null; delete shell.dataset.dragging;
      if (moved <= 6) { setSnap(sheetSnap === "peek" ? "half" : "peek"); return; }
      setSnap(nearestSnap(workspace?.sheet?.getBoundingClientRect().height || SHEET_PEEK));
    };
    handle.addEventListener("pointerup", finish, { signal: workspaceAbort.signal });
    handle.addEventListener("pointercancel", finish, { signal: workspaceAbort.signal });
    handle.addEventListener("keydown", (event) => {
      const order = ["peek", "half", "full"];
      const at = order.indexOf(sheetSnap);
      if (event.key === "ArrowUp") { event.preventDefault(); setSnap(order[Math.min(order.length - 1, at + 1)]); }
      if (event.key === "ArrowDown") { event.preventDefault(); setSnap(order[Math.max(0, at - 1)]); }
    }, { signal: workspaceAbort.signal });
  }

  /* ── Workspace shell ────────────────────────────────────────────── */
  function currentZone() { return selected?.zone || data?.zones?.find((item) => item.id === selected?.id) || null; }
  function ensureWorkspace() {
    if (workspace?.shell?.isConnected && mapMode === "overview") return;
    clearMap(); root.replaceChildren();
    workspaceAbort = new AbortController();
    const mapHost = node("div", { class: "route-notes-map route-notes-overview-map", role: "region", "aria-label": "선택한 구역 지도" });

    const search = node("input", { class: "route-notes-search", type: "search", value: query, placeholder: "구역 검색", "aria-label": "구역 또는 선택한 구역의 팁 검색", autocomplete: "off", enterkeyhint: "search" });
    const clear = iconButton("close", "검색어 지우기", () => {
      if (!prepareWorkspaceChange()) return;
      query = ""; search.value = ""; suggestOpen = false; if (selected) searchOpen = false; expandSheet();
      updateWorkspace({ preserveViewport: true });
    }, { class: "route-notes-search-clear" });
    search.addEventListener("input", () => {
      if (!prepareWorkspaceChange()) { search.value = query; return; }
      query = search.value; suggestOpen = Boolean(query.trim());
      if (suggestOpen) applySnap("peek"); else expandSheet();
      updateWorkspace({ preserveViewport: true });
    });
    search.addEventListener("focus", () => {
      if (!query.trim() || suggestOpen) return;
      if (!prepareWorkspaceChange()) { search.blur(); return; }
      suggestOpen = true; updateWorkspace({ preserveViewport: true });
    });
    search.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && suggestOpen) {
        const first = searchResults()[0];
        if (first) { event.preventDefault(); void chooseSuggestion(first); }
        return;
      }
      if (event.key !== "Escape" || !suggestOpen) return;
      event.stopPropagation(); suggestOpen = false; updateWorkspace({ preserveViewport: true });
    });
    const fullscreenButton = iconButton("expand", "전체 화면 보기", () => setFullscreen(!fullscreen), { class: "route-notes-fullscreen-toggle", pressed: fullscreen });
    const pickerFullscreenButton = iconButton("expand", "전체 화면으로 열기", () => setFullscreen(!fullscreen), { class: "route-notes-fullscreen-toggle", pressed: fullscreen });
    const searchBar = node("div", { class: "route-notes-searchbar" }, [icon("search"), search, clear, pickerFullscreenButton]);
    const zoneCode = node("strong", { class: "route-notes-zone-code", text: "구역" });
    const zoneName = node("span", { class: "route-notes-zone-name", text: "선택한 구역" });
    const zoneChange = node("button", { type: "button", class: "route-notes-zone-change", "aria-label": "구역 변경", onClick: showZoneList }, [zoneCode, zoneName]);
    const zoneEdit = iconButton("edit", "구역 수정", () => {
      const zone = currentZone();
      if (!zone || !canManageZone(zone) || !canClose()) return;
      tipDraft = null; zoneDraft = { ...zone, polygon: zone.polygon || null }; formDirty = false; render();
    });
    const searchToggle = iconButton("search", "구역 또는 팁 검색", () => { searchOpen = true; updateWorkspace({ preserveViewport: true }); workspace?.search?.focus(); });
    const selectedBar = node("div", { class: "route-notes-selected-bar", hidden: true }, [zoneChange, zoneEdit, searchToggle, fullscreenButton]);
    const suggest = node("div", { class: "route-notes-suggest", role: "group", "aria-label": "검색 결과", hidden: true });
    const filters = node("div", { class: "route-notes-tabs", role: "group", "aria-label": "구역 필터" });
    const topbar = node("section", { class: "route-notes-topbar" }, [selectedBar, searchBar, suggest, filters]);

    const locate = button("내 위치", () => {
      if (!map) { notify("지도를 사용할 수 없습니다. 잠시 후 다시 열어 주세요.", "error"); return; }
      map.locate().catch((error) => notify(errorText(error), "error"));
    }, { class: "route-notes-fab route-notes-locate", icon: "locate" });
    const fullscreenNotes = button("팁 보기", () => setSnap("half"), { class: "route-notes-fab", icon: "note" });
    fullscreenNotes.hidden = true;
    const writeButton = button("팁 쓰기", beginTipPlacement, { class: "route-notes-fab primary route-notes-write", icon: "plus" });
    const shareButton = null;
    const fabs = node("div", { class: "route-notes-fabs" }, [fullscreenNotes, locate, writeButton]);
    const statusLine = node("p", { class: "route-notes-status-line", hidden: true });
    const crosshair = node("div", { class: "route-notes-crosshair", role: "img", "aria-label": "팁 위치 조준점", hidden: true }, [node("span")]);
    const fullscreenExit = iconButton("collapse", "전체 화면 닫기", () => setFullscreen(false), { class: "route-notes-fullscreen-exit" });
    fullscreenExit.hidden = true;

    const grip = node("button", { type: "button", class: "route-notes-sheet-grip", "aria-label": "구역 목록 크기 조절", "aria-expanded": "true" }, [node("span", { class: "route-notes-grip-bar" })]);
    const sheetBack = button("구역 변경", () => tipDraft ? handleBack() : selectedTipId || locationMenuOpen ? showAllTips() : showZoneList(), { class: "route-notes-sheet-back", icon: "back" });
    sheetBack.hidden = true;
    const sheetTitle = node("strong", { class: "route-notes-sheet-title", text: "구역 목록", tabindex: "-1" });
    const sheetSubtitle = node("small", { class: "route-notes-sheet-subtitle", text: "지도에서 구역을 선택하세요." });
    const sheetToggle = button("지도 크게", () => setSnap(sheetSnap === "peek" ? (tipDraft ? "full" : "half") : "peek"), { class: "route-notes-sheet-toggle", icon: "down", expanded: true });
    const sheetBody = node("div", { class: "route-notes-sheet-body", "aria-live": "polite" });
    const sheet = node("section", { class: "route-notes-sheet", "aria-label": "구역 목록과 현장 팁" }, [
      grip,
      node("header", { class: "route-notes-sheet-head" }, [sheetBack, node("div", { class: "route-notes-sheet-heading" }, [sheetTitle, sheetSubtitle]), sheetToggle]),
      sheetBody,
    ]);

    const shell = node("section", { class: "route-notes-workspace" }, [mapHost, topbar, crosshair, fabs, statusLine, sheet, fullscreenExit]);
    root.append(shell);
    workspace = { shell, mapHost, search, searchBar, selectedBar, zoneCode, zoneName, zoneChange, zoneEdit, searchToggle, topbar, clear, suggest, filters, fabs, locate, writeButton, shareButton, statusLine, crosshair, fullscreenButton, pickerFullscreenButton, fullscreenNotes, fullscreenExit, sheet, sheetBody, sheetToggle, sheetTitle, sheetSubtitle, sheetBack, grip, mapStarted: false };
    mapMode = "overview";
    attachSheetDrag(grip, shell);
    document.addEventListener("pointerdown", (event) => {
      if (!suggestOpen || !workspace?.shell?.isConnected) return;
      if (topbar.contains(event.target) || tipDraft) return;
      suggestOpen = false; updateWorkspace({ preserveViewport: true });
    }, { signal: workspaceAbort.signal });
    /** The page header (other tabs' title bar) sits above this view and isn't part of the calc-based map height. */
    const pageHeaderHeight = () => fullscreen ? 0 : (root.parentElement?.querySelector(":scope > .tab-header")?.getBoundingClientRect().height || 0);
    const resize = () => {
      if (!workspace?.shell?.isConnected) return;
      const height = Math.min(window.innerHeight, window.visualViewport?.height || window.innerHeight) - pageHeaderHeight();
      workspace.shell.style.setProperty("--route-note-viewport-h", `${height}px`);
      applySnap(sheetSnap);
      const active = document.activeElement;
      if (tipDraft && workspace.sheetBody.contains(active)) active.scrollIntoView?.({ block: "nearest" });
    };
    workspace.updateViewport = resize;
    window.addEventListener("resize", resize, { signal: workspaceAbort.signal });
    window.visualViewport?.addEventListener("resize", resize, { signal: workspaceAbort.signal });
    if (typeof ResizeObserver !== "undefined") { workspaceResize = new ResizeObserver(() => applySnap(sheetSnap)); workspaceResize.observe(shell); }
    resize();
    applySnap(sheetSnap);
  }
  function updateWorkspace({ preserveViewport = false } = {}) {
    if (!workspace) return;
    applySnap(sheetSnap);
    workspace.searchBar.dataset.filled = String(Boolean(query.trim()));
    workspace.shell.dataset.editing = String(Boolean(tipDraft));
    workspace.shell.dataset.selected = String(Boolean(selected));
    workspace.shell.dataset.placing = String(locationMenuOpen);
    workspace.shell.dataset.detail = String(Boolean(selectedTipId));
    workspace.shell.dataset.tipDetails = String(tipDetailsOpen);
    workspace.mapHost.dataset.hasSelectedTip = String(Boolean(selectedTipId));
    root.setAttribute("data-route-notes-fullscreen", String(fullscreen));
    syncFullscreenControls();
    workspace.mapHost.hidden = !selected;
    workspace.topbar.hidden = Boolean(tipDraft);
    workspace.selectedBar.hidden = !selected;
    workspace.searchBar.hidden = Boolean(selected && !searchOpen);
    workspace.search.placeholder = selected ? "구역 / 현재 구역 팁 검색" : "구역 검색";
    workspace.search.setAttribute("aria-label", selected ? "구역 또는 현재 구역의 팁 검색" : "구역 검색");
    if (workspace.search.value !== query) workspace.search.value = query;

    workspace.filters.replaceChildren();
    const mineCount = fixedRouteZoneIds(data.zones, getProfile()).size;
    [...(mineCount ? [["mine", "내 구역"]] : []), ["all", "전체"], ["favorites", "즐겨찾기"]].forEach(([id, label]) => {
      workspace.filters.append(button(label, () => {
        if (!prepareWorkspaceChange()) return;
        tab = id; showZoneList();
      }, { class: tab === id ? "active" : "", pressed: tab === id }));
    });
    workspace.filters.hidden = Boolean(selected);
    workspace.fabs.hidden = !selected || Boolean(tipDraft);
    workspace.writeButton.hidden = !selected || Boolean(selected.loading || selected.error || locationMenuOpen || tipDraft);
    workspace.locate.hidden = !selected || Boolean(tipDraft);
    workspace.crosshair.hidden = !locationMenuOpen;

    renderSuggestions();
    const zone = currentZone();
    const named = Boolean(selected && zone?.name);
    workspace.zoneEdit.hidden = !zone || !canManageZone(zone);
    workspace.zoneCode.textContent = zone?.name ? formatRouteNoteZoneLabel(zone.name) : "구역";
    workspace.zoneName.textContent = zone?.polygon?.regionName || zone?.memo || "선택한 구역";
    const ownTips = (selected?.tips || []).filter((tip) => tip.created_by === userId()).length;
    const sharedTips = Math.max(0, (selected?.tips || []).length - ownTips);
    workspace.statusLine.textContent = `팁 ${(selected?.tips || []).length}개 · 공용 ${sharedTips} · 내 ${ownTips}`;
    workspace.statusLine.hidden = !selected || Boolean(selected.loading || selected.error || tipDraft || locationMenuOpen || fullscreen);
    workspace.sheetBack.hidden = !selected;
    workspace.sheetBack.replaceChildren(icon("back"), node("span", { text: tipDraft ? "지도로" : selectedTipId || locationMenuOpen ? "닫기" : "구역 변경" }));
    const zoneLabel = zone?.name ? formatRouteNoteZoneLabel(zone.name) : "";
    workspace.sheetTitle.textContent = tipDraft ? (tipDraft.id ? "팁 수정" : "팁 쓰기") : locationMenuOpen ? "팁 위치를 지도에서 찍으세요" : selected ? (zoneLabel || "구역 팁") : "구역 선택";
    workspace.sheetTitle.dataset.code = String(named);
    workspace.sheetSubtitle.textContent = tipDraft ? (zoneLabel || "구역 팁") : selected
      ? (selected.loading ? "팁을 불러오는 중" : locationMenuOpen ? `${zoneLabel} · 지도를 누르거나 움직여 위치를 정하세요` : selectedTipId ? "선택한 현장 팁" : `팁 ${(selected.tips || []).length}개 · 선택한 구역만 표시`)
      : `${filteredZones().length}개 구역 · 목록에서 하나를 선택하세요.`;
    workspace.sheetBody.replaceChildren();
    if (!selected || sheetSnap !== "peek") {
      if (selected) renderDetail(workspace.sheetBody);
      else renderListOnly(workspace.sheetBody);
    }
    if (selected && !workspace.mapStarted) { workspace.mapStarted = true; mountOverviewMap(workspace.mapHost); }
    renderOverviewMap({ zone, tips: selected?.tips || [], preserveViewport, padding: overviewMapPadding() });
  }
  function renderSuggestions() {
    const results = suggestOpen ? searchResults() : [];
    workspace.suggest.replaceChildren();
    workspace.suggest.hidden = !suggestOpen;
    if (!suggestOpen) return;
    if (!results.length) { workspace.suggest.append(node("p", { class: "route-notes-suggest-empty", text: "검색 결과가 없습니다." })); return; }
    results.forEach((result) => {
      const row = node("button", { type: "button", class: "route-notes-suggest-row", onClick: () => chooseSuggestion(result) }, [
        node("span", { class: "route-notes-suggest-glyph" }, [result.kind === "tip" ? tipIcon(result.tip.marker_type) : icon(result.glyph)]),
        node("span", { class: "route-notes-suggest-copy" }, [
          node("span", { class: "route-notes-suggest-title-row" }, [node("em", { class: "route-notes-badge", text: result.badge }), node("strong", { text: result.title })]),
          node("small", { text: result.subtitle }),
        ]),
      ]);
      workspace.suggest.append(row);
    });
  }
  async function chooseSuggestion(result) {
    if (!prepareWorkspaceChange()) return;
    suggestOpen = false;
    workspace?.search.blur();
    const token = generation;
    if (result.kind === "zone") {
      if (selected?.id === result.zone.id) { selectedTipId = null; query = ""; sheetSnap = "peek"; updateWorkspace({ preserveViewport: true }); return; }
      await openZone(result.zone.id, token);
      return;
    }
    selectTip(result.tip);
  }
  function renderListOnly(host) {
    if (canCreateZone()) host.append(button("구역 만들기", () => {
      if (!prepareWorkspaceChange()) return;
      zoneDraft = { name: "", memo: "", polygon: null }; formDirty = false; render();
    }, { class: "route-notes-create-zone", icon: "plus" }));
    const zones = filteredZones();
    if (!zones.length) { host.append(node("p", { class: "route-notes-empty", text: tab === "favorites" ? "즐겨찾는 구역이 없습니다." : tab === "mine" ? "배정된 구역과 일치하는 구역 노트가 없습니다." : TEXT.empty })); return; }
    const list = node("section", { class: "route-notes-list", "aria-label": "검색된 구역" }); host.append(list);
    zones.forEach((zone) => {
      const favorite = data.favorites.includes(zone.id);
      const favoriteButton = iconButton("star", favorite ? "즐겨찾기 해제" : "즐겨찾기", () => toggleFavorite(zone.id), { class: "route-notes-star", pressed: favorite });
      const openButton = node("button", { type: "button", class: "route-notes-zone-main", onClick: () => openZone(zone.id) }, [
        node("span", { class: "route-notes-zone-copy" }, [node("strong", { text: zone.name ? formatRouteNoteZoneLabel(zone.name) : "이름 없는 구역" }), node("small", { text: zone.memo || (isAgriculturalMarketZone(zone) ? "농산물시장 라우트 지도" : "공유 팁이 없습니다.") })]),
        icon("next"),
      ]);
      list.append(node("article", { class: "route-notes-zone-row" }, [openButton, favoriteButton]));
    });
  }
  function renderDetail(host) {
    if (selected.loading) { host.append(node("p", { class: "route-notes-loading", text: TEXT.loading })); return; }
    if (selected.error) { host.append(node("section", { class: "route-notes-state error" }, [node("p", { text: errorText(selected.error) }), button("다시 시도", () => openZone(selected.id), { class: "secondary" }), button("목록", () => handleBack(), { class: "secondary" })])); return; }
    const zone = selected.zone; if (!zone) { host.append(node("p", { class: "route-notes-empty", text: TEXT.empty })); return; }
    if (tipDraft) { renderTipForm(zone, host); return; }
    if (locationMenuOpen) {
      host.append(node("div", { class: "route-notes-location-menu" }, [
        node("p", { class: "route-notes-placement-help", text: pickedPoint ? "선택한 위치에 팁을 작성합니다." : "지도를 누르거나 움직여 위치를 정하세요." }),
        button("여기에 팁 쓰기", confirmTipPlacement, { class: "primary", icon: "plus", disabled: !userId() }),
        button("취소", () => { locationMenuOpen = false; pickedPoint = null; setSnap("peek"); updateWorkspace({ preserveViewport: true }); }, { class: "secondary" }),
      ]));
      return;
    }
    const selectedTip = selected.tips.find((tip) => tip.id === selectedTipId);
    if (selectedTip) { host.append(renderPinPopup(selectedTip)); if (tipDetailsOpen) host.append(renderTips([selectedTip], { embedded: true })); return; }
    const favorite = data.favorites.includes(zone.id);
    const detailActions = node("div", { class: "route-notes-detail-actions" }, [
      iconButton("star", favorite ? "즐겨찾기 해제" : "즐겨찾기", () => toggleFavorite(zone.id), { class: "route-notes-star", pressed: favorite }),
    ]);
    if (canManageZone(zone)) detailActions.append(iconButton("edit", "구역 수정", () => { if (!canClose()) return; tipDraft = null; zoneDraft = { ...zone, polygon: zone.polygon || null }; formDirty = false; render(); }));
    const zoneCopy = [node("h3", { class: "sr-only", text: zone.name ? formatRouteNoteZoneLabel(zone.name) : "이름 없는 구역" }), node("p", { text: zone.memo || "공유 팁이 없습니다." })];
    if (!hasPolygon(zone.polygon)) zoneCopy.push(node("p", { class: "route-notes-no-polygon", text: "등록된 구역 경계가 없습니다." }));
    host.append(node("section", { class: "route-notes-detail-head" }, [
      node("div", { class: "route-notes-detail-copy" }, zoneCopy),
      detailActions,
    ]));
    const tipsHeader = node("div", { class: "route-notes-section-head" }, [node("h3", { text: "구역 공통 팁" })]);
    if (userId()) tipsHeader.append(button("공통 팁 추가", () => showTipEditor(), { class: "primary", icon: "plus" }));
    host.append(tipsHeader);
    host.append(renderTips(selected.tips.filter((tip) => tip.lat == null || tip.lng == null)));
    const photos = renderZonePhotos(selected.zonePhotos); if (photos) host.append(photos);
    host.append(node("div", { class: "route-notes-section-head" }, [node("h3", { text: "위치별 배송 팁" }),
      button("지도에서 등록", beginTipPlacement, { class: "secondary", icon: "pin", disabled: !userId() || !hasPolygon(zone.polygon) })]));
    host.append(renderTips(selected.tips.filter((tip) => tip.lat != null && tip.lng != null)));
  }
  function renderZonePhotos(photos) {
    const visible = (Array.isArray(photos) ? photos : []).map((photo) => {
      const src = safeImageUrl(photo?.url); if (!src) return null;
      return node("a", { class: "route-notes-zone-photo", href: src, target: "_blank", rel: "noopener noreferrer", "aria-label": "구역 참고 사진 원본 열기" }, [
        node("img", { src, alt: "구역 참고 사진", loading: "lazy" }),
      ]);
    }).filter(Boolean);
    if (!visible.length) return null;
    return node("details", { class: "route-notes-zone-photos", "aria-label": "구역 참고 사진" }, [
      node("summary", { text: `구역 참고 사진 ${visible.length}장` }), node("div", { class: "route-notes-zone-photo-grid" }, visible),
    ]);
  }
  function renderPinPopup(tip) {
    const marketMap = isAgriculturalMarketTip(tip);
    const photo = (tip.photos || []).map((item) => safeImageUrl(item?.url)).find(Boolean);
    const meta = marketMap ? "311CD322D 전용 안내" : `${tip.author_name || "기사"} · ${String(tip.created_at || "").slice(5, 10).replace("-", "/") || "최근"}`;
    const scope = marketMap ? "전용 지도" : tip.created_by === userId() ? "내 팁" : "공용 팁";
    const actions = node("div", { class: "route-notes-pin-popup-actions" });
    if (marketMap) actions.append(button("시장 지도 열기", showAgriculturalMarketRouteMap, { class: "primary", icon: "expand" }));
    else {
      if (shareDialog) actions.append(button("공유", (event) => shareDialog.open({ zone: currentZone(), tip, trigger: event.currentTarget }), { class: "secondary", icon: "share" }));
      actions.append(button(tipDetailsOpen ? "간단히" : "자세히", () => { tipDetailsOpen = !tipDetailsOpen; updateWorkspace({ preserveViewport: true }); }, { class: "secondary" }));
    }
    return node("article", { class: "route-notes-pin-popup", id: `routeNoteTip-${tip.id}`, tabindex: "-1" }, [
      node("div", { class: "route-notes-pin-popup-copy" }, [
        node("p", { class: "route-notes-pin-popup-meta" }, [node("span", { text: MARKER_LABELS[tip.marker_type] || "팁" }), node("em", { text: scope })]),
        node("h3", { text: tip.title || "제목 없는 팁" }),
        node("p", { class: "route-notes-pin-popup-body", text: tip.memo || "추가 설명이 없습니다." }),
      ]),
      photo ? node("img", { class: "route-notes-pin-popup-photo", src: photo, alt: `${tip.title || "구역 팁"} 사진`, loading: "lazy" }) : null,
      node("footer", { class: "route-notes-pin-popup-footer" }, [node("small", { text: meta }), actions]),
    ]);
  }
  function renderTips(tips, { embedded = false } = {}) {
    const host = node("section", { class: "route-notes-tips" });
    if (!tips.length) host.append(node("p", { class: "route-notes-empty", text: "공유된 현장 팁이 없습니다." }));
    tips.forEach((tip) => {
      const marketMap = isAgriculturalMarketTip(tip);
      const controls = node("div", { class: "route-notes-tip-actions" });
      if (marketMap) controls.append(button("지도 열기", showAgriculturalMarketRouteMap, { class: "primary", icon: "expand" }));
      else if (canManageTip(tip)) controls.append(iconButton("edit", "팁 수정", () => showTipEditor(tip)));
      const glyph = node("span", { class: "route-notes-tip-glyph", "data-alert": String(ALERT_MARKERS.has(tip.marker_type)) }, [tipIcon(tip.marker_type)]);
      const articleProps = { class: `route-notes-tip${marketMap ? " route-notes-tip-market" : ""}`, tabindex: "-1" };
      if (!embedded) articleProps.id = `routeNoteTip-${tip.id}`;
      const article = node("article", articleProps, [
        glyph,
        node("div", { class: "route-notes-tip-copy" }, [
          node("p", { class: "route-notes-tip-type", text: MARKER_LABELS[tip.marker_type] || "팁" }),
          node("h4", { text: tip.title || "제목 없는 팁" }),
          marketMap ? null : node("p", { class: "route-notes-author", text: `작성자 · ${tip.author_name || "기사"}${tip.created_by === userId() ? " (나)" : ""}` }),
          node("p", { text: tip.memo || "" }),
        ]),
        controls,
      ]);
      const photos = (tip.photos || []).map((photo) => {
        const src = safeImageUrl(photo.url); if (!src) return null;
        const photoNode = node("figure", { class: "route-notes-photo" }, [node("img", { src, alt: `${tip.title || "구역 팁"} 사진`, loading: "lazy" })]);
        if (canManageTip(tip)) photoNode.append(button("사진 삭제", () => deleteTipPhoto(photo, tip), { class: "secondary photo-delete", icon: "trash" }));
        return photoNode;
      }).filter(Boolean);
      if (photos.length) article.append(node("div", { class: "route-notes-photos" }, photos)); host.append(article);
    }); return host;
  }
  function focusTip(tip) {
    const element = root.querySelector(`#routeNoteTip-${CSS.escape(String(tip.id))}`);
    element?.scrollIntoView({ behavior: "auto", block: "center" }); element?.focus({ preventScroll: true });
  }
  function selectTip(tip) {
    if (!selected?.tips?.some((item) => item.id === tip?.id) || !prepareWorkspaceChange()) return;
    selectedTipId = tip.id; tipDetailsOpen = false; pickedPoint = null; locationMenuOpen = false; query = ""; suggestOpen = false; searchOpen = false; workspace?.search.blur();
    expandSheet(); updateWorkspace({ preserveViewport: true }); focusTip(tip);
  }
  function showAllTips() {
    if (!prepareWorkspaceChange()) return;
    selectedTipId = null; tipDetailsOpen = false; pickedPoint = null; locationMenuOpen = false; expandSheet(); updateWorkspace({ preserveViewport: true });
    workspace?.sheetTitle.focus({ preventScroll: true });
  }
  function beginTipPlacement() {
    const zone = currentZone();
    if (!zone || !userId()) return;
    if (!hasPolygon(zone.polygon)) { notify("구역 경계가 있어야 지도에 팁 위치를 지정할 수 있습니다.", "error"); return; }
    selectedTipId = null; tipDetailsOpen = false; pickedPoint = null; locationMenuOpen = true; searchOpen = false; suggestOpen = false; sheetSnap = "half";
    updateWorkspace({ preserveViewport: true });
    notify("지도를 움직이거나 눌러 팁 위치를 정하세요.");
  }
  function confirmTipPlacement() {
    const center = map?.getCenter?.();
    const point = pickedPoint || center;
    if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) { notify("지도에서 팁 위치를 먼저 정해 주세요.", "error"); return; }
    if (!isPointInRouteNoteZone(point, currentZone()?.polygon)) { notify("선택한 구역 경계 안에서 위치를 정해 주세요.", "error"); return; }
    showTipEditor(null, { lat: Number(point.lat), lng: Number(point.lng) });
  }
  function showTipEditor(tip = null, point = null) {
    if (!canClose()) return;
    tipDraft = tip ? { ...tip } : { marker_type: "note", lat: point?.lat ?? null, lng: point?.lng ?? null };
    pickedPoint = tipDraft.lat != null && tipDraft.lng != null ? { lat: Number(tipDraft.lat), lng: Number(tipDraft.lng) } : null;
    locationMenuOpen = false; formDirty = false; sheetSnap = "full"; render();
  }
  function renderTipForm(zone, host = root) {
    const draft = tipDraft; const form = node("form", { class: "route-notes-form" });
    form.append(input("한 줄 설명", "routeNoteTipTitle", draft.title || "", { placeholder: "예: 303동 택배는 지하 1층 엘리베이터" }));
    const type = node("input", { type: "hidden", id: "routeNoteTipType", name: "routeNoteTipType", value: draft.marker_type || "note" });
    const markerPicker = node("details", { class: "route-notes-marker-picker" });
    const markerSummary = node("summary", {}, [tipIcon(type.value), node("span", { text: `${MARKER_LABELS[type.value] || "일반 팁"} · 종류 변경` }), icon("down")]);
    const markerGrid = node("div", { class: "route-notes-marker-grid", role: "group", "aria-label": "팁 마킹 아이콘" });
    MARKER_TYPES.forEach((value) => {
      const choice = button(MARKER_LABELS[value] || value, () => {
        type.value = value; formDirty = true;
        markerGrid.querySelectorAll("button").forEach((control) => control.setAttribute("aria-pressed", String(control.dataset.marker === value)));
        markerSummary.replaceChildren(tipIcon(value), node("span", { text: `${MARKER_LABELS[value]} · 아이콘 변경` }), icon("down"));
        markerPicker.open = false; markerSummary.focus();
      }, { markerType: value, pressed: value === (draft.marker_type || "note") });
      choice.dataset.marker = value; markerGrid.append(choice);
    });
    markerPicker.append(markerSummary, markerGrid);
    form.append(type, node("fieldset", { class: "route-notes-marker-field" }, [node("legend", { text: "종류" }), markerPicker]));
    form.append(node("input", { type: "hidden", id: "routeNoteTipLat", name: "routeNoteTipLat", value: draft.lat ?? "" }), node("input", { type: "hidden", id: "routeNoteTipLng", name: "routeNoteTipLng", value: draft.lng ?? "" }));
    form.append(node("section", { class: "route-notes-tip-location" }, [
      node("p", { id: "routeNoteTipLocation", text: pickedPoint ? "지도에서 선택한 위치의 배송 팁" : "위치 없는 구역 공통 팁" }),
      node("div", { class: "route-notes-map-actions" }, [
        button("위치 수정", () => { setSnap("peek"); notify("지도를 움직이거나 눌러 팁 위치를 다시 정하세요."); }, { icon: "pin", class: "secondary", disabled: !hasPolygon(zone.polygon) }),
        button("위치 없이 공통 팁으로", () => {
          form.elements.routeNoteTipLat.value = ""; form.elements.routeNoteTipLng.value = "";
          pickedPoint = null; formDirty = true; form.querySelector("#routeNoteTipLocation").textContent = "위치 없는 구역 공통 팁";
          renderOverviewMap({ tips: selected?.tips || [], preserveViewport: true });
        }, { class: "secondary" }),
      ]),
    ]));
    const optional = node("details", { class: "route-notes-tip-optional" }, [node("summary", { text: "사진 · 상세 설명    선택" })]);
    optional.append(input("상세 설명", "routeNoteTipMemo", draft.memo || "", { multiline: true, placeholder: "필요할 때만 자세한 내용을 남기세요." }));
    optional.append(node("label", { class: "route-notes-field", for: "routeNoteTipPhoto" }, [node("span", { text: "사진 (선택 · JPEG/PNG/WebP, 한 장당 5MB)" }), node("input", { id: "routeNoteTipPhoto", name: "routeNoteTipPhoto", type: "file", accept: "image/jpeg,image/png,image/webp", multiple: "multiple" })]));
    const existingPhotos = (draft.photos || []).map((photo) => {
      const src = safeImageUrl(photo.url); if (!src) return null;
      return node("figure", { class: "route-notes-photo" }, [node("img", { src, alt: `${draft.title || "구역 팁"} 사진`, loading: "lazy" }), button("사진 삭제", () => deleteTipPhoto(photo, draft), { class: "secondary photo-delete", icon: "trash" })]);
    }).filter(Boolean);
    if (existingPhotos.length) optional.append(node("section", { class: "route-notes-existing-photos" }, [node("p", { text: "등록된 사진" }), node("div", { class: "route-notes-photos" }, existingPhotos)]));
    if (draft.id && canManageTip(draft)) optional.append(button("팁 삭제", () => deleteTip(draft), { class: "danger" }));
    form.append(optional);
    form.append(node("label", { class: "route-notes-share-toggle" }, [
      node("span", {}, [node("strong", { text: "사업장 전체에 공유" }), node("small", { text: "현재 구역 팁은 사업장 공유로 저장됩니다." })]),
      node("input", { type: "checkbox", role: "switch", checked: true, disabled: true, "aria-label": "사업장 전체에 공유" }),
    ]));
    const actions = node("div", { class: "route-notes-form-actions" }, [button("취소", () => { if (!abandonDraft()) return; render(); }, { class: "secondary" })]);
    actions.append(button("팁 저장", null, { class: "primary" })); actions.lastChild.type = "submit"; form.append(actions);
    form.addEventListener("input", () => { formDirty = true; });
    form.addEventListener("change", () => { formDirty = true; });
    form.addEventListener("submit", (event) => saveTip(event, zone, draft, form)); host.append(form);
  }
  async function saveTip(event, zone, draft, form) {
    event.preventDefault(); if (saving) return; const token = generation;
    const rawLat = form.elements.routeNoteTipLat.value.trim(), rawLng = form.elements.routeNoteTipLng.value.trim();
    const lat = rawLat ? Number(rawLat) : null, lng = rawLng ? Number(rawLng) : null;
    const title = form.elements.routeNoteTipTitle.value.trim();
    if (!title) { notify("한 줄 설명을 입력해 주세요.", "error"); form.elements.routeNoteTipTitle.focus(); return; }
    const sameLocation = Boolean(draft.id) && Number(draft.lat) === lat && Number(draft.lng) === lng && draft.lat != null && draft.lng != null;
    if (Boolean(rawLat) !== Boolean(rawLng) || (rawLat && (!Number.isFinite(lat) || !Number.isFinite(lng) || (!sameLocation && !isPointInRouteNoteZone({ lat, lng }, zone.polygon))))) {
      notify("구역 경계 안에서 위치를 선택해 주세요.", "error"); return;
    }
    let saved = null; saving = true; setFormBusy(form, true);
    try {
      saved = await service.saveTip({ id: draft.id, zone_id: zone.id, title, marker_type: form.elements.routeNoteTipType.value,
        memo: form.elements.routeNoteTipMemo.value.trim(), lat, lng, expectedUpdatedAt: draft.updated_at });
      const photos = [...form.elements.routeNoteTipPhoto.files];
      for (const file of photos) { if (!isCurrent(token)) return; await service.uploadTipPhoto(saved.id, file); }
      if (!isCurrent(token)) return; tipDraft = null; formDirty = false; sheetSnap = "half"; await openZone(zone.id, token); notify("구역 팁을 저장했습니다.");
    } catch (error) {
      if (!isCurrent(token)) return;
      if (saved) { tipDraft = { ...saved, photos: draft.photos || [] }; formDirty = false; render(); notify("팁은 저장되었습니다. 사진을 다시 선택해 추가해 주세요.", "error"); return; }
      notify(error.code === "CONFLICT" ? "다른 수정이 있어 최신 내용을 다시 확인해 주세요." : errorText(error), "error");
    } finally { if (isCurrent(token)) saving = false; if (form.isConnected) setFormBusy(form, false); }
  }
  async function deleteTip(tip) {
    if ((tip.photos || []).length) { notify("사진을 먼저 하나씩 삭제해 주세요.", "error"); return; }
    if (!window.confirm("이 팁을 삭제할까요?")) return; const token = generation;
    try { await service.deleteTip(tip.id, tip.updated_at); if (isCurrent(token)) { tipDraft = null; formDirty = false; await openZone(selected.zone.id, token); notify("팁을 삭제했습니다."); } }
    catch (error) { if (isCurrent(token)) notify(errorText(error), "error"); }
  }
  async function deleteTipPhoto(photo, tip) {
    if (isDirty() && !canClose()) return;
    if (!window.confirm("이 사진을 삭제할까요?")) return;
    const token = generation;
    try {
      await service.deleteTipPhoto(photo.id);
      if (!isCurrent(token)) return;
      tipDraft = null; formDirty = false; await openZone(tip.zone_id || selected?.zone?.id, token); notify("사진을 삭제했습니다.");
    } catch (error) { if (isCurrent(token)) notify(errorText(error), "error"); }
  }
  function renderZoneEditor() {
    const host = node("div", { class: "route-notes-zone-editor-host" }); root.append(host);
    const token = generation;
    zoneEditor = createRouteNoteZoneEditor({
      host, zone: zoneDraft.id ? zoneDraft : null, zones: data.zones, service, mapClientId, notify,
      canDelete: ownsZone(zoneDraft),
      onCancel: () => { if (!isCurrent(token)) return; zoneDraft = null; formDirty = false; render(); },
      onSaved: (saved) => {
        if (!isCurrent(token)) return;
        data.zones = data.zones.some((zone) => zone.id === saved.id) ? data.zones.map((zone) => zone.id === saved.id ? saved : zone) : [...data.zones, saved];
        zoneDraft = null; formDirty = false; void openZone(saved.id, token);
      },
      onDeleted: (id) => {
        if (!isCurrent(token)) return;
        data.zones = data.zones.filter((zone) => zone.id !== id); data.favorites = data.favorites.filter((item) => item !== id);
        zoneDraft = null; formDirty = false; selected = null; sheetSnap = "half"; render();
      },
    });
  }
  function setFormBusy(form, busy) { form.querySelectorAll("button, input, textarea, select").forEach((control) => { control.disabled = busy; }); }
  function overviewMapPadding() {
    if (!workspace) return { top: 36, right: 36, bottom: 36, left: 36 };
    const controls = workspace.shell.querySelector(".route-notes-topbar")?.offsetHeight || 0;
    return isWide()
      ? { top: controls + 16, right: (workspace.sheet.offsetWidth || 0) + 32, bottom: 24, left: 24 }
      : { top: controls + 16, right: 20, bottom: Math.min(workspace.sheet.offsetHeight || 0, SHEET_PEEK) + 12, left: 20 };
  }
  function renderOverviewMap(options) {
    if (!map) return;
    const zone = currentZone();
    const tips = zone ? (options.tips || []) : [];
    const preserveViewport = Boolean(options.preserveViewport || (zone?.id && mapFocusZoneId === zone.id));
    try {
      map.render({ ...options, preserveViewport, zones: zone ? [zone] : [], zone, selectedZoneId: zone?.id || null, selectedTipId, pickedPoint, tips });
      if (!zone) mapFocusZoneId = null;
      else if (!preserveViewport && (hasPolygon(zone.polygon) || tips.some((tip) => tip.lat != null && tip.lng != null && Number.isFinite(Number(tip.lat)) && Number.isFinite(Number(tip.lng))))) mapFocusZoneId = zone.id;
    }
    catch (error) { failOverviewMap(error); }
  }
  function failOverviewMap(error) {
    const failed = map; map = null; mapFocusZoneId = null;
    try { failed?.destroy?.(); } catch { /* Map SDK failure is non-blocking. */ }
    if (workspace?.mapHost?.isConnected) workspace.mapHost.replaceChildren(node("section", { class: "route-notes-map-error" }, [
      node("p", { text: `${errorText(error)} 팁은 계속 볼 수 있습니다.` }),
      button("지도 다시 시도", () => { if (workspace) mountOverviewMap(workspace.mapHost); }),
    ]));
  }
  function abandonDraft() {
    if (!canClose()) return false;
    tipDraft = null; zoneDraft = null; pickedPoint = null; locationMenuOpen = false; formDirty = false; return true;
  }
  function prepareWorkspaceChange() { return (tipDraft || zoneDraft) ? abandonDraft() : !saving; }
  function mountOverviewMap(host) {
    host.append(node("p", { class: "route-notes-map-status", text: mapClientId ? TEXT.map : "지도 키가 준비되지 않았습니다. 목록으로 구역과 팁을 확인할 수 있습니다." }));
    mapMode = "overview";
    if (!mapClientId) return;
    const token = generation, request = ++mapRequest;
    host.replaceChildren();
    createRouteNoteMap({
      element: host, clientId: mapClientId,
      onZoneSelect: (zone, point) => {
        if (zone?.id === selected?.id) { if (point) pickTipLocation(point); else if (!tipDraft) showAllTips(); }
        else if (zone?.id) void openZone(zone.id);
      },
      onTipSelect: selectTip,
      onCoordinatePick: pickTipLocation,
      isActive: () => isCurrent(token) && host.isConnected && request === mapRequest,
    }).then((adapter) => {
      if (!isCurrent(token) || !host.isConnected || request !== mapRequest || mapMode !== "overview") { adapter.destroy(); return; }
      map = adapter;
      renderOverviewMap({ zones: filteredZones(), zone: currentZone(), selectedZoneId: selected?.id || null, tips: selected?.tips || [], padding: overviewMapPadding() });
    }).catch((error) => {
      if (error.name !== "AbortError" && isCurrent(token) && host.isConnected && request === mapRequest) failOverviewMap(error);
    });
  }
  function pickTipLocation(point) {
    if (saving || !selected?.zone || selected.loading || !userId()) return;
    if (selectedTipId && !locationMenuOpen && !tipDraft) { showAllTips(); return; }
    if (!isPointInRouteNoteZone(point, selected.zone.polygon)) {
      notify("선택한 구역 경계 안에서 위치를 눌러 주세요.", "error"); return;
    }
    pickedPoint = { lat: point.lat, lng: point.lng };
    if (locationMenuOpen && !tipDraft) { updateWorkspace({ preserveViewport: true }); return; }
    if (tipDraft) {
      const lat = root.querySelector("#routeNoteTipLat"), lng = root.querySelector("#routeNoteTipLng");
      if (!lat || !lng) return;
      lat.value = String(point.lat); lng.value = String(point.lng); formDirty = true;
      const status = root.querySelector("#routeNoteTipLocation");
      if (status) status.textContent = "지도에서 선택한 위치의 배송 팁";
      setSnap("full"); notify("팁 위치를 선택했습니다.");
      return;
    }
    selectedTipId = null; locationMenuOpen = true; suggestOpen = false; sheetSnap = "half";
    updateWorkspace({ preserveViewport: true }); workspace?.sheetTitle.focus({ preventScroll: true });
  }
  function isDirty() { return Boolean(zoneEditor?.isDirty() || (formDirty && tipDraft)); }
  function canClose() { if (zoneEditor) return zoneEditor.canClose(); if (saving) { notify("저장 중입니다. 잠시만 기다려 주세요."); return false; } return !isDirty() || window.confirm("저장하지 않은 변경이 있습니다. 닫을까요?"); }
  function showZoneList() {
    if (!prepareWorkspaceChange()) return;
    selected = null; selectedTipId = null; pickedPoint = null; locationMenuOpen = false; query = ""; suggestOpen = false; sheetSnap = "half"; render();
    workspace?.sheetTitle.focus({ preventScroll: true });
  }
  function handleBack() {
    if (fullscreen) { setFullscreen(false); return true; }
    if (zoneEditor?.handleBack()) return true;
    if (tipDraft || zoneDraft) {
      if (!canClose()) return true;
      tipDraft = null; zoneDraft = null; pickedPoint = null; locationMenuOpen = false; formDirty = false; sheetSnap = "half"; render(); return true;
    }
    if (suggestOpen) { suggestOpen = false; updateWorkspace({ preserveViewport: true }); return true; }
    if (selectedTipId || locationMenuOpen) { showAllTips(); return true; }
    if (selected && sheetSnap !== "peek") { setSnap("peek"); return true; }
    if (selected) { showZoneList(); return true; }
    return false;
  }
  return { open, close: reset, reset, destroy, isDirty, canClose, handleBack };
}
