const DETAIL_CODE = /^\d{3}[A-Z]\d{2}$/;

export function routeNoteDetailCodes(polygon) {
  const labels = [
    ...(Array.isArray(polygon?.subLabels) ? polygon.subLabels : []),
    ...(Array.isArray(polygon?.codeGroups) ? polygon.codeGroups.flatMap((group) =>
      Array.isArray(group?.codes) ? group.codes.map((code) => code?.label) : []) : []),
  ];
  const codes = new Set();
  for (const label of labels) {
    const normalized = String(label ?? "").normalize("NFKC").replace(/\s+/gu, "").toUpperCase();
    const prefix = normalized.match(/^(\d{3}[A-Z])\d{2}(?:[/,]|$)/)?.[1];
    for (const token of normalized.split(/[/,]/u)) {
      if (DETAIL_CODE.test(token)) codes.add(token);
      else if (prefix && /^\d{2}$/.test(token)) codes.add(prefix + token);
    }
  }
  return [...codes].sort();
}

function ringPosition(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[j];
    const [bx, by] = ring[i];
    const cross = (point.lng - ax) * (by - ay) - (point.lat - ay) * (bx - ax);
    if (Math.abs(cross) < 1e-10 && point.lng >= Math.min(ax, bx) - 1e-10 &&
        point.lng <= Math.max(ax, bx) + 1e-10 && point.lat >= Math.min(ay, by) - 1e-10 &&
        point.lat <= Math.max(ay, by) + 1e-10) return 2;
    if ((ay > point.lat) !== (by > point.lat) &&
        point.lng < (bx - ax) * (point.lat - ay) / (by - ay) + ax) inside = !inside;
  }
  return inside ? 1 : 0;
}

export function isPointInRouteNoteZone(point, polygon) {
  if (!Number.isFinite(point?.lat) || !Number.isFinite(point?.lng) || !polygon) return false;
  const parts = polygon.type === "Polygon" ? [polygon.coordinates] :
    polygon.type === "MultiPolygon" ? polygon.coordinates : [];
  if (!Array.isArray(parts)) return false;
  return parts.some((rings) => {
    if (!Array.isArray(rings) || !rings.length || !Array.isArray(rings[0])) return false;
    const outer = ringPosition(point, rings[0]);
    if (outer === 2) return true;
    if (outer !== 1) return false;
    for (const hole of rings.slice(1)) {
      const hit = ringPosition(point, hole);
      if (hit === 2) return true;
      if (hit === 1) return false;
    }
    return true;
  });
}
