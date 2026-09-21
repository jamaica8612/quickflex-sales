// Geometry edits are immutable so undo/redo never lose imported rings or metadata.
const copy = (value) => structuredClone(value);
const same = (a, b) => a?.[0] === b?.[0] && a?.[1] === b?.[1];

function position(point) {
  const lat = Number(point?.lat), lng = Number(point?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new RangeError("지도 위치가 올바르지 않습니다.");
  }
  return [lng, lat];
}

export function zonePolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates;
  throw new RangeError("지원하지 않는 구역 경계입니다.");
}

function asMulti(geometry) {
  if (!geometry) return { type: "MultiPolygon", coordinates: [], subLabels: [], postcodes: [], codeGroups: [], source: "mixed-boundary" };
  const result = copy(geometry);
  if (result.type === "Polygon") { result.type = "MultiPolygon"; result.coordinates = [result.coordinates]; }
  result.subLabels = [...(result.subLabels || [])];
  result.postcodes = [...(result.postcodes || [])];
  while (result.subLabels.length < result.coordinates.length) result.subLabels.push("");
  while (result.postcodes.length < result.coordinates.length) result.postcodes.push(null);
  result.codeGroups = copy(result.codeGroups || []);
  return result;
}

function close(points) {
  if (points.length < 3) throw new RangeError("경계에는 점이 3개 이상 필요합니다.");
  const ring = points.map(position);
  if (!same(ring[0], ring.at(-1))) ring.push([...ring[0]]);
  if (new Set(ring.slice(0, -1).map((point) => point.join(","))).size < 3) throw new RangeError("서로 다른 점을 3개 이상 찍어 주세요.");
  return ring;
}

export function ringPoints(geometry, partIndex, ringIndex = 0) {
  const ring = zonePolygons(geometry)[partIndex]?.[ringIndex] || [];
  const open = ring.length > 1 && same(ring[0], ring.at(-1)) ? ring.slice(0, -1) : ring;
  return open.map(([lng, lat]) => ({ lat, lng }));
}

export function setRingPoints(geometry, partIndex, ringIndex, points) {
  const result = copy(geometry);
  const polygons = result.type === "Polygon" ? [result.coordinates] : result.coordinates;
  if (!polygons[partIndex]?.[ringIndex]) throw new RangeError("편집할 경계를 찾을 수 없습니다.");
  polygons[partIndex][ringIndex] = close(points);
  return result;
}

export function appendManualPart(geometry, points, label = "") {
  const result = asMulti(geometry);
  result.coordinates.push([close(points)]);
  result.subLabels.push(String(label).trim().toUpperCase());
  result.postcodes.push(null);
  result.source = result.postcodes.some(Boolean) ? "mixed-boundary" : "manual-drawing";
  return result;
}

export function appendPostcode(geometry, lookup, label, groupPrefix = "") {
  const postcode = String(lookup?.postcode || "").trim();
  const code = String(label || "").trim().normalize("NFKC").toUpperCase();
  if (!/^\d{5}$/.test(postcode) || !code) throw new RangeError("상세 코드와 5자리 우편번호를 입력해 주세요.");
  const incoming = zonePolygons(lookup.geometry);
  if (!incoming.length) throw new RangeError("우편번호 경계를 찾을 수 없습니다.");
  const result = asMulti(geometry);
  incoming.forEach((part) => { result.coordinates.push(copy(part)); result.subLabels.push(code); result.postcodes.push(postcode); });
  const prefix = String(groupPrefix || "").trim().normalize("NFKC").toUpperCase();
  let group = result.codeGroups.find((item) => item.prefix === prefix);
  if (!group) { group = { prefix, codes: [] }; result.codeGroups.push(group); }
  if (!group.codes.some((item) => item.label === code && item.postcode === postcode)) group.codes.push({ label: code, postcode });
  result.source = result.postcodes.some((item) => !item) ? "mixed-boundary" : "postcode-boundary";
  return result;
}

export function removePart(geometry, partIndex) {
  const result = asMulti(geometry);
  if (!result.coordinates[partIndex]) return result;
  const label = result.subLabels[partIndex], postcode = result.postcodes[partIndex];
  result.coordinates.splice(partIndex, 1);
  result.subLabels.splice(partIndex, 1);
  result.postcodes.splice(partIndex, 1);
  if (postcode && !result.postcodes.some((value, index) => value === postcode && result.subLabels[index] === label)) {
    result.codeGroups = result.codeGroups.map((group) => ({ ...group, codes: (group.codes || []).filter((code) => code.label !== label || code.postcode !== postcode) })).filter((group) => group.codes.length);
  }
  result.source = result.postcodes.some(Boolean) ? result.postcodes.some((item) => !item) ? "mixed-boundary" : "postcode-boundary" : "manual-drawing";
  return result.coordinates.length ? result : null;
}

export function restorePostcode(geometry, postcode, lookup, detailCode = null) {
  const target = String(postcode);
  const result = asMulti(geometry);
  const indexes = result.postcodes.map((item, index) => item === target && (detailCode == null || result.subLabels[index] === detailCode) ? index : -1).filter((index) => index >= 0);
  if (!indexes.length) throw new RangeError("복원할 우편번호를 찾을 수 없습니다.");
  const parts = zonePolygons(lookup?.geometry);
  if (!parts.length || String(lookup.postcode) !== target) throw new RangeError("원본 우편번호 경계를 확인하지 못했습니다.");
  const label = result.subLabels[indexes[0]];
  for (const index of indexes.reverse()) { result.coordinates.splice(index, 1); result.subLabels.splice(index, 1); result.postcodes.splice(index, 1); }
  const insertAt = Math.min(...indexes);
  result.coordinates.splice(insertAt, 0, ...copy(parts));
  result.subLabels.splice(insertAt, 0, ...parts.map(() => label));
  result.postcodes.splice(insertAt, 0, ...parts.map(() => target));
  return result;
}

export function editZonePartLabel(geometry, partIndex, label) {
  const result = asMulti(geometry);
  if (!result.coordinates[partIndex]) throw new RangeError("구역 경계를 찾을 수 없습니다.");
  const next = String(label || "").trim().normalize("NFKC").toUpperCase();
  if (!next) throw new RangeError("상세 코드를 입력해 주세요.");
  const previous = result.subLabels[partIndex];
  const postcode = result.postcodes[partIndex];
  result.subLabels.forEach((value, index) => {
    if (index === partIndex || (postcode && value === previous && result.postcodes[index] === postcode)) result.subLabels[index] = next;
  });
  if (postcode) result.codeGroups.forEach((group) => (group.codes || []).forEach((code) => {
    if (code.label === previous && code.postcode === postcode) code.label = next;
  }));
  return result;
}

export function createZoneGeometryHistory(initial = null) {
  let value = copy(initial), past = [], future = [];
  return {
    get: () => copy(value),
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    set(next) { const candidate = copy(next); if (JSON.stringify(candidate) === JSON.stringify(value)) return false; past.push(value); value = candidate; future = []; return true; },
    undo() { if (!past.length) return false; future.push(value); value = past.pop(); return true; },
    redo() { if (!future.length) return false; past.push(value); value = future.pop(); return true; },
  };
}
