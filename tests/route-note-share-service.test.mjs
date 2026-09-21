import assert from "node:assert/strict";
import test from "node:test";
import { buildRouteNoteShareUrl, createRouteNoteShareService, normalizeRouteNoteShareDays } from "../src/services/route-note-share.js";

const ZONE = "44444444-4444-4444-8444-444444444444";
const OTHER_ZONE = "55555555-5555-4555-8555-555555555555";
const SHARE = "66666666-6666-4666-8666-666666666666";
const TOKEN = "a".repeat(64);
const USER = "77777777-7777-4777-8777-777777777777";

function service(calls, responses = {}) {
  const client = { rpc: async (name, params) => {
    calls.push([name, params]); return responses[name] || { data: null, error: null };
  } };
  const context = { client, user: { id: USER }, profile: { id: USER, status: "approved" }, epoch: 1 };
  return createRouteNoteShareService({ getContext: () => context });
}

test("share create sends a zone-scoped bounded expiry and accepts a one-time token", async () => {
  const calls = [];
  const api = service(calls, { quickflex_create_route_note_share: { data: [{ id: SHARE, token: TOKEN, expires_at: "2026-10-01T00:00:00Z" }], error: null } });
  const created = await api.create(ZONE, 7);
  assert.equal(created.token, TOKEN);
  assert.deepEqual(calls[0], ["quickflex_create_route_note_share", { p_zone_id: ZONE, p_expires_in_days: 7 }]);
});

test("share list keeps only the selected zone and updates never include a token", async () => {
  const calls = [];
  const api = service(calls, { quickflex_list_route_note_shares: { data: [{ id: SHARE, zone_id: ZONE }, { id: SHARE, zone_id: OTHER_ZONE }], error: null }, quickflex_update_route_note_share: { data: [{ id: SHARE }], error: null } });
  assert.deepEqual(await api.list(ZONE), [{ id: SHARE, zone_id: ZONE }]);
  await api.update(SHARE, { expiresInDays: 30 });
  await api.update(SHARE, { revoke: true });
  assert.deepEqual(calls[1], ["quickflex_update_route_note_share", { p_share_id: SHARE, p_revoke: false, p_expires_in_days: 30 }]);
  assert.deepEqual(calls[2], ["quickflex_update_route_note_share", { p_share_id: SHARE, p_revoke: true }]);
});

test("expiry bounds and a missing token fail before RPC or URL construction", async () => {
  for (const value of [0, 31, 7.5, "x"]) assert.throws(() => normalizeRouteNoteShareDays(value));
  assert.throws(() => buildRouteNoteShareUrl("bad", "https://example.test/app/index.html"));
  assert.equal(buildRouteNoteShareUrl(TOKEN, "https://example.test/quickflex/index.html"), `https://example.test/quickflex/route-share.html#token=${TOKEN}`);
});
