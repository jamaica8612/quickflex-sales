import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  pendingSignupsBannerText,
  pendingSignupsGearLabel,
  shouldShowPendingSignupsNotice,
} from "../src/services/admin-insights.js";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

function sourceFunction(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start + 1) : source.length;
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end).replace(/\basync\s*$/, "");
}

function fakeClassList(initial = []) {
  const set = new Set(initial);
  return {
    set,
    toggle(name, force) {
      const on = force === undefined ? !set.has(name) : Boolean(force);
      if (on) set.add(name); else set.delete(name);
      return on;
    },
    contains: (name) => set.has(name),
  };
}
function fakeButton() {
  const attrs = {};
  return {
    classList: fakeClassList(),
    dataset: {},
    setAttribute(name, value) { attrs[name] = value; },
    getAttribute: (name) => attrs[name],
    attrs,
  };
}

test("applyPendingSignupsNotice shows the banner text and dots the settings gear when pending, hides both at zero", () => {
  const src = sourceFunction(main, "applyPendingSignupsNotice", "refreshPendingSignupsNotice");
  const banner = { classList: fakeClassList(["hidden"]), textContent: "" };
  const gear1 = fakeButton();
  const gear2 = fakeButton();
  const state = {};
  const el = { pendingSignupsBanner: banner };
  const document = { querySelectorAll: (sel) => (sel === "[data-open-settings]" ? [gear1, gear2] : []) };

  runInNewContext(`${src}; applyPendingSignupsNotice({ pendingCount: 3, oldestWaitingDays: 88 });`, {
    state,
    el,
    document,
    shouldShowPendingSignupsNotice,
    pendingSignupsBannerText,
    pendingSignupsGearLabel,
  });
  assert.equal(banner.textContent, "가입 승인 대기 3명 · 가장 오래 88일째");
  assert.equal(banner.classList.contains("hidden"), false);
  assert.equal(gear1.classList.contains("has-pending-dot"), true);
  assert.equal(gear1.attrs["aria-label"], "설정, 가입 승인 대기 3명");
  assert.equal(gear2.attrs["aria-label"], "설정, 가입 승인 대기 3명");
  assert.equal(state.pendingSignupsNotice.pendingCount, 3);
  assert.equal(state.pendingSignupsNotice.oldestWaitingDays, 88);

  // Count drops to zero (or the RPC failed): both the banner and the dot must disappear.
  runInNewContext(`${src}; applyPendingSignupsNotice(null);`, {
    state,
    el,
    document,
    shouldShowPendingSignupsNotice,
    pendingSignupsBannerText,
    pendingSignupsGearLabel,
  });
  assert.equal(banner.textContent, "");
  assert.equal(banner.classList.contains("hidden"), true);
  assert.equal(gear1.classList.contains("has-pending-dot"), false);
  assert.equal(gear1.attrs["aria-label"], "설정");
  assert.equal(state.pendingSignupsNotice, null);
});

