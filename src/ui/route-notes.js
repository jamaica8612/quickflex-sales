import { createRouteNoteMap, hasPolygon } from "../lib/route-note-map.js";
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
const TEXT = {
  loading: "회사 구역 메모를 불러오는 중입니다.", empty: "등록된 구역 메모가 없습니다.",
  notReady: "구역 메모를 사용할 준비가 되지 않았습니다.", map: "지도를 준비하는 중입니다.",
};

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
  return node("button", { type: "button", class: `route-notes-button ${options.class || ""}`, text, disabled: options.disabled, "aria-pressed": options.pressed, onClick: action }, []);
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
  let map = null, mapRequest = 0, zoneDraft = null, tipDraft = null, formDirty = false, saving = false;
  const abort = new AbortController();
  const isCurrent = (token) => !disposed && token === generation;
  const membershipRole = () => data?.membership?.role || "member";
  const userId = () => getUser()?.id || getUser()?.user_id || getProfile()?.id || getProfile()?.user_id || null;
  const canManageZones = () => ["admin", "editor"].includes(membershipRole());
  const canManageTip = (tip) => Boolean(userId() && tip?.created_by === userId());

  function clearMap() { mapRequest += 1; map?.destroy(); map = null; }
  function reset() {
    shareDialog?.reset?.();
    generation += 1; clearMap(); data = null; selected = null; zoneDraft = null; tipDraft = null; formDirty = false; saving = false; loadError = null; tab = "all"; query = "";
    root.replaceChildren();
  }
  function destroy() { disposed = true; abort.abort(); reset(); }
  function showState(kind, message, retry) {
    clearMap(); root.replaceChildren(node("section", { class: `route-notes-state ${kind}` }, [
      node("p", { text: message }), retry ? button("다시 시도", retry, { class: "secondary" }) : null,
    ]));
  }
  async function open({ route } = {}) {
    const token = ++generation; clearMap(); selected = null; zoneDraft = null; tipDraft = null; formDirty = false; loadError = null;
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
  function filteredZones() {
    const needle = query.trim().toLocaleLowerCase(); const favorites = new Set(data?.favorites || []);
    const mine = fixedRouteZoneIds(data?.zones, getProfile());
    return (data?.zones || []).filter((zone) => (tab !== "favorites" || favorites.has(zone.id)) && (tab !== "mine" || mine.has(zone.id)) &&
      (!needle || `${zone.name || ""} ${zone.memo || ""}`.toLocaleLowerCase().includes(needle)));
  }
  async function openZone(zoneId, token = generation) {
    if (!service?.loadZone) return;
    selected = { id: zoneId, loading: true }; tipDraft = null; zoneDraft = null; formDirty = false; render();
    try {
      const detail = await service.loadZone(zoneId);
      if (!isCurrent(token) || selected?.id !== zoneId) return;
      selected = { ...detail, loading: false, tips: Array.isArray(detail?.tips) ? detail.tips : [] }; render();
    } catch (error) { if (isCurrent(token) && selected?.id === zoneId) { selected = { id: zoneId, error }; render(); } }
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
    clearMap(); root.replaceChildren();
    const company = node("header", { class: "route-notes-header" }, [
      node("div", {}, [node("p", { class: "route-notes-kicker", text: data.company.name || "회사 공유" }), node("h2", { text: "구역노트" })]),
      selected ? button("목록", () => handleBack(), { class: "secondary" }) : null,
    ]);
    root.append(company);
    if (zoneDraft) { renderZoneEditor(); return; }
    if (selected) { renderDetail(); return; }
    renderList();
  }
  function renderList() {
    const search = node("input", { class: "route-notes-search", type: "search", value: query, placeholder: "구역 또는 메모 검색", "aria-label": "구역 또는 메모 검색" });
    search.addEventListener("input", () => { query = search.value; renderListOnly(); });
    const tabs = node("div", { class: "route-notes-tabs", role: "group", "aria-label": "구역 필터" });
    const mineCount = fixedRouteZoneIds(data.zones, getProfile()).size;
    [...(mineCount ? [["mine", "내 구역"]] : []), ["all", "전체"], ["favorites", "즐겨찾기"]].forEach(([id, label]) => {
      const item = button(label, () => { tab = id; render(); }, { class: tab === id ? "active" : "", pressed: tab === id }); tabs.append(item);
    });
    const actions = node("div", { class: "route-notes-list-actions" });
    if (canManageZones()) actions.append(button("구역 만들기", () => { zoneDraft = { name: "", memo: "", polygon: null }; formDirty = false; render(); }, { class: "primary" }));
    root.append(node("section", { class: "route-notes-toolbar" }, [search, tabs, actions]));
    root.append(node("section", { class: "route-notes-list", "aria-live": "polite" })); renderListOnly();
  }
  function renderListOnly() {
    const host = root.querySelector(".route-notes-list"); if (!host) return; host.replaceChildren();
    const zones = filteredZones();
    if (!zones.length) { host.append(node("p", { class: "route-notes-empty", text: tab === "favorites" ? "즐겨찾는 구역이 없습니다." : tab === "mine" ? "배정된 구역과 일치하는 구역 노트가 없습니다." : TEXT.empty })); return; }
    zones.forEach((zone) => {
      const favorite = data.favorites.includes(zone.id);
      const favoriteButton = button(favorite ? "즐겨찾기 해제" : "즐겨찾기", () => toggleFavorite(zone.id), { class: "icon secondary", pressed: favorite });
      const openButton = button("상세 보기", () => openZone(zone.id), { class: "route-notes-zone-main" });
      openButton.append(node("strong", { text: zone.name || "이름 없는 구역" }), node("small", { text: zone.memo || "공유 메모가 없습니다." }));
      host.append(node("article", { class: "route-notes-zone-row" }, [openButton, favoriteButton]));
    });
  }
  function renderDetail() {
    if (selected.loading) { root.append(node("p", { class: "route-notes-loading", text: TEXT.loading })); return; }
    if (selected.error) { root.append(node("section", { class: "route-notes-state error" }, [node("p", { text: errorText(selected.error) }), button("다시 시도", () => openZone(selected.id), { class: "secondary" })])); return; }
    const zone = selected.zone; if (!zone) { root.append(node("p", { class: "route-notes-empty", text: TEXT.empty })); return; }
    const favorite = data.favorites.includes(zone.id);
    const detailActions = node("div", { class: "route-notes-detail-actions" }, [button(favorite ? "즐겨찾기 해제" : "즐겨찾기", () => toggleFavorite(zone.id), { class: "secondary", pressed: favorite })]);
    if (shareDialog) detailActions.append(button("공유", (event) => shareDialog.open({ zone, trigger: event.currentTarget }), { class: "secondary" }));
    if (canManageZones()) detailActions.append(button("구역 수정", () => { if (!canClose()) return; tipDraft = null; zoneDraft = { ...zone, polygon: zone.polygon || null }; formDirty = false; render(); }, { class: "secondary" }));
    root.append(node("section", { class: "route-notes-detail-head" }, [node("div", {}, [node("h3", { text: zone.name || "이름 없는 구역" }), node("p", { text: zone.memo || "공유 메모가 없습니다." })]), detailActions]));
    renderZonePhotos(selected.zonePhotos);
    const mapHost = node("div", { class: "route-notes-map", role: "region", "aria-label": `${zone.name || "구역"} 지도` });
    const mapActions = node("div", { class: "route-notes-map-actions" }, [button("내 위치", () => {
      if (!map) { notify("지도를 준비하는 중입니다.", "error"); return; }
      map.locate().catch((error) => notify(errorText(error), "error"));
    }, { class: "secondary" })]);
    root.append(node("section", { class: "route-notes-map-card" }, [mapHost, mapActions]));
    mountMap(mapHost, zone, selected.tips, (tip) => canManageTip(tip) ? showTipEditor(tip) : focusTip(tip));
    const tipsHeader = node("div", { class: "route-notes-section-head" }, [node("h3", { text: "현장 메모" })]);
    if (userId()) tipsHeader.append(button("메모 추가", () => showTipEditor(), { class: "primary" }));
    root.append(tipsHeader);
    if (tipDraft) renderTipForm(zone); else renderTips(selected.tips);
  }
  function renderZonePhotos(photos) {
    const visible = (Array.isArray(photos) ? photos : []).map((photo) => {
      const src = safeImageUrl(photo?.url); if (!src) return null;
      return node("a", { class: "route-notes-zone-photo", href: src, target: "_blank", rel: "noopener noreferrer", "aria-label": "구역 참고 사진 원본 열기" }, [
        node("img", { src, alt: "구역 참고 사진", loading: "lazy" }),
      ]);
    }).filter(Boolean);
    if (!visible.length) return;
    root.append(node("section", { class: "route-notes-zone-photos", "aria-label": "구역 참고 사진" }, [
      node("h3", { text: "구역 참고 사진" }), node("div", { class: "route-notes-zone-photo-grid" }, visible),
    ]));
  }
  function renderTips(tips) {
    const host = node("section", { class: "route-notes-tips" });
    if (!tips.length) host.append(node("p", { class: "route-notes-empty", text: "공유된 현장 메모가 없습니다." }));
    tips.forEach((tip) => {
      const controls = node("div", { class: "route-notes-tip-actions" });
      if (canManageTip(tip)) controls.append(button("수정", () => showTipEditor(tip), { class: "secondary" }));
      const article = node("article", { class: "route-notes-tip", id: `routeNoteTip-${tip.id}`, tabindex: "-1" }, [
        node("div", {}, [node("p", { class: "route-notes-tip-type", text: MARKER_LABELS[tip.marker_type] || "메모" }), node("h4", { text: tip.title || "제목 없는 메모" }), node("p", { class: "route-notes-author", text: `작성자 · ${tip.author_name || "기사"}${tip.created_by === userId() ? " (나)" : ""}` }), node("p", { text: tip.memo || "" })]), controls,
      ]);
      const photos = (tip.photos || []).map((photo) => {
        const src = safeImageUrl(photo.url); if (!src) return null;
        const photoNode = node("figure", { class: "route-notes-photo" }, [node("img", { src, alt: `${tip.title || "구역 메모"} 사진`, loading: "lazy" })]);
        if (canManageTip(tip)) photoNode.append(button("사진 삭제", () => deleteTipPhoto(photo, tip), { class: "secondary photo-delete" }));
        return photoNode;
      }).filter(Boolean);
      if (photos.length) article.append(node("div", { class: "route-notes-photos" }, photos)); host.append(article);
    }); root.append(host);
  }
  function focusTip(tip) {
    const element = root.querySelector(`#routeNoteTip-${CSS.escape(String(tip.id))}`);
    element?.scrollIntoView({ behavior: "auto", block: "center" }); element?.focus({ preventScroll: true });
  }
  function showTipEditor(tip = null) { if (!canClose()) return; tipDraft = tip ? { ...tip } : { marker_type: "note", lat: "", lng: "" }; formDirty = false; render(); }
  function renderTipForm(zone) {
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
      return node("figure", { class: "route-notes-photo" }, [node("img", { src, alt: `${draft.title || "구역 메모"} 사진`, loading: "lazy" }), button("사진 삭제", () => deleteTipPhoto(photo, draft), { class: "secondary photo-delete" })]);
    }).filter(Boolean);
    if (existingPhotos.length) form.append(node("section", { class: "route-notes-existing-photos" }, [node("p", { text: "등록된 사진" }), node("div", { class: "route-notes-photos" }, existingPhotos)]));
    const actions = node("div", { class: "route-notes-form-actions" }, [button("취소", () => { tipDraft = null; formDirty = false; render(); }, { class: "secondary" })]);
    if (draft.id && canManageTip(draft)) actions.append(button("삭제", () => deleteTip(draft), { class: "danger" }));
    actions.append(button(draft.id ? "메모 저장" : "메모 추가", null, { class: "primary" })); actions.lastChild.type = "submit"; form.append(actions);
    form.addEventListener("input", () => { formDirty = true; });
    form.addEventListener("change", () => { formDirty = true; });
    form.addEventListener("submit", (event) => saveTip(event, zone, draft, form)); root.append(form);
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
      if (!isCurrent(token)) return; formDirty = false; await openZone(zone.id, token); notify("구역 메모를 저장했습니다.");
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
    form.append(node("p", { class: "route-notes-kicker", text: draft.id ? "구역 수정" : "새 구역" }), input("구역 이름", "routeNoteZoneName", draft.name || "", { placeholder: "예: 302A" }), input("공유 메모", "routeNoteZoneMemo", draft.memo || "", { multiline: true, placeholder: "구역 전체 안내" }));
    const mapHost = node("div", { class: "route-notes-map", role: "region", "aria-label": "구역 경계 편집 지도" }); const state = node("p", { class: "route-notes-coordinate-help", text: hasPolygon(draft.polygon) ? "현재 경계가 지도에 표시됩니다." : "이름만 먼저 저장할 수 있습니다. 경계는 점을 세 개 이상 찍어 추가하세요." });
    const draw = button("경계 그리기", () => { map?.setDrawing(true); formDirty = true; state.textContent = "지도를 눌러 경계 점을 추가하세요."; }, { class: "secondary" });
    const undo = button("점 하나 지우기", () => { map?.undoPoint(); formDirty = true; }, { class: "secondary" });
    const finish = button("경계 사용", () => { const polygon = map?.finishPolygon(); if (!polygon) { notify("점 세 개 이상이 필요합니다.", "error"); return; } zoneDraft = { ...zoneDraft, polygon }; formDirty = true; state.textContent = "새 경계를 저장할 수 있습니다."; }, { class: "secondary" });
    const locate = button("내 위치", () => { map?.locate().catch((error) => notify(errorText(error), "error")); }, { class: "secondary" });
    form.append(node("section", { class: "route-notes-map-card" }, [mapHost, node("div", { class: "route-notes-map-actions" }, [locate, draw, undo, finish]), state]));
    const actions = node("div", { class: "route-notes-form-actions" }, [button("취소", () => { zoneDraft = null; render(); }, { class: "secondary" }), button("구역 저장", null, { class: "primary" })]); actions.lastChild.type = "submit"; form.append(actions);
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
  function mountMap(host, zone, tips, onTipSelect) {
    host.append(node("p", { class: "route-notes-map-status", text: mapClientId ? TEXT.map : "지도 키가 준비되지 않았습니다. 목록과 메모는 사용할 수 있습니다." }));
    if (!mapClientId) return;
    const token = generation, request = ++mapRequest;
    host.replaceChildren();
    createRouteNoteMap({ element: host, clientId: mapClientId, onTipSelect, isActive: () => isCurrent(token) && host.isConnected && request === mapRequest, onCoordinatePick: (point) => {
      const lat = root.querySelector("#routeNoteTipLat"), lng = root.querySelector("#routeNoteTipLng"); if (lat && lng) { lat.value = point.lat.toFixed(6); lng.value = point.lng.toFixed(6); formDirty = true; notify("지도 위치를 메모에 넣었습니다."); }
    } }).then((adapter) => { if (!isCurrent(token) || !host.isConnected || request !== mapRequest) { adapter.destroy(); return; } map = adapter; map.render({ zone, tips }); })
      .catch((error) => { if (error.name !== "AbortError" && isCurrent(token) && host.isConnected && request === mapRequest) { host.replaceChildren(node("p", { class: "route-notes-map-error", text: errorText(error) })); } });
  }
  function isDirty() { return Boolean(formDirty && (zoneDraft || tipDraft)); }
  function canClose() { if (saving) { notify("저장 중입니다. 잠시만 기다려 주세요."); return false; } return !isDirty() || window.confirm("저장하지 않은 변경이 있습니다. 닫을까요?"); }
  function handleBack() {
    if (tipDraft || zoneDraft) {
      if (!canClose()) return true;
      tipDraft = null; zoneDraft = null; formDirty = false; render(); return true;
    }
    if (selected) { selected = null; formDirty = false; render(); return true; }
    return false;
  }
  return { open, close: reset, reset, destroy, isDirty, canClose, handleBack };
}
