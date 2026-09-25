const key = ([lng, lat]) => `${Number(lng).toFixed(7)},${Number(lat).toFixed(7)}`;
const edgeKey = (a, b) => [key(a), key(b)].sort().join("|");
const signedArea = (ring) => ring.slice(0, -1).reduce((sum, point, index) => sum + point[0] * ring[index + 1][1] - ring[index + 1][0] * point[1], 0);
const NUDGE_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315];

/**
 * A zone label centered on the plain coordinate average often lands right on a tip pin
 * (delivery tips cluster near a zone's middle, e.g. a courtyard or main entrance). Only
 * step in when a tip actually sits close enough to the centroid to risk overlapping the
 * label; otherwise leave the label centered so it stays readable when there's room. When
 * a nudge is needed, try 8 points spaced around the centroid (scaled to the label's own
 * cluster size) and keep whichever stays farthest from the closest tip.
 */
function labelPositionAwayFromTips(position, points, tips) {
  if (!tips?.length) return position;
  const lats = points.map((point) => point[1]);
  const lngs = points.map((point) => point[0]);
  const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs)) || 0.0005;
  const step = span * 0.22;
  const latScale = Math.cos((position.lat * Math.PI) / 180) || 1;
  const nearestTipDistanceSq = (point) => Math.min(...tips.map((tip) =>
    ((point.lat - tip.lat) ** 2) + (((point.lng - tip.lng) * latScale) ** 2)));
  if (nearestTipDistanceSq(position) >= step ** 2) return position;
  const candidates = NUDGE_ANGLES.map((angle) => {
    const radians = (angle * Math.PI) / 180;
    return { lat: position.lat + (Math.sin(radians) * step), lng: position.lng + ((Math.cos(radians) * step) / latScale) };
  });
  return candidates.reduce((best, candidate) =>
    nearestTipDistanceSq(candidate) > nearestTipDistanceSq(best) ? candidate : best, position);
}

/** RouteNote labels each connected piece, even when distant pieces share a code. */
export function routeNoteLabelGroups(polygon, fallbackLabel = "", tips = []) {
  const parts = polygon?.type === "MultiPolygon" ? polygon.coordinates : polygon?.type === "Polygon" ? [polygon.coordinates] : [];
  if (!Array.isArray(parts)) return [];
  const byLabel = new Map();
  parts.forEach((rings, index) => {
    const text = String(polygon.subLabels?.[index] || fallbackLabel).trim();
    if (!text || !rings?.[0]?.length) return;
    if (!byLabel.has(text)) byLabel.set(text, []);
    byLabel.get(text).push(rings);
  });
  return [...byLabel].flatMap(([text, groups]) => {
    const parent = groups.map((_, index) => index);
    function find(index) {
      while (parent[index] !== index) { parent[index] = parent[parent[index]]; index = parent[index]; }
      return index;
    }
    const owners = new Map();
    groups.forEach((rings, index) => {
      const ring = rings[0];
      const points = key(ring[0]) === key(ring.at(-1)) ? ring.slice(0, -1) : ring;
      points.forEach((point, pointIndex) => {
        const next = points[(pointIndex + 1) % points.length];
        if (key(point) === key(next)) return;
        const edge = edgeKey(point, next);
        if (owners.has(edge)) parent[find(index)] = find(owners.get(edge));
        else owners.set(edge, index);
      });
    });
    const clusters = new Map();
    groups.forEach((rings, index) => {
      const root = find(index);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root).push(...rings.flat());
    });
    // Match RouteNote's coordinate average within each connected cluster, then nudge clear of tips.
    return [...clusters.values()].map((points) => {
      const position = {
        lat: points.reduce((sum, point) => sum + point[1], 0) / points.length,
        lng: points.reduce((sum, point) => sum + point[0], 0) / points.length,
      };
      return { text, position: labelPositionAwayFromTips(position, points, tips) };
    });
  });
}

/** Only the visual strokes are joined; source polygons and their holes remain intact. */
export function routeNoteBoundaryDisplay(polygon, fallbackLabel = "", tips = []) {
  const parts = polygon?.type === "MultiPolygon" ? polygon.coordinates : polygon?.type === "Polygon" ? [polygon.coordinates] : [];
  if (!Array.isArray(parts) || !polygon?.subLabels?.some(Boolean)) return null;
  const edges = new Map();
  parts.forEach((rings, index) => {
    const label = String(polygon.subLabels[index] || fallbackLabel).trim();
    rings.forEach((ring, ringIndex) => {
      const forward = signedArea(ring) >= 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        if (key(a) === key(b)) continue;
        const id = edgeKey(a, b);
        if (!edges.has(id)) edges.set(id, []);
        edges.get(id).push({ a, b, label, part: index, hole: ringIndex > 0, direction: key(forward ? a : b) });
      }
    });
  });
  const segments = [...edges.values()].filter((items) => {
    if (items.length !== 2) return true;
    const [a, b] = items;
    return a.hole || b.hole || !a.label || a.label !== b.label || a.part === b.part || a.direction === b.direction;
  }).map((items) => ({ a: items[0].a, b: items[0].b }));
  const neighbors = new Map();
  segments.forEach((segment, index) => [segment.a, segment.b].forEach((point) => {
    const id = key(point); if (!neighbors.has(id)) neighbors.set(id, []); neighbors.get(id).push(index);
  }));
  const visited = new Set(), paths = [];
  function walk(index, start) {
    const path = [start]; let point = start;
    while (!visited.has(index)) {
      visited.add(index); const segment = segments[index];
      point = key(segment.a) === key(point) ? segment.b : segment.a; path.push(point);
      const next = neighbors.get(key(point));
      if (next.length !== 2) break;
      const candidate = next.find((item) => !visited.has(item)); if (candidate == null) break;
      index = candidate;
    }
    paths.push(path.map(([lng, lat]) => ({ lat, lng })));
  }
  segments.forEach((segment, index) => {
    if (!visited.has(index) && neighbors.get(key(segment.a)).length !== 2) walk(index, segment.a);
    if (!visited.has(index) && neighbors.get(key(segment.b)).length !== 2) walk(index, segment.b);
  });
  segments.forEach((segment, index) => { if (!visited.has(index)) walk(index, segment.a); });
  return { paths, labels: routeNoteLabelGroups(polygon, fallbackLabel, tips) };
}
