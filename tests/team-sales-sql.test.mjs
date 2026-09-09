import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test, { before, after, beforeEach, afterEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const schema = readFileSync(new URL('../supabase-schema.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../supabase/migrations/20260906022033_team_sales_ledger.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const day = '2026-09-06';
let db;
test('canonical schema mirrors the team ledger migration', () => {
  assert.ok(schema.replace(/\r\n/g,'\n').includes(migration.trim().replace(/\r\n/g,'\n')));
});
const hash = (id) => createHash('sha256').update(id).digest('hex');
const evidence = (id, overrides = {}) => ({ id, route: '314D', count: 1, invoiceHash: hash(id), detailedRoute: '314D01', cancellation: false, returned: false, ...overrides });
function payload(id, deliveries, { count = deliveries.reduce((sum, d) => sum + d.count, 0), fresh = [], freshCount = fresh.length, routes, date = day } = {}) {
  return {
    work_id: id, work_date: date, work_shift: 'night', total_households: 1, total_items: count,
    fresh_count: freshCount, return_count: deliveries.filter(d => d.returned).reduce((s,d) => s+d.count,0),
    cancel_count: deliveries.filter(d => d.cancellation).reduce((s,d) => s+d.count,0),
    routes: routes || [{ route: '314D', delivery_count: count, household_count: 1, unit_snapshot: 1000, sort_order: 0,
      detail_counts: { '314D01': count }, cancellation_detail_counts: {} }],
    evidence: { deliveries, freshSerials: fresh },
  };
}
async function submit(p, device = 'device-0001') {
  return (await db.query('select * from public.quickflex_finalize_team_work($1,$2::jsonb)', [device, JSON.stringify(p)])).rows[0];
}
async function total() { return (await db.query('select * from public.quickflex_team_sales')).rows[0]; }
async function correction(count, basis, revision = 0, request = 'correction-0001') {
  return (await db.query('select * from public.quickflex_replace_team_sales_override($1,$2,$3,$4,$5::jsonb,$6::jsonb)',
    [day, revision, request, 'manual', JSON.stringify([{ route: '314D', delivery_count: count, unit_snapshot: 1000, sort_order: 0 }]), JSON.stringify(basis)])).rows[0];
}
async function sqlError(fn, code) {
  await db.exec('savepoint expected_error');
  await assert.rejects(fn, error => { assert.equal(error.code, code, error.message); return true; });
  await db.exec('rollback to savepoint expected_error; release savepoint expected_error');
}

before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  for (const name of ['quickflex_profiles','quickflex_day_records','quickflex_day_route_items','quickflex_work_results','quickflex_work_result_routes','quickflex_work_result_route_details','quickflex_automatic_sales_overrides']) {
    const sql = schema.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0];
    await db.exec(sql);
  }
  await db.exec('alter table public.quickflex_day_records add column cancel_count integer not null default 0; alter table public.quickflex_work_results add column cancel_count integer not null default 0;');
  await db.exec("alter table public.quickflex_day_records add column freshbag_mode text not null default 'single', add column fresh_solo_count integer not null default 0, add column fresh_linked_count integer not null default 0;");
  for (const fn of ['quickflex_is_approved','quickflex_is_admin']) {
    await db.exec(schema.match(new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\n\\$\\$;`))[0]);
  }
  for (const name of ['quickflex_work_results','quickflex_work_result_routes','quickflex_work_result_route_details','quickflex_automatic_sales_overrides']) {
    await db.exec(`alter table public.${name} enable row level security; grant select on public.${name} to authenticated;
      create policy own_rows on public.${name} for select to authenticated using(user_id=(select auth.uid()));`);
  }
  await db.exec(migration);
  await db.exec('create trigger quickflex_guard_manual_counts_after_work_result before insert or update on public.quickflex_day_route_items for each row execute function public.quickflex_guard_manual_counts_after_work_result()');
  await db.query('insert into auth.users values($1),($2)', [owner,other]);
  await db.query("insert into public.quickflex_profiles(id,status) values($1,'approved'),($2,'approved')", [owner,other]);
});
beforeEach(async () => { await db.exec('begin'); await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]); });
afterEach(async () => { await db.exec('rollback'); });
after(async () => { await db.close(); });

test('one phone keeps its quantities, route rate and exact retry', async () => {
  const p = payload('work-single', [evidence('one'),evidence('two')]);
  assert.equal((await submit(p)).status, 'applied');
  assert.equal((await submit(p)).status, 'already_applied');
  assert.equal((await total()).total_items, 2);
  assert.equal((await total()).routes[0].unit_snapshot,1000);
  await sqlError(() => submit({...p,total_items:3}), '22023');
  await sqlError(() => submit({...p,fresh_count:1}), '23505');
});
test('A60 and B40 make one date record with 100, not two shared totals', async () => {
  await submit(payload('work-phone-a', Array.from({length:60},(_,i)=>evidence(`a${i}`))));
  assert.equal((await total()).total_items,60);
  await submit(payload('work-phone-b', Array.from({length:40},(_,i)=>evidence(`b${i}`))), 'device-0002');
  assert.equal((await total()).total_items,100);
  assert.equal((await db.query('select count(*)::integer n from public.quickflex_sales_work_results')).rows[0].n,1);
});
test('two or three phones seeing the same invoices count only once in either arrival order', async () => {
  const list = Array.from({length:100},(_,i)=>evidence(`same${i}`));
  for (const name of ['third','first','second']) await submit(payload(`work-${name}`,list), `device-${name}`);
  assert.equal((await total()).total_items,100);
  assert.equal((await db.query('select sum(delivery_count * unit_snapshot)::integer revenue from public.quickflex_sales_work_routes')).rows[0].revenue,100000);
});
test('positive and negative per-phone manual corrections survive colleague deliveries', async () => {
  await submit(payload('work-phone-a',[evidence('a',{count:60})], {count:65}));
  await submit(payload('work-phone-b',[evidence('b',{count:40})]));
  assert.equal((await total()).total_items,105);
  await submit(payload('work-phone-c',[evidence('a',{count:60})], {count:55}));
  assert.equal((await total()).total_items,100);
});
test('date correction 60 to 65 remains +5 when B40 arrives later', async () => {
  await submit(payload('work-phone-a',[evidence('a',{count:60})]));
  assert.equal((await correction(65,{'314D':60})).status,'applied');
  await submit(payload('work-phone-b',[evidence('b',{count:40})]));
  const current = (await db.query('select * from public.quickflex_sales_overrides')).rows[0];
  assert.equal(current.total_items,105);
  assert.equal((await correction(65,{'314D':60})).status,'already_applied');
  assert.equal((await db.query('select total_items from public.quickflex_sales_overrides')).rows[0].total_items,105);
});
test('late arrival while editing and two stale editors fail visibly without overwriting', async () => {
  await submit(payload('work-phone-a',[evidence('a',{count:60})]));
  await submit(payload('work-phone-b',[evidence('b',{count:40})]));
  await sqlError(() => correction(65,{'314D':60}), '40001');
  await correction(105,{'314D':100});
  await sqlError(() => correction(102,{'314D':100},0,'correction-0002'), '40001');
});
test('restarting the same day does not duplicate invoices and another date is independent', async () => {
  await submit(payload('work-first',[evidence('same')]));
  await submit(payload('work-restart',[evidence('same'),evidence('new')]));
  assert.equal((await total()).total_items,2);
  await submit(payload('work-next-day',[evidence('same')],{date:'2026-09-07'}));
  assert.equal((await db.query('select sum(total_items)::integer n from public.quickflex_team_sales')).rows[0].n,3);
});
test('fresh serial union preserves corrections and never adds the same bag twice', async () => {
  await submit(payload('work-phone-a',[evidence('a')],{fresh:['C1-ABCDE','C2-12345'],freshCount:5}));
  await submit(payload('work-phone-b',[evidence('b')],{fresh:['C1-ABCDE','C2-98765']}));
  assert.equal((await total()).fresh_count,6);
  assert.equal((await db.query('select fresh_count from public.quickflex_day_records')).rows[0].fresh_count,6);
  await db.exec('update public.quickflex_day_records set fresh_count=4');
  await submit(payload('work-phone-c',[evidence('c')],{fresh:['C2-AAAAA']}));
  assert.equal((await db.query('select fresh_count from public.quickflex_day_records')).rows[0].fresh_count,5);
});
test('returns and cancellations remain inside deliveries with separate deduplicated annotations', async () => {
  const list = [evidence('cancel',{cancellation:true}),evidence('return',{returned:true}),evidence('normal')];
  await submit(payload('work-phone-a',list)); await submit(payload('work-phone-b',list));
  const t = await total();
  assert.equal(t.total_items,3); assert.equal(t.cancel_count,1); assert.equal(t.return_count,1);
  assert.deepEqual(t.cancellation_detail_counts,{'314D01':1});
});
test('same invoice cannot silently move to a competing route', async () => {
  await submit(payload('work-phone-a',[evidence('same')]));
  await sqlError(() => submit(payload('work-phone-b',[evidence('same',{route:'314C',detailedRoute:'314C01'})])), '22023');
  assert.equal((await total()).total_items,1);
});
test('missing invoices are not falsely deduplicated just because the routes match', async () => {
  await submit(payload('work-phone-a',[evidence('local',{invoiceHash:null})]));
  await submit(payload('work-phone-b',[evidence('local',{invoiceHash:null})]));
  assert.equal((await total()).total_items,2);
});
test('authenticated users see only own inputs and projections and cannot directly write', async () => {
  await submit(payload('work-owner',[evidence('one')]));
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
  await db.exec('set local role authenticated');
  assert.equal((await db.query('select * from public.quickflex_team_work_inputs')).rows.length,0);
  assert.equal((await db.query('select * from public.quickflex_sales_work_results')).rows.length,0);
  await submit(payload('work-other',[evidence('one')]));
  assert.equal((await total()).total_items,1);
  await sqlError(() => db.exec('delete from public.quickflex_team_work_inputs'), '42501');
});
test('anonymous and unapproved accounts cannot finalize', async () => {
  await db.exec('set local role anon');
  await sqlError(() => submit(payload('work-anon',[evidence('one')])), '42501');
  await db.exec('reset role');
  await db.query("update public.quickflex_profiles set status='pending' where id=$1",[owner]);
  await sqlError(() => submit(payload('work-pending',[evidence('one')])), '42501');
});

test('fresh-bag form correction keeps a late colleague arrival and retries exactly once', async () => {
  await submit(payload('work-phone-a',[evidence('a')],{fresh:['C1-AAAAA','C1-BBBBB']}));
  const expected = {fresh_count:2,fresh_unit:100,fresh_solo_count:0,fresh_linked_count:0,backup_unit:30,freshbag_mode:'single',driver_type:'backup'};
  await submit(payload('work-phone-b',[evidence('b')],{fresh:['C1-CCCCC']}));
  const values = {...expected,fresh_count:4};
  const args = [day,0,JSON.stringify(expected),JSON.stringify(values)];
  const save = () => db.query('select public.quickflex_update_sales_day($1,$2,$3::jsonb,$4::jsonb) as saved',args);
  assert.equal((await save()).rows[0].saved.fresh_count,5);
  assert.equal((await save()).rows[0].saved.fresh_count,5);
  await sqlError(() => db.query('select public.quickflex_update_sales_day($1,0,$2::jsonb,$3::jsonb)',[day,JSON.stringify(expected),JSON.stringify({...values,fresh_count:1})]),'40001');
});

test('partial cancellation metadata counts one not the whole multi-item delivery', async () => {
  const items = [evidence('cancel',{count:3,cancellation:true,cancellationCount:1})];
  const p = payload('work-phone-a',items); p.cancel_count=1;
  await submit(p); await submit({...p,work_id:'work-phone-b'});
  assert.equal((await total()).total_items,3); assert.equal((await total()).cancel_count,1);
});

test('a new colleague route appears after an existing-route correction with its own rate', async () => {
  await submit(payload('work-phone-a',[evidence('a',{count:60})]));
  await correction(65,{'314D':60});
  await submit(payload('work-phone-b',[evidence('b',{count:40,route:'314C',detailedRoute:'314C01'})],{
    routes:[{route:'314C',delivery_count:40,household_count:1,unit_snapshot:1200,sort_order:0,detail_counts:{'314C01':40}}]
  }));
  const effective = (await db.query('select * from public.quickflex_sales_overrides')).rows[0];
  assert.equal(effective.total_items,105);
  assert.deepEqual(effective.routes.map(r=>[r.route,r.delivery_count,r.unit_snapshot]),[['314C',40,1200],['314D',65,1000]]);
});

test('an older manual editor cannot delete or replace a date after team work arrives', async () => {
  const manual = (remove=false) => db.query(
    'select public.quickflex_replace_manual_day_record($1,$2,false,2,100,0,0,30,$3,$4::jsonb)',
    [day,remove,'backup',JSON.stringify([{route:'314D',delivery_count:2,household_count:1,unit_snapshot:1000,sort_order:0}])]
  );
  await manual();
  await submit(payload('work-phone-a',[evidence('a')],{fresh:['C1-AAAAA']}));
  await sqlError(()=>manual(), '55000');
  await sqlError(()=>manual(true), '55000');
  await sqlError(()=>db.query("insert into public.quickflex_day_route_items(user_id,work_date,route,delivery_count) values($1,$2,'314C',5)",[owner,day]), '55000');
  assert.equal((await db.query('select fresh_count from public.quickflex_day_records')).rows[0].fresh_count,3);
  assert.equal((await total()).total_items,1);
});

test('legacy receipts and their saved prices stay unchanged alongside new work', async () => {
  const receipt = {work_date:day,total_items:10,routes:[{route:'314D',delivery_count:10,unit_snapshot:900,sort_order:0}]};
  await db.query("insert into public.quickflex_work_results(user_id,work_id,device_id,work_date,work_shift,total_households,total_items,canonical_payload) values($1,'legacy-work','legacy-device',$2,'night',8,10,$3::jsonb)",[owner,day,JSON.stringify(receipt)]);
  await db.query("insert into public.quickflex_work_result_routes values($1,'legacy-work','314D',10,8,900,0)",[owner]);
  await submit(payload('work-phone-a',[evidence('a',{count:2})]));
  const rows = (await db.query('select * from public.quickflex_sales_work_results order by work_id')).rows;
  assert.equal(rows.length,2); assert.deepEqual(rows[0].canonical_payload,receipt);
  assert.equal((await db.query('select sum(delivery_count * unit_snapshot)::integer revenue from public.quickflex_sales_work_routes')).rows[0].revenue,11000);
});

test('daytime team finalization preserves preexisting manual route rows and their dated prices in storage', async () => {
  await db.query(
    'select public.quickflex_replace_manual_day_record($1,false,false,12,100,0,0,30,$2,$3::jsonb)',
    [day, 'backup', JSON.stringify([{route:'310D',delivery_count:120,household_count:90,unit_snapshot:1050,sort_order:0}])]
  );
  const before = (await db.query('select * from public.quickflex_day_route_items where user_id=$1 and work_date=$2', [owner, day])).rows;
  const daytime = { ...payload('work-daytime', [evidence('daytime', {count:40})]), work_shift:'day' };
  assert.equal((await submit(daytime)).status, 'applied');
  const after = (await db.query('select * from public.quickflex_day_route_items where user_id=$1 and work_date=$2', [owner, day])).rows;
  assert.deepEqual(after, before, 'finalization must not delete, zero or rewrite the manual baseline');
  assert.equal((await total()).total_items, 40, 'automatic projection contains its own items, not manual baseline');
  assert.equal((await submit(daytime)).status, 'already_applied');
  assert.deepEqual((await db.query('select * from public.quickflex_day_route_items where user_id=$1 and work_date=$2', [owner, day])).rows, before);
});

test('daytime and nighttime immutable team inputs are both retained in the date aggregate', async () => {
  const night = payload('work-nighttime', [evidence('nighttime', {count:120})]);
  const daytime = { ...payload('work-daytime', [evidence('daytime', {count:40})]), work_shift:'day' };
  await submit(night);
  await submit(daytime);
  const inputs = (await db.query('select payload from public.quickflex_team_work_inputs order by work_id')).rows;
  assert.equal(inputs.length, 2);
  assert.deepEqual(inputs.map((row) => row.payload).sort((a,b) => a.work_id.localeCompare(b.work_id)), [daytime, night]);
  assert.equal((await total()).total_items, 160);
  assert.equal((await total()).work_shift, 'day', 'the aggregate label is min(day,night), not a shift filter');
});

test('full date correction including manual night baseline receives later automatic delta only once', async () => {
  await db.query(
    'select public.quickflex_replace_manual_day_record($1,false,false,0,100,0,0,30,$2,$3::jsonb)',
    [day, 'backup', JSON.stringify([{route:'310D',delivery_count:120,household_count:90,unit_snapshot:1050,sort_order:0}])]
  );
  await submit({...payload('work-daytime', [evidence('daytime', {count:40})]), work_shift:'day'});
  const originalManual = (await db.query('select * from public.quickflex_day_route_items')).rows;
  const editedFullDay = [
    {route:'310D',delivery_count:125,unit_snapshot:1080,sort_order:0},
    {route:'314D',delivery_count:40,unit_snapshot:1000,sort_order:1}
  ];
  const args = [day,0,'correction-manual-baseline','manual night plus day',JSON.stringify(editedFullDay),JSON.stringify({'314D':40})];
  await db.query('select * from public.quickflex_replace_team_sales_override($1,$2,$3,$4,$5::jsonb,$6::jsonb)', args);
  assert.equal((await db.query('select total_items from public.quickflex_sales_overrides')).rows[0].total_items,165);
  await submit({...payload('work-daytime-later',[evidence('daytime-later',{count:20})]),work_shift:'day'});
  const effective = (await db.query('select * from public.quickflex_sales_overrides')).rows[0];
  assert.equal(effective.total_items,185, 'manual120 plus edited5 plus auto60, not manual120 added again');
  assert.deepEqual(effective.routes.map(row=>[row.route,row.delivery_count,row.unit_snapshot]),[['310D',125,1080],['314D',60,1000]]);
  assert.deepEqual((await db.query('select * from public.quickflex_day_route_items')).rows, originalManual);
  assert.equal((await db.query('select * from public.quickflex_replace_team_sales_override($1,$2,$3,$4,$5::jsonb,$6::jsonb)',args)).rows[0].status,'already_applied');
  assert.equal((await db.query('select total_items from public.quickflex_sales_overrides')).rows[0].total_items,185);
});
