import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const config = readFileSync(new URL("../src/config.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");

function extractFunction(name) {
  const markers = [`async function ${name}(`, `function ${name}(`];
  const start = markers.reduce((found, marker) => found >= 0 ? found : main.indexOf(marker), -1);
  assert.notEqual(start, -1, `missing ${name}()`);
  const paramsStart = main.indexOf("(", start);
  let paramsDepth = 0;
  let paramsEnd = -1;
  for (let index = paramsStart; index < main.length; index += 1) {
    if (main[index] === "(") paramsDepth += 1;
    if (main[index] === ")") paramsDepth -= 1;
    if (paramsDepth === 0) { paramsEnd = index; break; }
  }
  const bodyStart = main.indexOf("{", paramsEnd);
  let depth = 0;
  for (let index = bodyStart; index < main.length; index += 1) {
    if (main[index] === "{") depth += 1;
    if (main[index] === "}") depth -= 1;
    if (depth === 0) return main.slice(start, index + 1);
  }
  assert.fail(`unterminated ${name}()`);
}

test("update notice uses an in-app accessible modal instead of browser dialogs", () => {
  assert.match(config, /id:\s*"2026-08-27-device-notice-detail-cleanup-v4"/);
  assert.match(html, /id="updateNoticeOverlay"[^>]*aria-hidden="true"[^>]*inert/);
  assert.match(html, /id="updateNoticeDialog"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-labelledby="updateNoticeTitle"/);
  assert.match(html, /id="acknowledgeUpdateNotice"/);
  const offer = extractFunction("maybeOfferRateUpdate");
  assert.match(offer, /appNoticeSeenLocally\(context\.userId, noticeVersion\)/);
  assert.match(offer, /showAppUpdateNotice\(\)/);
  assert.doesNotMatch(offer, /window\.(alert|confirm)/);
  assert.doesNotMatch(offer, /app_notice_version/);
});

test("notice acknowledgement is isolated by user on each device", () => {
  const values = new Map();
  const sandbox = {
    APP_NOTICE_LOCAL_KEY_PREFIX: "quickflex-app-notice:",
    APP_UPDATE_NOTICE: { id: "notice-v4" },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
    },
  };
  const context = vm.createContext(sandbox);
  vm.runInContext(`${extractFunction("appNoticeStorageKey")}\n${extractFunction("appNoticeSeenLocally")}\n${extractFunction("rememberAppNoticeLocally")}\nglobalThis.actual = { appNoticeSeenLocally, rememberAppNoticeLocally };`, context);
  const { appNoticeSeenLocally, rememberAppNoticeLocally } = context.actual;
  assert.equal(appNoticeSeenLocally("user-a"), false);
  assert.equal(rememberAppNoticeLocally("user-a"), true);
  assert.equal(appNoticeSeenLocally("user-a"), true);
  assert.equal(appNoticeSeenLocally("user-b"), false);
});

test("storage and remote audit failures cannot block the visible notice flow", () => {
  const seen = extractFunction("appNoticeSeenLocally");
  const remember = extractFunction("rememberAppNoticeLocally");
  const persist = extractFunction("persistAppNoticeAudit");
  const acknowledge = extractFunction("acknowledgeAppUpdateNotice");
  assert.match(seen, /catch \(_\) \{ return false; \}/);
  assert.match(remember, /catch \(_\) \{[\s\S]*return false;/);
  assert.match(persist, /catch \(_\) \{[\s\S]*return false;/);
  assert.match(persist, /isProductionSiteRuntime\(\)/);
  assert.match(acknowledge, /rememberAppNoticeLocally[\s\S]*closeAppUpdateNotice[\s\S]*void persistAppNoticeAudit/);

  const context = vm.createContext({
    APP_NOTICE_LOCAL_KEY_PREFIX: "quickflex-app-notice:",
    APP_UPDATE_NOTICE: { id: "notice-v4" },
    localStorage: {
      getItem() { throw new Error("storage unavailable"); },
      setItem() { throw new Error("storage unavailable"); },
    },
  });
  vm.runInContext(`${extractFunction("appNoticeStorageKey")}\n${seen}\n${remember}\nglobalThis.actual = { appNoticeSeenLocally, rememberAppNoticeLocally };`, context);
  assert.equal(context.actual.appNoticeSeenLocally("user-a"), false);
  assert.equal(context.actual.rememberAppNoticeLocally("user-a"), false);
});
