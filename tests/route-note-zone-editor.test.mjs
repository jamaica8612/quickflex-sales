import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { routeNoteZoneNameKey } from "../src/lib/route-notes.js";
import { routeNoteDetailCodes } from "../src/lib/route-note-rules.js";
import { appendManualPart, appendPostcode, createZoneGeometryHistory, editZonePartLabel, removePart, restorePostcode, ringPoints, setRingPoints, zonePolygons } from "../src/lib/route-note-zone-model.js";

const source = readFileSync(new URL("../src/ui/route-note-zone-editor.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace("export function createRouteNoteZoneEditor", "function createRouteNoteZoneEditor");

class Element {
  constructor(tag, document) { this.tag = tag; this.document = document; this.children = []; this.parent = null; this.listeners = {}; this.hidden = false; this.disabled = false; this.dataset = {}; this.className = ""; this._text = ""; this._value = ""; }
  append(...children) { for (const child of children) { if (!child) continue; child.remove(); child.parent = this; this.children.push(child); } }
  prepend(child) { child.remove(); child.parent = this; this.children.unshift(child); }
  insertBefore(child, next) { child.remove(); child.parent = this; this.children.splice(this.children.indexOf(next), 0, child); }
  replaceChildren(...children) { this.children.forEach((child) => { child.parent = null; }); this.children = []; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  addEventListener(name, callback) { (this.listeners[name] ||= []).push(callback); }
  dispatch(name) { for (const callback of this.listeners[name] || []) callback({ preventDefault() {}, stopPropagation() {}, target: this }); }
  setAttribute(name, value) { this[name] = value; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  get value() { return this._value; }
  set value(value) { this._value = String(value); }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  querySelectorAll(tag) { return this.all().filter((element) => element.tag === tag); }
}

const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const findButton = (host, label) => host.all().find((element) => element.tag === "button" && element.textContent === label);
function fill(host, label, value) {
  const wrapper = host.all().find((element) => element.tag === "label" && element.children[0]?.textContent === label);
  assert.ok(wrapper, `field ${label}`);
  const input = wrapper.children[1]; input.value = value; input.dispatch("input"); return input;
}

test("postcode first, mixed drawing, back confirmation, refit and save review", async () => {
  const document = { createElement: (tag) => new Element(tag, document) };
  const host = document.createElement("main");
  let allowDiscard = false;
  const window = { confirm: () => allowDiscard };
  const calls = { renders: [], saved: [] };
  let mapOptions, ring;
  const map = { render(options) { calls.renders.push(options); }, setRingEditor(options) { ring = options; }, clearRingEditor() { ring = null; }, resize() {}, destroy() {} };
  const createRouteNoteMap = async (options) => { mapOptions = options; return map; };
  const service = {
    async lookupPostcode(postcode) { return { postcode, geometry: { type: "Polygon", coordinates: [[[127, 37], [128, 37], [127, 38], [127, 37]]] } }; },
    async saveZone(input) { calls.saved.push(input); return { ...input, id: "new-zone" }; },
  };
  const context = { document, window, structuredClone, createRouteNoteMap, routeNoteZoneNameKey, routeNoteDetailCodes,
    appendManualPart, appendPostcode, createZoneGeometryHistory, editZonePartLabel, removePart, restorePostcode, ringPoints, setRingPoints, zonePolygons };
  runInNewContext(source, context);
  const editor = context.createRouteNoteZoneEditor({ host, service, zones: [], mapClientId: "fixture" });
  await flush();
  assert.equal(host.all().some((element) => element.tag === "h2"), false, "parent supplies the screen title");
  assert.equal(host.all().find((element) => element.className === "route-note-zone-options").open, false);
  fill(host, "구역 이름", "310C");
  fill(host, "상세 코드", "310C01"); fill(host, "우편번호 5자리", "06236");
  findButton(host, "우편번호 경계 추가").dispatch("click"); await flush();
  assert.equal(calls.renders.at(-1).preserveViewport, false);
  fill(host, "상세 코드", "310C01"); fill(host, "우편번호 5자리", "06237");
  findButton(host, "우편번호 경계 추가").dispatch("click"); await flush();
  assert.equal(calls.renders.at(-1).preserveViewport, false, "new postcode refits map");
  findButton(host, "직접 그린 영역 추가").dispatch("click");
  mapOptions.onCoordinatePick({ lat: 37, lng: 129 });
  assert.equal(editor.handleBack(), true);
  assert.equal(ring.points.length, 1, "declined back preserves drawing");
  assert.ok(host.children[0].children.findIndex((child) => child.className === "route-note-zone-map-card")
    < host.children[0].children.findIndex((child) => child.className === "route-note-zone-content"), "map precedes controls in drawing mode");
  mapOptions.onCoordinatePick({ lat: 37.01, lng: 129 }); mapOptions.onCoordinatePick({ lat: 37.01, lng: 129.01 });
  fill(host, "이 영역의 상세 코드", "310C02");
  findButton(host, "이 영역 사용").dispatch("click");
  findButton(host, "저장 전 확인").dispatch("click");
  findButton(host, "이대로 저장").dispatch("click"); await flush();
  assert.equal(calls.saved.length, 1);
  assert.equal(calls.saved[0].polygon.coordinates.length, 3);
  assert.deepEqual([...calls.saved[0].polygon.postcodes], ["06236", "06237", null]);
  assert.equal(calls.saved[0].polygon.codeGroups[0].prefix, "310C");
  editor.destroy();
});
