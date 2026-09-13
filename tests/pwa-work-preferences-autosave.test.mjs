import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const settings = readFileSync(new URL("../src/ui/settings.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const start = main.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const bodyStart = main.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < main.length; index += 1) {
    if (main[index] === "{") depth += 1;
    if (main[index] === "}") depth -= 1;
    if (depth === 0) return main.slice(start, index + 1);
  }
  throw new Error(`Could not extract ${name}`);
}

function harness({ failure = false, deferred = false } = {}) {
  const writes = [];
  const calls = { renderAll: 0, renderEntryForm: 0, toasts: [] };
  let current = true;
  let release;
  const radios = [
    { name: "workShift", value: "day", checked: false, disabled: false },
    { name: "workShift", value: "night", checked: true, disabled: false },
    { name: "freshbagMode", value: "single", checked: false, disabled: false },
    { name: "freshbagMode", value: "dual", checked: true, disabled: false },
  ];
  const response = () => ({
    data: { work_shift: "night", freshbag_mode: "dual", updated_at: "2026-09-13T01:02:03.000Z" },
    error: failure ? new Error("offline") : null,
  });
  let currentTable = "";
  const query = {
    update(payload) { writes.push({ table: currentTable, payload }); return this; },
    eq(column, value) { writes.at(-1).eq = [column, value]; return this; },
    select(columns) { writes.at(-1).select = columns; return this; },
    single() {
      if (!deferred) return Promise.resolve(response());
      return new Promise((resolve) => { release = () => resolve(response()); });
    },
  };
  const state = {
    profile: { id: "user-a", work_shift: "day", freshbag_mode: "single", display_name: "unsaved name" },
    db: { from(table) { currentTable = table; return query; } },
  };
  const document = {
    querySelector(selector) {
      const name = selector.includes("freshbagMode") ? "freshbagMode" : "workShift";
      return radios.find((radio) => radio.name === name && radio.checked) || null;
    },
    querySelectorAll(selector) {
      if (selector.includes("freshbagMode") && selector.includes("workShift")) return radios;
      if (selector.includes("freshbagMode")) return radios.filter((radio) => radio.name === "freshbagMode");
      if (selector.includes("workShift")) return radios.filter((radio) => radio.name === "workShift");
      return [];
    },
  };
  const el = {
    app: { dataset: { view: "settings" } },
    profileDisplayName: { value: "typed name draft" },
    profileVehicleNumber: { value: "12가3456 draft" },
    goalAmountInput: { value: "9,000,000 draft" },
  };
  const context = vm.createContext({
    state,
    document,
    TABLES: { profiles: "quickflex_profiles" },
    el,
    captureAccountContext: () => ({ epoch: 1, userId: "user-a" }),
    isAccountContextCurrent: () => current,
    renderAll: () => { calls.renderAll += 1; },
    renderEntryForm: () => { calls.renderEntryForm += 1; },
    toast: (...args) => calls.toasts.push(args),
  });
  vm.runInContext(`${extractFunction("applyWorkPreferencesUi")}\nlet workPreferencesSaveTask = null;\n${extractFunction("saveWorkPreferences")}`, context);
  return {
    calls,
    context,
    el,
    radios,
    release: () => release?.(),
    save: context.saveWorkPreferences,
    setCurrent: (value) => { current = value; },
    state,
    writes,
  };
}

test("work controls auto-save only the two preferences", async () => {
  const h = harness();
  assert.equal(await h.save(), true);
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].table, "quickflex_profiles");
  assert.deepEqual(Object.keys(h.writes[0].payload).sort(), ["freshbag_mode", "updated_at", "work_shift"]);
  assert.equal(h.writes[0].payload.work_shift, "night");
  assert.equal(h.writes[0].payload.freshbag_mode, "dual");
  assert.deepEqual(h.writes[0].eq, ["id", "user-a"]);
  assert.equal(h.writes[0].select, "work_shift,freshbag_mode,updated_at");
  assert.equal(h.state.profile.display_name, "unsaved name", "unrelated profile drafts stay untouched");
  assert.equal(h.state.profile.work_shift, "night");
  assert.equal(h.state.profile.freshbag_mode, "dual");
  assert.equal(h.calls.renderAll, 0, "full profile rendering must not reset unrelated drafts");
  assert.equal(h.calls.renderEntryForm, 0, "an async response must not reset an in-progress record form");
  assert.equal(h.el.profileDisplayName.value, "typed name draft");
  assert.equal(h.el.profileVehicleNumber.value, "12가3456 draft");
  assert.equal(h.el.goalAmountInput.value, "9,000,000 draft");
});

test("a failed preference save rolls both controls back and reports one error", async () => {
  const h = harness({ failure: true });
  await assert.rejects(h.save(), /offline/);
  assert.equal(h.radios.find((radio) => radio.name === "workShift" && radio.value === "day").checked, true);
  assert.equal(h.radios.find((radio) => radio.name === "freshbagMode" && radio.value === "single").checked, true);
  assert.ok(h.radios.every((radio) => radio.disabled === false));
  assert.deepEqual(h.calls.toasts, [["근무 설정 저장 실패: offline", "error"]]);
  assert.equal(h.state.profile.work_shift, "day");
  assert.equal(h.state.profile.freshbag_mode, "single");
});

test("rapid toggles share one pending write while both groups are locked", async () => {
  const h = harness({ deferred: true });
  const first = h.save();
  const second = h.save();
  assert.equal(h.writes.length, 1);
  assert.ok(h.radios.every((radio) => radio.disabled === true));
  vm.runInContext("applyWorkPreferencesUi(state.profile)", h.context);
  assert.ok(h.radios.every((radio) => radio.disabled === true), "a profile render keeps the pending lock");
  assert.equal(h.radios.find((radio) => radio.value === "night").checked, true);
  assert.equal(h.radios.find((radio) => radio.value === "dual").checked, true);
  h.release();
  assert.deepEqual(await Promise.all([first, second]), [true, true]);
  assert.ok(h.radios.every((radio) => radio.disabled === false));
});

test("a late response cannot mutate the replacement account state or controls", async () => {
  const h = harness({ deferred: true });
  const pending = h.save();
  h.setCurrent(false);
  h.state.profile = { id: "user-b", work_shift: "day", freshbag_mode: "single", display_name: "account b" };
  h.radios.forEach((radio) => {
    radio.checked = radio.value === "day" || radio.value === "single";
    radio.disabled = false;
  });
  h.release();
  assert.equal(await pending, false);
  assert.equal(h.state.profile.id, "user-b");
  assert.equal(h.state.profile.work_shift, "day");
  assert.equal(h.state.profile.freshbag_mode, "single");
  assert.ok(h.radios.every((radio) => radio.disabled === false));
  assert.equal(h.calls.renderAll, 0);
  assert.equal(h.calls.toasts.length, 0);
});

test("settings markup removes only the work save button and labels both radio groups", () => {
  assert.doesNotMatch(html, />근무 설정 저장<\/button>/);
  assert.equal((html.match(/data-save-profile/g) || []).length, 1, "vehicle save remains separate");
  assert.match(html, /id="workShiftLabel"[\s\S]*role="radiogroup" aria-labelledby="workShiftLabel"/);
  assert.match(html, /id="freshbagModeLabel"[\s\S]*role="radiogroup" aria-labelledby="freshbagModeLabel"/);
  assert.match(settings, /input\[name="workShift"\], input\[name="freshbagMode"\][\s\S]*saveWorkPreferences\(\)/);
});
