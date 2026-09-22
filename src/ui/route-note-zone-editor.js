import { createRouteNoteMap } from "../lib/route-note-map.js?v=5";
import { routeNoteZoneNameKey } from "../lib/route-notes.js?v=2";
import { routeNoteDetailCodes } from "../lib/route-note-rules.js";
import { appendManualPart, appendPostcode, createZoneGeometryHistory, editZonePartLabel, removePart, restorePostcode, ringPoints, setRingPoints, zonePolygons } from "../lib/route-note-zone-model.js";

const $ = (tag, className = "", content = "") => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content != null) element.textContent = String(content);
  return element;
};
const button = (label, callback, className = "") => {
  const element = $("button", `route-note-zone-button ${className}`, label);
  element.type = "button";
  element.addEventListener("click", callback);
  return element;
};
const field = (label, value, onInput, { multiline = false, type = "text", placeholder = "", maxLength } = {}) => {
  const wrapper = $("label", "route-note-zone-field");
  wrapper.append($("span", "", label));
  const control = $(multiline ? "textarea" : "input");
  if (!multiline) control.type = type;
  control.value = value ?? "";
  control.placeholder = placeholder;
  if (maxLength) control.maxLength = maxLength;
  control.addEventListener("input", () => onInput(control.value));
  wrapper.append(control);
  return { wrapper, control };
};
const errorMessage = (error) => error?.code === "CONFLICT" ? "다른 수정이 있어 최신 내용을 확인해 주세요." : (error?.message || "작업을 완료하지 못했습니다.");
const validColor = (value) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : "#1B62D6";
const normalizedCode = (value) => String(value || "").trim().normalize("NFKC").toUpperCase();
const isDetailCode = (value) => /^\d{3}[A-Z]\d{2}$/.test(normalizedCode(value));

