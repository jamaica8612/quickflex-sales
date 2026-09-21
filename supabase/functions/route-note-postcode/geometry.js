export function transformPostcodeGeometry(geometry, project) {
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) throw new Error("Invalid geometry");
  let count = 0;
  const ring = (positions) => {
    if (!Array.isArray(positions) || positions.length < 4) throw new Error("Invalid ring");
    count += positions.length;
    if (count > 5000) throw new Error("Too many coordinates");
    const result = positions.map((point) => {
      if (!Array.isArray(point) || point.length !== 2 || point.some((n) => typeof n !== "number" || !Number.isFinite(n))) throw new Error("Invalid position");
      const converted = project(point);
      if (!Array.isArray(converted) || converted.length !== 2) throw new Error("Invalid projection");
      const [lng, lat] = converted;
      if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) throw new Error("Invalid projection");
      return [lng, lat];
    });
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.abs(first[0] - last[0]) > 1e-8 || Math.abs(first[1] - last[1]) > 1e-8) throw new Error("Open ring");
    return result;
  };
  const polygon = (rings) => {
    if (!Array.isArray(rings) || !rings.length || rings.length > 100) throw new Error("Invalid polygon");
    return rings.map(ring);
  };
  if (!Array.isArray(geometry.coordinates) || !geometry.coordinates.length || geometry.coordinates.length > 100) throw new Error("Invalid coordinates");
  return { type: geometry.type, coordinates: geometry.type === "Polygon"
    ? polygon(geometry.coordinates) : geometry.coordinates.map(polygon) };
}
