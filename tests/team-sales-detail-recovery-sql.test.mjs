import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, afterEach, before, beforeEach, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('..', import.meta.url);
const schema = readFileSync(new URL('supabase-schema.sql', root), 'utf8');
const ledger = readFileSync(new URL('supabase/migrations/20260906022033_team_sales_ledger.sql', root), 'utf8');
const recovery = readFileSync(new URL('supabase/migrations/20260920021710_recover_team_detail_counts_from_complete_evidence.sql', root), 'utf8');
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const day = '2026-09-19';
let db;

const hash = (id) => createHash('sha256').update(id).digest('hex');
const delivery = (id, route, detail, count, extra = {}) => ({
  id, route, detailedRoute: detail, count, invoiceHash: hash(id), cancellation: false, returned: false, ...extra,
});
function work(id, routes, deliveries) {
  const total = routes.reduce((sum, route) => sum + route.delivery_count, 0);
  return {
    work_id: id,
    work_date: day,
    work_shift: 'night',
    total_households: 1,
    total_items: total,
    fresh_count: 0,
    return_count: 0,
    cancel_count: deliveries.reduce((sum, row) => sum + (row.cancellationCount ?? (row.cancellation ? row.count : 0)), 0),
    routes,
    evidence: { deliveries, freshSerials: [] },
  };
}
function route(routeCode, deliveryCount, detailCounts) {
  const value = {
    route: routeCode,
    delivery_count: deliveryCount,
    household_count: 1,
    unit_snapshot: 1000,
    sort_order: 0,
  };
  if (detailCounts !== undefined) value.detail_counts = detailCounts;
  return value;
}
async function submit(payload, device = 'detail-device-0001') {
  return (await db.query('select * from public.quickflex_finalize_team_work($1,$2::jsonb)', [
    device,
    JSON.stringify(payload),
  ])).rows[0];
}
async function details() {
  return (await db.query(
    'select detail_route, delivery_count from public.quickflex_sales_work_details where user_id=$1 and work_id=$2 order by detail_route',
    [owner, `team:${day}`],
  )).rows;
}
async function teamSales() {
  return (await db.query('select * from public.quickflex_team_sales where user_id=$1 and work_date=$2', [owner, day])).rows[0];
}

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  for (const name of [
    'quickflex_profiles',
    'quickflex_day_records',
    'quickflex_day_route_items',
    'quickflex_work_results',
    'quickflex_work_result_routes',
    'quickflex_work_result_route_details',
    'quickflex_automatic_sales_overrides',
  ]) {
    const statement = schema.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0];
    await db.exec(statement);
  }
  await db.exec(`alter table public.quickflex_day_records add column cancel_count integer not null default 0;
    alter table public.quickflex_work_results add column cancel_count integer not null default 0;
    alter table public.quickflex_day_records add column freshbag_mode text not null default 'single',
      add column fresh_solo_count integer not null default 0,
      add column fresh_linked_count integer not null default 0;`);
  for (const name of ['quickflex_is_approved', 'quickflex_is_admin']) {
    await db.exec(schema.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))[0]);
  }
  for (const name of [
    'quickflex_work_results',
    'quickflex_work_result_routes',
    'quickflex_work_result_route_details',
    'quickflex_automatic_sales_overrides',
  ]) {
    await db.exec(`alter table public.${name} enable row level security;
      grant select on public.${name} to authenticated;
      create policy own_rows on public.${name} for select to authenticated using(user_id=(select auth.uid()));`);
  }
  await db.exec(ledger);
  await db.exec(recovery);
  await db.exec('create trigger quickflex_guard_manual_counts_after_work_result before insert or update on public.quickflex_day_route_items for each row execute function public.quickflex_guard_manual_counts_after_work_result()');
  await db.query('insert into auth.users values($1),($2)', [owner, other]);
  await db.query("insert into public.quickflex_profiles(id,status) values($1,'approved'),($2,'approved')", [owner, other]);
});
beforeEach(async () => {
  await db.exec('begin');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
});
afterEach(async () => { await db.exec('rollback'); });
after(async () => { await db.close(); });

