import assert from "node:assert/strict";
import test from "node:test";
import { createRouteNoteMap, hasPolygon, polygonCentroid, polygonPoints, polygonRings, toPolygon } from "../src/lib/route-note-map.js";

function mapFixture() {
  const records = { maps: [], polygons: [], markers: [], removedListeners: [] };
  class FakeButton {
    constructor() { this.children = []; this.listeners = new Map(); this.style = { setProperty: () => {} }; this.attributes = {}; }
    append(child) { this.children.push(child); }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    removeEventListener(type, handler) { if (this.listeners.get(type) === handler) this.listeners.delete(type); }
    setAttribute(name, value) { this.attributes[name] = value; }
    emit(type) {
      const event = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      this.listeners.get(type)?.(event);
      return event;
    }
  }
  class LatLng { constructor(lat, lng) { this.latitude = lat; this.longitude = lng; } lat() { return this.latitude; } lng() { return this.longitude; } }
  class LatLngBounds { constructor() { this.points = []; } extend(point) { this.points.push(point); return this; } }
  class FakeMap {
    constructor(element, options) { this.element = element; this.options = options; this.listeners = new Map(); this.fitCalls = []; this.centers = []; records.maps.push(this); }
    fitBounds(bounds, padding) { this.fitCalls.push({ bounds, padding }); }
    setCenter(center) { this.centers.push(center); }
    setZoom() {}
  }
  class Overlay {
    constructor(options) { this.options = options; this.listeners = new Map(); this.setMaps = [options.map]; }
    setMap(value) { this.setMaps.push(value); }
  }
  class Polygon extends Overlay { constructor(options) { super(options); records.polygons.push(this); } }
  class Marker extends Overlay { constructor(options) { super(options); records.markers.push(this); } getPosition() { return this.options.position; } }
  class Polyline extends Overlay {}
  const maps = {
    Map: FakeMap, LatLng, LatLngBounds, Polygon, Marker, Polyline, Point: class { constructor(x, y) { this.x = x; this.y = y; } },
    Event: {
      addListener(target, type, handler) { target.listeners.set(type, handler); return { target, type, handler }; },
      removeListener(listener) { records.removedListeners.push(listener); if (listener.target.listeners.get(listener.type) === listener.handler) listener.target.listeners.delete(listener.type); },
    },
  };
  const document = { createElement: () => new FakeButton(), createElementNS: () => new FakeButton() };
  const element = { ownerDocument: document, replaceChildren() { this.replaced = true; } };
  return { records, maps, element };
}

