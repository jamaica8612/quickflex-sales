import assert from "node:assert/strict";
import test from "node:test";
import { fixedRouteZoneIds } from "../src/ui/route-notes.js";

test("an approved fixed driver gets only explicit matching zone-name codes", () => {
  const zones = [
    { id: "a", name: "303A" },
    { id: "b", name: "302B" },
    { id: "c", name: "303C" },
    { id: "d", name: "농산물시장" , polygon: { codeGroups: ["303A"] } },
  ];
  assert.deepEqual([...fixedRouteZoneIds(zones, { status: "approved", driver_type: "fixed", fixed_routes: ["303A302B"] })], ["a", "b"]);
});

test("unapproved, backup, and blank fixed-route profiles never get a private route filter", () => {
  const zones = [{ id: "a", name: "303A" }];
  for (const profile of [
    { status: "pending", driver_type: "fixed", fixed_routes: ["303A"] },
    { status: "approved", driver_type: "backup", fixed_routes: ["303A"] },
    { status: "approved", driver_type: "fixed", fixed_routes: [] },
  ]) assert.equal(fixedRouteZoneIds(zones, profile).size, 0);
});
