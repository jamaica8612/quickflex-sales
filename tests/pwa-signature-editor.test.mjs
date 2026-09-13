import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const saveSource = main.slice(main.indexOf("async function saveInspectionSignature()"), main.indexOf("async function saveGoalAmount()"));
const signature = "data:image/webp;base64,dGVzdA==";

function harness({ ink = signature, failure = false, switchAccount = false } = {}) {
  const writes = [];
  let current = true;
  const state = {
    inspectionSignature: "previous-signature",
    db: { from() { return {
      upsert(payload) { writes.push(payload); return this; },
      select() { return this; },
      async single() {
        if (switchAccount) current = false;
        return { data: { signature_data: signature }, error: failure ? new Error("offline") : null };
      },
    }; } },
  };
  const context = vm.createContext({ state, TABLES: { inspectionSignatures: "test-only" },
    el: { app: { dataset: { view: "settings" } } },
    captureAccountContext: () => ({ userId: "test-user" }),
    isAccountContextCurrent: () => current,
    profileSignaturePad: { value: () => ink },
    isValidSignatureData: value => value === signature,
    toast() {},
  });
  vm.runInContext(saveSource, context);
  return { save: context.saveInspectionSignature, writes, state };
}

test("empty handwriting never sends a signature write", async () => {
  const h = harness({ ink: "" });
  await assert.rejects(h.save(), /손글씨/);
  assert.equal(h.writes.length, 0);
});

test("handwriting is saved for the captured account and applied after success", async () => {
  const h = harness();
  assert.equal(await h.save(), true);
  assert.equal(h.writes[0].user_id, "test-user");
  assert.equal(h.writes[0].signature_data, signature);
  assert.equal(h.state.inspectionSignature, signature);
});

test("failed save preserves the previous registered signature", async () => {
  const h = harness({ failure: true });
  await assert.rejects(h.save(), /offline/);
  assert.equal(h.state.inspectionSignature, "previous-signature");
});

test("late save response does not update another account", async () => {
  const h = harness({ switchAccount: true });
  assert.equal(await h.save(), false);
  assert.equal(h.state.inspectionSignature, "previous-signature");
});
