import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { MARKER_ICONS, ALERT_MARKERS, createRouteNoteIcon, createRouteNoteMapIcon } from "../src/lib/route-note-icons.js";
import { appendAgriculturalMarketTip, isAgriculturalMarketTip, isAgriculturalMarketZone } from "../src/lib/agricultural-market-route-map.js";
import { routeNoteZoneNameKey } from "../src/lib/route-notes.js";
import { isPointInRouteNoteZone } from "../src/lib/route-note-rules.js";

const source = readFileSync(new URL("../src/ui/route-notes.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "")
  .replace("export function fixedRouteZoneIds", "function fixedRouteZoneIds")
  .replace("export function createRouteNotesController", "function createRouteNotesController");

class Element {
  constructor(tag, document) {
    this.tag = tag.toLowerCase(); this.document = document; this.children = []; this.parent = null;
    this.attributes = {}; this.dataset = {}; this.listeners = new Map(); this.style = { setProperty() {}, removeProperty() {} };
    this.className = ""; this.hidden = false; this.disabled = false; this.text = ""; this.files = [];
  }
  append(...children) { children.flat().filter(Boolean).forEach((child) => { child.parent = this; this.children.push(child); }); }
  replaceChildren(...children) { this.children = []; this.text = ""; this.append(...children); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.parent = null; }
  get childNodes() { return this.children; }
  get lastChild() { return this.children.at(-1); }
  get isConnected() { return this === this.document.body || Boolean(this.parent?.isConnected); }
  setAttribute(name, value) { this.attributes[name] = String(value); if (name === "class") this.className = String(value); }
  getAttribute(name) { return this.attributes[name] ?? null; }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  dispatch(type, extra = {}) {
    const event = { currentTarget: this, target: this, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...extra };
    let result; let current = this;
    while (current) {
      event.currentTarget = current;
      result = current.listeners.get(type)?.(event) ?? result;
      if (event.propagationStopped) break;
      current = current.parent;
    }
    return result;
  }
  contains(target) { return this === target || this.children.some((child) => child.contains(target)); }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  matches(selector) {
    if (selector.startsWith("#")) return this.attributes.id === selector.slice(1);
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    if (selector.startsWith("[")) return Object.hasOwn(this.attributes, selector.slice(1, -1));
    return this.tag === selector.toLowerCase();
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const selectors = selector.split(",").map((item) => item.trim());
    return this.all().filter((child) => selectors.some((item) => child.matches(item)));
  }
  focus() { this.document.activeElement = this; }
  blur() { if (this.document.activeElement === this) this.document.activeElement = null; }
  scrollIntoView() {}
  getBoundingClientRect() { return { height: 360 }; }
  get clientHeight() { return this.tag === "section" ? 720 : 0; }
  get offsetHeight() { return 48; }
  get offsetWidth() { return 320; }
  get textContent() { return this.text + this.children.map((child) => child.textContent).join(""); }
  set textContent(value) { this.text = String(value); this.children = []; }
  get value() {
    if (this._value != null) return this._value;
    if (this.tag === "textarea") return this.text;
    if (this.tag === "select") return this.children.find((child) => child.selected)?.value || this.children[0]?.value || "";
    return this.attributes.value || "";
  }
  set value(value) { this._value = String(value); }
  get elements() {
    const fields = this.all().filter((child) => ["input", "textarea", "select"].includes(child.tag));
    return Object.assign(fields, Object.fromEntries(fields.flatMap((field) => [field.attributes.name, field.attributes.id].filter(Boolean).map((key) => [key, field]))));
  }
}

function createDocument() {
  const document = { activeElement: null, listeners: new Map(), visibilityState: "visible" };
  document.body = new Element("body", document);
  document.createElement = (tag) => new Element(tag, document);
  document.createElementNS = (_namespace, tag) => new Element(tag, document);
  document.addEventListener = (type, handler) => document.listeners.set(type, handler);
  return document;
}

const flush = async () => { for (let index = 0; index < 6; index += 1) await Promise.resolve(); };
const click = async (element) => { await element.dispatch("click"); await flush(); };
const visible = (element) => !element.hidden && (!element.parent || visible(element.parent));
const button = (root, text) => root.all().find((element) => element.tag === "button" && element.textContent === text && visible(element));
const byClass = (root, className) => root.all().find((element) => element.className.split(/\s+/).includes(className));

function setup({ confirm = () => true, mapFactory, extraTips = [], shareDialog, marketZone = false } = {}) {
  const document = createDocument(); const root = document.createElement("main"); document.body.append(root);
  const windowListeners = new Map();
  const window = { innerHeight: 800, location: { href: "https://example.invalid/" }, visualViewport: { height: 800, addEventListener() {} }, addEventListener(type, handler) { windowListeners.set(type, handler); }, matchMedia: () => ({ matches: false }), confirm };
  let zones = [
    { id: "zone-a", created_by: "user", name: "A 구역", memo: "A 안내", polygon: { type: "Polygon", coordinates: [[[127, 37], [128, 37], [127, 38], [127, 37]]] } },
    { id: "zone-b", created_by: "other", name: "B 구역", memo: "B 안내", polygon: { type: "Polygon", coordinates: [[[129, 39], [130, 39], [129, 40], [129, 39]]] } },
  ];
  if (marketZone) zones[0] = { ...zones[0], name: "311CD322D" };
  let tips = [
    { id: "tip-a", zone_id: "zone-a", created_by: "user", title: "A 메모", memo: "A 내용", marker_type: "note", lat: 37.5, lng: 127.5, photos: [] },
    { id: "tip-b", zone_id: "zone-b", created_by: "user", title: "B 메모", memo: "B 내용", marker_type: "note", lat: 39.5, lng: 129.5, photos: [] },
  ];
  tips.push(...extraTips);
  const calls = { loadZone: [], saveTip: [], saveZone: [], deleteZone: [], maps: [], zoneEditors: [], marketRouteMaps: [] };
  const service = {
    async load() { return { company: { id: "company", name: "회사" }, membership: { company_id: "company", role: "member" }, zones, favorites: [] }; },
    async loadZone(id) { calls.loadZone.push(id); return { zone: zones.find((zone) => zone.id === id), tips: tips.filter((tip) => tip.zone_id === id), zonePhotos: [] }; },
    async saveTip(input) { calls.saveTip.push(input); const saved = { ...input, id: input.id || "saved-tip", created_by: "user", author_name: "나", photos: [] }; tips = [...tips.filter((tip) => tip.id !== saved.id), saved]; return saved; },
    async saveZone(input) { calls.saveZone.push(input); const saved = { ...input, id: input.id || "saved-zone", created_by: "user" }; zones = [...zones.filter((zone) => zone.id !== saved.id), saved]; return saved; },
    async deleteZone(id) { calls.deleteZone.push(id); zones = zones.filter((zone) => zone.id !== id); },
    async uploadTipPhoto() {}, async setFavorite() {}, async deleteTip(id) { tips = tips.filter((tip) => tip.id !== id); }, async deleteTipPhoto() {},
  };
  const createRouteNoteMap = (...args) => {
    calls.maps.push(args);
    return mapFactory ? mapFactory(...args) : Promise.resolve({ render(value) { calls.mapRenders = [...(calls.mapRenders || []), value]; }, destroy() {}, locate: async () => {} });
  };
  const createRouteNoteZoneEditor = (options) => {
    const editor = {
      options, dirty: false, destroyed: false, backHandled: false,
      isDirty() { return this.dirty; }, canClose() { return !this.dirty || confirm(); },
      handleBack() { return this.backHandled; }, resize() {}, destroy() { this.destroyed = true; },
      async save(input) { const saved = await options.service.saveZone(input); options.onSaved(saved); return saved; },
      async delete() { await options.service.deleteZone(options.zone.id, options.zone.updated_at); options.onDeleted(options.zone.id); },
    };
    options.host.append(document.createElement("section"));
    calls.zoneEditors.push(editor);
    return editor;
  };
  const context = { document, window, AbortController, Promise, URL, console, CSS: { escape: (value) => value },
    MARKER_ICONS, ALERT_MARKERS, createRouteNoteIcon, createRouteNoteMapIcon, routeNoteZoneNameKey, isPointInRouteNoteZone, appendAgriculturalMarketTip, isAgriculturalMarketTip, isAgriculturalMarketZone,
    openAgriculturalMarketRouteMap: (options = {}) => { const entry = { options, closed: false }; calls.marketRouteMaps.push(entry); return { close() { entry.closed = true; options.onClose?.(); } }; },
    createRouteNoteZoneEditor, createRouteNoteMap, hasPolygon: (polygon) => Boolean(polygon?.coordinates?.length), ROUTE_NOTE_MARKER_TYPES: ["note", "parking"], parseScheduleRoutes: () => [] };
  runInNewContext(source, context, { filename: "route-notes.js" });
  const notifications = [];
  const controller = context.createRouteNotesController({ root, service, shareDialog, getUser: () => ({ id: "user" }), getProfile: () => ({ id: "user", status: "approved", driver_type: "backup" }), notify: (...args) => notifications.push(args), mapClientId: "fixture" });
  return { root, document, windowListeners, controller, calls, notifications };
}

async function openZone(view, zoneName = "A 구역") {
  await view.controller.open(); await flush();
  const zoneButton = view.root.all().find((element) => element.className.split(/\s+/).includes("route-notes-zone-main") && element.textContent.includes(zoneName));
  assert.ok(zoneButton, `zone button for ${zoneName}`);
  await click(zoneButton);
}

async function openTipForm(view) {
  await click(button(view.root, "팁 쓰기"));
  view.calls.maps[0][0].onCoordinatePick({ lat: 37.2, lng: 127.2 }); await flush();
  await click(button(view.root, "여기에 팁 쓰기"));
  const form = byClass(view.root, "route-notes-form");
  assert.ok(form, "tip form is visible");
  return form;
}

test("selecting a zone defaults to peek and sends only its zone and tips to the map", async () => {
  const view = setup();
  await openZone(view);
  const sheet = byClass(view.root, "route-notes-sheet");
  assert.equal(sheet.dataset.snap, "peek");
  const render = view.calls.mapRenders.at(-1);
  assert.deepEqual([...render.zones.map((zone) => zone.id)], ["zone-a"]);
  assert.equal(render.zone.id, "zone-a");
  assert.equal(render.selectedZoneId, "zone-a");
  assert.deepEqual([...render.tips.map((tip) => tip.id)], ["tip-a"]);
  assert.equal(view.document.activeElement, byClass(view.root, "route-notes-sheet-toggle"));
});

test("a map marker opens only its own tip and preserves author controls, photos and the map viewport", async () => {
  const tip = { id: "tip-a2", zone_id: "zone-a", created_by: "other", author_name: "동료", title: "동문 출입구", memo: "동문으로 진입", marker_type: "entrance", lat: 37.6, lng: 127.6, photos: [{ url: "https://example.invalid/entrance.jpg" }] };
  const view = setup({ extraTips: [tip] }); await openZone(view);
  view.calls.maps[0][0].onTipSelect(tip); await flush();
  assert.equal(view.root.querySelectorAll(".route-notes-pin-popup").length, 1);
  assert.equal(view.root.querySelectorAll(".route-notes-tip").length, 0);
  assert.ok(view.root.querySelector("#routeNoteTip-tip-a2"));
  assert.doesNotMatch(view.root.textContent, /A 내용/);
  assert.match(view.root.textContent, /동료/);
  assert.equal(view.root.querySelectorAll("img").length, 1);
  assert.equal(view.root.all().filter((element) => element.getAttribute("aria-label") === "팁 수정").length, 0);
  assert.equal(view.calls.mapRenders.at(-1).selectedTipId, tip.id);
  assert.equal(view.calls.mapRenders.at(-1).preserveViewport, true);
  await click(button(view.root, "자세히"));
  assert.equal(view.root.querySelectorAll(".route-notes-tip").length, 1);
  assert.match(view.root.textContent, /작성자 · 동료/);
  assert.equal(view.controller.handleBack(), true);
  assert.equal(view.root.querySelectorAll(".route-notes-pin-popup").length, 0);
  assert.equal(view.calls.mapRenders.at(-1).selectedTipId, null);
});

test("a selected pin can be shared without opening the full tip list", async () => {
  const shares = [];
  const view = setup({ shareDialog: { open: (value) => shares.push(value), reset() {} } }); await openZone(view);
  const tip = view.calls.mapRenders.at(-1).tips[0];
  view.calls.maps[0][0].onTipSelect(tip); await flush();
  await click(button(view.root, "공유"));
  assert.equal(shares[0].zone.id, "zone-a");
  assert.equal(shares[0].tip.id, "tip-a");
  assert.equal(view.root.querySelectorAll(".route-notes-pin-popup").length, 1);
});

test("311CD322D receives the agricultural market marker and opens its dedicated map", async () => {
  const view = setup({ marketZone: true });
  await openZone(view, "311CD322D");
  const render = view.calls.mapRenders.at(-1);
  const marketTip = render.tips.find((tip) => tip.id === "agricultural-market-route-map");
  assert.ok(marketTip);
  assert.equal(marketTip.marker_type, "market_map");
  view.calls.maps[0][0].onTipSelect(marketTip); await flush();
  assert.match(view.root.textContent, /반여농산물시장/);
  await click(button(view.root, "시장 지도 열기"));
  assert.equal(view.calls.marketRouteMaps.length, 1);
});

test("searching a tip opens its compact popup and deletion returns to the map", async () => {
  const tip = { id: "tip-a2", zone_id: "zone-a", created_by: "user", title: "동문 출입구", memo: "선택할 메모", marker_type: "note", photos: [] };
  const view = setup({ extraTips: [tip] }); await openZone(view);
  const search = byClass(view.root, "route-notes-search"); search.value = "동문"; search.dispatch("input");
  await click(byClass(view.root, "route-notes-suggest-row"));
  assert.equal(view.root.querySelectorAll(".route-notes-pin-popup").length, 1);
  assert.ok(view.root.querySelector("#routeNoteTip-tip-a2"));
  await click(button(view.root, "자세히"));
  await click(view.root.all().find((element) => element.getAttribute("aria-label") === "팁 수정"));
  await click(button(view.root, "팁 삭제"));
  assert.equal(view.root.querySelectorAll(".route-notes-pin-popup").length, 0);
  assert.equal(view.calls.mapRenders.at(-1).selectedTipId, null);
});

test("zone editor callbacks create and delete member zones; only owned zones expose editing", async () => {
  const view = setup(); await view.controller.open(); await flush();
  await click(button(view.root, "구역 만들기"));
  const creator = view.calls.zoneEditors.at(-1);
  assert.equal(creator.options.zone, null);
  assert.equal(creator.options.canDelete, false);
  await creator.save({ name: "303A", memo: "", polygon: null }); await flush();
  assert.equal(view.calls.saveZone.length, 1);
  await click(view.root.all().find((element) => element.getAttribute("aria-label") === "구역 수정" && visible(element)));
  const editor = view.calls.zoneEditors.at(-1);
  assert.equal(editor.options.zone.id, "saved-zone");
  assert.equal(editor.options.canDelete, true);
  editor.dirty = true;
  assert.equal(view.controller.isDirty(), true);
  editor.backHandled = true;
  assert.equal(view.controller.handleBack(), true);
  assert.equal(view.calls.zoneEditors.at(-1), editor);
  await editor.delete(); await flush();
  assert.deepEqual(view.calls.deleteZone, ["saved-zone"]);
  await openZone(view, "B 구역");
  assert.equal(view.root.all().filter((element) => element.getAttribute("aria-label") === "구역 수정" && visible(element)).length, 0);
});

test("map tap rejects outside points and offers tip registration inside the selected zone", async () => {
  const view = setup(); await openZone(view);
  const pick = view.calls.maps[0][0].onCoordinatePick;
  pick({ lat: 40, lng: 130 }); await flush();
  assert.match(view.notifications.at(-1)[0], /경계 안에서/);
  assert.equal(button(view.root, "여기에 팁 쓰기"), undefined);
  pick({ lat: 37.2, lng: 127.2 }); await flush();
  assert.ok(button(view.root, "여기에 팁 쓰기"));
  await click(button(view.root, "여기에 팁 쓰기"));
  const form = byClass(view.root, "route-notes-form");
  assert.equal(form.elements.routeNoteTipLat.value, "37.2");
  assert.equal(form.elements.routeNoteTipLng.value, "127.2");
  assert.match(form.textContent, /지도에서 선택한 위치의 배송 팁/);
});

test("choosing a tip location keeps its draft and files, then common tip clears coordinates", async () => {
  const view = setup(); await openZone(view); const form = await openTipForm(view);
  form.elements.routeNoteTipTitle.value = "현관 위치"; form.elements.routeNoteTipTitle.dispatch("input");
  form.elements.routeNoteTipMemo.value = "전화 먼저"; form.elements.routeNoteTipMemo.dispatch("input");
  const file = { name: "door.jpg", type: "image/jpeg", size: 123 };
  form.elements.routeNoteTipPhoto.files = [file];
  await click(button(view.root, "위치 수정"));
  view.calls.maps.at(-1)[0].onCoordinatePick({ lat: 37.25, lng: 127.25 }); await flush();
  assert.equal(byClass(view.root, "route-notes-form"), form);
  assert.equal(form.elements.routeNoteTipTitle.value, "현관 위치");
  assert.equal(form.elements.routeNoteTipMemo.value, "전화 먼저");
  assert.equal(form.elements.routeNoteTipPhoto.files[0], file);
  assert.equal(form.elements.routeNoteTipLat.value, "37.25");
  assert.equal(form.elements.routeNoteTipLng.value, "127.25");
  await click(button(view.root, "위치 없이 공통 팁으로"));
  assert.equal(form.elements.routeNoteTipLat.value, "");
  assert.equal(form.elements.routeNoteTipLng.value, "");
  assert.equal(form.elements.routeNoteTipPhoto.files[0], file);
  form.elements.routeNoteTipPhoto.files = [];
  await form.dispatch("submit"); await flush();
  assert.equal(view.calls.saveTip.at(-1).lat, null);
  assert.equal(view.calls.saveTip.at(-1).lng, null);
});

test("adjusting a tip position preserves unsaved input", async () => {
  const view = setup(); await openZone(view); const form = await openTipForm(view);
  const title = form.elements.routeNoteTipTitle; title.value = "계속 작성"; title.dispatch("input");
  await click(button(view.root, "위치 수정"));
  view.windowListeners.get("resize")();
  assert.equal(byClass(view.root, "route-notes-sheet").dataset.snap, "peek");
  view.calls.maps.at(-1)[0].onCoordinatePick({ lat: 37.25, lng: 127.25 }); await flush();
  assert.equal(byClass(view.root, "route-notes-form").elements.routeNoteTipTitle.value, "계속 작성");
});

test("a successful tip save reloads the detail without abandoning its own in-flight draft", async () => {
  const view = setup({ confirm: () => false }); await openZone(view); const form = await openTipForm(view);
  form.elements.routeNoteTipTitle.value = "저장한 메모"; form.elements.routeNoteTipTitle.dispatch("input");
  assert.equal(view.controller.isDirty(), true);
  await form.dispatch("submit"); await flush();
  assert.doesNotMatch(String(view.notifications.at(-1)?.[0] || ""), /한 줄 설명을 입력/);
  assert.equal(view.calls.saveTip.length, 1);
  assert.deepEqual(view.calls.loadZone, ["zone-a", "zone-a"]);
  assert.equal(view.calls.saveTip[0].title, "저장한 메모");
  assert.ok(view.notifications.some(([message]) => message === "구역 팁을 저장했습니다."));
});

test("declining cancel keeps a dirty tip draft in place", async () => {
  const view = setup({ confirm: () => false }); await openZone(view); const form = await openTipForm(view);
  form.elements.routeNoteTipTitle.value = "남겨 둘 메모"; form.elements.routeNoteTipTitle.dispatch("input");
  assert.equal(view.controller.isDirty(), true);
  await click(button(view.root, "취소"));
  assert.ok(byClass(view.root, "route-notes-form"));
  assert.equal(byClass(view.root, "route-notes-form").elements.routeNoteTipTitle.value, "남겨 둘 메모");
  assert.equal(view.controller.isDirty(), true);
});

test("native back from a pin popup returns to the full map", async () => {
  const view = setup(); await openZone(view);
  view.calls.maps[0][0].onTipSelect(view.calls.mapRenders.at(-1).tips[0]); await flush();
  assert.equal(view.controller.handleBack(), true);
  assert.equal(byClass(view.root, "route-notes-sheet").hidden, true);
  assert.equal(view.calls.mapRenders.at(-1).selectedTipId, null);
});

test("full-screen map opens and closes with native back without losing the selected zone or an editor draft", async () => {
  const view = setup(); await openZone(view);
  await click(byClass(view.root, "route-notes-fullscreen-toggle"));
  assert.equal(view.root.getAttribute("data-route-notes-fullscreen"), "true");
  assert.equal(byClass(view.root, "route-notes-sheet").hidden, true);
  assert.equal(view.calls.mapRenders.at(-1).selectedZoneId, "zone-a");
  assert.equal(view.controller.handleBack(), true);
  assert.equal(view.root.getAttribute("data-route-notes-fullscreen"), "false");
  assert.equal(byClass(view.root, "route-notes-sheet").hidden, true);
  await click(byClass(view.root, "route-notes-fullscreen-toggle"));
  const form = await openTipForm(view);
  form.elements.routeNoteTipTitle.value = "보존할 입력"; form.elements.routeNoteTipTitle.dispatch("input");
  await click(button(view.root, "위치 수정"));
  assert.equal(byClass(view.root, "route-notes-sheet").hidden, false);
  view.calls.maps.at(-1)[0].onCoordinatePick({ lat: 37.3, lng: 127.3 }); await flush();
  assert.equal(byClass(view.root, "route-notes-fullscreen-exit").hidden, false);
  await click(byClass(view.root, "route-notes-fullscreen-exit"));
  assert.equal(byClass(view.root, "route-notes-form"), form);
  assert.equal(form.elements.routeNoteTipTitle.value, "보존할 입력");
  view.controller.reset();
  assert.equal(view.root.getAttribute("data-route-notes-fullscreen"), "false");
});

test("a map initialization failure exposes a retry that can initialize and render", async () => {
  let attempts = 0; const renders = [];
  const view = setup({ mapFactory: () => {
    attempts += 1;
    if (attempts === 1) return Promise.reject(new Error("map unavailable"));
    return Promise.resolve({ render(value) { renders.push(value); }, destroy() {}, locate: async () => {} });
  } });
  await openZone(view); await flush();
  const retry = button(view.root, "지도 다시 시도");
  assert.ok(retry);
  await click(retry);
  assert.equal(attempts, 2);
  assert.equal(renders.at(-1).selectedZoneId, "zone-a");
  assert.deepEqual([...renders.at(-1).tips.map((tip) => tip.id)], ["tip-a"]);
});
