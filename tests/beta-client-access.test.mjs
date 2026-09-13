import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, existsSync } from "node:fs";
import { checkBetaMeasurementAccess } from "../src/services/beta-access.js";
import { bindAccountDeletion } from "../src/ui/account-deletion.js";

const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };

test("measurement checks fresh server approval and enrollment, not a stale profile", async () => {
  let result = { data: { id: "a", status: "approved", beta_enabled: true } };
  const query = { select: () => query, eq: (key, value) => { assert.equal(key, "id"); assert.equal(value, "a"); return query; }, single: async () => result };
  const options = { session: { user: { id: "a", email: "beta@example.test" } }, db: { from: () => query }, isCurrent: () => true };
  assert.equal(await checkBetaMeasurementAccess(options), "allowed");
  for (const status of ["pending", "blocked"]) {
    result = { data: { id: "a", status, beta_enabled: true } };
    assert.equal(await checkBetaMeasurementAccess(options), "not_enrolled");
  }
  for (const flag of [false, undefined, "true", 1]) {
    result = { data: { id: "a", status: "approved", beta_enabled: flag } };
    assert.equal(await checkBetaMeasurementAccess(options), "not_enrolled");
  }
  result = { error: { message: "network unavailable" } };
  assert.equal(await checkBetaMeasurementAccess(options), "unavailable");
  result = { data: { id: "b", status: "approved", beta_enabled: true } };
  assert.equal(await checkBetaMeasurementAccess(options), "unavailable");
});

test("measurement rejects a late account response while retaining the developer workflow", async () => {
  const pending = deferred(); let current = true;
  const query = { select: () => query, eq: () => query, single: () => pending.promise };
  const waiting = checkBetaMeasurementAccess({ session: { user: { id: "a" } }, db: { from: () => query }, isCurrent: () => current });
  current = false;
  pending.resolve({ data: { id: "a", status: "approved", beta_enabled: true } });
  assert.equal(await waiting, "account_changed");
  assert.equal(await checkBetaMeasurementAccess({ session: { user: { id: "owner", email: "JAMAICA8612@gmail.com" } }, isCurrent: () => true }), "allowed");
  assert.equal(await checkBetaMeasurementAccess({ session: null, isCurrent: () => true }), "signed_out");
});

function deletionHarness({ rpcResult = { data: "2026-09-13T11:00:00Z" }, flush = async () => {}, rpc } = {}) {
  let click; let epoch = 1; const calls = []; const messages = [];
  const button = { textContent: "탈퇴 요청", disabled: false, addEventListener: (_, fn) => { click = fn; }, setAttribute() {}, removeAttribute() {} };
  const state = { profile: { id: "a" }, db: { rpc: async (name, params) => { calls.push({ name, params }); return rpc ? rpc() : rpcResult; }, from: () => assert.fail("deletion requests must not mutate user data") } };
  bindAccountDeletion({ button, state, captureAccountContext: () => ({ userId: "a", epoch }), isAccountContextCurrent: (context) => context.epoch === epoch,
    ensurePendingSavesFlushed: flush, toast: (...args) => messages.push(args), confirm: () => true });
  return { click: () => click(), state, calls, messages, button, switchAccount: () => { epoch++; state.profile = { id: "b" }; } };
}

test("deletion requests persist only the server-confirmed timestamp without deleting or logging out", async () => {
  const h = deletionHarness(); await h.click();
  assert.deepEqual(h.calls, [{ name: "quickflex_request_account_deletion", params: { p_expected_user_id: "a" } }]);
  assert.equal(h.state.profile.deletion_requested_at, "2026-09-13T11:00:00Z");
  assert.equal(h.messages[0][1], "success"); assert.equal(h.button.disabled, false);
});

test("deletion failure and malformed ACK never report success", async () => {
  for (const rpcResult of [{ error: { message: "denied" } }, { data: null }, { data: "ok" }]) {
    const h = deletionHarness({ rpcResult }); await h.click();
    assert.equal(h.messages[0][1], "error"); assert.equal(h.state.profile.deletion_requested_at, undefined);
  }
});

test("deletion flush/account-switch and duplicate clicks cannot affect a replacement account", async () => {
  const pending = deferred(); const h = deletionHarness({ flush: () => pending.promise });
  const first = h.click(); await h.click(); h.switchAccount(); pending.resolve(); await first;
  assert.equal(h.calls.length, 0); assert.equal(h.messages.length, 0); assert.equal(h.button.disabled, false);
  const response = deferred(); const late = deletionHarness({ rpc: () => response.promise });
  const send = late.click(); await Promise.resolve(); late.switchAccount(); response.resolve({ data: "2026-09-13T11:00:00Z" }); await send;
  assert.equal(late.messages.length, 0); assert.equal(late.state.profile.deletion_requested_at, undefined);
});

test("beta entry/admin/deletion modules are wired and the public help page is cached", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /await checkBetaMeasurementAccess/);
  assert.match(main, /p_beta_enabled: card.querySelector/);
  assert.match(main, /captureAccountContext,\s+isAccountContextCurrent,/);
  const settings = readFileSync(new URL("../src/ui/settings.js", import.meta.url), "utf8");
  assert.match(settings, /bindAccountDeletion\(\{ \.\.\.ctx, button: el.requestAccountDelete/);
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  for (const path of ["account-deletion.html", "src/services/beta-access.js", "src/ui/account-deletion.js"]) {
    assert.ok(sw.includes(`"./${path}"`)); assert.ok(existsSync(new URL(`../${path}`, import.meta.url)));
  }
  const page = readFileSync(new URL("../account-deletion.html", import.meta.url), "utf8");
  assert.match(page, /mailto:flexnote2026@gmail.com/); assert.doesNotMatch(page, /<script/);
});