/** Mounts a self-contained editor. The parent owns list navigation and service state. */
export function createRouteNoteZoneEditor({ host, zone = null, zones = [], service, canDelete = false, notify = () => {}, onCancel = () => {}, onSaved = () => {}, onDeleted = () => {}, mapClientId } = {}) {
  if (!host || !service?.saveZone) throw new TypeError("구역 편집 화면을 열 수 없습니다.");
  const original = zone ? structuredClone(zone) : null;
  const initialPolygon = zone?.polygon || null;
  const history = createZoneGeometryHistory(initialPolygon);
  let name = zone?.name || "", memo = zone?.memo || "", color = validColor(zone?.color);
  let regionName = initialPolygon?.regionName || "";
  let pendingCode = "", pendingPostcode = "", pendingGroup = "", moreOpen = false, groupOpen = false;
  let drawLabel = "", mode = "form", activePart = null, activeRing = 0, selectedPoint = null;
  let drawing = [], drawPast = [], drawFuture = [];
  let map = null, disposed = false, saving = false, generation = 0;
  let inlineError = "", fieldError = null, didFitMap = false;

  const initialFields = JSON.stringify([name, memo, color, regionName]);
  const isDirty = () => JSON.stringify([name, memo, color, regionName]) !== initialFields
    || JSON.stringify(history.get()) !== JSON.stringify(initialPolygon) || drawing.length > 0;
  function canClose() {
    if (saving) { notify("저장 중입니다. 잠시 기다려 주세요.", "error"); return false; }
    return !isDirty() || window.confirm("저장하지 않은 구역 변경을 버릴까요?");
  }
  function paintError() {
    fieldError?.remove(); fieldError = null;
    errorBox.textContent = inlineError; errorBox.hidden = !inlineError;
    if (inlineError) content.prepend(errorBox); else errorBox.remove();
    const target = inlineError.includes("우편번호") ? "우편번호 5자리"
      : inlineError.includes("상세 코드") ? (mode === "drawing" ? "이 영역의 상세 코드" : mode === "editing" ? "이 경계의 상세 코드" : "상세 코드")
        : inlineError.includes("구역 이름") ? "구역 이름" : null;
    if (!target) return;
    const wrapper = [...content.querySelectorAll("label")].find((label) => label.firstElementChild?.textContent === target || label.children?.[0]?.textContent === target);
    if (wrapper) { fieldError = $("small", "route-note-zone-field-error", inlineError); fieldError.setAttribute("role", "alert"); wrapper.append(fieldError); }
  }
  function setError(message) { inlineError = message; paintError(); }
  function announce(message) { setError(message); notify(message, "error"); }
  function changeGeometry(next) {
    history.set(next); setError(""); renderSections(); syncMap();
  }
  function drawingChange(next) {
    drawPast.push(drawing.map((point) => ({ ...point })));
    drawing = next; drawFuture = []; selectedPoint = null; setError(""); renderSections(); syncMap();
  }
  function undo() {
    if (mode === "drawing" && drawPast.length) { drawFuture.push(drawing); drawing = drawPast.pop(); selectedPoint = null; renderSections(); syncMap(); return; }
    if (history.undo()) { renderSections(); syncMap(); }
  }
  function redo() {
    if (mode === "drawing" && drawFuture.length) { drawPast.push(drawing); drawing = drawFuture.pop(); selectedPoint = null; renderSections(); syncMap(); return; }
    if (history.redo()) { renderSections(); syncMap(); }
  }
  function activePoints() { return mode === "drawing" ? drawing : activePart == null ? [] : ringPoints(history.get(), activePart, activeRing); }
  function updatePoint(index, point) {
    if (saving) return;
    const points = activePoints();
    if (!points[index]) return;
    const next = points.map((item, i) => i === index ? point : item);
    try {
      if (mode === "drawing") drawingChange(next);
      else changeGeometry(setRingPoints(history.get(), activePart, activeRing, next));
      selectedPoint = index; renderSections(); syncMap();
    } catch (error) { announce(errorMessage(error)); }
  }
  function insertPoint(point) {
    if (saving) return;
    if (mode === "drawing") { drawingChange([...drawing, point]); return; }
    if (mode !== "editing") return;
    const points = activePoints();
    if (!points.length) return;
    const insertAt = selectedPoint == null ? points.length : selectedPoint + 1;
    const next = [...points.slice(0, insertAt), point, ...points.slice(insertAt)];
    try { changeGeometry(setRingPoints(history.get(), activePart, activeRing, next)); selectedPoint = insertAt; renderSections(); syncMap(); }
    catch (error) { announce(errorMessage(error)); }
  }
  function removeSelectedPoint() {
    if (selectedPoint == null) return;
    const points = activePoints();
    if (mode === "editing" && points.length <= 3) return announce("경계에는 점이 3개 이상 필요합니다.");
    const next = points.filter((_, index) => index !== selectedPoint);
    try {
      if (mode === "drawing") drawingChange(next);
      else changeGeometry(setRingPoints(history.get(), activePart, activeRing, next));
      selectedPoint = null; renderSections(); syncMap();
    } catch (error) { announce(errorMessage(error)); }
  }
  function syncMap() {
    if (!map || disposed) return;
    const polygon = history.get();
    map.render({ zone: { polygon, color, name }, preserveViewport: didFitMap });
    didFitMap ||= !!polygon;
    if (mode === "drawing" || mode === "editing") {
      map.setRingEditor?.({ points: activePoints(), closed: mode === "editing", selectedIndex: selectedPoint,
        onMove: (index, point) => updatePoint(index, point),
        onSelect: (index) => { selectedPoint = index; renderSections(); syncMap(); } });
    } else map.clearRingEditor?.();
  }
  function onMapPick(point) { if (mode === "drawing" || mode === "editing") insertPoint(point); }
  async function mountMap() {
    const epoch = ++generation;
    try {
      const instance = await createRouteNoteMap({ element: mapHost, clientId: mapClientId, onCoordinatePick: onMapPick,
        isActive: () => !disposed && generation === epoch });
      if (disposed || generation !== epoch) { instance.destroy(); return; }
      map = instance; mapStatus.hidden = true; retryMap.hidden = true; syncMap();
    } catch (error) {
      if (disposed || generation !== epoch) return;
      mapStatus.hidden = false;
      mapStatus.textContent = `지도를 열지 못했습니다. ${errorMessage(error)}`;
      retryMap.hidden = false;
    }
  }
  function handleBack() {
    if (mode === "drawing" || mode === "editing" || mode === "review") {
      if (mode === "drawing" && drawing.length && !window.confirm(`그리던 점 ${drawing.length}개를 버리고 돌아갈까요?`)) return true;
      mode = "form"; drawing = []; drawPast = []; drawFuture = []; selectedPoint = null;
      renderSections(); syncMap(); return true;
    }
    return false;
  }
  function cancel() { if (handleBack()) return; if (canClose()) onCancel(); }
  async function addPostal() {
    const code = normalizedCode(pendingCode), postcode = pendingPostcode.trim();
    if (!isDetailCode(code)) return announce("상세 코드를 310C01 형식으로 입력해 주세요.");
    if (!/^\d{5}$/.test(postcode)) return announce("우편번호 5자리를 입력해 주세요.");
    if (typeof service.lookupPostcode !== "function") return announce("우편번호 조회 기능을 사용할 수 없습니다.");
    const epoch = generation; saving = true; renderSections();
    try {
      const found = await service.lookupPostcode(postcode);
      if (disposed || epoch !== generation) return;
      didFitMap = false;
      changeGeometry(appendPostcode(history.get(), found, code, normalizedCode(pendingGroup) || code.slice(0, 4)));
      pendingCode = ""; pendingPostcode = ""; renderSections();
      notify(`${postcode} 경계를 추가했습니다.`);
    } catch (error) { if (!disposed && epoch === generation) announce(errorMessage(error)); }
    finally { if (!disposed && epoch === generation) { saving = false; renderSections(); } }
  }
  async function restorePostal(partIndex) {
    const postcode = history.get()?.postcodes?.[partIndex];
    if (!postcode || typeof service.lookupPostcode !== "function") return;
    const epoch = generation; saving = true; renderSections();
    try {
      const found = await service.lookupPostcode(postcode);
      if (disposed || epoch !== generation) return;
      didFitMap = false;
      changeGeometry(restorePostcode(history.get(), postcode, found, history.get()?.subLabels?.[partIndex]));
      activePart = null; mode = "form"; renderSections(); syncMap(); notify(`${postcode} 우편번호 원본 경계로 복원했습니다.`);
    } catch (error) { if (!disposed && epoch === generation) announce(errorMessage(error)); }
    finally { if (!disposed && epoch === generation) { saving = false; renderSections(); } }
  }
  function validate() {
    const trimmed = name.trim();
    if (!trimmed) return "구역 이름을 입력해 주세요.";
    if (trimmed.length > 80) return "구역 이름은 80자까지 입력할 수 있습니다.";
    const duplicate = zones.find((item) => item.id !== zone?.id && routeNoteZoneNameKey(item.name) === routeNoteZoneNameKey(trimmed));
    if (duplicate) return `${duplicate.name} 구역이 이미 있습니다.`;
    const polygon = history.get();
    if (!polygon || !zonePolygons(polygon).length) return "우편번호 경계 또는 직접 그린 영역을 하나 이상 추가해 주세요.";
    const codes = new Set(routeNoteDetailCodes(polygon));
    for (const existing of zones) {
      if (existing.id === zone?.id) continue;
      const used = new Set(routeNoteDetailCodes(existing.polygon));
      for (const code of codes) if (used.has(code)) return `${code} 상세 코드는 다른 구역에서 사용 중입니다.`;
    }
    return "";
  }
  async function save() {
    if (saving) return;
    const problem = validate(); if (problem) return announce(problem);
    const epoch = generation; saving = true; renderSections();
    try {
      const polygon = history.get();
      if (polygon) polygon.regionName = regionName.trim();
      const saved = await service.saveZone({ id: zone?.id, name: name.trim(), memo: memo.trim(), color,
        polygon, expectedUpdatedAt: zone?.updated_at });
      if (disposed || epoch !== generation) return;
      notify("구역을 저장했습니다."); onSaved(saved);
    } catch (error) { if (!disposed && epoch === generation) announce(errorMessage(error)); }
    finally { if (!disposed && epoch === generation) { saving = false; renderSections(); } }
  }
  async function removeZone() {
    if (!zone?.id || !canDelete || saving || !canClose()) return;
    if (!window.confirm(`${zone.name} 구역을 삭제할까요? 팁이나 참고 사진이 남아 있으면 삭제할 수 없습니다.`)) return;
    const epoch = generation; saving = true; renderSections();
    try { await service.deleteZone(zone.id, zone.updated_at); if (disposed || epoch !== generation) return;
      notify("구역을 삭제했습니다."); onDeleted(zone.id);
    } catch (error) { if (!disposed && epoch === generation) announce(errorMessage(error)); }
    finally { if (!disposed && epoch === generation) { saving = false; renderSections(); } }
  }

  host.replaceChildren();
  const shell = $("section", "route-note-zone-editor");
  const guide = $("p", "route-note-zone-intro", "우편번호 경계를 먼저 추가하고, 빠진 곳은 지도에 직접 그려 함께 저장하세요.");
  const content = $("div", "route-note-zone-content");
  const mapCard = $("section", "route-note-zone-map-card");
  const mapHost = $("div", "route-note-zone-map");
  mapHost.setAttribute("role", "region"); mapHost.setAttribute("aria-label", "구역 경계 편집 지도");
  const mapStatus = $("p", "route-note-zone-map-status", "지도 여는 중…");
  const retryMap = button("지도 다시 열기", () => { retryMap.hidden = true; mapStatus.textContent = "지도 여는 중…"; mountMap(); }, "secondary");
  retryMap.hidden = true;
  const mapTools = $("div", "route-note-zone-map-tools");
  mapCard.append(mapHost, mapStatus, retryMap, mapTools);
  const errorBox = $("p", "route-note-zone-error"); errorBox.setAttribute("role", "alert"); errorBox.hidden = true;
  const actions = $("div", "route-note-zone-actions");
  shell.append(guide, content, mapCard, actions); host.append(shell);

  function renderSections() {
    if (disposed) return;
    for (const details of content.querySelectorAll("details")) {
      if (details.className === "route-note-zone-options") moreOpen = details.open;
      if (details.className === "route-note-zone-group-options") groupOpen = details.open;
    }
    shell.dataset.mode = mode;
    if (mode === "drawing" || mode === "editing") shell.insertBefore(mapCard, content);
    else shell.insertBefore(content, mapCard);
    content.replaceChildren(); mapTools.replaceChildren(); actions.replaceChildren();
    const polygon = history.get(), parts = zonePolygons(polygon);
    if (mode === "review") {
      const panel = $("section", "route-note-zone-card");
      panel.append($("h3", "", "저장 전 확인"), $("p", "", `구역 ${name.trim() || "(이름 없음)"} · 경계 ${parts.length}개`));
      const codes = [...new Set((polygon?.subLabels || []).filter(Boolean))];
      panel.append($("p", "", `상세 코드 ${codes.length}개: ${codes.join(", ") || "없음"}`));
      panel.append($("p", "", `우편번호 ${[...new Set((polygon?.postcodes || []).filter(Boolean))].join(", ") || "직접 그린 영역만 있음"}`));
      panel.append($("p", "", "기존 현장 메모와 사진은 이 구역에 그대로 남습니다."));
      content.append(panel);
      actions.append(button("수정하기", () => { mode = "form"; renderSections(); syncMap(); }, "secondary"), button(saving ? "저장 중…" : "이대로 저장", save, "primary"));
    } else {
      if (mode === "form") {
        const basics = $("section", "route-note-zone-card route-note-zone-name-card"); basics.append($("h3", "", "1. 구역 이름"));
        const nameField = field("구역 이름", name, (value) => { name = value; }, { placeholder: "예: 302A·302B", maxLength: 80 });
        nameField.wrapper.className += " route-note-zone-name";
        const regionField = field("지역 이름 (선택)", regionName, (value) => { regionName = value; }, { placeholder: "예: 강남구 역삼동" });
        const memoField = field("공유 메모 (선택)", memo, (value) => { memo = value; }, { multiline: true, maxLength: 4000 });
        const colorField = field("지도 색상", color, (value) => { color = value; syncMap(); }, { type: "color" });
        const options = $("details", "route-note-zone-options"); options.open = moreOpen;
        options.append($("summary", "", "추가 안내·색상 (선택)"), regionField.wrapper, colorField.wrapper, memoField.wrapper);
        basics.append(nameField.wrapper, options); content.append(basics);
        const postal = $("section", "route-note-zone-card"); postal.append($("h3", "", "2. 우편번호 경계 추가"), $("p", "route-note-zone-help", "상세 코드 하나에 여러 우편번호를 넣거나, 우편번호 하나를 여러 상세 코드에 연결할 수 있습니다."));
        const inputs = $("div", "route-note-zone-postal-inputs");
        const group = field("묶음 코드 직접 지정", pendingGroup, (value) => { pendingGroup = value; }, { placeholder: "예: 310C" });
        const code = field("상세 코드", pendingCode, (value) => { pendingCode = value; }, { placeholder: "예: 310C01" });
        const postcode = field("우편번호 5자리", pendingPostcode, (value) => { pendingPostcode = value.replace(/\D/g, "").slice(0, 5); postcode.control.value = pendingPostcode; }, { placeholder: "예: 06236", maxLength: 5 });
        postcode.control.inputMode = "numeric"; inputs.append(code.wrapper, postcode.wrapper);
        const groupOptions = $("details", "route-note-zone-group-options"); groupOptions.open = groupOpen;
        groupOptions.append($("summary", "", "묶음 코드 조정 (선택)"), $("p", "route-note-zone-help", "비워 두면 상세 코드 앞 4자리로 자동 묶습니다."), group.wrapper);
        postal.append(inputs, groupOptions, button(saving ? "조회 중…" : "우편번호 경계 추가", addPostal, "primary")); content.append(postal);
        const boundaries = $("section", "route-note-zone-card"); boundaries.append($("h3", "", "3. 경계 확인과 수정"));
        if (!parts.length) boundaries.append($("p", "route-note-zone-help", "아직 경계가 없습니다. 우편번호를 추가하거나 지도를 눌러 직접 그려 주세요."));
        const list = $("div", "route-note-zone-part-list");
        parts.forEach((part, index) => {
          const row = $("div", "route-note-zone-part");
          const post = polygon?.postcodes?.[index];
          const label = polygon?.subLabels?.[index] || "";
          row.append($("strong", "", `${label || "코드 없음"} · ${post || "직접 그린 영역"}`), $("small", "", `${part.length}개 링 · ${part.reduce((n, ring) => n + Math.max(0, ring.length - 1), 0)}개 점`));
          const rowActions = $("div", "route-note-zone-row-actions");
          rowActions.append(button("경계 편집", () => { activePart = index; activeRing = 0; selectedPoint = null; mode = "editing"; renderSections(); syncMap(); }, "secondary"));
          if (post) rowActions.append(button("우편번호 원본 복원", () => restorePostal(index), "secondary"));
          rowActions.append(button("경계 삭제", () => { if (window.confirm("이 경계를 삭제할까요? 실행 취소로 되돌릴 수 있습니다.")) { changeGeometry(removePart(history.get(), index)); activePart = null; } }, "secondary"));
          row.append(rowActions); list.append(row);
        });
        boundaries.append(list, button("직접 그린 영역 추가", () => { mode = "drawing"; drawing = []; drawPast = []; drawFuture = []; selectedPoint = null; renderSections(); syncMap(); }, "secondary"));
        content.append(boundaries);
      } else {
        const points = activePoints();
        const panel = $("section", "route-note-zone-card");
        panel.append($("h3", "", mode === "drawing" ? "지도에서 영역 그리기" : "경계 점 편집"));
        panel.append($("p", "route-note-zone-help", mode === "drawing" ? "지도에서 점을 3개 이상 찍으세요. 점을 눌러 이동하거나 삭제할 수 있습니다." : "점을 끌어 이동하세요. 점을 선택한 뒤 지도를 누르면 그 다음에 새 점이 들어갑니다."));
        if (mode === "drawing") {
          const label = field("이 영역의 상세 코드", drawLabel, (value) => { drawLabel = value; }, { placeholder: "예: 310C02" }); panel.append(label.wrapper);
        } else {
          const label = field("이 경계의 상세 코드", polygon?.subLabels?.[activePart] || "", () => {});
          label.control.addEventListener("change", () => {
            if (normalizedCode(label.control.value) === normalizedCode(polygon?.subLabels?.[activePart])) return;
            if (!isDetailCode(label.control.value)) return announce("상세 코드를 310C01 형식으로 입력해 주세요.");
            try { changeGeometry(editZonePartLabel(history.get(), activePart, label.control.value)); } catch (error) { announce(errorMessage(error)); }
          });
          panel.append(label.wrapper);
          if (parts[activePart]?.length > 1) {
            const ringSelect = $("select", "route-note-zone-ring-select"); ringSelect.setAttribute("aria-label", "편집할 링");
            parts[activePart].forEach((_, index) => { const option = $("option", "", index ? `내부 구멍 ${index}` : "바깥 경계"); option.value = index; ringSelect.append(option); });
            ringSelect.value = String(activeRing); ringSelect.addEventListener("change", () => { activeRing = Number(ringSelect.value); selectedPoint = null; renderSections(); syncMap(); }); panel.append(ringSelect);
          }
        }
        panel.append($("p", "route-note-zone-help", `현재 ${points.length}개 점`));
        if (selectedPoint != null && points[selectedPoint]) {
          const coordinate = $("div", "route-note-zone-coordinates");
          const lat = field("선택한 점 위도", String(points[selectedPoint].lat), () => {}, { type: "number" });
          const lng = field("선택한 점 경도", String(points[selectedPoint].lng), () => {}, { type: "number" });
          lat.control.step = lng.control.step = "any";
          const apply = button("좌표 적용", () => updatePoint(selectedPoint, { lat: Number(lat.control.value), lng: Number(lng.control.value) }), "secondary");
          coordinate.append(lat.wrapper, lng.wrapper, apply); panel.append(coordinate, button("선택한 점 삭제", removeSelectedPoint, "secondary"));
        }
        content.append(panel);
        mapTools.append(button("실행 취소", undo, "secondary"), button("다시 실행", redo, "secondary"));
        if (mode === "drawing") mapTools.append(button("이 영역 사용", () => {
          if (!isDetailCode(drawLabel)) return announce("상세 코드를 310C01 형식으로 입력해 주세요.");
          try { didFitMap = false; changeGeometry(appendManualPart(history.get(), drawing, drawLabel)); drawing = []; drawPast = []; drawFuture = []; drawLabel = ""; mode = "form"; renderSections(); syncMap(); }
          catch (error) { announce(errorMessage(error)); }
        }, "primary"));
        mapTools.append(button("경계 편집 마치기", () => { handleBack(); }, "secondary"));
      }
      actions.append(button("취소", cancel, "secondary"));
      if (mode === "form") {
        actions.append(button("실행 취소", undo, "secondary"), button("다시 실행", redo, "secondary"));
        if (zone?.id && canDelete) actions.append(button("구역 삭제", removeZone, "danger"));
        actions.append(button("저장 전 확인", () => { const problem = validate(); if (problem) return announce(problem); mode = "review"; renderSections(); syncMap(); }, "primary"));
      }
    }
    shell.querySelectorAll("button").forEach((control) => { if (saving) control.disabled = true; });
    paintError();
  }
  renderSections(); mountMap();
  return { isDirty, canClose, handleBack, resize: () => map?.resize?.(), destroy() { disposed = true; generation++; map?.destroy?.(); map = null; host.replaceChildren(); } };
}
