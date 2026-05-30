import test from "node:test";
import assert from "node:assert/strict";

import {
  routeDistance,
  buildRouteCandidates,
  correctRoute,
  activeRouteBundles,
  completeRouteBundles,
  correctRouteList,
} from "../src/lib/route.js";

test("routeDistance scores confusable chars cheaper than unrelated", () => {
  assert.equal(routeDistance("302A", "302A"), 0);
  assert.equal(routeDistance("3O2A", "302A"), 0.35); // O<->0 confusion
  assert.equal(routeDistance("302C", "302A"), 1); // unrelated swap
  assert.equal(routeDistance("302A", "30A"), 99); // length mismatch
});

test("buildRouteCandidates keeps master, gates the rest to NNNX", () => {
  const c = buildRouteCandidates({ master: ["302A", "free-text"], gated: ["303A", "nope", "30"] });
  assert.ok(c.has("302A"));
  assert.ok(c.has("FREE-TEXT")); // master added unconditionally (normalized/upper)
  assert.ok(c.has("303A"));
  assert.ok(!c.has("NOPE"));
  assert.ok(!c.has("30"));
});

test("correctRoute: exact, OCR-confusion repair, fuzzy, and passthrough", () => {
  const c = new Set(["302A", "302B", "303A"]);
  assert.equal(correctRoute("302A", c), "302A"); // exact
  assert.equal(correctRoute("3O2A", c), "302A"); // O->0 in numeric part
  assert.equal(correctRoute("302C", new Set(["302A"])), "302A"); // single nearest within 1
  assert.equal(correctRoute("302C", c), ""); // ambiguous tie -> empty
  assert.equal(correctRoute("999Z", c), "999Z"); // no match but valid code -> keep
  assert.equal(correctRoute("!!", c), ""); // junk -> empty
});

test("correctRouteList: expands, repairs, dedups against master", () => {
  const sources = { master: ["302A", "302B", "303A"] };
  assert.deepEqual(correctRouteList("3O2A, 3O3A", sources), ["302A", "303A"]);
  assert.deepEqual(correctRouteList("302AB", sources), ["302A", "302B"]); // expand multi-suffix
  assert.deepEqual(correctRouteList("302A 302A", sources), ["302A"]); // dedup
});

test("activeRouteBundles prefers db bundles and dedups defaults", () => {
  const bundles = activeRouteBundles({
    stateBundles: [{ active: true, routes: ["403A", "403B"] }],
    defaultBundles: [["403A", "403B"], ["405A", "405C", "410B"]],
  });
  assert.equal(bundles.filter((b) => b.trusted).length, 1);
  // the default ["403A","403B"] is deduped away; ["405A","405C","410B"] remains as fallback
  assert.ok(bundles.some((b) => !b.trusted && b.routes.join() === "405A,405C,410B"));
  assert.ok(!bundles.some((b) => !b.trusted && b.routes.join() === "403A,403B"));
});

test("completeRouteBundles fills untrusted bundle only when exactly one is missing", () => {
  const untrusted = [{ routes: ["405A", "405C", "410B"], trusted: false }];
  assert.deepEqual(completeRouteBundles(["405A", "405C"], untrusted), ["405A", "405C", "410B"]);
  // two missing -> untrusted does not complete
  assert.deepEqual(completeRouteBundles(["405A"], untrusted), ["405A"]);
});

test("correctRouteList completes a trusted db bundle end to end", () => {
  const sources = {
    master: ["403A", "403B", "403C", "403D"],
    stateBundles: [{ active: true, routes: ["403A", "403B", "403C", "403D"] }],
  };
  assert.deepEqual(correctRouteList("403A 403B", sources), ["403A", "403B", "403C", "403D"]);
});
