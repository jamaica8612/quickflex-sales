import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarSyncShouldPoll,
  calendarSyncStatusCopy,
  consumeCalendarOauthResult,
  mountCalendarSync,
} from "../src/ui/calendar-sync.js";

test("connected calendar status prioritizes pending server work", () => {
  assert.equal(calendarSyncStatusCopy({
    state: "connected", pendingJobs: 2, lastJobStatus: "failed", lastJobError: "old failure",
    lastSuccessfulAt: "2026-09-13T06:00:00.000Z",
  }), "동기화 중 · 서버 처리 대기 2건");
});

test("OAuth result is consumed once without dropping unrelated URL fields", () => {
  const calls = [];
  const history = { state: { view: "settings" }, replaceState(...args) { calls.push(args); } };
  assert.equal(consumeCalendarOauthResult({ href: "https://example.test/app?view=settings&calendar=connected#calendar" }, history), "connected");
  assert.deepEqual(calls, [[history.state, "", "/app?view=settings#calendar"]]);
  assert.equal(consumeCalendarOauthResult({ href: "https://example.test/app?view=settings" }, history), null);
});

test("completed calendar status reports the latest failure or conflict before an older success", () => {
  assert.equal(calendarSyncStatusCopy({
    state: "connected", pendingJobs: 0, lastJobStatus: "failed", lastJobError: "Google API error",
    lastSuccessfulAt: "2026-09-13T06:00:00.000Z",
  }), "동기화 실패 · Google API error");
  assert.equal(calendarSyncStatusCopy({
    state: "connected", pendingJobs: 0, lastJobStatus: "conflict", lastJobError: "1개 일정이 외부 변경으로 보류되었습니다.",
    lastSuccessfulAt: "2026-09-13T06:00:00.000Z",
  }), "일정 확인 필요 · 1개 일정이 외부 변경으로 보류되었습니다.");
});

test("successful calendar status uses the server-confirmed success time", () => {
  const finishedAt = "2026-09-13T06:00:00.000Z";
  assert.equal(calendarSyncStatusCopy({
    state: "connected", pendingJobs: 0, lastJobStatus: "succeeded", lastSuccessfulAt: finishedAt,
  }), `연결됨 · 마지막 성공 ${new Date(finishedAt).toLocaleString("ko-KR")}`);
});

test("calendar polling covers a five-minute worker cycle and stops at six minutes", () => {
  const startedAt = Date.UTC(2026, 8, 13, 6, 0, 0);
  const pollUntil = startedAt + 6 * 60_000;
  const pending = { state: "connected", pendingJobs: 1 };
  assert.equal(calendarSyncShouldPoll(pending, pollUntil, startedAt + 5 * 60_000 + 50_000, "visible"), true);
  assert.equal(calendarSyncShouldPoll(pending, pollUntil, pollUntil, "visible"), false);
  assert.equal(calendarSyncShouldPoll(pending, pollUntil, startedAt + 30_000, "hidden"), false);
  assert.equal(calendarSyncShouldPoll({ state: "connected", pendingJobs: 0 }, pollUntil, startedAt + 5 * 60_000 + 20_000, "visible"), false);
});

function fakeElement(document, name) {
  return {
    name, value: "", checked: false, dataset: {}, disabled: false, textContent: "", listeners: new Map(),
    addEventListener(type, listener) { this.listeners.set(type, listener); },
    removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); },
    focus() { document.activeElement = this; },
  };
}

function fakeBrowser() {
  const styles = new Map();
  const listeners = new Map();
  const document = {
    activeElement: null,
    visibilityState: "visible",
    getElementById(id) { return styles.get(id) || null; },
    createElement() { return fakeElement(document, "style"); },
    head: { append(node) { styles.set(node.id, node); } },
    addEventListener(type, listener) { listeners.set(type, listener); },
    removeEventListener(type, listener) { if (listeners.get(type) === listener) listeners.delete(type); },
  };
  const details = fakeElement(document, "details");
  details.open = true;
  const host = {
    html: "", renderCount: 0, nodes: new Map(),
    set innerHTML(value) {
      if ([...this.nodes.values()].includes(document.activeElement)) document.activeElement = null;
      this.html = value;
      this.renderCount += 1;
      this.nodes = new Map([
        [".calendar-sync-status", fakeElement(document, "status")],
        ["[data-calendar-preview]", fakeElement(document, "preview")],
        ["[data-calendar-start]", fakeElement(document, "start")],
        ["[data-calendar-end]", fakeElement(document, "end")],
        ["[data-calendar-sync]", fakeElement(document, "sync")],
        ["[data-calendar-reapply]", fakeElement(document, "reapply")],
        ["[data-calendar-disconnect]", fakeElement(document, "disconnect")],
      ]);
    },
    get innerHTML() { return this.html; },
    querySelector(selector) { return this.nodes.get(selector) || null; },
    querySelectorAll() { return []; },
    contains(node) { return [...this.nodes.values()].includes(node); },
    closest(selector) { return selector === "details" ? details : null; },
    replaceChildren() { this.html = ""; this.nodes.clear(); },
  };
  return { document, details, host, listeners };
}

test("poll completion updates only status text and preserves the focused date input", async () => {
  const browser = fakeBrowser();
  const originalDocument = globalThis.document;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  globalThis.document = browser.document;
  globalThis.setTimeout = () => 1;
  globalThis.clearTimeout = () => {};
  let statusCall = 0;
  const finishedAt = "2026-09-13T06:05:20.000Z";
  const db = { functions: { async invoke(_name, { body }) {
    assert.equal(body.action, "status");
    statusCall += 1;
    return { data: statusCall === 1
      ? { state: "connected", pendingJobs: 1 }
      : { state: "connected", pendingJobs: 0, lastJobStatus: "succeeded", lastSuccessfulAt: finishedAt } };
  } } };
  try {
    const controller = mountCalendarSync({ host: browser.host, db, getDays: async () => [], toast() {} });
    await new Promise((resolve) => setImmediate(resolve));
    const input = browser.host.querySelector("[data-calendar-start]");
    input.focus();
    const renderCount = browser.host.renderCount;
    await controller.refresh();
    assert.equal(browser.host.renderCount, renderCount);
    assert.equal(browser.host.querySelector("[data-calendar-start]"), input);
    assert.equal(browser.document.activeElement, input);
    assert.equal(browser.host.querySelector(".calendar-sync-status").textContent,
      `연결됨 · 마지막 성공 ${new Date(finishedAt).toLocaleString("ko-KR")}`);

    browser.details.open = false;
    browser.details.listeners.get("toggle")();
    browser.details.open = true;
    browser.details.listeners.get("toggle")();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(statusCall, 3);

    controller.dispose();
    assert.equal(browser.listeners.has("visibilitychange"), false);
    assert.equal(browser.details.listeners.has("toggle"), false);
  } finally {
    globalThis.document = originalDocument;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
