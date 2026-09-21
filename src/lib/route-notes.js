export const ROUTE_NOTE_MARKER_TYPES = Object.freeze([
  "note",
  "vehicle_entrance", "parking", "entrance", "elevator", "stairs", "restroom", "dog", "cat", "delivery_spot", "warning", "construction", "access_code", "security", "storage", "walk_in", "unloading", "locked", "quiet", "no_entry", "important",
]);
export const ROUTE_NOTE_BUCKET = "quickflex-route-notes-photos";
export const ROUTE_NOTE_SIGNED_URL_SECONDS = 300;
export const ROUTE_NOTE_IMAGE_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);
export const ROUTE_NOTE_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MARKERS = new Set(ROUTE_NOTE_MARKER_TYPES);
const IMAGE_EXTENSIONS = Object.freeze({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" });

export function isRouteNoteUuid(value) {
  return typeof value === "string" && UUID.test(value);
}

function text(value, limit, label, { required = false } = {}) {
  const result = String(value ?? "").trim();
  if (required && !result) throw new RangeError(`${label} 항목을 입력해 주세요.`);
  if (result.length > limit) throw new RangeError(`${label} 항목은 ${limit}자까지 입력할 수 있습니다.`);
  return result;
}

function optionalText(value, limit, label) {
  if (value == null || value === "") return null;
  return text(value, limit, label) || null;
}

function coordinate(value, minimum, maximum, label) {
  if (value == null || typeof value === "boolean" || String(value).trim() === "") throw new RangeError(`${label} 좌표를 입력해 주세요.`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) throw new RangeError(`${label} is invalid`);
  return result;
}

function position(value) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((coordinate) => typeof coordinate !== "number")) throw new RangeError("구역 경계의 좌표 형식이 올바르지 않습니다.");
  coordinate(value[0], -180, 180, "Longitude");
  coordinate(value[1], -90, 90, "Latitude");
}

function ring(value, counter) {
  if (!Array.isArray(value) || value.length < 4) throw new RangeError("Polygon ring needs at least four positions");
  counter.count += value.length;
  if (counter.count > 5000) throw new RangeError("구역 경계는 5,000개 좌표까지 지원합니다.");
  value.forEach(position);
  const first = value[0];
  const last = value.at(-1);
  if (first[0] !== last[0] || first[1] !== last[1]) throw new RangeError("Polygon ring must be closed");
}

export function normalizeRouteNotePolygon(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || !["Polygon", "MultiPolygon"].includes(value.type)) {
    throw new RangeError("Polygon must be GeoJSON Polygon or MultiPolygon");
  }
  const counter = { count: 0 };
  if (value.type === "Polygon") {
    if (!Array.isArray(value.coordinates) || value.coordinates.length < 1 || value.coordinates.length > 100) {
      throw new RangeError("Polygon rings are invalid");
    }
    value.coordinates.forEach((value) => ring(value, counter));
  } else {
    if (!Array.isArray(value.coordinates) || value.coordinates.length < 1 || value.coordinates.length > 100) {
      throw new RangeError("MultiPolygon parts are invalid");
    }
    value.coordinates.forEach((polygon) => {
      if (!Array.isArray(polygon) || polygon.length < 1 || polygon.length > 100) throw new RangeError("MultiPolygon rings are invalid");
      polygon.forEach((value) => ring(value, counter));
    });
  }
  return structuredClone(value);
}

export function normalizeRouteNoteZone(input = {}) {
  if (input.id != null && !isRouteNoteUuid(input.id)) throw new RangeError("Invalid zone ID");
  if (input.expectedUpdatedAt != null && !String(input.expectedUpdatedAt).trim()) throw new RangeError("Invalid zone revision");
  return {
    id: input.id?.toLowerCase() || null,
    name: text(input.name, 80, "구역 이름", { required: true }),
    memo: text(input.memo, 4_000, "구역 메모"),
    polygon: normalizeRouteNotePolygon(input.polygon),
    expectedUpdatedAt: input.expectedUpdatedAt == null ? null : String(input.expectedUpdatedAt),
  };
}

export function normalizeRouteNoteTip(input = {}) {
  if (input.id != null && !isRouteNoteUuid(input.id)) throw new RangeError("Invalid tip ID");
  if (!isRouteNoteUuid(input.zone_id)) throw new RangeError("Invalid zone ID");
  if (!MARKERS.has(input.marker_type)) throw new RangeError("Invalid route-note marker type");
  if (input.expectedUpdatedAt != null && !String(input.expectedUpdatedAt).trim()) throw new RangeError("Invalid tip revision");
  const hasLat = input.lat != null && String(input.lat).trim() !== "";
  const hasLng = input.lng != null && String(input.lng).trim() !== "";
  if (hasLat !== hasLng) throw new RangeError("지도 위치를 넣으려면 위도와 경도를 함께 입력해 주세요.");
  return {
    id: input.id?.toLowerCase() || null,
    zone_id: input.zone_id.toLowerCase(),
    title: text(input.title, 120, "팁 제목", { required: true }),
    marker_type: input.marker_type,
    memo: text(input.memo, 4_000, "배송 팁"),
    lat: hasLat ? coordinate(input.lat, -90, 90, "위도") : null,
    lng: hasLng ? coordinate(input.lng, -180, 180, "경도") : null,
    expectedUpdatedAt: input.expectedUpdatedAt == null ? null : String(input.expectedUpdatedAt),
  };
}

export function validateRouteNoteImage(file) {
  if (!file || typeof file.name !== "string" || !ROUTE_NOTE_IMAGE_TYPES.includes(file.type)) {
    throw new RangeError("Photo must be a JPEG, PNG, or WebP image");
  }
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > ROUTE_NOTE_MAX_IMAGE_BYTES) {
    throw new RangeError("Photo must be between 1 byte and 5 MB");
  }
  return IMAGE_EXTENSIONS[file.type];
}
