/** Shared SVG icons for route-note controls, cards and map markers. */
export const MARKER_ICONS = {
  market_map: "storage",
  parking: "parking", vehicle_entrance: "car", unloading: "unloading", walk_in: "walk",
  entrance: "door", access_code: "keypad", security: "shield", elevator: "elevator", stairs: "stairs",
  restroom: "restroom", storage: "storage", locked: "lock",
  delivery_spot: "box",
  warning: "alert", important: "star", no_entry: "no-entry", dog: "dog", cat: "cat",
  construction: "construction", quiet: "quiet",
};
export const MAP_MARKER_ICONS = Object.freeze({
  "market_map": "building-warehouse",
  "note": "bulb",
  "vehicle_entrance": "car",
  "parking": "parking",
  "entrance": "door-enter",
  "elevator": "elevator",
  "stairs": "stairs",
  "restroom": "toilet-paper",
  "dog": "dog",
  "cat": "cat",
  "delivery_spot": "package",
  "warning": "alert-triangle",
  "construction": "traffic-cone",
  "access_code": "password",
  "security": "shield-check",
  "storage": "building-warehouse",
  "walk_in": "walk",
  "unloading": "truck-delivery",
  "locked": "lock",
  "quiet": "volume-off",
  "no_entry": "ban",
  "important": "star"
});
export const ALERT_MARKERS = new Set(["warning", "important", "no_entry", "construction", "dog", "locked"]);
const SVG_NS = "http://www.w3.org/2000/svg";
export function createRouteNoteMapIcon(documentRef, markerType) {
  const svg = documentRef.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "route-notes-map-icon");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.35");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  // Cards can reuse this SVG with their own class without thickening the official outline.
  svg.setAttribute("style", "fill:none;stroke:currentColor;stroke-width:1.35;stroke-linecap:round;stroke-linejoin:round");
  (MAP_ICON_PATHS[markerType] || MAP_ICON_PATHS.note).forEach((data) => {
    const path = documentRef.createElementNS(SVG_NS, "path");
    path.setAttribute("d", data);
    svg.append(path);
  });
  return svg;
}
function circlePath(cx, cy, r) {
  return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${r * 2} 0a${r} ${r} 0 1 0 ${-r * 2} 0`;
}
const ICON_PATHS = {
  search: [circlePath(11, 11, 7), "M20.5 20.5 16.2 16.2"],
  close: ["M6.5 6.5 17.5 17.5", "M17.5 6.5 6.5 17.5"],
  expand: ["M4 9V4h5", "M15 4h5v5", "M20 15v5h-5", "M9 20H4v-5"],
  collapse: ["M9 4v5H4", "M20 9h-5V4", "M15 20v-5h5", "M4 15h5v5"],
  locate: [circlePath(12, 12, 7.4), circlePath(12, 12, 2.4), "M12 1.8v2.6", "M12 19.6v2.6", "M1.8 12h2.6", "M19.6 12h2.6"],
  plus: ["M12 5.2v13.6", "M5.2 12h13.6"],
  star: ["M12 3.6 14.6 9l5.8.8-4.2 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8L3.6 9.8 9.4 9z"],
  back: ["M14.5 5.5 8 12l6.5 6.5"],
  next: ["M9.5 5.5 16 12l-6.5 6.5"],
  up: ["M6 14.6 12 9l6 5.6"],
  down: ["M6 9.4 12 15l6-5.6"],
  share: [circlePath(6.6, 12, 2.4), circlePath(17.2, 6.2, 2.4), circlePath(17.2, 17.8, 2.4), "M8.8 10.8 15 7.4", "M8.8 13.2 15 16.6"],
  edit: ["M4.5 19.5h4L18 10l-4-4-9.5 9.5z", "M13.6 6.4l4 4"],
  trash: ["M5 7h14", "M9.5 7V4.8h5V7", "M7.2 7 8.3 20h7.4L16.8 7"],
  photo: ["M4 7.6h3.2L8.7 5.4h6.6l1.5 2.2H20v11H4z", circlePath(12, 13.2, 3)],
  pin: ["M12 21.2s6.4-6.2 6.4-10.4a6.4 6.4 0 1 0-12.8 0C5.6 15 12 21.2 12 21.2z", circlePath(12, 10.8, 2.2)],
  alert: ["M12 3.8 2.9 20h18.2z", "M12 9.8v4.2", "M12 17.1v.1"],
  car: ["M4.6 15.8l1.2-5A2 2 0 0 1 7.8 9.2h8.4a2 2 0 0 1 2 1.6l1.2 5z", "M4.6 15.8h14.8v2.4H4.6z", circlePath(7.6, 18.2, 1.1), circlePath(16.4, 18.2, 1.1)],
  door: ["M7 20V4.8h10V20", "M4.6 20h14.8", circlePath(14.2, 12.6, .9)],
  box: ["M4.4 8.4 12 4.6l7.6 3.8v7.2L12 19.4l-7.6-3.8z", "M4.4 8.4 12 12.2l7.6-3.8", "M12 12.2v7.2"],
  note: ["M6.4 4h8.2l3 3v13H6.4z", "M9.4 10.4h5.2", "M9.4 14h5.2", "M9.4 17.6h3.4"],
  parking: ["M5 3h14v18H5z", "M10 17V7h3a3 3 0 0 1 0 6h-3"],
  unloading: ["M3 6h11v11H3z", "M14 10h4l3 4v3h-7", circlePath(7, 18, 2), circlePath(18, 18, 2), "M8 3v7m-2-2 2 2 2-2"],
  walk: [circlePath(14, 4, 2), "M10 9l3-2 3 5h3", "M13 7l-2 7 5 7", "M11 14l-3 7", "M10 9l-4 4"],
  keypad: ["M6 3h12v18H6z", circlePath(9, 8, .5), circlePath(15, 8, .5), circlePath(9, 12, .5), circlePath(15, 12, .5), "M9 17h6"],
  shield: ["M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z", "M8 12l3 3 5-6"],
  elevator: ["M4 3h16v18H4z", "M8 10V6m-2 2 2-2 2 2", "M16 6v4m-2-2 2 2 2-2", "M8 21v-7h8v7", "M12 14v7"],
  stairs: ["M3 20h5v-5h5v-5h5V5h3", "M4 11V4h7", "M4 4l8 8"],
  restroom: [circlePath(7, 5, 2), circlePath(17, 5, 2), "M4 10h6v6H4z", "M6 16v5m2-5v5", "M17 9l-4 8h8z", "M16 17v4m2-4v4"],
  storage: ["M4 3h16v18H4z", "M4 10h16M4 16h16", "M8 7h2m4 6h2m-8 6h2"],
  lock: ["M5 10h14v11H5z", "M8 10V7a4 4 0 0 1 8 0v3", circlePath(12, 15, 1), "M12 16v2"],
  "no-entry": [circlePath(12, 12, 9), "M5.7 5.7l12.6 12.6"],
  dog: ["M7 6 3 4v9l4-2m10-5 4-2v9l-4-2", "M7 6c2-2 8-2 10 0v10c0 6-10 6-10 0z", "M10 16h4l-2 2z", "M10 10v1m4-1v1"],
  cat: ["M5 10V3l6 4h2l6-4v7c5 14-19 14-14 0z", "M8 12h1m6 0h1", "M10 16h4m-12-2 5 1m-5 3 5-1m10-2 5-1m-5 3 5 1"],
  construction: ["M8 4h8l4 16H4z", "M7 8h10M6 13h12M3 21h18"],
  quiet: ["M4 10h4l5-5v14l-5-5H4z", "M17 10l5 5m0-5-5 5"],
};

// Official Tabler Icons outline paths, bundled for offline map markers. See assets/icons/route-notes/tabler-outline/LICENSE.txt.
const MAP_ICON_PATHS = {
  "market_map": [
    "M3 21v-13l9 -4l9 4v13",
    "M13 13h4v8h-10v-6h6",
    "M13 21v-9a1 1 0 0 0 -1 -1h-2a1 1 0 0 0 -1 1v3"
  ],
  "note": [
    "M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7",
    "M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3",
    "M9.7 17l4.6 0"
  ],
  "vehicle_entrance": [
    "M5 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "M15 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "M5 17h-2v-6l2 -5h9l4 5h1a2 2 0 0 1 2 2v4h-2m-4 0h-6m-6 -6h15m-6 0v-5"
  ],
  "parking": [
    "M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14",
    "M10 16v-8h2.667c.736 0 1.333 .895 1.333 2s-.597 2 -1.333 2h-2.667"
  ],
  "entrance": [
    "M13 12v.01",
    "M3 21h18",
    "M5 21v-16a2 2 0 0 1 2 -2h6m4 10.5v7.5",
    "M21 7h-7m3 -3l-3 3l3 3"
  ],
  "elevator": [
    "M5 5a1 1 0 0 1 1 -1h12a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-12a1 1 0 0 1 -1 -1l0 -14",
    "M10 10l2 -2l2 2",
    "M10 14l2 2l2 -2"
  ],
  "stairs": [
    "M22 5h-5v5h-5v5h-5v5h-5"
  ],
  "restroom": [
    "M3 10a3 7 0 1 0 6 0a3 7 0 1 0 -6 0",
    "M21 10c0 -3.866 -1.343 -7 -3 -7",
    "M6 3h12",
    "M21 10v10l-3 -1l-3 2l-3 -3l-3 2v-10",
    "M6 10h.01"
  ],
  "dog": [
    "M11 5h2",
    "M19 12c-.667 5.333 -2.333 8 -5 8h-4c-2.667 0 -4.333 -2.667 -5 -8",
    "M11 16c0 .667 .333 1 1 1s1 -.333 1 -1h-2",
    "M12 18v2",
    "M10 11v.01",
    "M14 11v.01",
    "M5 4l6 .97l-6.238 6.688a1.021 1.021 0 0 1 -1.41 .111a.953 .953 0 0 1 -.327 -.954l1.975 -6.815",
    "M19 4l-6 .97l6.238 6.688c.358 .408 .989 .458 1.41 .111a.953 .953 0 0 0 .327 -.954l-1.975 -6.815"
  ],
  "cat": [
    "M20 3v10a8 8 0 1 1 -16 0v-10l3.432 3.432a7.963 7.963 0 0 1 4.568 -1.432c1.769 0 3.403 .574 4.728 1.546l3.272 -3.546",
    "M2 16h5l-4 4",
    "M22 16h-5l4 4",
    "M11 16a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    "M9 11v.01",
    "M15 11v.01"
  ],
  "delivery_spot": [
    "M12 3l8 4.5l0 9l-8 4.5l-8 -4.5l0 -9l8 -4.5",
    "M12 12l8 -4.5",
    "M12 12l0 9",
    "M12 12l-8 -4.5",
    "M16 5.25l-8 4.5"
  ],
  "warning": [
    "M12 9v4",
    "M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0",
    "M12 16h.01"
  ],
  "construction": [
    "M4 20l16 0",
    "M9.4 10l5.2 0",
    "M7.8 15l8.4 0",
    "M6 20l5 -15h2l5 15"
  ],
  "access_code": [
    "M12 10v4",
    "M10 13l4 -2",
    "M10 11l4 2",
    "M5 10v4",
    "M3 13l4 -2",
    "M3 11l4 2",
    "M19 10v4",
    "M17 13l4 -2",
    "M17 11l4 2"
  ],
  "security": [
    "M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06",
    "M15 19l2 2l4 -4"
  ],
  "storage": [
    "M3 21v-13l9 -4l9 4v13",
    "M13 13h4v8h-10v-6h6",
    "M13 21v-9a1 1 0 0 0 -1 -1h-2a1 1 0 0 0 -1 1v3"
  ],
  "walk_in": [
    "M12 4a1 1 0 1 0 2 0a1 1 0 1 0 -2 0",
    "M7 21l3 -4",
    "M16 21l-2 -4l-3 -3l1 -6",
    "M6 12l2 -3l4 -1l3 3l3 1"
  ],
  "unloading": [
    "M5 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "M15 17a2 2 0 1 0 4 0a2 2 0 1 0 -4 0",
    "M5 17h-2v-4m-1 -8h11v12m-4 0h6m4 0h2v-6h-8m0 -5h5l3 5",
    "M3 9l4 0"
  ],
  "locked": [
    "M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6",
    "M11 16a1 1 0 1 0 2 0a1 1 0 0 0 -2 0",
    "M8 11v-4a4 4 0 1 1 8 0v4"
  ],
  "quiet": [
    "M15 8a5 5 0 0 1 1.912 4.934m-1.377 2.602a5 5 0 0 1 -.535 .464",
    "M17.7 5a9 9 0 0 1 2.362 11.086m-1.676 2.299a9 9 0 0 1 -.686 .615",
    "M9.069 5.054l.431 -.554a.8 .8 0 0 1 1.5 .5v2m0 4v8a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l1.294 -1.664",
    "M3 3l18 18"
  ],
  "no_entry": [
    "M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0",
    "M5.7 5.7l12.6 12.6"
  ],
  "important": [
    "M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245"
  ]
};

export function createRouteNoteIcon(documentRef, name) {
  const svg = documentRef.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "route-notes-icon");
  (ICON_PATHS[name] || ICON_PATHS.note).forEach((data) => {
    const path = documentRef.createElementNS(SVG_NS, "path");
    path.setAttribute("d", data);
    svg.append(path);
  });
  return svg;
}
