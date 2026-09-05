import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const schema = readFileSync(new URL("../supabase-schema.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL(
  "../supabase/migrations/20260905043306_record_cancellation_detail_counts.sql",
  import.meta.url,
), "utf8");
const previousCancellationMigration = readFileSync(new URL(
  "../supabase/migrations/20260904161505_record_delivery_cancellation_counts.sql",
  import.meta.url,
), "utf8");
const owner = "00000000-0000-4000-8000-000000000001";
const otherOwner = "00000000-0000-4000-8000-000000000002";
const workDate = "2026-09-05";
let db;

function functionBodies(source, name) {
  return [...source.matchAll(new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`, "g",
  ))].map((match) => match[0]);
}

function tableBody(name) {
  const match = schema.match(new RegExp(
    `create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`,
  ));
  assert.ok(match, `${name} table must exist`);
  return match[0];
}

function route({ base = "310D", count = 10, details = { "310D01": 10 }, cancellations = { "310D01": 1 } } = {}) {
  return {
    route: base,
    delivery_count: count,
    household_count: 1,
    unit_snapshot: 1000,
    sort_order: 0,
    detail_counts: details,
    ...(cancellations === undefined ? {} : { cancellation_detail_counts: cancellations }),
  };
}

async function prepareWork(workId = "work-cancel-0001", { userId = owner, dayRecord = true } = {}) {
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  if (dayRecord) {
    await db.query(`
      insert into public.quickflex_day_records(user_id, work_date)
      values ($1, $2) on conflict do nothing
    `, [userId, workDate]);
  }
  // The checked-in base finalizer still expects a lease. The new migration
  // does not alter this base function or introduce any lease requirement.
  await db.query(`
    insert into public.quickflex_active_work_leases
      (user_id, device_id, work_id, work_date, work_shift, lease_expires_at)
    values ($1, 'device-cancel-0001', $2, $3, 'day', clock_timestamp() + interval '1 hour')
    on conflict (user_id) do update set
      work_id = excluded.work_id,
      released_at = null,
      lease_expires_at = excluded.lease_expires_at
  `, [userId, workId, workDate]);
}

async function finalize({ workId = "work-cancel-0001", routes = [route()], cancelCount = 1, totalItems } = {}) {
  const total = totalItems ?? routes.reduce((sum, row) => sum + row.delivery_count, 0);
  const result = await db.query(`
    select * from public.quickflex_finalize_work_result(
      'device-cancel-0001'::text, $1::text, $2::date, 'day'::text,
      1::integer, $3::integer, 0::integer, 0::integer, $4::integer, $5::jsonb
    )
  `, [workId, workDate, total, cancelCount, JSON.stringify(routes)]);
  return result.rows[0];
}

async function expectSqlError(callback, code) {
  await db.exec("savepoint expected_error");
  await assert.rejects(callback, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
  await db.exec("rollback to savepoint expected_error; release savepoint expected_error");
}

async function receipt(workId = "work-cancel-0001", userId = owner) {
  return (await db.query(`
    select total_items, cancel_count, canonical_payload
    from public.quickflex_work_results where user_id = $1 and work_id = $2
  `, [userId, workId])).rows[0];
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  for (const table of [
    "quickflex_profiles", "quickflex_day_records", "quickflex_day_route_items",
    "quickflex_active_work_leases", "quickflex_work_results", "quickflex_work_result_routes",
    "quickflex_work_result_route_details",
  ]) {
    await db.exec(tableBody(table));
  }
  await db.exec(functionBodies(schema, "quickflex_is_approved")[0]);
  await db.exec(functionBodies(schema, "quickflex_is_admin")[0]);
  const finalizers = functionBodies(schema, "quickflex_finalize_work_result");
  assert.equal(finalizers.length, 3);
  // An optional local-only fixture lets release QA rerun the same behavior
  // cases against the read-only retrieved production base function.
  await db.exec(process.env.QUICKFLEX_FINALIZE_BASE_SQL
    ? readFileSync(process.env.QUICKFLEX_FINALIZE_BASE_SQL, "utf8")
    : finalizers[0]);
  await db.exec(finalizers[1]);
  await db.exec(previousCancellationMigration);
  await db.exec(migration);
  for (const table of ["quickflex_work_results", "quickflex_work_result_routes", "quickflex_work_result_route_details"]) {
    await db.exec(`alter table public.${table} enable row level security`);
    await db.exec(`revoke all on public.${table} from public, anon, authenticated; grant select on public.${table} to authenticated`);
    const policy = schema.match(new RegExp(
      `create policy "[^"]+"\\s+on public\\.${table}\\s+[\\s\\S]*?;`,
    ));
    assert.ok(policy, `${table} select policy must exist`);
    await db.exec(policy[0]);
  }
  await db.query("insert into auth.users(id) values ($1), ($2)", [owner, otherOwner]);
  await db.query(`
    insert into public.quickflex_profiles(id, status) values ($1, 'approved'), ($2, 'approved')
  `, [owner, otherOwner]);
});

