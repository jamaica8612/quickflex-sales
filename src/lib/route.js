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

// --- OCR route correction (pure) ---
// These were extracted from main.js. State-derived inputs are passed in via the
// `sources` object on correctRouteList so the logic stays free of globals/DOM.

const ROUTE_CODE = /^\d{3}[A-Z]$/;

export function routeDistance(a, b) {
  if (a.length !== b.length) return 99;
  const confusion = { O: "0", 0: "O", I: "1", 1: "I", L: "1", S: "5", 5: "S", B: "8", 8: "B", Z: "2", 2: "Z" };
  let score = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] === b[i]) continue;
    if (confusion[a[i]] === b[i]) score += 0.35;
    else score += 1;
  }
  return score;
}

// `master` codes are always candidates; everything in `gated` is only added when
// it already looks like a valid route code (NNNX).
export function buildRouteCandidates({ master = [], gated = [] } = {}) {
  const candidates = new Set(master.map(normalizeRoute));
  gated.forEach((route) => {
    const normalized = normalizeRoute(route);
    if (ROUTE_CODE.test(normalized)) candidates.add(normalized);
  });
  return candidates;
}

export function correctRoute(route, candidates) {
  const raw = normalizeRoute(route).replace(/[^0-9A-Z]/g, "");
  if (!raw) return "";
  if (candidates.has(raw)) return raw;
  const normalized = raw
    .slice(0, 3).replace(/[OIL]/g, "0").replace(/S/g, "5").replace(/B/g, "8")
    + raw.slice(3).replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/8/g, "B");
  if (candidates.has(normalized)) return normalized;
  let best = "";
  let bestScore = 99;
  for (const candidate of candidates) {
    const score = routeDistance(raw, candidate);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    } else if (score === bestScore) {
      best = "";
    }
  }
  if (bestScore <= 1) return best;
  return ROUTE_CODE.test(raw) ? raw : "";
}

export function activeRouteBundles({ stateBundles = [], defaultBundles = [] } = {}) {
  const dbBundles = (stateBundles || [])
    .filter((bundle) => bundle.active !== false && Array.isArray(bundle.routes) && bundle.routes.length >= 1)
    .map((bundle) => ({ routes: routeListFromText(bundle.routes), trusted: true }));
  const seen = new Set(dbBundles.map((bundle) => joinStoredRoutes(bundle.routes)));
  const fallback = (defaultBundles || [])
    .filter((bundle) => !seen.has(joinStoredRoutes(bundle)))
    .map((bundle) => ({ routes: bundle, trusted: false }));
  return [...dbBundles, ...fallback];
}

export function completeRouteBundles(routes, activeBundles) {
  const result = [...routes];
  const seen = new Set(result);
  (activeBundles || []).forEach(({ routes: bundle, trusted }) => {
    const observed = bundle.filter((route) => seen.has(route));
    const missing = bundle.filter((route) => !seen.has(route));
    const shouldComplete = trusted
      ? observed.length >= 2 && missing.length >= 1
      : observed.length >= 2 && missing.length === 1;
    if (shouldComplete) {
      bundle.forEach((route) => {
        if (!seen.has(route)) {
          seen.add(route);
          result.push(route);
        }
      });
    }
  });
  return result;
}

export function correctRouteList(routes, sources = {}) {
  const {
    master = [], defaultBundles = [], stateBundles = [], rates = [], fixedRoutes = [],
  } = sources;
  const gated = [
    ...defaultBundles.flat(),
    ...(stateBundles || []).flatMap((bundle) => routeListFromText(bundle.routes)),
    ...(rates || []).map((rate) => rate.route),
    ...fixedRoutes,
  ];
  const candidates = buildRouteCandidates({ master, gated });
  const bundles = activeRouteBundles({ stateBundles, defaultBundles });
  const seen = new Set();
  const corrected = routeListFromText(routes)
    .flatMap(expandRouteText)
    .map((route) => correctRoute(route, candidates))
    .filter((route) => route && !seen.has(route) && seen.add(route));
  return completeRouteBundles(corrected, bundles);
}
