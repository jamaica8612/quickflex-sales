import { ALERT_MARKERS, createRouteNoteIcon, createRouteNoteMapIcon } from "./route-note-icons.js?v=3";
import { routeNoteBoundaryDisplay, routeNoteLabelGroups } from "./route-note-map-geometry.js?v=2";

const NAVER_SCRIPT_ID = "quickflex-route-notes-naver-map";
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 };
const DEFAULT_BOUNDS_PADDING = { top: 36, right: 36, bottom: 36, left: 36 };
const ZONE_COLORS = ["#1B62D6", "#8B5CF6", "#0F8A72", "#C26B00", "#C33D6B"];
let naverLoadPromise = null;

export function polygonRings(polygon) {
  if (!polygon || typeof polygon !== "object") return [];
  const polygons = polygon.type === "MultiPolygon" ? polygon.coordinates : polygon.type === "Polygon" ? [polygon.coordinates] : [];
  return (polygons || []).map((rings) => (rings || []).map((ring) => (ring || []).map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))).filter((ring) => ring.length >= 3)).filter((rings) => rings.length);
}

export function polygonPoints(polygon) {
  return polygonRings(polygon).flat(2);
}

export function polygonCentroid(polygon) {
  const points = polygonPoints(polygon);
  if (!points.length) return null;
  return {
    lat: points.reduce((sum, point) => sum + point.lat, 0) / points.length,
    lng: points.reduce((sum, point) => sum + point.lng, 0) / points.length,
  };
}

export function toPolygon(points) {
  if (!Array.isArray(points) || points.length < 3) return null;
  const ring = points.map(({ lat, lng }) => [Number(lng), Number(lat)]);
  if (ring.some(([lng, lat]) => !Number.isFinite(lat) || !Number.isFinite(lng))) return null;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([...first]);
  return { type: "Polygon", coordinates: [ring] };
}

export function hasPolygon(polygon) {
  return polygonPoints(polygon).length >= 3;
}

function zoneColor(zone, index) {
  const supplied = typeof zone?.color === "string" ? zone.color.trim() : "";
  if (/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(supplied)) return supplied;
  const key = String(zone?.id ?? zone?.name ?? index);
  let hash = 0;
  for (let position = 0; position < key.length; position += 1) hash = ((hash * 31) + key.charCodeAt(position)) | 0;
  return ZONE_COLORS[(hash >>> 0) % ZONE_COLORS.length];
}

function zoneName(zone) {
  const name = typeof zone?.name === "string" ? zone.name.trim() : "";
  return name || "이름 없는 구역";
}

function boundsPadding(padding) {
  if (typeof padding === "number" && Number.isFinite(padding) && padding >= 0) {
    return { top: padding, right: padding, bottom: padding, left: padding };
  }
  if (!padding || typeof padding !== "object") return { ...DEFAULT_BOUNDS_PADDING };
  return Object.fromEntries(Object.entries(DEFAULT_BOUNDS_PADDING).map(([side, fallback]) => {
    const value = padding[side];
    return [side, typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback];
  }));
}