beforeEach(async () => {
  await db.exec("begin");
  await prepareWork();
});
afterEach(async () => { await db.exec("rollback"); });
after(async () => { await db.close(); });

test("new cancellation wrapper is exactly mirrored in canonical schema and keeps the RPC signature", () => {
  const normalize = (sql) => sql.replace(/\r\n/g, "\n");
  const body = functionBodies(migration, "quickflex_finalize_work_result")[0];
  assert.equal(normalize(functionBodies(schema, "quickflex_finalize_work_result")[2]), normalize(body));
  assert.match(body, /p_return_count integer,\s*p_cancel_count integer,\s*p_routes jsonb/);
  assert.match(body, /security definer\s*set search_path = ''/);
  assert.match(body, /current_user_id uuid := \(select auth\.uid\(\)\)/);
  assert.doesNotMatch(body, /update public\.quickflex_work_result_routes/);
  assert.doesNotMatch(body, /update public\.quickflex_work_result_route_details/);
  assert.doesNotMatch(body, /set total_items|set delivery_count|active work lease/);
});

test("one cancellation stays inside 10 deliveries and 10000 revenue and is stored by detail route", async () => {
  await db.exec("set local role authenticated");
  assert.deepEqual(await finalize(), { status: "applied", work_id: "work-cancel-0001" });
  const saved = await receipt();
  assert.equal(saved.total_items, 10);
  assert.equal(saved.cancel_count, 1);
  assert.deepEqual(saved.canonical_payload.cancellation_detail_counts, { "310D01": 1 });
  assert.equal(saved.canonical_payload.routes[0].delivery_count, 10);
  assert.equal(saved.canonical_payload.routes[0].cancellation_detail_counts, undefined);
  const totals = (await db.query(`
    select sum(delivery_count)::integer as count,
           sum(delivery_count * unit_snapshot)::integer as revenue
    from public.quickflex_work_result_routes
  `)).rows[0];
  assert.deepEqual(totals, { count: 10, revenue: 10000 });
});

test("exact retries do not add deliveries, cancellation totals, or receipt rows twice", async () => {
  await finalize();
  const beforeRetry = await receipt();
  assert.equal((await finalize()).status, "already_applied");
  assert.deepEqual(await receipt(), beforeRetry);
  assert.equal((await db.query("select count(*)::integer as n from public.quickflex_work_results")).rows[0].n, 1);
  assert.equal((await db.query("select cancel_count from public.quickflex_day_records")).rows[0].cancel_count, 1);
});

test("changed attribution, explicit empty map, and changed global count conflict with immutable receipt", async () => {
  await finalize();
  const saved = await receipt();
  await expectSqlError(() => finalize({ routes: [route({ cancellations: { "310D02": 1 } })] }), "23505");
  await expectSqlError(() => finalize({ routes: [route({ cancellations: {} })] }), "23505");
  await expectSqlError(() => finalize({ cancelCount: 2 }), "23505");
  assert.deepEqual(await receipt(), saved);
});

test("a legacy client retry omits the map without erasing stored attribution", async () => {
  await finalize();
  const legacyRoute = route();
  delete legacyRoute.cancellation_detail_counts;
  assert.equal((await finalize({ routes: [legacyRoute] })).status, "already_applied");
  assert.deepEqual((await receipt()).canonical_payload.cancellation_detail_counts, { "310D01": 1 });
});

test("legacy receipts without metadata accept empty retries but never invent or late-add routes", async () => {
  // Create a receipt using the genuinely previous wrapper, then apply the new migration.
  await db.exec(functionBodies(previousCancellationMigration, "quickflex_finalize_work_result")[0]);
  await finalize();
  assert.equal((await receipt()).canonical_payload.cancellation_detail_counts, undefined);
  await db.exec(functionBodies(migration, "quickflex_finalize_work_result")[0]);
  assert.equal((await finalize({ routes: [route({ cancellations: {} })] })).status, "already_applied");
  await expectSqlError(() => finalize(), "23505");
  assert.equal((await receipt()).canonical_payload.cancellation_detail_counts, undefined);
});

test("new empty receipts persist an empty map and normalize zero annotations", async () => {
  await finalize({ routes: [route({ cancellations: { "310D01": 0 } })], cancelCount: 0 });
  assert.deepEqual((await receipt()).canonical_payload.cancellation_detail_counts, {});
  assert.equal((await finalize({ routes: [route({ cancellations: {} })], cancelCount: 0 })).status, "already_applied");
});

