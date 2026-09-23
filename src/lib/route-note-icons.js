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
  market_map: "warehouse",
  note: "lightbulb", vehicle_entrance: "car-profile", parking: "letter-circle-p", entrance: "door-open",
  elevator: "elevator", stairs: "stairs", restroom: "toilet", dog: "dog", cat: "cat",
  delivery_spot: "package", warning: "warning", construction: "traffic-cone", access_code: "password",
  security: "shield-check", storage: "warehouse", walk_in: "person-simple-walk", unloading: "truck",
  locked: "lock-key", quiet: "speaker-slash", no_entry: "prohibit", important: "star",
});
export const ALERT_MARKERS = new Set(["warning", "important", "no_entry", "construction", "dog", "locked"]);
const SVG_NS = "http://www.w3.org/2000/svg";
const MAP_MARKER_SPRITE = new URL("../../assets/icons/route-notes/phosphor-regular.svg", import.meta.url).href;

export function createRouteNoteMapIcon(documentRef, markerType) {
  const svg = documentRef.createElementNS(SVG_NS, "svg");
  const use = documentRef.createElementNS(SVG_NS, "use");
  svg.setAttribute("viewBox", "0 0 256 256");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "route-notes-map-icon");
  use.setAttribute("href", `${MAP_MARKER_SPRITE}#${MAP_MARKER_ICONS[markerType] || MAP_MARKER_ICONS.note}`);
  svg.append(use);
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