test("refreshPendingSignupsNotice never calls the RPC for a non-admin and ignores stale/account-switched responses", async () => {
  // refreshPendingSignupsNotice is declared `async function`; sourceFunction's indexOf("function <name>(")
  // match starts after the "async " keyword, so it must be re-added before the slice is executed.
  const src = `async ${sourceFunction(main, "refreshPendingSignupsNotice", "openPendingSignupsApproval")}`;
  let rpcCalls = 0;
  let appliedWith = "unset";
  const context = { epoch: 1, userId: "u1" };
  const state = { profile: { role: "driver" }, db: { rpc: () => { rpcCalls++; } } };

  await runInNewContext(`${src}; refreshPendingSignupsNotice(context);`, {
    context,
    state,
    captureAccountContext: () => context,
    isAccountContextCurrent: (c) => c === context,
    fetchPendingSignups: async () => { rpcCalls++; return { pendingCount: 1, oldestWaitingDays: 1 }; },
    applyPendingSignupsNotice: (data) => { appliedWith = data; },
    console,
  });
  await Promise.resolve(); // let the async function body settle before asserting
  assert.equal(rpcCalls, 0, "a non-admin must never call quickflex_pending_signups");
  assert.equal(appliedWith, null, "a non-admin clears any prior notice instead of leaving stale state");

  // Admin whose account context changed mid-flight (account switch / sign-out): the late response must be dropped.
  appliedWith = "unset";
  const adminState = { profile: { role: "admin" }, db: {} };
  let currentContext = { epoch: 1, userId: "admin1" };
  await runInNewContext(`${src}; refreshPendingSignupsNotice(currentContext);`, {
    get currentContext() { return currentContext; },
    context: currentContext,
    state: adminState,
    captureAccountContext: () => currentContext,
    isAccountContextCurrent: (c) => c === currentContext,
    fetchPendingSignups: async () => {
      currentContext = { epoch: 2, userId: "admin2" }; // account switched while the RPC was in flight
      return { pendingCount: 5, oldestWaitingDays: 9 };
    },
    applyPendingSignupsNotice: (data) => { appliedWith = data; },
    console,
  });
  assert.equal(appliedWith, "unset", "a response for a switched-away account must be ignored");
});

test("renderAdminUsageSummary wiring calls the migration's screen-summary RPC and matches the required empty-state copy", () => {
  const body = sourceFunction(main, "renderAdminUsageSummary", "applyPendingSignupsNotice");
  assert.match(body, /state\.profile\?\.role !== "admin"/, "must stay admin-only");
  assert.match(body, /fetchUsageScreenSummary\(state\.db, \{ windowDays: state\.adminUsageWindowDays \}\)/);
  assert.match(body, /아직 모인 사용 기록이 없어요/);
  assert.match(body, /catch \(error\)/);
  assert.doesNotMatch(body, /toast\(/, "an RPC error must render quietly, not through a toast");
});

test("boot and save-admin trigger the pending-signups refresh, and sign-out/account switch clears it", () => {
  assert.match(main, /trackApprovedSessionStart\(\);\s*\n\s*void refreshPendingSignupsNotice\(context\);/);
  assert.match(main, /await renderAdminProfiles\(\);\s*\n\s*void refreshPendingSignupsNotice\(context\);/);
  const clearBody = sourceFunction(main, "clearUserScopedState", "scheduleSignedInBoot");
  assert.match(clearBody, /applyPendingSignupsNotice\(null\)/);
});

test("noah and routes are tracked as screen_viewed like every other bottom-nav tab", () => {
  const usageSource = readFileSync(new URL("../src/services/usage.js", import.meta.url), "utf8");
  assert.match(usageSource, /"noah",\s*\n\s*"routes",/);
  assert.match(main, /if \(view !== previousView\) queueUsageEvent\("screen_viewed", \{ screen: view \}\)/);
  assert.match(main, /\["home", "record", "measurement", "inspection", "stats", "settings", "expenses", "schedule", "routes", "noah"\]/);
});

test("index.html carries the admin usage card, the 7/30 toggle, and a tappable, initially-hidden home banner", () => {
  assert.match(html, /id="usageSettings"/);
  assert.match(html, /최근 30일 화면별 사용/);
  assert.match(html, /data-usage-window="7"/);
  assert.match(html, /data-usage-window="30"/);
  assert.match(html, /id="adminUsageSummary"/);
  assert.match(html, /id="pendingSignupsBanner" class="pending-signups-banner hidden" data-open-pending-signups/);
  assert.match(html, /id="adminProfiles" class="admin-list" tabindex="-1"/);
});

test("styles.css themes the pending banner and dot with existing tokens, not hardcoded colors", () => {
  assert.match(css, /\.pending-signups-banner \{[\s\S]*?background: var\(--warn-bg\);[\s\S]*?\}/);
  assert.match(css, /\.tab-settings\.has-pending-dot::before \{[\s\S]*?background: var\(--red\);[\s\S]*?\}/);
  assert.match(css, /\.usage-summary-row \{/);
});
