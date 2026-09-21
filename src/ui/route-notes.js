import { createRouteNoteMap, hasPolygon } from "../lib/route-note-map.js?v=2";
import { ROUTE_NOTE_MARKER_TYPES } from "../lib/route-notes.js";
import { parseScheduleRoutes } from "../lib/route.js";

const MARKER_TYPES = ROUTE_NOTE_MARKER_TYPES;
const MARKER_LABELS = {
  note: "일반 메모",
  parking: "주차", entrance: "출입구", vehicle_entrance: "차량 출입", delivery_spot: "배송 위치",
  warning: "주의", access_code: "공동현관", important: "중요", elevator: "엘리베이터",
  stairs: "계단", restroom: "화장실", dog: "개 주의", cat: "고양이", construction: "공사 중",
  security: "경비실", storage: "보관 장소", walk_in: "도보 진입", unloading: "하차 장소",
  locked: "잠긴 출입구", quiet: "소음 주의", no_entry: "진입 금지",
};
/** Marker types share a small icon set: the label carries the exact meaning. */
const MARKER_ICONS = {
  parking: "car", vehicle_entrance: "car", unloading: "car", walk_in: "pin",
  entrance: "door", access_code: "door", security: "door", elevator: "door", stairs: "door",
  restroom: "door", storage: "box", locked: "door",
  delivery_spot: "box",
  warning: "alert", important: "alert", no_entry: "alert", dog: "alert", cat: "alert",
  construction: "alert", quiet: "alert",
};
const ALERT_MARKERS = new Set(["warning", "important", "no_entry", "construction", "dog", "locked"]);
const TEXT = {
  loading: "회사 구역 메모를 불러오는 중입니다.", empty: "등록된 구역 메모가 없습니다.",
  notReady: "구역 메모를 사용할 준비가 되지 않았습니다.", map: "지도를 준비하는 중입니다.",
};
const SVG_NS = "http://www.w3.org/2000/svg";
const SHEET_PEEK = 144;
const SUGGEST_LIMIT = 6;
const WIDE_LAYOUT = "(min-width:768px) and (orientation:landscape), (min-width:1100px)";

function circlePath(cx, cy, r) {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
}
const ICON_PATHS = {
  search: [circlePath(11, 11, 7), "M20.5 20.5 16.2 16.2"],
  close: ["M6.5 6.5 17.5 17.5", "M17.5 6.5 6.5 17.5"],
  locate: [circlePath(12, 12, 7.4), circlePath(12, 12, 2.4), "M12 1.8v2.6", "M12 19.6v2.6", "M1.8 12h2.6", "M19.6 12h2.6"],
  plus: ["M12 5.2v13.6", "M5.2 12h13.6"],
  star: ["M12 3.6 14.6 9l5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.8 9.4 9z"],
  back: ["M14.5 5.5 8 12l6.5 6.5"],
  next: ["M9.5 5.5 16 12l-6.5 6.5"],
  up: ["M6 14.6 12 9l6 5.6"],
  down: ["M6 9.4 12 15l6-5.6"],
  share: [circlePath(6.6, 12, 2.4), circlePath(17.2, 6.2, 2.4), circlePath(17.2, 17.8, 2.4), "M8.8 10.8 15 7.4", "M8.8 13.2 15 16.6"],
  edit: ["M4.5 19.5h4L18 10l-4-4-9.5 9.5z", "M13.6 6.4l4 4"],
  trash: ["M5 7h14", "M9.5 7V4.8h5V7", "M7.2 7 8.3 20h7.4L16.8 7"],
  photo: ["M4 7.6h3.2L8.7 5.4h6.6l1.5 2.2H20v11H4z", circlePath(12, 13.2, 3)],
  pin: ["M12 21.2s6.4-6.2 6.4-10.4a6.4 6.4 0 1 0-12.8 0C5.6 15 12 21.2 12 21.2z", circlePath(12, 10.8, 2.2)],
  alert: ["M12 3.8 2.9 20h18.2z", "M12 9.8v4.2", "M12 17.1v.1"],
  car: ["M4.6 15.8l1.2-5A2 2 0 0 1 7.8 9.2h8.4a2 2 0 0 1 2 1.6l1.2 5z", "M4.6 15.8h14.8v2.4H4.6z", circlePath(7.6, 18.2, 1.1), circlePath(16.4, 18.2, 1.1)],
  door: ["M7 20V4.8h10V20", "M4.6 20h14.8", circlePath(14.2, 12.6, .9)],
  box: ["M4.4 8.4 12 4.6l7.6 3.8v7.2L12 19.4l-7.6-3.8z", "M4.4 8.4 12 12.2l7.6-3.8", "M12 12.2v7.2"],
  note: ["M6.4 4h8.2l3 3v13H6.4z", "M9.4 10.4h5.2", "M9.4 14h5.2", "M9.4 17.6h3.4"],
};

