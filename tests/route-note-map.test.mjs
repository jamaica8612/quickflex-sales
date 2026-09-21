import assert from "node:assert/strict";
import test from "node:test";
import { createRouteNoteMap, hasPolygon, polygonCentroid, polygonPoints, polygonRings, toPolygon } from "../src/lib/route-note-map.js";

function mapFixture() {
  const records = { maps: [], polygons: [], markers: [], removedListeners: [] };
  class FakeButton {
    constructor() { this.listeners = new Map(); this.style = { setProperty: () => {} }; this.attributes = {}; }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    removeEventListener(type, handler) { if (this.listeners.get(type) === handler) this.listeners.delete(type); }
    setAttribute(name, value) { this.attributes[name] = value; }
    emit(type) {
      const event = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
      this.listeners.get(type)?.(event);
      return event;
    }
  }
  class LatLng { constructor(lat, lng) { this.latitude = lat; this.longitude = lng; } }
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
  class Marker extends Overlay { constructor(options) { super(options); records.markers.push(this); } }
  class Polyline extends Overlay {}
  const maps = {
    Map: FakeMap, LatLng, LatLngBounds, Polygon, Marker, Polyline,
    Event: {
      addListener(target, type, handler) { target.listeners.set(type, handler); return { target, type, handler }; },
      removeListener(listener) { records.removedListeners.push(listener); if (listener.target.listeners.get(listener.type) === listener.handler) listener.target.listeners.delete(listener.type); },
    },
  };
  const document = { createElement: () => new FakeButton() };
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
    const labels = records.markers.filter((marker) => marker.options.icon?.content);
    assert.equal(labels.length, 3);
    assert.equal(labels[0].options.icon.content.textContent, "<West>");
    assert.equal(typeof labels[0].options.icon.content, "object");
    assert.equal(records.markers.filter((marker) => !marker.options.icon).length, 1);
    records.polygons[1].listeners.get("click")();
    assert.deepEqual(selected, ["east"]);
    assert.equal(records.polygons[1].options.fillColor, "#0A7");
    records.markers.find((marker) => !marker.options.icon).listeners.get("click")();
    assert.deepEqual(openedTips, ["valid"]);
    const event = labels[0].options.icon.content.emit("click");
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    map.listeners.get("click")({ coord: { lat: () => 37, lng: () => 127 } });
    assert.deepEqual(picked, []);
    await Promise.resolve();
    map.listeners.get("click")({ coord: { lat: () => 37, lng: () => 127 } });
    assert.deepEqual(picked, [{ lat: 37, lng: 127 }]);
  });
});

test("route-note map emphasizes the selected zone and disposes replaced overlays", async () => {
  await withMapFixture(async ({ records, element }) => {
    const adapter = await createRouteNoteMap({ element, clientId: "fixture", onZoneSelect: () => {} });
    adapter.render({ zones: [west, east], selectedZoneId: "east" });
    const map = records.maps[0];
    assert.equal(map.fitCalls[0].bounds.points.length, 4);
    assert.equal(records.polygons[0].options.strokeWeight, 2);
    assert.equal(records.polygons[1].options.strokeWeight, 4);
    const firstRenderOverlays = [...records.polygons, ...records.markers];
    adapter.render({ zones: [west, east], preserveViewport: true });
    assert.equal(map.fitCalls.length, 1);
    assert.ok(firstRenderOverlays.every((overlay) => overlay.setMaps.includes(null)));
    assert.ok(records.removedListeners.length >= 2);
    adapter.destroy();
    assert.equal(element.replaced, true);
    assert.ok(records.polygons.slice(2).every((overlay) => overlay.setMaps.includes(null)));

    const editorAdapter = await createRouteNoteMap({ element, clientId: "fixture" });
    editorAdapter.render({ zone: west });
    assert.equal(records.polygons.at(-1).options.clickable, false);
    assert.equal(records.markers.length, 4);
  });
});
