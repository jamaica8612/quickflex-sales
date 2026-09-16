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

export function splitStoredRoutes(value) {
  return routeListFromText(value);
}

export function joinStoredRoutes(routes) {
  return routeListFromText(Array.isArray(routes) ? routes.join("|") : routes).join("|");
}

export function expandRouteText(text) {
  const seen = new Set();
  return routeListFromText(text)
    .flatMap((route) => {
      const match = route.match(/^(\d+)([A-Z]{2,})$/);
      return match ? match[2].split("").map((suffix) => match[1] + suffix) : [route];
    })
    .filter((route) => route && !seen.has(route) && seen.add(route));
}

// Schedule/admin input accepts compact groups, including adjacent prefixes.
// Do not use fuzzy correction here: explicit imported routes must be preserved.
export function parseScheduleRoutes(value) {
  const text = (Array.isArray(value) ? value.join(" ") : String(value ?? "")).toUpperCase();
  const groups = text.match(/(?<![0-9A-Z])(?:\d{3}[A-Z]+)+(?![0-9A-Z])/g) || [];
  return [...new Set(groups.flatMap((group) =>
    (group.match(/\d{3}[A-Z]+/g) || []).flatMap(expandRouteText)))];
}

export function compactRouteList(routes) {
  const groups = new Map();
  routeListFromText(routes).forEach((route) => {
    const prefix = route.slice(0, 3);
    const suffix = route.slice(3);
    if (!groups.has(prefix)) groups.set(prefix, []);
    if (!groups.get(prefix).includes(suffix)) groups.get(prefix).push(suffix);
  });
  return [...groups.entries()].map(([prefix, suffixes]) => `${prefix}${suffixes.join("")}`).join(" ");
}

export function formatRouteLabel(value) {
  return compactRouteList(splitStoredRoutes(value));
}

export function formatRecordRoutes(rows) {
  return compactRouteList((rows || []).flatMap((row) => splitStoredRoutes(row.route)));
}
