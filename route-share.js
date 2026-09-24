import { PUBLIC_SUPABASE_CONFIG, ROUTE_NOTES_CONFIG } from "./src/config.js?v=11";
import { createRouteNoteMap, hasPolygon } from "./src/lib/route-note-map.js?v=9";

const root = document.getElementById("routeSharePage");
let expiresAt = 0, expiryTimer = 0, map = null, generation = 0;

function node(tag, attrs = {}, children = []) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null) continue;
    if (key === "class") element.className = value;
    else if (key === "text") element.textContent = value;
    else if (key === "hidden") element.hidden = Boolean(value);
    else if (key.startsWith("on")) element.addEventListener(key.slice(2).toLowerCase(), value);
    else element.setAttribute(key, String(value));
  }
  children.flat().filter(Boolean).forEach((child) => element.append(child));
  return element;
}
function messageFor(status, detail = "") {
  if (status === 400) return "공유 링크 주소가 올바르지 않습니다.";
  if (status === 404) return "이 공유 링크를 찾을 수 없습니다.";
  if (status === 410) return "이 공유 링크는 만료되었거나 공유가 중지되었습니다.";
  if (status === 429) return "요청이 많습니다. 잠시 후 다시 열어 주세요.";
  if (detail && /expired|revoked/i.test(detail)) return "이 공유 링크는 만료되었거나 공유가 중지되었습니다.";
  return "공유 구역 메모를 불러오지 못했습니다. 잠시 후 다시 열어 주세요.";
}
function safeUrl(value) {
  try { const url = new URL(value); return /^https:$/.test(url.protocol) ? url.href : null; } catch { return null; }
}
function formatDate(value) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(time) : "";
}
function getToken() {
  const token = new URLSearchParams(location.hash.slice(1)).get("token") || "";
  return /^[0-9a-f]{64}$/i.test(token) ? token.toLowerCase() : null;
}
function photoGrid(photos, label) {
  const images = (photos || []).map((photo) => safeUrl(photo?.url)).filter(Boolean);
  if (!images.length) return null;
  return node("section", { class: "route-share-photos", "aria-label": label }, [node("div", { class: "route-share-photo-grid" }, images.map((src) =>
    node("a", { href: src, target: "_blank", rel: "noopener noreferrer" }, [node("img", { src, alt: label, loading: "lazy" })])))]);
}
function destroyMap() { map?.destroy?.(); map = null; }
function render(payload, token) {
  const zone = payload?.zone;
  if (!zone?.name) throw new Error("공유 구역 정보가 없습니다.");
  const tipPhotos = Array.isArray(payload.tip_photos) ? payload.tip_photos : [];
  const zonePhotos = Array.isArray(payload.zone_photos) ? payload.zone_photos : [];
  const byTip = new Map(); tipPhotos.forEach((photo) => byTip.set(photo.tip_id, [...(byTip.get(photo.tip_id) || []), photo]));
  const tips = (Array.isArray(payload.tips) ? payload.tips : []).filter((tip) => tip?.zone_id === zone.id);
  expiresAt = Date.parse(payload.expires_at || "") || 0;
  const mapHost = hasPolygon(zone.polygon) || tips.some((tip) => tip.lat != null && tip.lng != null && Number.isFinite(Number(tip.lat)) && Number.isFinite(Number(tip.lng)))
    ? node("div", { class: "route-share-map", role: "region", "aria-label": `${zone.name} 지도` }) : null;
  root.replaceChildren(node("article", { class: "route-share-card" }, [
    node("header", { class: "route-share-heading" }, [node("p", { text: "플렉스노트 · 공유 구역" }), node("h1", { text: zone.name }), node("p", { class: "route-share-memo", text: zone.memo || "공유 메모가 없습니다." })]),
    photoGrid(zonePhotos, "구역 참고 사진"),
    mapHost ? node("section", { class: "route-share-map-card" }, [mapHost]) : null,
    node("section", { class: "route-share-tips", "aria-labelledby": "routeShareTips" }, [node("h2", { id: "routeShareTips", text: "배송 팁" }),
      tips.length ? tips.map((tip) => node("article", { class: "route-share-tip", id: `route-share-tip-${tip.id}`, tabindex: "-1" }, [node("h3", { text: tip.title || "배송 메모" }),
        tip.memo ? node("p", { text: tip.memo }) : null,
        tip.author_name ? node("small", { text: `작성자 · ${tip.author_name}` }) : null,
        photoGrid(byTip.get(tip.id), `${tip.title || "배송 팁"} 사진`),
      ])) : node("p", { class: "route-share-empty", text: "등록된 배송 팁이 없습니다." })]),
    payload.expires_at ? node("div", { class: "route-share-expiry" }, [node("p", { text: `${formatDate(payload.expires_at)}까지 볼 수 있는 링크입니다.` }), node("button", { type: "button", class: "route-share-refresh", text: "새로 고침", onClick: load })]) : null,
  ]));
  if (mapHost) mountMap(mapHost, zone, tips, token);
  scheduleExpiry();
}
async function mountMap(host, zone, tips, token) {
  try {
    const next = await createRouteNoteMap({ element: host, clientId: ROUTE_NOTES_CONFIG.mapClientId, isActive: () => token === generation && root.contains(host), onTipSelect: (tip) => document.getElementById(`route-share-tip-${tip.id}`)?.focus() });
    if (token !== generation || !root.contains(host)) { next.destroy(); return; }
    map = next; map.render({ zone, tips });
  } catch {
    if (token === generation && root.contains(host)) host.replaceChildren(node("p", { class: "route-share-map-unavailable", text: "지도를 표시하지 못했습니다. 메모와 사진은 계속 볼 수 있습니다." }));
  }
}
function clearForExpiry() {
  clearTimeout(expiryTimer); expiresAt = 0; generation += 1; destroyMap();
  root.replaceChildren(node("section", { class: "route-share-card route-share-state" }, [node("h1", { text: "공유 기간이 끝났습니다." }), node("p", { text: "다시 보려면 공유한 기사에게 새 링크를 요청해 주세요." })]));
}
function scheduleExpiry() {
  clearTimeout(expiryTimer);
  if (!expiresAt) return;
  const remaining = expiresAt - Date.now();
  if (remaining <= 0) { clearForExpiry(); return; }
  expiryTimer = setTimeout(() => { if (Date.now() >= expiresAt) clearForExpiry(); else scheduleExpiry(); }, Math.min(remaining, 2_147_000_000));
}
async function load() {
  const tokenGeneration = ++generation;
  clearTimeout(expiryTimer); expiresAt = 0; destroyMap();
  const token = getToken();
  if (!token) { root.replaceChildren(node("section", { class: "route-share-card route-share-state" }, [node("h1", { text: "공유 링크를 확인해 주세요." }), node("p", { text: "주소 전체를 다시 열어 주세요." })])); return; }
  root.replaceChildren(node("section", { class: "route-share-card route-share-state" }, [node("p", { text: "공유 구역 메모를 여는 중입니다." })]));
  try {
    const response = await fetch(`${PUBLIC_SUPABASE_CONFIG.url}/functions/v1/route-note-share`, {
      method: "POST", cache: "no-store", referrerPolicy: "no-referrer", headers: { "Content-Type": "application/json", apikey: PUBLIC_SUPABASE_CONFIG.anonKey }, body: JSON.stringify({ token }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload?.error || ""), { status: response.status });
    if (tokenGeneration !== generation) return;
    render(payload, tokenGeneration);
  } catch (error) {
    if (tokenGeneration !== generation) return;
    root.replaceChildren(node("section", { class: "route-share-card route-share-state" }, [node("h1", { text: "공유 구역을 열 수 없습니다." }), node("p", { text: messageFor(error.status, error.message) })]));
  }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && expiresAt && Date.now() >= expiresAt) clearForExpiry(); });
window.addEventListener("hashchange", load);
window.addEventListener("pageshow", (event) => { if (expiresAt && Date.now() >= expiresAt) clearForExpiry(); else if (event.persisted) load(); });
load();