async function withMapFixture(run) {
  const previousWindow = globalThis.window;
  const fixture = mapFixture();
  globalThis.window = { naver: { maps: fixture.maps } };
  try { await run(fixture); } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

const west = { id: "west", name: "<West>", polygon: { type: "Polygon", coordinates: [[[127, 37], [128, 37], [127, 38], [127, 37]]] } };
const east = { id: "east", name: "East", color: "#0A7", polygon: { type: "Polygon", coordinates: [[[129, 39], [130, 39], [129, 40], [129, 39]]] } };
const multi = { id: "multi", name: "Multi", polygon: { type: "MultiPolygon", coordinates: [
  [[[131, 41], [132, 41], [131, 42], [131, 41]]],
  [[[133, 43], [134, 43], [133, 44], [133, 43]]],
] } };

test("route-note polygon helpers normalize a closed ring without mutating input", () => {
  const points = [{ lat: 37, lng: 127 }, { lat: 37, lng: 128 }, { lat: 38, lng: 127 }];
  const polygon = toPolygon(points);
  assert.equal(polygon.coordinates[0].length, 4);
  assert.deepEqual(points, [{ lat: 37, lng: 127 }, { lat: 37, lng: 128 }, { lat: 38, lng: 127 }]);
  assert.equal(hasPolygon(polygon), true);
  assert.equal(polygonPoints(polygon).length, 4);
});

test("route-note polygon helpers reject incomplete or malformed geometry", () => {
  assert.equal(toPolygon([{ lat: 1, lng: 2 }, { lat: 2, lng: 3 }]), null);
  assert.equal(hasPolygon({ type: "Polygon", coordinates: [[ ["x", 1] ]] }), false);
  assert.equal(polygonCentroid(null), null);
});

test("route-note polygon helpers retain separate multipolygon paths and interior rings", () => {
  const multi = { type: "MultiPolygon", coordinates: [
    [[[127, 37], [128, 37], [127, 38], [127, 37]], [[127.2, 37.2], [127.3, 37.2], [127.2, 37.3], [127.2, 37.2]]],
    [[[129, 39], [130, 39], [129, 40], [129, 39]]],
  ] };
  const rings = polygonRings(multi);
  assert.equal(rings.length, 2);
  assert.equal(rings[0].length, 2);
  assert.equal(rings[1].length, 1);
  assert.equal(polygonPoints(multi).length, 12);
});

test("route-note map renders a selectable multi-zone overview without built-in zoom controls", async () => {
  await withMapFixture(async ({ records, element }) => {
    const selected = []; const picked = []; const openedTips = [];
    const adapter = await createRouteNoteMap({ element, clientId: "fixture", onZoneSelect: (zone) => selected.push(zone.id), onCoordinatePick: (point) => picked.push(point), onTipSelect: (tip) => openedTips.push(tip.id) });
    const padding = { top: 72, right: 16, bottom: 280, left: 16 };
    adapter.render({ zones: [west, east, multi, { id: "invalid", polygon: null }], tips: [{ id: "valid", lat: 37.5, lng: 127.5 }, { id: "skip", lat: null, lng: 127.5 }], padding });
    const map = records.maps[0];
    assert.equal(map.options.zoomControl, false);
    assert.equal(records.polygons.length, 4);
    assert.equal(map.fitCalls[0].bounds.points.length, 16);
    assert.deepEqual(map.fitCalls[0].padding, padding);
    const labels = records.markers.filter((marker) => marker.options.icon?.content?.className === "route-notes-map-zone-label");
    assert.equal(labels.length, 4);
    assert.equal(labels[0].options.icon.content.textContent, "<West>");
    assert.equal(typeof labels[0].options.icon.content, "object");
    assert.equal(labels[0].options.icon.content.type, undefined);
    assert.equal(labels[0].options.icon.anchor.x, 0);
    assert.equal(labels[0].options.icon.anchor.y, 0);
    assert.equal(labels[0].options.clickable, false);
    assert.equal(labels[0].options.icon.content.listeners.size, 0);
    assert.equal(labels[0].options.icon.content.attributes["aria-label"], undefined);
    assert.deepEqual(labels.slice(2).map((item) => item.options.icon.content.textContent), ["Multi", "Multi"]);
    assert.equal(records.markers.filter((marker) => marker.options.icon?.content?.className === "route-notes-map-tip-marker").length, 1);
    records.polygons[1].listeners.get("click")();
    assert.deepEqual(selected, ["east"]);
    assert.equal(records.polygons[1].options.fillColor, "#0A7");
    records.markers.find((marker) => marker.options.icon?.content?.className === "route-notes-map-tip-marker").options.icon.content.emit("click");
    assert.deepEqual(openedTips, ["valid"]);
    const event = labels[0].options.icon.content.emit("click");
    assert.equal(event.prevented, false);
    assert.equal(event.stopped, false);
    map.listeners.get("click")({ coord: { lat: () => 37, lng: () => 127 } });
    assert.deepEqual(picked, []);
    await Promise.resolve();
    map.listeners.get("click")({ coord: { lat: () => 37, lng: () => 127 } });
    assert.deepEqual(picked, [{ lat: 37, lng: 127 }]);
  });
});

test("route-note map shows one label per connected detail-code piece even without zone selection", async () => {
  await withMapFixture(async ({ records, element }) => {
    const first = [[127,37],[128,37],[128,38],[127,38],[127,37]];
    const joined = [[128,37],[129,37],[129,38],[128,38],[128,37]];
    const remote = [[131,41],[132,41],[132,42],[131,42],[131,41]];
    const geometry = { type: "MultiPolygon", coordinates: [[first],[joined],[remote]], subLabels: ["303A01", "303A01", "303A01"] };
    const original = structuredClone(geometry);
    const adapter = await createRouteNoteMap({ element, clientId: "fixture" });
    adapter.render({ zones: [{ id: "details", name: "Parent", polygon: geometry }] });
    const labels = records.markers.filter((item) => item.options.icon?.content?.className === "route-notes-map-zone-label");
    assert.equal(labels.length, 2);
    assert.deepEqual(labels.map((item) => item.options.icon.content.textContent), ["303A01", "303A01"]);
    assert.ok(labels.every((item) => item.options.clickable === false && item.options.icon.content.listeners.size === 0));
    assert.ok(records.polygons.every((item) => item.options.clickable === false));
    assert.deepEqual(geometry, original);
    adapter.destroy();
    assert.ok(labels.every((item) => item.setMaps.at(-1) === null));
  });
});

test("route-note map renders only the selected zone, its pins, and its bounds", async () => {
  await withMapFixture(async ({ records, element }) => {
    const adapter = await createRouteNoteMap({ element, clientId: "fixture", onZoneSelect: () => {} });
    adapter.render({ zones: [west, east, multi], selectedZoneId: "east", tips: [
      { id: "east-tip", zone_id: "east", title: "East tip", lat: 39.5, lng: 129.5 },
      { id: "west-tip", zone_id: "west", title: "West tip", lat: 37.5, lng: 127.5 },
      { id: "unassigned", title: "Unassigned", lat: 39.6, lng: 129.6 },
    ] });
    const map = records.maps[0];
    assert.equal(map.fitCalls[0].bounds.points.length, 4);
    assert.equal(records.polygons.length, 1);
    assert.equal(records.polygons[0].options.strokeWeight, 2);
    const labels = records.markers.filter((marker) => marker.options.icon?.content?.className === "route-notes-map-zone-label");
    assert.equal(labels.length, 1);
    assert.equal(labels[0].options.icon.content.textContent, "East");
    const pins = records.markers.filter((marker) => marker.options.icon?.content?.className === "route-notes-map-tip-marker");
    assert.equal(pins.length, 1);
    assert.equal(pins[0].options.title, "East tip");
    const firstRenderOverlays = [...records.polygons, ...records.markers];
    adapter.render({ zones: [west, east], preserveViewport: true });
    assert.equal(map.fitCalls.length, 1);
    assert.ok(firstRenderOverlays.every((overlay) => overlay.setMaps.includes(null)));
    assert.ok(records.removedListeners.length >= 1);
    adapter.destroy();
    assert.equal(element.replaced, true);
    assert.ok(records.polygons.slice(1).every((overlay) => overlay.setMaps.includes(null)));

    const editorAdapter = await createRouteNoteMap({ element, clientId: "fixture" });
    editorAdapter.render({ zone: west });
    assert.equal(records.polygons.at(-1).options.clickable, false);
    assert.equal(records.markers.at(-1).options.icon.content.textContent, "<West>");
  });
});

test("route-note map leaves the map empty for an absent or invalid requested selection", async () => {
  await withMapFixture(async ({ records, element }) => {
    const adapter = await createRouteNoteMap({ element, clientId: "fixture", onZoneSelect: () => {} });
    const tips = [
      { id: "west-tip", zone_id: "west", title: "West tip", lat: 37.5, lng: 127.5 },
      { id: "legacy-tip", title: "Legacy tip", lat: 37.6, lng: 127.6 },
    ];
    adapter.render({ zones: [west, east], selectedZoneId: null, tips });
    const map = records.maps[0];
    assert.equal(records.polygons.length, 0);
    assert.equal(records.markers.length, 0);
    assert.equal(map.fitCalls.length, 0);
    assert.equal(map.centers.length, 0);

    adapter.render({ zones: [west, east], selectedZoneId: "missing", tips });
    assert.equal(records.polygons.length, 0);
    assert.equal(records.markers.length, 0);
    assert.equal(map.fitCalls.length, 0);
    assert.equal(map.centers.length, 0);
  });
});

test("route-note map preserves matching pins for a selected name-only zone", async () => {
  await withMapFixture(async ({ records, element }) => {
    const nameOnly = { id: "name-only", name: "Name only", polygon: null };
    const adapter = await createRouteNoteMap({ element, clientId: "fixture" });
    adapter.render({ zones: [west, nameOnly], selectedZoneId: nameOnly.id, tips: [
      { id: "matching", zone_id: nameOnly.id, title: "Matching tip", lat: 36.5, lng: 128.5 },
      { id: "other", zone_id: west.id, title: "Other tip", lat: 37.5, lng: 127.5 },
    ] });
    const map = records.maps[0];
    assert.equal(records.polygons.length, 0);
    assert.equal(records.markers.length, 1);
    assert.equal(records.markers[0].options.title, "Matching tip");
    assert.equal(map.fitCalls.length, 0);
    assert.equal(map.centers.length, 1);
    assert.equal(map.centers[0].latitude, 36.5);
    assert.equal(map.centers[0].longitude, 128.5);
  });
});

test("custom tip markers keep safe labels, selection, keyboard activation and listener cleanup", async () => {
  await withMapFixture(async ({ records, element }) => {
    const opened = [], picked = [];
    const tip = { id: "tip", zone_id: east.id, title: "<주차 안내>", marker_type: "warning", lat: 39.5, lng: 129.5 };
    const adapter = await createRouteNoteMap({ element, clientId: "fixture", onTipSelect: (item) => opened.push(item.id), onCoordinatePick: (point) => picked.push(point) });
    adapter.render({ zone: east, tips: [tip], selectedTipId: tip.id });
    const marker = records.markers.find((item) => item.options.icon?.content?.className === "route-notes-map-tip-marker"), control = marker.options.icon.content;
    assert.equal(control.type, "button");
    assert.equal(control.attributes["aria-label"], "<주차 안내> 메모 보기");
    assert.equal(control.attributes["aria-pressed"], "true");
    assert.equal(control.attributes["data-alert"], "true");
    assert.equal(control.children[0].attributes["viewBox"], "0 0 24 24");
    assert.equal(control.emit("keydown").stopped, true);
    control.emit("click");
    assert.deepEqual(opened, ["tip"]);
    records.maps[0].listeners.get("click")({ coord: { lat: () => 39.5, lng: () => 129.5 } });
    assert.equal(picked.length, 0);
    adapter.destroy();
    assert.equal(control.listeners.size, 0);
  });
});

test("route-note map retains the share page's single-zone render contract", async () => {
  await withMapFixture(async ({ records, element }) => {
    const adapter = await createRouteNoteMap({ element, clientId: "fixture" });
    adapter.render({ zone: east, tips: [
      { id: "east-tip", zone_id: "east", title: "East tip", lat: 39.5, lng: 129.5 },
      { id: "west-tip", zone_id: "west", title: "West tip", lat: 37.5, lng: 127.5 },
    ] });
    const map = records.maps[0];
    assert.equal(records.polygons.length, 1);
    assert.equal(records.markers.length, 2);
    assert.equal(records.markers.find((item) => item.options.icon?.content?.className === "route-notes-map-tip-marker").options.title, "East tip");
    assert.equal(map.fitCalls[0].bounds.points.length, 4);
  });
});

test("ring editor reports moves and selections, retains draft across render, and cleans listeners", async () => {
  await withMapFixture(async ({ records, maps, element }) => {
    const moves = [], selections = [], picks = [];
    const adapter = await createRouteNoteMap({ element, onCoordinatePick: (point) => picks.push(point) });
    const points = [{ lat: 37, lng: 127 }, { lat: 37, lng: 128 }, { lat: 38, lng: 127 }];
    adapter.setRingEditor({ points, closed: true, selectedIndex: 1, onMove: (...args) => moves.push(args), onSelect: (index) => selections.push(index) });
    const marker = records.markers[1], control = marker.options.icon.content;
    assert.equal(marker.options.draggable, true);
    assert.equal(control.attributes["aria-pressed"], "true");
    control.emit("click"); assert.deepEqual(selections, [1]);
    marker.options.position = new maps.LatLng(37.2, 127.8);
    marker.listeners.get("dragend")();
    assert.deepEqual(moves, [[1, { lat: 37.2, lng: 127.8 }]]);
    assert.deepEqual(points[1], { lat: 37, lng: 128 });
    records.maps[0].listeners.get("click")({ coord: new maps.LatLng(37.2, 127.8) });
    assert.equal(picks.length, 0);
    adapter.render({ zone: west }); assert.equal(marker.setMaps.includes(null), false);
    adapter.clearRingEditor(); assert.equal(marker.setMaps.at(-1), null); assert.equal(control.listeners.size, 0);
    await Promise.resolve();
    records.maps[0].listeners.get("longpress")({ coord: new maps.LatLng(37.2, 127.8) });
    assert.deepEqual(picks, [{ lat: 37.2, lng: 127.8 }]);
    adapter.destroy(); assert.equal(records.maps[0].listeners.size, 0);
  });
});
