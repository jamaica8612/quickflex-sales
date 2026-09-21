const key = ([lng, lat]) => `${Number(lng).toFixed(7)},${Number(lat).toFixed(7)}`;
const edgeKey = (a, b) => [key(a), key(b)].sort().join("|");
const signedArea = (ring) => ring.slice(0, -1).reduce((sum, point, index) => sum + point[0] * ring[index + 1][1] - ring[index + 1][0] * point[1], 0);

/** Only the visual strokes are joined; source polygons and their holes remain intact. */
export function routeNoteBoundaryDisplay(polygon) {
  const parts = polygon?.type === "MultiPolygon" ? polygon.coordinates : polygon?.type === "Polygon" ? [polygon.coordinates] : [];
  if (!Array.isArray(parts) || !polygon?.subLabels?.some(Boolean)) return null;
  const edges = new Map(), labels = new Map();
  parts.forEach((rings, index) => {
    const label = String(polygon.subLabels[index] || "").trim();
    if (label) {
      const points = rings[0].slice(0, -1);
      if (!labels.has(label)) labels.set(label, []);
      labels.get(label).push(...points);
    }
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
  return { paths, labels: [...labels].map(([text, points]) => ({ text,
    position: { lat: points.reduce((sum, point) => sum + point[1], 0) / points.length,
      lng: points.reduce((sum, point) => sum + point[0], 0) / points.length } })) };
}