test('recovers the cancellation-bearing 316C breakdown only from complete work evidence', async () => {
  const payload = work('work-316c-recovery', [
    route('316C', 196),
    route('316D', 100, { '316D01': 100 }),
  ], [
    delivery('c01', '316C', '316C01', 137, { cancellation: true, cancellationCount: 1 }),
    delivery('c02', '316C', '316C02', 59),
    delivery('d01', '316D', '316D01', 100),
  ]);
  assert.equal((await submit(payload)).status, 'applied');
  assert.deepEqual(await details(), [
    { detail_route: '316C01', delivery_count: 137 },
    { detail_route: '316C02', delivery_count: 59 },
    { detail_route: '316D01', delivery_count: 100 },
  ]);
  const sales = await teamSales();
  assert.equal(sales.total_items, 296);
  assert.equal(sales.cancel_count, 1);
  assert.deepEqual(sales.cancellation_detail_counts, { '316C01': 1 });
  assert.equal((await db.query(
    "select sum(delivery_count * unit_snapshot)::integer as revenue from public.quickflex_sales_work_routes where user_id=$1 and work_id=$2",
    [owner, `team:${day}`],
  )).rows[0].revenue, 296000);

  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
  await db.exec('set local role authenticated');
  assert.equal((await db.query('select count(*)::integer as count from public.quickflex_sales_work_details')).rows[0].count, 0);
});

test('does not infer details from a correction-sized mismatch or an invalid detailed route', async () => {
  assert.equal((await submit(work('work-correction-mismatch', [route('316C', 196)], [
    delivery('c01', '316C', '316C01', 137),
    delivery('c02', '316C', '316C02', 58),
  ]))).status, 'applied');
  assert.deepEqual(await details(), []);
  assert.equal((await teamSales()).total_items, 196);

  await db.exec('rollback'); await db.exec('begin');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
  const invalid = work('work-invalid-detail', [route('316C', 196)], [
    delivery('wrong-detail', '316C', '316D01', 196),
  ]);
  await db.query('insert into public.quickflex_team_work_inputs(user_id,work_id,device_id,work_date,payload) values($1,$2,$3,$4,$5::jsonb)', [
    owner, invalid.work_id, 'detail-device-0001', day, JSON.stringify(invalid),
  ]);
  assert.deepEqual(await details(), []);

  await db.exec('rollback'); await db.exec('begin');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
  const withUnknownRoute = work('work-unknown-route', [route('316C', 196)], [
    delivery('c01', '316C', '316C01', 137),
    delivery('c02', '316C', '316C02', 59),
    { id: 'unknown', route: null, detailedRoute: null, count: 1, invoiceHash: hash('unknown') },
  ]);
  await db.query('insert into public.quickflex_team_work_inputs(user_id,work_id,device_id,work_date,payload) values($1,$2,$3,$4,$5::jsonb)', [
    owner, withUnknownRoute.work_id, 'detail-device-0001', day, JSON.stringify(withUnknownRoute),
  ]);
  assert.deepEqual(await details(), []);
});

test('keeps cross-phone invoice deduplication while recovering the same complete evidence', async () => {
  const deliveries = [
    delivery('shared-c01', '316C', '316C01', 137),
    delivery('shared-c02', '316C', '316C02', 59),
  ];
  await submit(work('work-phone-one', [route('316C', 196)], deliveries), 'detail-device-0001');
  await submit(work('work-phone-two', [route('316C', 196)], deliveries), 'detail-device-0002');
  assert.deepEqual(await details(), [
    { detail_route: '316C01', delivery_count: 137 },
    { detail_route: '316C02', delivery_count: 59 },
  ]);
  assert.equal((await teamSales()).total_items, 196);
});

test('preserves supplied full and partial detail quantities instead of replacing them from evidence', async () => {
  const deliveries = [
    delivery('c01', '316C', '316C01', 137),
    delivery('c02', '316C', '316C02', 59),
  ];
  await submit(work('work-explicit-full', [route('316C', 196, { '316C01': 120, '316C02': 76 })], deliveries));
  assert.deepEqual(await details(), [
    { detail_route: '316C01', delivery_count: 120 },
    { detail_route: '316C02', delivery_count: 76 },
  ]);

  await db.exec('rollback'); await db.exec('begin');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
  await submit(work('work-explicit-partial', [route('316C', 196, { '316C01': 100 })], deliveries));
  assert.deepEqual(await details(), [{ detail_route: '316C01', delivery_count: 100 }]);
});
