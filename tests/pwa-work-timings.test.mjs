import assert from "node:assert/strict";
import test from "node:test";
import { fetchWorkTimings } from "../src/services/work-timings.js";

function client(pages, requests) {
  return { from(table) {
    const request = { table, orders: [] }; requests.push(request);
    const query = {
      select(columns, options) { Object.assign(request, { columns, options }); return query; },
      eq(key, value) { request.owner = [key, value]; return query; },
      order(key) { request.orders.push(key); return query; },
      range(from, to) { request.range = [from, to]; return Promise.resolve(pages.shift()); },
    }; return query;
  } };
}

test("timing reads require an owner and page through only that owner's rows", async () => {
  const requests = [];
  const first = Array.from({ length: 1000 }, (_, i) => ({ user_id: "synthetic-owner", work_id: `synthetic-${i}` }));
  const db = client([{ data: first, count: 1001 }, { data: [{ user_id: "synthetic-owner", work_id: "last" }], count: 1001 }], requests);
  assert.deepEqual(await fetchWorkTimings(db, ""), { rows: [], available: false });
  assert.equal(requests.length, 0);
  const result = await fetchWorkTimings(db, "synthetic-owner");
  assert.equal(result.rows.length, 1001);
  assert.equal(result.available, true);
  for (const request of requests) assert.deepEqual(request.owner, ["user_id", "synthetic-owner"]);
  assert.deepEqual(requests[1].range, [1000, 1999]);
});

test("unavailable timing migration does not turn into zero timing history", async () => {
  for (const response of [{ error: { code: "42P01" } }, { error: { code: "PGRST205" } }, { status: 404, error: { code: "404" } }]) {
    assert.deepEqual(await fetchWorkTimings(client([response], []), "synthetic-owner"), { rows: [], available: false });
  }
});

test("unexpected read failures never yield a partial timing sample", async () => {
  const error = { code: "42501", message: "synthetic denied" };
  await assert.rejects(fetchWorkTimings(client([{ data: [{ user_id: "synthetic-owner" }], count: 2 }, { error }], []), "synthetic-owner"), (value) => value === error);
});

test("foreign rows are discarded even if a malformed response includes them", async () => {
  const result = await fetchWorkTimings(client([{ data: [{ user_id: "other" }, { user_id: "synthetic-owner" }], count: 2 }], []), "synthetic-owner");
  assert.deepEqual(result.rows, [{ user_id: "synthetic-owner" }]);
});