function loadNaverMap(clientId) {
  if (window.naver?.maps) return Promise.resolve(window.naver.maps);
  if (!clientId) return Promise.reject(new Error("지도 키가 준비되지 않았습니다."));
  if (naverLoadPromise) return naverLoadPromise;
  naverLoadPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById(NAVER_SCRIPT_ID);
    const script = existing || document.createElement("script");
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true; clearTimeout(timeout);
      if (error) { script.remove(); naverLoadPromise = null; reject(error); }
      else resolve(window.naver.maps);
    };
    const timeout = setTimeout(() => finish(new Error("지도 서비스 응답이 지연되고 있습니다.")), 12_000);
    script.addEventListener("load", () => window.naver?.maps ? finish() : finish(new Error("지도를 시작하지 못했습니다.")), { once: true });
    script.addEventListener("error", () => finish(new Error("지도 서비스를 불러오지 못했습니다.")), { once: true });
    if (!existing) {
      script.id = NAVER_SCRIPT_ID;
      script.async = true;
      script.defer = true;
      script.src = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${encodeURIComponent(clientId)}`;
      document.head.append(script);
    }
  });
  return naverLoadPromise;
}

/** Naver SDK is optional: all map-only state stays in this disposable adapter. */
export async function createRouteNoteMap({ element, clientId, onCoordinatePick, onTipSelect, onZoneSelect, isActive = () => true } = {}) {
  if (!element) throw new Error("지도 영역을 찾을 수 없습니다.");
  const maps = await loadNaverMap(clientId);
  if (!isActive()) { const error = new Error("지도 요청이 취소되었습니다."); error.name = "AbortError"; throw error; }
  const map = new maps.Map(element, {
    center: new maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng), zoom: 15,
    minZoom: 8, zoomControl: false,
  });
  let drawing = false;
  let points = [];
  let overlays = [];
  let overlayListeners = [];
  let overlayDisposers = [];
  let draftOverlays = [];
  let ringOverlays = [];
  let ringListeners = [];
  let ringDisposers = [];
  let suppressCoordinatePick = false;
  const listener = maps.Event.addListener(map, "click", (event) => {
    const point = { lat: event.coord.lat(), lng: event.coord.lng() };
    if (drawing) { points = [...points, point]; drawDraft(); } else if (!suppressCoordinatePick) onCoordinatePick?.(point);
  });
  const longPressListener = maps.Event.addListener(map, "longpress", (event) => {
    if (!drawing && !suppressCoordinatePick) onCoordinatePick?.({ lat: event.coord.lat(), lng: event.coord.lng() });
  });
  function clear(items) { items.forEach((item) => item?.setMap?.(null)); return []; }
  function clearRenderedOverlays() {
    overlayListeners.forEach((item) => maps.Event.removeListener(item));
    overlayListeners = [];
    overlayDisposers.forEach((dispose) => dispose());
    overlayDisposers = [];
    overlays = clear(overlays);
  }
  function selectZone(zone, point = null) {
    suppressCoordinatePick = true;
    Promise.resolve().then(() => { suppressCoordinatePick = false; });
    onZoneSelect?.(zone, point);
  }
  function addZoneLabel(detail) {
    const documentRef = element.ownerDocument || globalThis.document;
    const label = documentRef?.createElement?.("span");
    if (!label || !detail?.position) return;
    label.className = "route-notes-map-zone-label";
    label.textContent = detail.text;
    overlays.push(new maps.Marker({
      map, position: new maps.LatLng(detail.position.lat, detail.position.lng),
      title: detail.text, clickable: false, zIndex: 10,
      icon: { content: label, anchor: new maps.Point(0, 0) },
    }));
  }
  function addTipMarker(tip, selected) {
    const documentRef = element.ownerDocument || globalThis.document;
    const button = documentRef.createElement("button");
    const title = tip.title || "구역 팁";
    button.type = "button";
    button.className = "route-notes-map-tip-marker";
    button.setAttribute("aria-label", title + " 팁 보기");
    button.setAttribute("aria-pressed", String(selected));
    button.setAttribute("data-alert", String(ALERT_MARKERS.has(tip.marker_type)));
    button.setAttribute("data-marker-type", tip.marker_type || "note");
    button.append(createRouteNoteMapIcon(documentRef, tip.marker_type));
    const choose = (event) => {
      event.preventDefault(); event.stopPropagation();
      suppressCoordinatePick = true;
      Promise.resolve().then(() => { suppressCoordinatePick = false; });
      onTipSelect?.(tip);
    };
    const stopKeyPropagation = (event) => event.stopPropagation();
    button.addEventListener("click", choose);
    button.addEventListener("keydown", stopKeyPropagation);
    overlays.push(new maps.Marker({
      map, position: new maps.LatLng(Number(tip.lat), Number(tip.lng)), title,
      clickable: true, zIndex: selected ? 100 : 20,
      icon: { content: button, anchor: new maps.Point(22, 22) },
    }));
    overlayDisposers.push(() => {
      button.removeEventListener("click", choose);
      button.removeEventListener("keydown", stopKeyPropagation);
    });
  }
  function drawDraft() {
    draftOverlays = clear(draftOverlays);
    if (!points.length) return;
    const path = points.map((point) => new maps.LatLng(point.lat, point.lng));
    draftOverlays.push(new maps.Polyline({ map, path, strokeColor: "#1B62D6", strokeWeight: 2, strokeOpacity: .85 }));
    points.forEach((point) => draftOverlays.push(new maps.Marker({ map, position: new maps.LatLng(point.lat, point.lng) })));
  }
  function clearRingEditor() {
    ringListeners.forEach((item) => maps.Event.removeListener(item));
    ringListeners = [];
    ringDisposers.forEach((dispose) => dispose());
    ringDisposers = [];
    ringOverlays = clear(ringOverlays);
  }
  function setRingEditor({ points: vertices = [], closed = false, selectedIndex = null, onMove, onSelect } = {}) {
    clearRingEditor();
    if (!vertices.length) return;
    const path = vertices.map((point) => new maps.LatLng(point.lat, point.lng));
    if (closed) path.push(path[0]);
    ringOverlays.push(new maps.Polyline({ map, path, strokeColor: "#1B62D6", strokeWeight: 2, strokeOpacity: 1, clickable: false, zIndex: 120 }));
    const documentRef = element.ownerDocument || globalThis.document;
    vertices.forEach((point, index) => {
      const button = documentRef.createElement("button");
      button.type = "button";
      button.className = "route-notes-map-vertex";
      button.textContent = String(index + 1);
      button.setAttribute("aria-label", `경계점 ${index + 1} 선택`);
      button.setAttribute("aria-pressed", String(index === selectedIndex));
      const marker = new maps.Marker({ map, position: new maps.LatLng(point.lat, point.lng), draggable: true, clickable: true,
        zIndex: index === selectedIndex ? 140 : 130, icon: { content: button, anchor: new maps.Point(22, 22) } });
      ringOverlays.push(marker);
      const suppress = () => {
        suppressCoordinatePick = true;
        Promise.resolve().then(() => { suppressCoordinatePick = false; });
      };
      const choose = (event) => { event.preventDefault(); event.stopPropagation(); suppress(); onSelect?.(index); };
      const stopKey = (event) => event.stopPropagation();
      button.addEventListener("click", choose);
      button.addEventListener("keydown", stopKey);
      ringDisposers.push(() => { button.removeEventListener("click", choose); button.removeEventListener("keydown", stopKey); });
      ringListeners.push(maps.Event.addListener(marker, "dragstart", () => { suppressCoordinatePick = true; }));
      ringListeners.push(maps.Event.addListener(marker, "dragend", () => {
        const coord = marker.getPosition();
        suppress();
        onMove?.(index, { lat: coord.lat(), lng: coord.lng() });
      }));
    });
  }
  function addPickedMarker(point) {
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) return;
    const documentRef = element.ownerDocument || globalThis.document;
    const marker = documentRef.createElement("span");
    marker.className = "route-notes-map-picked-marker";
    marker.setAttribute("role", "img");
    marker.setAttribute("aria-label", "선택한 팁 위치");
    marker.append(createRouteNoteIcon(documentRef, "pin"));
    overlays.push(new maps.Marker({ map, position: new maps.LatLng(point.lat, point.lng), zIndex: 110,
      clickable: false, title: "선택한 팁 위치", icon: { content: marker, anchor: new maps.Point(22, 22) } }));
  }
  function render(options = {}) {
    const { zone, zones, tips = [], selectedZoneId, selectedTipId, pickedPoint, preserveViewport = false, padding } = options;
    clearRenderedOverlays();
    const sourceZones = Array.isArray(zones) ? zones : zone ? [zone] : [];
    const validZones = sourceZones.filter((item) => hasPolygon(item?.polygon));
    const canSelectZone = typeof onZoneSelect === "function";
    const hasSelectedZoneId = Object.prototype.hasOwnProperty.call(options, "selectedZoneId");
    const selectionRequested = hasSelectedZoneId || Object.prototype.hasOwnProperty.call(options, "zone");
    const selectedZone = hasSelectedZoneId
      ? (selectedZoneId == null ? null : sourceZones.find((item) => item?.id === selectedZoneId)
        || (zone?.id === selectedZoneId ? zone : null))
      : (zone || null);
    const renderedZones = selectionRequested && hasPolygon(selectedZone?.polygon) ? [selectedZone] : selectionRequested ? [] : validZones;
    const renderedTips = selectionRequested
      ? tips.filter((tip) => selectedZone?.id != null && tip?.zone_id === selectedZone.id)
      : tips;
    const tipsWithCoordinates = renderedTips.filter((tip) => tip.lat != null && tip.lng != null && Number.isFinite(Number(tip.lat)) && Number.isFinite(Number(tip.lng)));
    // Zone labels steer clear of whichever tips actually land on screen, so a busy zone
    // doesn't bury its name under a pin (or a pin under its name).
    const labelTips = tipsWithCoordinates.map((tip) => ({ lat: Number(tip.lat), lng: Number(tip.lng) }));
    renderedZones.forEach((item, index) => {
      const selected = item === selectedZone;
      const color = zoneColor(item, index);
      const display = routeNoteBoundaryDisplay(item.polygon, zoneName(item), labelTips);
      polygonRings(item.polygon).forEach((rings) => {
        const polygon = new maps.Polygon({
          map, paths: rings.map((ring) => ring.map((point) => new maps.LatLng(point.lat, point.lng))), clickable: canSelectZone,
          fillColor: color, fillOpacity: selected ? .07 : .035, strokeColor: color, strokeOpacity: display ? 0 : selected ? .85 : .6, strokeWeight: display ? 0 : selected ? 2 : 1,
        });
        overlays.push(polygon);
        if (canSelectZone) overlayListeners.push(maps.Event.addListener(polygon, "click", (event) => selectZone(item,
          event?.coord ? { lat: event.coord.lat(), lng: event.coord.lng() } : null)));
      });
      if (display) {
        display.paths.forEach((path) => overlays.push(new maps.Polyline({ map, path: path.map((point) => new maps.LatLng(point.lat, point.lng)),
          strokeColor: color, strokeWeight: selected ? 2 : 1, strokeOpacity: .85, clickable: false })));
      }
      (display?.labels || routeNoteLabelGroups(item.polygon, zoneName(item), labelTips)).forEach(addZoneLabel);
    });
    const fitPadding = boundsPadding(padding);
    if (!preserveViewport && hasPolygon(selectedZone?.polygon)) {
      const bounds = polygonPoints(selectedZone.polygon).reduce((result, point) => result.extend(new maps.LatLng(point.lat, point.lng)), new maps.LatLngBounds());
      map.fitBounds(bounds, fitPadding);
    } else if (!preserveViewport && renderedZones.length) {
      const bounds = renderedZones.flatMap((item) => polygonPoints(item.polygon)).reduce((result, point) => result.extend(new maps.LatLng(point.lat, point.lng)), new maps.LatLngBounds());
      map.fitBounds(bounds, fitPadding);
    } else if (!preserveViewport && tipsWithCoordinates[0]) map.setCenter(new maps.LatLng(Number(tipsWithCoordinates[0].lat), Number(tipsWithCoordinates[0].lng)));
    tipsWithCoordinates.forEach((tip) => addTipMarker(tip, tip.id === selectedTipId));
    addPickedMarker(pickedPoint);
  }
  return {
    render,
    getCenter() {
      const center = map.getCenter?.();
      return center ? { lat: Number(center.lat()), lng: Number(center.lng()) } : null;
    },
    setRingEditor,
    clearRingEditor,
    resize() {
      if (element.clientWidth > 0 && element.clientHeight > 0) map.setSize({ width: element.clientWidth, height: element.clientHeight });
    },
    setDrawing(value, initialPoints = []) { drawing = Boolean(value); points = drawing ? [...initialPoints] : []; drawDraft(); },
    undoPoint() { points = points.slice(0, -1); drawDraft(); return points; },
    finishPolygon() { const polygon = toPolygon(points); drawing = false; points = []; drawDraft(); return polygon; },
    locate() {
      if (!navigator.geolocation) return Promise.reject(new Error("이 기기에서는 현재 위치를 사용할 수 없습니다."));
      return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((position) => {
        const point = { lat: position.coords.latitude, lng: position.coords.longitude };
        map.setCenter(new maps.LatLng(point.lat, point.lng)); map.setZoom(17); resolve(point);
      }, () => reject(new Error("현재 위치 권한을 확인해 주세요.")), { enableHighAccuracy: true, timeout: 8000 }));
    },
    destroy() { clearRingEditor(); clearRenderedOverlays(); draftOverlays = clear(draftOverlays); maps.Event.removeListener(listener); maps.Event.removeListener(longPressListener); element.replaceChildren(); },
  };
}
