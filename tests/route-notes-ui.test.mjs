import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

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
const button = (root, text) => root.all().find((element) => element.tag === "button" && element.textContent === text);
const byClass = (root, className) => root.all().find((element) => element.className.split(/\s+/).includes(className));

function setup({ confirm = () => true, mapFactory } = {}) {
  const document = createDocument(); const root = document.createElement("main"); document.body.append(root);
  const windowListeners = new Map();
  const window = { innerHeight: 800, location: { href: "https://example.invalid/" }, visualViewport: { height: 800, addEventListener() {} }, addEventListener(type, handler) { windowListeners.set(type, handler); }, matchMedia: () => ({ matches: false }), confirm };
  const zones = [
    { id: "zone-a", name: "A 구역", memo: "A 안내", polygon: { type: "Polygon", coordinates: [[[127, 37], [128, 37], [127, 38], [127, 37]]] } },
    { id: "zone-b", name: "B 구역", memo: "B 안내", polygon: { type: "Polygon", coordinates: [[[129, 39], [130, 39], [129, 40], [129, 39]]] } },
  ];
  let tips = [
    { id: "tip-a", zone_id: "zone-a", created_by: "user", title: "A 메모", memo: "A 내용", marker_type: "note", lat: 37.5, lng: 127.5, photos: [] },
    { id: "tip-b", zone_id: "zone-b", created_by: "user", title: "B 메모", memo: "B 내용", marker_type: "note", lat: 39.5, lng: 129.5, photos: [] },
  ];
  const calls = { loadZone: [], saveTip: [], maps: [] };
  const service = {
    async load() { return { company: { id: "company", name: "회사" }, membership: { company_id: "company", role: "member" }, zones, favorites: [] }; },
    async loadZone(id) { calls.loadZone.push(id); return { zone: zones.find((zone) => zone.id === id), tips: tips.filter((tip) => tip.zone_id === id), zonePhotos: [] }; },
    async saveTip(input) { calls.saveTip.push(input); const saved = { ...input, id: "saved-tip", created_by: "user", author_name: "나", photos: [] }; tips = [...tips, saved]; return saved; },
    async uploadTipPhoto() {}, async setFavorite() {}, async deleteTip() {}, async deleteTipPhoto() {},
  };
  const createRouteNoteMap = (...args) => {
    calls.maps.push(args);
    return mapFactory ? mapFactory(...args) : Promise.resolve({ render(value) { calls.mapRenders = [...(calls.mapRenders || []), value]; }, destroy() {}, locate: async () => {} });
  };
  const context = { document, window, AbortController, Promise, URL, console, CSS: { escape: (value) => value },
    createRouteNoteMap, hasPolygon: (polygon) => Boolean(polygon?.coordinates?.length), ROUTE_NOTE_MARKER_TYPES: ["note", "parking"], parseScheduleRoutes: () => [] };
  runInNewContext(source, context, { filename: "route-notes.js" });
  const notifications = [];
  const controller = context.createRouteNotesController({ root, service, getUser: () => ({ id: "user" }), getProfile: () => ({ id: "user", status: "approved", driver_type: "backup" }), notify: (...args) => notifications.push(args), mapClientId: "fixture" });
  return { root, document, windowListeners, controller, calls, notifications };
}

async function openZone(view, zoneName = "A 구역") {
  await view.controller.open(); await flush();
  const zoneButton = view.root.all().find((element) => element.className.split(/\s+/).includes("route-notes-zone-main") && element.textContent.includes(zoneName));
  assert.ok(zoneButton, `zone button for ${zoneName}`);
  await click(zoneButton);
}

async function openTipForm(view) {
  await click(button(view.root, "메모 보기"));
  await click(button(view.root, "메모 추가"));
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

test("collapsing and reopening a tip form preserves unsaved input", async () => {
  const view = setup(); await openZone(view); const form = await openTipForm(view);
  const title = form.elements.routeNoteTipTitle; title.value = "계속 작성"; title.dispatch("input");
  await click(button(view.root, "위치 선택"));
  view.windowListeners.get("resize")();
  assert.equal(byClass(view.root, "route-notes-sheet").dataset.snap, "peek");
  await click(button(view.root, "작성 계속"));
  assert.equal(byClass(view.root, "route-notes-form").elements.routeNoteTipTitle.value, "계속 작성");
});

test("a successful tip save reloads the detail without abandoning its own in-flight draft", async () => {
  const view = setup({ confirm: () => false }); await openZone(view); const form = await openTipForm(view);
  form.elements.routeNoteTipTitle.value = "저장한 메모"; form.elements.routeNoteTipTitle.dispatch("input");
  assert.equal(view.controller.isDirty(), true);
  await form.dispatch("submit"); await flush();
  assert.doesNotMatch(String(view.notifications.at(-1)?.[0] || ""), /제목을 입력/);
  assert.equal(view.calls.saveTip.length, 1);
  assert.deepEqual(view.calls.loadZone, ["zone-a", "zone-a"]);
  assert.match(view.root.textContent, /저장한 메모/);
  assert.ok(view.notifications.some(([message]) => message === "구역 메모를 저장했습니다."));
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

test("native back from detail moves focus to the visible peek toggle", async () => {
  const view = setup(); await openZone(view); await click(button(view.root, "메모 보기"));
  assert.equal(view.controller.handleBack(), true);
  const toggle = byClass(view.root, "route-notes-sheet-toggle");
  assert.equal(byClass(view.root, "route-notes-sheet").dataset.snap, "peek");
  assert.equal(toggle.hidden, false);
  assert.equal(view.document.activeElement, toggle);
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
