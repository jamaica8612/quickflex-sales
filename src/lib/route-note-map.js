const NAVER_SCRIPT_ID = "quickflex-route-notes-naver-map";
const DEFAULT_CENTER = { lat: 37.5665, lng: 126.978 };
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
export async function createRouteNoteMap({ element, clientId, onCoordinatePick, onTipSelect, isActive = () => true } = {}) {
  if (!element) throw new Error("지도 영역을 찾을 수 없습니다.");
  const maps = await loadNaverMap(clientId);
  if (!isActive()) { const error = new Error("지도 요청이 취소되었습니다."); error.name = "AbortError"; throw error; }
  const map = new maps.Map(element, {
    center: new maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng), zoom: 15,
    minZoom: 8, zoomControl: true,
  });
  let drawing = false;
  let points = [];
  let overlays = [];
  let draftOverlays = [];
  const listener = maps.Event.addListener(map, "click", (event) => {
    const point = { lat: event.coord.lat(), lng: event.coord.lng() };
    if (drawing) { points = [...points, point]; drawDraft(); } else onCoordinatePick?.(point);
  });
  function clear(items) { items.forEach((item) => item?.setMap?.(null)); return []; }
  function drawDraft() {
    draftOverlays = clear(draftOverlays);
    if (!points.length) return;
    const path = points.map((point) => new maps.LatLng(point.lat, point.lng));
    draftOverlays.push(new maps.Polyline({ map, path, strokeColor: "#1B62D6", strokeWeight: 3, strokeOpacity: .85 }));
    points.forEach((point) => draftOverlays.push(new maps.Marker({ map, position: new maps.LatLng(point.lat, point.lng) })));
  }
  function render({ zone, tips = [] } = {}) {
    overlays = clear(overlays);
    if (hasPolygon(zone?.polygon)) {
      polygonRings(zone.polygon).forEach((rings) => overlays.push(new maps.Polygon({
        map, paths: rings.map((ring) => ring.map((point) => new maps.LatLng(point.lat, point.lng))),
        fillColor: "#1B62D6", fillOpacity: .12, strokeColor: "#1B62D6", strokeOpacity: .85, strokeWeight: 2,
      })));
      const pointsForBounds = polygonPoints(zone.polygon);
      const bounds = pointsForBounds.reduce((result, point) => result.extend(new maps.LatLng(point.lat, point.lng)), new maps.LatLngBounds());
      map.fitBounds(bounds, { top: 36, right: 36, bottom: 36, left: 36 });
    }
    const tipsWithCoordinates = tips.filter((tip) => tip.lat != null && tip.lng != null && Number.isFinite(Number(tip.lat)) && Number.isFinite(Number(tip.lng)));
    if (!hasPolygon(zone?.polygon) && tipsWithCoordinates[0]) map.setCenter(new maps.LatLng(Number(tipsWithCoordinates[0].lat), Number(tipsWithCoordinates[0].lng)));
    tipsWithCoordinates.forEach((tip) => {
      const marker = new maps.Marker({ map, position: new maps.LatLng(Number(tip.lat), Number(tip.lng)), title: tip.title || "구역 메모" });
      maps.Event.addListener(marker, "click", () => onTipSelect?.(tip));
      overlays.push(marker);
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
    destroy() { overlays = clear(overlays); draftOverlays = clear(draftOverlays); maps.Event.removeListener(listener); element.replaceChildren(); },
  };
}