test("old clients and partially attributed cancellation totals remain valid without guessed routes", async () => {
  const legacyRoute = route();
  delete legacyRoute.cancellation_detail_counts;
  await finalize({ routes: [legacyRoute], cancelCount: 2 });
  assert.deepEqual((await receipt()).canonical_payload.cancellation_detail_counts, {});
  assert.equal((await receipt()).cancel_count, 2);
  await prepareWork("work-cancel-0002");
  await finalize({ workId: "work-cancel-0002", cancelCount: 2 });
  const partial = await receipt("work-cancel-0002");
  assert.deepEqual(partial.canonical_payload.cancellation_detail_counts, { "310D01": 1 });
  assert.equal(partial.cancel_count, 2);
  assert.equal(partial.total_items, 10);
});

test("different base routes and different works keep independent attribution", async () => {
  const routes = [
    route({ count: 10 }),
    route({ base: "314C", count: 5, details: { "314C03": 5 }, cancellations: { "314C03": 2 } }),
  ];
  await finalize({ routes, cancelCount: 3 });
  assert.deepEqual((await receipt()).canonical_payload.cancellation_detail_counts, { "310D01": 1, "314C03": 2 });
  await prepareWork("work-cancel-0002");
  await finalize({ workId: "work-cancel-0002" });
  assert.deepEqual((await receipt("work-cancel-0002")).canonical_payload.cancellation_detail_counts, { "310D01": 1 });
  assert.equal((await db.query("select cancel_count from public.quickflex_day_records")).rows[0].cancel_count, 4);
});

test("manual reconciliation does not rescale or reject observed cancellation route annotation", async () => {
  const routes = [
    route({ count: 0, details: {}, cancellations: { "310D01": 1 } }),
    route({ base: "314C", count: 10, details: { "314C03": 10 }, cancellations: {} }),
  ];
  delete routes[0].detail_counts;
  await finalize({ routes });
  const saved = await receipt();
  assert.equal(saved.total_items, 10);
  assert.deepEqual(saved.canonical_payload.cancellation_detail_counts, { "310D01": 1 });
});

test("invalid metadata fails atomically before any receipt or route is committed", async () => {
  const invalidMaps = [
    null, [], "bad", { "310D": 1 }, { "310d01": 1 }, { "314C03": 1 },
    { "310D01": -1 }, { "310D01": 1.5 }, { "310D01": "1" },
    { "310D01": true }, { "310D01": null }, { "310D01": 2147483648 },
    { "310D01": 2 },
  ];
  for (const cancellations of invalidMaps) {
    await expectSqlError(() => finalize({ routes: [route({ cancellations })] }), "22023");
  }
  for (const routes of [null, {}, [], [null]]) {
    await expectSqlError(() => finalize({ routes, totalItems: 10 }), "22023");
  }
  assert.equal(await receipt(), undefined);
  assert.equal((await db.query("select count(*)::integer as n from public.quickflex_work_result_routes")).rows[0].n, 0);
  assert.equal((await db.query("select released_at from public.quickflex_active_work_leases")).rows[0].released_at, null);
});

test("a failure after base writes rolls the entire receipt and lease release back", async () => {
  await db.exec("delete from public.quickflex_day_records");
  await expectSqlError(() => finalize(), "55000");
  assert.equal(await receipt(), undefined);
  assert.equal((await db.query("select count(*)::integer as n from public.quickflex_work_result_route_details")).rows[0].n, 0);
  assert.equal((await db.query("select released_at from public.quickflex_active_work_leases")).rows[0].released_at, null);
});

test("approved authenticated users only write and read their own cancellation metadata", async () => {
  await finalize();
  await prepareWork("work-cancel-0001", { userId: otherOwner });
  await db.exec("set local role authenticated");
  await finalize({ routes: [route({ cancellations: { "310D02": 1 } })] });
  const visible = (await db.query("select user_id, canonical_payload from public.quickflex_work_results")).rows;
  assert.equal(visible.length, 1);
  assert.equal(visible[0].user_id, otherOwner);
  assert.deepEqual(visible[0].canonical_payload.cancellation_detail_counts, { "310D02": 1 });
  await db.exec("reset role");
  assert.deepEqual((await receipt()).canonical_payload.cancellation_detail_counts, { "310D01": 1 });
});

test("anonymous and unapproved accounts cannot finalize, and execute privileges stay restricted", async () => {
  await db.query("select set_config('request.jwt.claim.sub', '', false)");
  await expectSqlError(() => finalize(), "42501");
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
  await db.query("update public.quickflex_profiles set status = 'pending' where id = $1", [owner]);
  await expectSqlError(() => finalize(), "42501");
  const privileges = (await db.query(`
    select has_function_privilege('anon',
      'public.quickflex_finalize_work_result(text,text,date,text,integer,integer,integer,integer,integer,jsonb)', 'EXECUTE') as anon,
      has_function_privilege('authenticated',
      'public.quickflex_finalize_work_result(text,text,date,text,integer,integer,integer,integer,integer,jsonb)', 'EXECUTE') as authenticated
  `)).rows[0];
  assert.deepEqual(privileges, { anon: false, authenticated: true });
  assert.equal(await receipt(), undefined);
});
