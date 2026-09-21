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
  let suppressCoordinatePick = false;
  const listener = maps.Event.addListener(map, "click", (event) => {
    const point = { lat: event.coord.lat(), lng: event.coord.lng() };
    if (drawing) { points = [...points, point]; drawDraft(); } else if (!suppressCoordinatePick) onCoordinatePick?.(point);
  });
  function clear(items) { items.forEach((item) => item?.setMap?.(null)); return []; }
  function clearRenderedOverlays() {
    overlayListeners.forEach((item) => maps.Event.removeListener(item));
    overlayListeners = [];
    overlayDisposers.forEach((dispose) => dispose());
    overlayDisposers = [];
    overlays = clear(overlays);
  }
  function selectZone(zone) {
    suppressCoordinatePick = true;
    Promise.resolve().then(() => { suppressCoordinatePick = false; });
    onZoneSelect?.(zone);
  }
  function addZoneLabel(zone, color, selected) {
    const documentRef = element.ownerDocument || globalThis.document;
    const button = documentRef?.createElement?.("button");
    const centroid = polygonCentroid(zone.polygon);
    if (!button || !centroid) return;
    const name = zoneName(zone);
    button.type = "button";
    button.className = "route-notes-map-zone-label";
    button.textContent = name;
    button.setAttribute("aria-label", `${name} 구역 선택`);
    button.setAttribute("aria-pressed", String(selected));
    button.style?.setProperty?.("--route-note-zone-color", color);
    const stopKeyPropagation = (event) => event.stopPropagation();
    const choose = (event) => { event.preventDefault(); event.stopPropagation(); selectZone(zone); };
    button.addEventListener("click", choose);
    button.addEventListener("keydown", stopKeyPropagation);
    const marker = new maps.Marker({
      map, position: new maps.LatLng(centroid.lat, centroid.lng), title: name, clickable: true,
      icon: { content: button },
    });
    overlays.push(marker);
    overlayDisposers.push(() => {
      button.removeEventListener("click", choose);
      button.removeEventListener("keydown", stopKeyPropagation);
    });
  }
  function drawDraft() {
    draftOverlays = clear(draftOverlays);
    if (!points.length) return;
    const path = points.map((point) => new maps.LatLng(point.lat, point.lng));
    draftOverlays.push(new maps.Polyline({ map, path, strokeColor: "#1B62D6", strokeWeight: 3, strokeOpacity: .85 }));
    points.forEach((point) => draftOverlays.push(new maps.Marker({ map, position: new maps.LatLng(point.lat, point.lng) })));
  }
  function render({ zone, zones, tips = [], selectedZoneId, preserveViewport = false, padding } = {}) {
    clearRenderedOverlays();
    const sourceZones = Array.isArray(zones) ? zones : zone ? [zone] : [];
    const validZones = sourceZones.filter((item) => hasPolygon(item?.polygon));
    const canSelectZone = typeof onZoneSelect === "function";
    const resolvedSelectedId = selectedZoneId ?? zone?.id;
    const selectedZone = validZones.find((item) => item?.id === resolvedSelectedId) || (Array.isArray(zones) ? null : validZones[0]);
    validZones.forEach((item, index) => {
      const selected = item === selectedZone;
      const color = zoneColor(item, index);
      polygonRings(item.polygon).forEach((rings) => {
        const polygon = new maps.Polygon({
          map, paths: rings.map((ring) => ring.map((point) => new maps.LatLng(point.lat, point.lng))), clickable: canSelectZone,
          fillColor: color, fillOpacity: selected ? .24 : .12, strokeColor: color, strokeOpacity: selected ? 1 : .85, strokeWeight: selected ? 4 : 2,
        });
        overlays.push(polygon);
        if (canSelectZone) overlayListeners.push(maps.Event.addListener(polygon, "click", () => selectZone(item)));
      });
      if (canSelectZone) addZoneLabel(item, color, selected);
    });
    const tipsWithCoordinates = tips.filter((tip) => tip.lat != null && tip.lng != null && Number.isFinite(Number(tip.lat)) && Number.isFinite(Number(tip.lng)));
    const fitPadding = boundsPadding(padding);
    if (!preserveViewport && selectedZone) {
      const bounds = polygonPoints(selectedZone.polygon).reduce((result, point) => result.extend(new maps.LatLng(point.lat, point.lng)), new maps.LatLngBounds());
      map.fitBounds(bounds, fitPadding);
    } else if (!preserveViewport && validZones.length) {
      const bounds = validZones.flatMap((item) => polygonPoints(item.polygon)).reduce((result, point) => result.extend(new maps.LatLng(point.lat, point.lng)), new maps.LatLngBounds());
      map.fitBounds(bounds, fitPadding);
    } else if (!preserveViewport && tipsWithCoordinates[0]) map.setCenter(new maps.LatLng(Number(tipsWithCoordinates[0].lat), Number(tipsWithCoordinates[0].lng)));
    tipsWithCoordinates.forEach((tip) => {
      const marker = new maps.Marker({ map, position: new maps.LatLng(Number(tip.lat), Number(tip.lng)), title: tip.title || "구역 메모" });
      overlays.push(marker);
      overlayListeners.push(maps.Event.addListener(marker, "click", () => onTipSelect?.(tip)));
    });
  }
  return {
    render,
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
    destroy() { clearRenderedOverlays(); draftOverlays = clear(draftOverlays); maps.Event.removeListener(listener); element.replaceChildren(); },
  };
}
