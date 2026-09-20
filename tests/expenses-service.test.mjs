import assert from "node:assert/strict";
import test from "node:test";
import { normalizeExpenseSaveInput } from "../src/lib/expenses.js";
import { createExpenseService } from "../src/services/expenses.js";

const cryptoImpl = { randomUUID: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };

test("expense saves allow photo-only drafts but require date and gross won to confirm", () => {
  const draft = normalizeExpenseSaveInput({}, cryptoImpl);
  assert.equal(draft.status, "draft");
  assert.equal(draft.actual_date, null);
  assert.equal(draft.gross_amount, null);
  assert.throws(() => normalizeExpenseSaveInput({ status: "confirmed", gross_amount: 5000 }, cryptoImpl), /actual date/i);
  assert.deepEqual(normalizeExpenseSaveInput({ status: "confirmed", actual_date: "2026-09-13", gross_amount: "5000", business_amount: "4000" }, cryptoImpl).gross_amount, 5000);
  assert.throws(() => normalizeExpenseSaveInput({ gross_amount: 10, business_amount: 11 }, cryptoImpl), /cannot exceed/i);
});

test("duplicate receipt metadata removes only the new orphan object", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const expenseId = "22222222-2222-4222-8222-222222222222";
  const acceptedPath = `${userId}/33333333-3333-4333-8333-333333333333`;
  const sha256 = "00".repeat(32);
  let fetchCount = 0;
  const removed = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    rpc: async () => ({ data: "44444444-4444-4444-8444-444444444444", error: null }),
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ single: async () => ({ data: {
      id: expenseId, receipts: fetchCount++ ? [{ id: "55555555-5555-4555-8555-555555555555", sha256, object_path: acceptedPath }] : [], adjustments: [],
    }, error: null }) }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }), remove: async (paths) => { removed.push(...paths); return { error: null }; } }) },
  };
  const service = createExpenseService(db, { cryptoImpl: { randomUUID: () => "66666666-6666-4666-8666-666666666666", subtle: { digest: async () => new Uint8Array(32).buffer } } });
  const saved = await service.addReceipt(expenseId, { name: "receipt.jpg", type: "image/jpeg", size: 1, arrayBuffer: async () => new ArrayBuffer(1) });
  assert.equal(saved.receipts[0].object_path, acceptedPath);
  assert.deepEqual(removed, [`${userId}/66666666-6666-4666-8666-666666666666`]);
});

test("orphan cleanup reports Storage remove response errors", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    rpc: async () => ({ data: null, error: null }), from() {},
    storage: { from: () => ({ remove: async () => ({ error: { message: "denied" } }) }) },
  };
  const service = createExpenseService(db);
  const path = `${userId}/66666666-6666-4666-8666-666666666666`;
  await assert.rejects(() => service.cleanupOrphan(path), (error) => {
    assert.match(error.message, /temporary private upload.*denied/i);
    assert.equal(error.cleanupPath, path);
    return true;
  });
});

test("monthly lists include undated trashed drafts when the trash view requests them", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const queries = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    rpc() {}, storage: {},
    from: () => {
      const query = { filters: [] };
      for (const method of ["select", "eq", "order", "not", "gte", "lte", "neq", "is"]) {
        query[method] = (...args) => { query.filters.push([method, ...args]); return query; };
      }
      query.range = async () => { queries.push(query.filters); return { data: [], error: null }; };
      return query;
    },
  };
  const service = createExpenseService(db);
  await service.list({ from: "2026-09-01", to: "2026-09-30", includeDrafts: true, includeTrashed: true });
  assert.ok(queries.some((filters) => filters.some(([method, field, value]) => method === "eq" && field === "status" && value === "trashed")
    && filters.some(([method, field, value]) => method === "is" && field === "actual_date" && value === null)));
});

test("monthly lists load an original expense referenced by an in-period adjustment", async () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const expenseId = "22222222-2222-4222-8222-222222222222";
  const seen = [];
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) }, rpc() {}, storage: {},
    from: (table) => {
      const query = { filters: [] };
      for (const method of ["select", "eq", "order", "not", "gte", "lte", "neq", "is", "in"]) {
        query[method] = (...args) => { query.filters.push([method, ...args]); return query; };
      }
      query.range = async () => {
        seen.push([table, query.filters]);
        if (table === "quickflex_expense_adjustments") return { data: [{ expense_id: expenseId }], error: null };
        return { data: [], error: null };
      };
      return query;
    },
  };
  await createExpenseService(db).list({ from: "2026-09-01", to: "2026-09-30" });
  assert.ok(seen.some(([table, filters]) => table === "quickflex_expenses" && filters.some(([method, field, ids]) => method === "in" && field === "id" && ids.includes(expenseId))));
});
