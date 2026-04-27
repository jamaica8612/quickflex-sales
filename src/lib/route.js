export function normalizeRoute(value) {
  return String(value || "").trim().toUpperCase();
}

export function routeListFromText(value) {
  return String(value || "")
    .split(/[,\s/|]+/)
    .map(normalizeRoute)
    .filter(Boolean)
    .filter((route, index, list) => list.indexOf(route) === index);
}