function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "route-notes-icon");
  (ICON_PATHS[name] || ICON_PATHS.note).forEach((data) => {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", data);
    svg.append(path);
  });
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
  if (options.icon) control.append(icon(options.icon));
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
  if (!root) throw new Error("구역 메모 화면을 표시할 위치가 없습니다.");
  let disposed = false, generation = 0, data = null, selected = null, tab = "all", query = "", loadError = null;
  let map = null, mapRequest = 0, mapMode = null, zoneDraft = null, tipDraft = null, formDirty = false, saving = false;
  let workspace = null, sheetSnap = "half", suggestOpen = false, workspaceAbort = null, workspaceResize = null, mapFocusZoneId = null;
  const abort = new AbortController();
  const isCurrent = (token) => !disposed && token === generation;
  const membershipRole = () => data?.membership?.role || "member";
  const userId = () => getUser()?.id || getUser()?.user_id || getProfile()?.id || getProfile()?.user_id || null;
  const canManageZones = () => ["admin", "editor"].includes(membershipRole());
  const canManageTip = (tip) => Boolean(userId() && tip?.created_by === userId());
  const isWide = () => Boolean(window.matchMedia?.(WIDE_LAYOUT)?.matches);

  function clearMap() { workspaceAbort?.abort(); workspaceAbort = null; workspaceResize?.disconnect(); workspaceResize = null; mapRequest += 1; try { map?.destroy(); } catch { /* Optional map cleanup must not block notes. */ } map = null; mapMode = null; mapFocusZoneId = null; workspace = null; }
  function reset() {
    shareDialog?.reset?.();
    generation += 1; clearMap(); data = null; selected = null; zoneDraft = null; tipDraft = null; formDirty = false; saving = false; loadError = null; tab = "all"; query = ""; sheetSnap = "half"; suggestOpen = false;
    root.replaceChildren();
  }
  function destroy() { disposed = true; abort.abort(); reset(); }
  function showState(kind, message, retry) {
    clearMap(); root.replaceChildren(node("section", { class: `route-notes-state ${kind}` }, [
      node("p", { text: message }), retry ? button("다시 시도", retry, { class: "secondary" }) : null,
    ]));
  }
  async function open({ route } = {}) {
    const token = ++generation; clearMap(); selected = null; zoneDraft = null; tipDraft = null; formDirty = false; loadError = null; suggestOpen = false; sheetSnap = "half";
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
      .map((zone) => ({ kind: "zone", key: `zone-${zone.id}`, badge: "구역", glyph: "pin", title: zone.name || "이름 없는 구역", subtitle: zone.memo || "공유 메모가 없습니다.", zone }));
    const tips = (selected?.tips || []).filter((tip) => `${tip.title || ""} ${tip.memo || ""}`.toLocaleLowerCase().includes(needle)).slice(0, SUGGEST_LIMIT)
      .map((tip) => ({ kind: "tip", key: `tip-${tip.id}`, badge: "메모", glyph: MARKER_ICONS[tip.marker_type] || "note", title: tip.title || "제목 없는 메모", subtitle: `${MARKER_LABELS[tip.marker_type] || "메모"}${tip.memo ? ` · ${tip.memo}` : ""}`, tip }));
    return [...zones, ...tips];
  }
  async function openZone(zoneId, token = generation) {
    if (!service?.loadZone) return;
    if ((tipDraft || zoneDraft) && !abandonDraft()) return;
    if (selected?.id !== zoneId) sheetSnap = "peek";
    suggestOpen = false; query = "";
    workspace?.search.blur();
    selected = { id: zoneId, loading: true }; tipDraft = null; zoneDraft = null; formDirty = false; render();
    if (sheetSnap === "peek") workspace?.sheetToggle.focus({ preventScroll: true });
    try {
      const detail = await service.loadZone(zoneId);
      if (!isCurrent(token) || selected?.id !== zoneId) return;
      selected = { ...detail, id: zoneId, loading: false, tips: Array.isArray(detail?.tips) ? detail.tips : [] }; render();
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
      clearMap(); root.replaceChildren(node("header", { class: "route-notes-header" }, [
        iconButton("back", "뒤로", () => handleBack()),
        node("div", {}, [node("p", { class: "route-notes-kicker", text: data.company.name || "회사 공유" }), node("h2", { text: zoneDraft.id ? "구역 수정" : "새 구역" })]),
      ])); renderZoneEditor(); return;
    }
    ensureWorkspace(); updateWorkspace();
  }

  /* ── Sheet snapping ─────────────────────────────────────────────── */
  function snapHeights() {
    const total = workspace?.shell?.clientHeight || 0;
    const peek = Math.min(SHEET_PEEK, total);
    const full = Math.max(peek, total - (tipDraft ? 8 : 88));
    return { peek, half: Math.max(peek, Math.min(full, Math.round(total * 0.64))), full };
  }
  function applySnap(snap) {
    sheetSnap = snap;
    if (!workspace) return;
    workspace.sheet.dataset.snap = snap;
    workspace.sheetToggle.setAttribute("aria-expanded", String(snap !== "peek"));
    const toggleLabel = snap === "peek" ? (tipDraft ? "작성 계속" : selected ? "메모 보기" : "구역 선택") : tipDraft ? "위치 선택" : "지도 크게";
    workspace.sheetToggle.setAttribute("aria-label", toggleLabel);
    workspace.sheetToggle.title = toggleLabel;
    workspace.sheetToggle.replaceChildren(icon(snap === "peek" ? "up" : "down"), node("span", { text: toggleLabel }));
    workspace.sheetToggle.hidden = !selected;
    workspace.sheetBody.inert = Boolean(selected && snap === "peek");
    workspace.grip.hidden = !selected || Boolean(tipDraft) || snap === "peek";
    workspace.grip.setAttribute("aria-expanded", String(snap !== "peek"));
    workspace.shell.style.setProperty("--route-note-sheet-h", `${snapHeights()[snap]}px`);
  }
  function setSnap(snap, { preserveViewport = true } = {}) {
    applySnap(snap);
    if (snap === "peek") workspace?.sheetToggle.focus({ preventScroll: true });
    if (snap !== "peek" && workspace && !workspace.sheetBody.childNodes.length) updateWorkspace({ preserveViewport });
    else renderOverviewMap({ zones: filteredZones(), zone: currentZone(), selectedZoneId: selected?.id || null, tips: selected?.tips || [], preserveViewport, padding: overviewMapPadding() });
  }
  function expandSheet() { if (sheetSnap === "peek") sheetSnap = "half"; }
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

    const search = node("input", { class: "route-notes-search", type: "search", value: query, placeholder: "구역 검색", "aria-label": "구역 또는 선택한 구역의 메모 검색", autocomplete: "off", enterkeyhint: "search" });
    const clear = iconButton("close", "검색어 지우기", () => {
      if (!prepareWorkspaceChange()) return;
      query = ""; search.value = ""; suggestOpen = false; expandSheet(); search.focus();
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
    const searchBar = node("div", { class: "route-notes-searchbar" }, [icon("search"), search, clear]);
    const suggest = node("div", { class: "route-notes-suggest", role: "group", "aria-label": "검색 결과", hidden: true });
    const filters = node("div", { class: "route-notes-tabs", role: "group", "aria-label": "구역 필터" });
    const topbar = node("section", { class: "route-notes-topbar" }, [searchBar, suggest, filters]);

    const locate = button("내 위치", () => {
      if (!map) { notify("지도를 사용할 수 없습니다. 잠시 후 다시 열어 주세요.", "error"); return; }
      map.locate().catch((error) => notify(errorText(error), "error"));
    }, { class: "route-notes-fab route-notes-locate", icon: "locate" });
    const fabs = node("div", { class: "route-notes-fabs" }, [locate]);

    const grip = node("button", { type: "button", class: "route-notes-sheet-grip", "aria-label": "구역 목록 크기 조절", "aria-expanded": "true" }, [node("span", { class: "route-notes-grip-bar" })]);
    const sheetBack = button("구역 변경", () => tipDraft ? handleBack() : showZoneList(), { class: "route-notes-sheet-back", icon: "back" });
    sheetBack.hidden = true;
    const sheetTitle = node("strong", { class: "route-notes-sheet-title", text: "구역 목록", tabindex: "-1" });
    const sheetSubtitle = node("small", { class: "route-notes-sheet-subtitle", text: "지도에서 구역을 선택하세요." });
    const sheetToggle = button("지도 크게", () => setSnap(sheetSnap === "peek" ? (tipDraft ? "full" : "half") : "peek"), { class: "route-notes-sheet-toggle", icon: "down", expanded: true });
    const sheetBody = node("div", { class: "route-notes-sheet-body", "aria-live": "polite" });
    const sheet = node("section", { class: "route-notes-sheet", "aria-label": "구역 목록과 현장 메모" }, [
      grip,
      node("header", { class: "route-notes-sheet-head" }, [sheetBack, node("div", { class: "route-notes-sheet-heading" }, [sheetTitle, sheetSubtitle]), sheetToggle]),
      sheetBody,
    ]);

    const shell = node("section", { class: "route-notes-workspace" }, [mapHost, topbar, fabs, sheet]);
    root.append(shell);
    workspace = { shell, mapHost, search, searchBar, topbar, clear, suggest, filters, fabs, sheet, sheetBody, sheetToggle, sheetTitle, sheetSubtitle, sheetBack, grip, mapStarted: false };
    mapMode = "overview";
    attachSheetDrag(grip, shell);
    document.addEventListener("pointerdown", (event) => {
      if (!suggestOpen || !workspace?.shell?.isConnected) return;
      if (topbar.contains(event.target) || tipDraft) return;
      suggestOpen = false; updateWorkspace({ preserveViewport: true });
    }, { signal: workspaceAbort.signal });
    const resize = () => {
      if (!workspace?.shell?.isConnected) return;
      const height = Math.min(window.innerHeight, window.visualViewport?.height || window.innerHeight);
      workspace.shell.style.setProperty("--route-note-viewport-h", `${height}px`);
      applySnap(sheetSnap);
      const active = document.activeElement;
      if (tipDraft && workspace.sheetBody.contains(active)) active.scrollIntoView?.({ block: "nearest" });
    };
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
    workspace.mapHost.hidden = !selected;
    workspace.topbar.hidden = Boolean(tipDraft);
    workspace.search.placeholder = selected ? "구역 / 현재 구역 메모 검색" : "구역 검색";
    workspace.search.setAttribute("aria-label", selected ? "구역 또는 현재 구역의 메모 검색" : "구역 검색");
    if (workspace.search.value !== query) workspace.search.value = query;

    workspace.filters.replaceChildren();
    const mineCount = fixedRouteZoneIds(data.zones, getProfile()).size;
    [...(mineCount ? [["mine", "내 구역"]] : []), ["all", "전체"], ["favorites", "즐겨찾기"]].forEach(([id, label]) => {
      workspace.filters.append(button(label, () => {
        if (!prepareWorkspaceChange()) return;
        tab = id; showZoneList();
      }, { class: tab === id ? "active" : "", pressed: tab === id }));
    });
    workspace.filters.hidden = Boolean(selected) && !suggestOpen;
    workspace.fabs.hidden = !selected || Boolean(tipDraft);

    renderSuggestions();
    const zone = currentZone();
    const named = Boolean(selected && zone?.name);
    workspace.sheetBack.hidden = !selected;
    workspace.sheetBack.replaceChildren(icon("back"), node("span", { text: tipDraft ? "메모로" : "구역 변경" }));
    workspace.sheetTitle.textContent = tipDraft ? (tipDraft.id ? "메모 수정" : "메모 작성") : selected ? (zone?.name || "구역 메모") : "구역 선택";
    workspace.sheetTitle.dataset.code = String(named);
    workspace.sheetSubtitle.textContent = tipDraft ? (zone?.name || "구역 메모") : selected
      ? (selected.loading ? "메모를 불러오는 중" : `현장 메모 ${(selected.tips || []).length}개 · 선택한 구역만 표시`)
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
        node("span", { class: "route-notes-suggest-glyph" }, [icon(result.glyph)]),
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
      if (selected?.id === result.zone.id) { query = ""; sheetSnap = "peek"; updateWorkspace({ preserveViewport: true }); return; }
      await openZone(result.zone.id, token);
      return;
    }
    query = ""; expandSheet(); updateWorkspace({ preserveViewport: true });
    focusTip(result.tip);
  }
  function renderListOnly(host) {
    if (canManageZones()) host.append(button("구역 만들기", () => {
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
        node("span", { class: "route-notes-zone-copy" }, [node("strong", { text: zone.name || "이름 없는 구역" }), node("small", { text: zone.memo || "공유 메모가 없습니다." })]),
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
    const favorite = data.favorites.includes(zone.id);
    const detailActions = node("div", { class: "route-notes-detail-actions" }, [
      iconButton("star", favorite ? "즐겨찾기 해제" : "즐겨찾기", () => toggleFavorite(zone.id), { class: "route-notes-star", pressed: favorite }),
    ]);
    if (shareDialog) detailActions.append(button("공유", (event) => shareDialog.open({ zone, trigger: event.currentTarget }), { icon: "share" }));
    if (canManageZones()) detailActions.append(iconButton("edit", "구역 수정", () => { if (!canClose()) return; tipDraft = null; zoneDraft = { ...zone, polygon: zone.polygon || null }; formDirty = false; render(); }));
    const zoneCopy = [node("h3", { class: "sr-only", text: zone.name || "이름 없는 구역" }), node("p", { text: zone.memo || "공유 메모가 없습니다." })];
    if (!hasPolygon(zone.polygon)) zoneCopy.push(node("p", { class: "route-notes-no-polygon", text: "등록된 구역 경계가 없습니다." }));
    host.append(node("section", { class: "route-notes-detail-head" }, [
      node("div", { class: "route-notes-detail-copy" }, zoneCopy),
      detailActions,
    ]));
    const tipsHeader = node("div", { class: "route-notes-section-head" }, [node("h3", { text: "현장 메모" })]);
    if (userId()) tipsHeader.append(button("메모 추가", () => showTipEditor(), { class: "primary", icon: "plus" }));
    host.append(tipsHeader);
    host.append(renderTips(selected.tips));
    const photos = renderZonePhotos(selected.zonePhotos); if (photos) host.append(photos);
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
  function renderTips(tips) {
    const host = node("section", { class: "route-notes-tips" });
    if (!tips.length) host.append(node("p", { class: "route-notes-empty", text: "공유된 현장 메모가 없습니다." }));
    tips.forEach((tip) => {
      const controls = node("div", { class: "route-notes-tip-actions" });
      if (canManageTip(tip)) controls.append(iconButton("edit", "메모 수정", () => showTipEditor(tip)));
      const glyph = node("span", { class: "route-notes-tip-glyph", "data-alert": String(ALERT_MARKERS.has(tip.marker_type)) }, [icon(MARKER_ICONS[tip.marker_type] || "note")]);
      const article = node("article", { class: "route-notes-tip", id: `routeNoteTip-${tip.id}`, tabindex: "-1" }, [
        glyph,
        node("div", { class: "route-notes-tip-copy" }, [
          node("p", { class: "route-notes-tip-type", text: MARKER_LABELS[tip.marker_type] || "메모" }),
          node("h4", { text: tip.title || "제목 없는 메모" }),
          node("p", { class: "route-notes-author", text: `작성자 · ${tip.author_name || "기사"}${tip.created_by === userId() ? " (나)" : ""}` }),
          node("p", { text: tip.memo || "" }),
        ]),
        controls,
      ]);
      const photos = (tip.photos || []).map((photo) => {
        const src = safeImageUrl(photo.url); if (!src) return null;
        const photoNode = node("figure", { class: "route-notes-photo" }, [node("img", { src, alt: `${tip.title || "구역 메모"} 사진`, loading: "lazy" })]);
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
  function showTipEditor(tip = null) { if (!canClose()) return; tipDraft = tip ? { ...tip } : { marker_type: "note", lat: "", lng: "" }; formDirty = false; if (sheetSnap !== "full") sheetSnap = "full"; render(); }
  function renderTipForm(zone, host = root) {
    const draft = tipDraft; const form = node("form", { class: "route-notes-form" });
    form.append(input("제목", "routeNoteTipTitle", draft.title || "", { placeholder: "예: 공동현관 호출 위치" }));
    const type = node("select", { id: "routeNoteTipType", name: "marker_type" }, MARKER_TYPES.map((value) => node("option", { value, text: MARKER_LABELS[value] || value, selected: value === draft.marker_type })));
    form.append(node("label", { class: "route-notes-field", for: "routeNoteTipType" }, [node("span", { text: "메모 유형" }), type]));
    form.append(input("메모", "routeNoteTipMemo", draft.memo || "", { multiline: true, placeholder: "동료에게 남길 현장 팁" }));
    form.append(node("p", { class: "route-notes-coordinate-help", text: "위치는 선택사항입니다. 지도에서 위치를 누르거나 좌표를 입력하세요." }));
    form.append(node("div", { class: "route-notes-coordinate-grid" }, [input("위도", "routeNoteTipLat", draft.lat ?? "", { inputmode: "decimal" }), input("경도", "routeNoteTipLng", draft.lng ?? "", { inputmode: "decimal" })]));
    form.append(node("label", { class: "route-notes-field", for: "routeNoteTipPhoto" }, [node("span", { text: "사진 (선택 · JPEG/PNG/WebP, 한 장당 5MB)" }), node("input", { id: "routeNoteTipPhoto", type: "file", accept: "image/jpeg,image/png,image/webp", multiple: "multiple" })]));
    const existingPhotos = (draft.photos || []).map((photo) => {
      const src = safeImageUrl(photo.url); if (!src) return null;
      return node("figure", { class: "route-notes-photo" }, [node("img", { src, alt: `${draft.title || "구역 메모"} 사진`, loading: "lazy" }), button("사진 삭제", () => deleteTipPhoto(photo, draft), { class: "secondary photo-delete", icon: "trash" })]);
    }).filter(Boolean);
    if (existingPhotos.length) form.append(node("section", { class: "route-notes-existing-photos" }, [node("p", { text: "등록된 사진" }), node("div", { class: "route-notes-photos" }, existingPhotos)]));
    const actions = node("div", { class: "route-notes-form-actions" }, [button("취소", () => { if (!abandonDraft()) return; render(); }, { class: "secondary" })]);
    if (draft.id && canManageTip(draft)) actions.append(button("삭제", () => deleteTip(draft), { class: "danger" }));
    actions.append(button(draft.id ? "메모 저장" : "메모 추가", null, { class: "primary" })); actions.lastChild.type = "submit"; form.append(actions);
    form.addEventListener("input", () => { formDirty = true; });
    form.addEventListener("change", () => { formDirty = true; });
    form.addEventListener("submit", (event) => saveTip(event, zone, draft, form)); host.append(form);
  }
  async function saveTip(event, zone, draft, form) {
    event.preventDefault(); if (saving) return; const token = generation;
    const rawLat = form.elements.routeNoteTipLat.value.trim(), rawLng = form.elements.routeNoteTipLng.value.trim();
    const lat = rawLat ? Number(rawLat) : null, lng = rawLng ? Number(rawLng) : null;
    const title = form.elements.routeNoteTipTitle.value.trim();
    if (!title || Boolean(rawLat) !== Boolean(rawLng) || (rawLat && (!Number.isFinite(lat) || !Number.isFinite(lng)))) { notify("제목을 입력하고, 위치는 두 좌표를 함께 입력하거나 비워 주세요.", "error"); return; }
    let saved = null; saving = true; setFormBusy(form, true);
    try {
      saved = await service.saveTip({ id: draft.id, zone_id: zone.id, title, marker_type: form.elements.routeNoteTipType.value,
        memo: form.elements.routeNoteTipMemo.value.trim(), lat, lng, expectedUpdatedAt: draft.updated_at });
      const photos = [...form.elements.routeNoteTipPhoto.files];
      for (const file of photos) { if (!isCurrent(token)) return; await service.uploadTipPhoto(saved.id, file); }
      if (!isCurrent(token)) return; tipDraft = null; formDirty = false; sheetSnap = "half"; await openZone(zone.id, token); notify("구역 메모를 저장했습니다.");
    } catch (error) {
      if (!isCurrent(token)) return;
      if (saved) { tipDraft = { ...saved, photos: draft.photos || [] }; formDirty = false; render(); notify("메모는 저장되었습니다. 사진을 다시 선택해 추가해 주세요.", "error"); return; }
      notify(error.code === "CONFLICT" ? "다른 수정이 있어 최신 내용을 다시 확인해 주세요." : errorText(error), "error");
    } finally { if (isCurrent(token)) saving = false; if (form.isConnected) setFormBusy(form, false); }
  }
  async function deleteTip(tip) {
    if ((tip.photos || []).length) { notify("사진을 먼저 하나씩 삭제해 주세요.", "error"); return; }
    if (!window.confirm("이 메모를 삭제할까요?")) return; const token = generation;
    try { await service.deleteTip(tip.id, tip.updated_at); if (isCurrent(token)) { tipDraft = null; formDirty = false; await openZone(selected.zone.id, token); notify("메모를 삭제했습니다."); } }
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
    const draft = zoneDraft; const form = node("form", { class: "route-notes-form" });
    form.append(input("구역 이름", "routeNoteZoneName", draft.name || "", { placeholder: "예: 302A" }), input("공유 메모", "routeNoteZoneMemo", draft.memo || "", { multiline: true, placeholder: "구역 전체 안내" }));
    const mapHost = node("div", { class: "route-notes-map", role: "region", "aria-label": "구역 경계 편집 지도" }); const state = node("p", { class: "route-notes-coordinate-help", text: hasPolygon(draft.polygon) ? "현재 경계가 지도에 표시됩니다." : "이름만 먼저 저장할 수 있습니다. 경계는 점을 세 개 이상 찍어 추가하세요." });
    const draw = button("경계 그리기", () => { map?.setDrawing(true); formDirty = true; state.textContent = "지도를 눌러 경계 점을 추가하세요."; }, { class: "secondary" });
    const undo = button("점 하나 지우기", () => { map?.undoPoint(); formDirty = true; }, { class: "secondary" });
    const finish = button("경계 사용", () => { const polygon = map?.finishPolygon(); if (!polygon) { notify("점 세 개 이상이 필요합니다.", "error"); return; } zoneDraft = { ...zoneDraft, polygon }; formDirty = true; state.textContent = "새 경계를 저장할 수 있습니다."; }, { class: "secondary" });
    const locate = button("내 위치", () => { map?.locate().catch((error) => notify(errorText(error), "error")); }, { class: "secondary", icon: "locate" });
    form.append(node("section", { class: "route-notes-map-card" }, [mapHost, node("div", { class: "route-notes-map-actions" }, [locate, draw, undo, finish]), state]));
    const actions = node("div", { class: "route-notes-form-actions" }, [button("취소", () => { if (!abandonDraft()) return; render(); }, { class: "secondary" }), button("구역 저장", null, { class: "primary" })]); actions.lastChild.type = "submit"; form.append(actions);
    form.addEventListener("input", () => { formDirty = true; });
    form.addEventListener("change", () => { formDirty = true; });
    form.addEventListener("submit", (event) => saveZone(event, form, draft)); root.append(form); mountMap(mapHost, draft, [], null);
  }
  async function saveZone(event, form, draft) {
    event.preventDefault(); if (saving) return; const name = form.elements.routeNoteZoneName.value.trim(); if (!name) { notify("구역 이름을 입력해 주세요.", "error"); return; }
    const token = generation;
    saving = true; setFormBusy(form, true);
    try { const saved = await service.saveZone({ id: draft.id, name, memo: form.elements.routeNoteZoneMemo.value.trim(), polygon: zoneDraft.polygon, expectedUpdatedAt: draft.updated_at });
      if (!isCurrent(token)) return; data.zones = draft.id ? data.zones.map((zone) => zone.id === saved.id ? saved : zone) : [...data.zones, saved]; zoneDraft = null; formDirty = false; await openZone(saved.id, token); notify("구역을 저장했습니다.");
    } catch (error) { if (isCurrent(token)) notify(error.code === "CONFLICT" ? "다른 수정이 있어 최신 내용을 다시 확인해 주세요." : errorText(error), "error"); }
    finally { if (isCurrent(token)) saving = false; if (form.isConnected) setFormBusy(form, false); }
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
      map.render({ ...options, preserveViewport, zones: zone ? [zone] : [], zone, selectedZoneId: zone?.id || null, tips });
      if (!zone) mapFocusZoneId = null;
      else if (!preserveViewport && (hasPolygon(zone.polygon) || tips.some((tip) => tip.lat != null && tip.lng != null && Number.isFinite(Number(tip.lat)) && Number.isFinite(Number(tip.lng))))) mapFocusZoneId = zone.id;
    }
    catch (error) { failOverviewMap(error); }
  }
  function failOverviewMap(error) {
    const failed = map; map = null; mapFocusZoneId = null;
    try { failed?.destroy?.(); } catch { /* Map SDK failure is non-blocking. */ }
    if (workspace?.mapHost?.isConnected) workspace.mapHost.replaceChildren(node("section", { class: "route-notes-map-error" }, [
      node("p", { text: `${errorText(error)} 메모는 계속 볼 수 있습니다.` }),
      button("지도 다시 시도", () => { if (workspace) mountOverviewMap(workspace.mapHost); }),
    ]));
  }
  function abandonDraft() {
    if (saving) { notify("저장 중입니다. 잠시만 기다려 주세요."); return false; }
    if (isDirty() && !window.confirm("저장하지 않은 변경이 있습니다. 닫을까요?")) return false;
    tipDraft = null; zoneDraft = null; formDirty = false; return true;
  }
  function prepareWorkspaceChange() { return (tipDraft || zoneDraft) ? abandonDraft() : !saving; }
  function mountOverviewMap(host) {
    host.append(node("p", { class: "route-notes-map-status", text: mapClientId ? TEXT.map : "지도 키가 준비되지 않았습니다. 목록으로 구역과 메모를 확인할 수 있습니다." }));
    mapMode = "overview";
    if (!mapClientId) return;
    const token = generation, request = ++mapRequest;
    host.replaceChildren();
    createRouteNoteMap({
      element: host, clientId: mapClientId,
      onZoneSelect: (zone) => {
        if (zone?.id === selected?.id) { if (!tipDraft) setSnap("half"); }
        else if (zone?.id) void openZone(zone.id);
      },
      onTipSelect: (tip) => {
        if (!tip || !selected?.id || !prepareWorkspaceChange()) return;
        expandSheet(); updateWorkspace({ preserveViewport: true }); focusTip(tip);
      },
      onCoordinatePick: (point) => {
        if (!tipDraft) return;
        const lat = root.querySelector("#routeNoteTipLat"), lng = root.querySelector("#routeNoteTipLng");
        if (!lat || !lng) return;
        lat.value = point.lat.toFixed(6); lng.value = point.lng.toFixed(6); formDirty = true; notify("지도 위치를 메모에 넣었습니다.");
      },
      isActive: () => isCurrent(token) && host.isConnected && request === mapRequest,
    }).then((adapter) => {
      if (!isCurrent(token) || !host.isConnected || request !== mapRequest || mapMode !== "overview") { adapter.destroy(); return; }
      map = adapter;
      renderOverviewMap({ zones: filteredZones(), zone: currentZone(), selectedZoneId: selected?.id || null, tips: selected?.tips || [], padding: overviewMapPadding() });
    }).catch((error) => {
      if (error.name !== "AbortError" && isCurrent(token) && host.isConnected && request === mapRequest) failOverviewMap(error);
    });
  }
  function mountMap(host, zone, tips, onTipSelect) {
    host.append(node("p", { class: "route-notes-map-status", text: mapClientId ? TEXT.map : "지도 키가 준비되지 않았습니다. 목록과 메모는 사용할 수 있습니다." }));
    if (!mapClientId) return;
    const token = generation, request = ++mapRequest; mapMode = "editor";
    host.replaceChildren();
    createRouteNoteMap({ element: host, clientId: mapClientId, onTipSelect, isActive: () => isCurrent(token) && host.isConnected && request === mapRequest, onCoordinatePick: (point) => {
      const lat = root.querySelector("#routeNoteTipLat"), lng = root.querySelector("#routeNoteTipLng"); if (lat && lng) { lat.value = point.lat.toFixed(6); lng.value = point.lng.toFixed(6); formDirty = true; notify("지도 위치를 메모에 넣었습니다."); }
    } }).then((adapter) => { if (!isCurrent(token) || !host.isConnected || request !== mapRequest) { adapter.destroy(); return; } map = adapter; map.render({ zone, tips }); })
      .catch((error) => { if (error.name !== "AbortError" && isCurrent(token) && host.isConnected && request === mapRequest) { host.replaceChildren(node("p", { class: "route-notes-map-error", text: errorText(error) })); } });
  }
  function isDirty() { return Boolean(formDirty && (zoneDraft || tipDraft)); }
  function canClose() { if (saving) { notify("저장 중입니다. 잠시만 기다려 주세요."); return false; } return !isDirty() || window.confirm("저장하지 않은 변경이 있습니다. 닫을까요?"); }
  function showZoneList() {
    if (!prepareWorkspaceChange()) return;
    selected = null; query = ""; suggestOpen = false; sheetSnap = "half"; render();
    workspace?.sheetTitle.focus({ preventScroll: true });
  }
  function handleBack() {
    if (tipDraft || zoneDraft) {
      if (!canClose()) return true;
      tipDraft = null; zoneDraft = null; formDirty = false; sheetSnap = "half"; render(); return true;
    }
    if (suggestOpen) { suggestOpen = false; updateWorkspace({ preserveViewport: true }); return true; }
    if (selected && sheetSnap !== "peek") { setSnap("peek"); return true; }
    if (selected) { showZoneList(); return true; }
    return false;
  }
  return { open, close: reset, reset, destroy, isDirty, canClose, handleBack };
}
