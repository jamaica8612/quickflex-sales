import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, afterEach, before, beforeEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20261003093111_record_work_timing.sql', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../supabase-schema.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const admin = '00000000-0000-4000-8000-000000000003';
const pending = '00000000-0000-4000-8000-000000000004';
const day = '2026-10-03';
const rpc = 'public.quickflex_record_work_timing(text,date,text,timestamptz,timestamptz,integer,integer,jsonb)';
let db;

function tableBody(name) {
  const sql = schema.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))?.[0];
  assert.ok(sql, `${name} is present in canonical schema`);
  return sql;
}

async function asUser(userId = owner, role = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? '']);
  await db.exec(`set local role ${role}`);
}

async function save(overrides = {}) {
  const params = {
    workId: 'work-own-0001', day, shift: 'night',
    start: '2026-10-02T23:00:00+09:00', end: '2026-10-03T03:00:00+09:00',
    active: 10800, items: 95, routes: { '310C': 7200, '310D': 3600 },
    ...overrides,
  };
  const { rows } = await db.query(`select public.quickflex_record_work_timing(
    $1::text,$2::date,$3::text,$4::timestamptz,$5::timestamptz,
    $6::integer,$7::integer,$8::jsonb) as result`, [
    params.workId, params.day, params.shift, params.start, params.end,
    params.active, params.items, params.routes === null ? null : JSON.stringify(params.routes),
  ]);
  return rows[0].result;
}

async function expectSqlError(action, code = '22023') {
  await db.exec('savepoint expected_error');
  await assert.rejects(action, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
  await db.exec('rollback to savepoint expected_error; release savepoint expected_error');
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
  `);
  await db.exec(tableBody('quickflex_profiles'));
  await db.exec(tableBody('quickflex_work_results'));
  await db.exec(schema.match(/create or replace function public\.quickflex_is_approved\([\s\S]*?\n\$\$;/)[0]);
  await db.exec(migration);
  for (const [userId, status, role, workId] of [
    [owner, 'approved', 'driver', 'work-own-0001'],
    [other, 'approved', 'driver', 'work-other-0001'],
    [admin, 'approved', 'admin', 'work-admin-0001'],
    [pending, 'pending', 'driver', 'work-pending-0001'],
  ]) {
    await db.query('insert into auth.users(id) values($1)', [userId]);
    await db.query('insert into public.quickflex_profiles(id,status,role) values($1,$2,$3)', [userId, status, role]);
    await db.query(`insert into public.quickflex_work_results
      (user_id,work_id,device_id,work_date,work_shift,total_households,total_items,canonical_payload)
      values($1,$2,'device-synthetic',$3,'night',80,100,'{}')`, [userId, workId, day]);
  }
});
beforeEach(async () => { await db.exec('begin'); await asUser(); });
afterEach(async () => { await db.exec('rollback'); });
after(async () => { await db.close(); });

test('new migration is mirrored exactly in the canonical schema', () => {
  assert.ok(schema.replaceAll('\r\n', '\n').endsWith(migration.replaceAll('\r\n', '\n')));
  assert.match(migration, /security definer\s*set search_path = ''/);
  assert.doesNotMatch(migration, /update public\.quickflex_work_results|quickflex_is_admin|create policy[^;]*for (insert|update|delete)/i);
});

test('approved owner saves timing after finalization without changing sales', async () => {
  await asUser(owner, 'postgres');
  const before = (await db.query('select * from public.quickflex_work_results where user_id=$1', [owner])).rows;
  await asUser();
  assert.deepEqual(await save(), { status: 'applied', work_id: 'work-own-0001' });
  const row = (await db.query('select * from public.quickflex_work_timings')).rows[0];
  assert.equal(row.work_date.toISOString().slice(0, 10), day);
  assert.equal(row.active_seconds, 10800);
  assert.equal(row.measured_items, 95);
  assert.deepEqual(row.route_active_seconds, { '310C': 7200, '310D': 3600 });
  await asUser(owner, 'postgres');
  assert.deepEqual((await db.query('select * from public.quickflex_work_results where user_id=$1', [owner])).rows, before);
});

test('night shift keeps the finalized closing date across midnight', async () => {
  await save();
  const row = (await db.query('select work_date::text,work_shift,extract(epoch from ended_at-started_at)::integer as seconds from public.quickflex_work_timings')).rows[0];
  assert.deepEqual(row, { work_date: day, work_shift: 'night', seconds: 14400 });
});

test('repeat work_id replaces the timing instead of duplicating it', async () => {
  await save();
  await save({ active: 10000, items: 98, routes: { '310D': 10000 } });
  assert.deepEqual((await db.query('select work_id,active_seconds,measured_items,route_active_seconds from public.quickflex_work_timings')).rows,
    [{ work_id: 'work-own-0001', active_seconds: 10000, measured_items: 98, route_active_seconds: { '310D': 10000 } }]);
});

test('reapplying the schema keeps timing and owner-only permissions', async () => {
  await save();
  await asUser(owner, 'postgres');
  await db.exec(migration);
  await asUser();
  assert.equal((await db.query('select count(*)::integer as n from public.quickflex_work_timings')).rows[0].n, 1);
  assert.equal((await db.query("select has_table_privilege('authenticated','public.quickflex_work_timings','INSERT') as allowed")).rows[0].allowed, false);
});

test('owner and admin can only read their own timing rows', async () => {
  await save();
  await asUser(other); await save({ workId: 'work-other-0001' });
  await asUser(admin); await save({ workId: 'work-admin-0001' });
  assert.deepEqual((await db.query('select user_id from public.quickflex_work_timings')).rows, [{ user_id: admin }]);
  await asUser();
  assert.deepEqual((await db.query('select user_id from public.quickflex_work_timings')).rows, [{ user_id: owner }]);
});

test('another user work_id and an unfinalized work_id are refused', async () => {
  await expectSqlError(() => save({ workId: 'work-other-0001' }), '42501');
  await expectSqlError(() => save({ workId: 'work-missing-0001' }), '42501');
  await asUser(admin);
  await expectSqlError(() => save(), '42501');
});

test('pending or blocked approval refuses timing and existing rows become invisible', async () => {
  await save();
  await asUser(owner, 'postgres');
  await db.query("update public.quickflex_profiles set status='blocked' where id=$1", [owner]);
  await asUser();
  assert.deepEqual((await db.query('select * from public.quickflex_work_timings')).rows, []);
  await expectSqlError(() => save(), '42501');
  await asUser(pending);
  await expectSqlError(() => save({ workId: 'work-pending-0001' }), '42501');
});

test('unauthenticated and anonymous requests cannot write or read', async () => {
  await asUser(null);
  await expectSqlError(() => save(), '42501');
  await asUser(null, 'anon');
  await expectSqlError(() => save(), '42501');
  await expectSqlError(() => db.query('select * from public.quickflex_work_timings'), '42501');
});

test('clients have no direct insert, update or delete grants or policies', async () => {
  const { rows } = await db.query(`select
    has_table_privilege('authenticated','public.quickflex_work_timings','SELECT') as can_read,
    has_table_privilege('authenticated','public.quickflex_work_timings','INSERT') as can_insert,
    has_table_privilege('authenticated','public.quickflex_work_timings','UPDATE') as can_update,
    has_table_privilege('authenticated','public.quickflex_work_timings','DELETE') as can_delete,
    has_table_privilege('service_role','public.quickflex_work_timings','INSERT') as service_insert,
    has_function_privilege('anon',$1,'EXECUTE') as anon_execute,
    has_function_privilege('authenticated',$1,'EXECUTE') as auth_execute`, [rpc]);
  assert.deepEqual(rows[0], { can_read: true, can_insert: false, can_update: false, can_delete: false, service_insert: false, anon_execute: false, auth_execute: true });
  await expectSqlError(() => db.query("insert into public.quickflex_work_timings(user_id) values($1)", [owner]), '42501');
  await expectSqlError(() => db.query('update public.quickflex_work_timings set measured_items=0'), '42501');
  await expectSqlError(() => db.query('delete from public.quickflex_work_timings'), '42501');
});

for (const [name, values] of [
  ['different closing date', { day: '2026-10-02' }],
  ['different shift', { shift: 'day' }],
  ['missing closing date', { day: null }],
  ['missing start', { start: null }],
  ['missing end', { end: null }],
  ['end before start', { end: '2026-10-02T22:59:59+09:00' }],
  ['over 24 hours', { end: '2026-10-04T00:00:00+09:00' }],
  ['infinite timestamp', { end: 'infinity' }],
  ['negative active time', { active: -1 }],
  ['active exceeds work time', { active: 14401 }],
  ['missing active time', { active: null }],
  ['negative measured items', { items: -1 }],
  ['missing measured items', { items: null }],
  ['missing routes', { routes: null }],
  ['route array', { routes: [] }],
  ['detail route key', { routes: { '310C01': 10 } }],
  ['lowercase route key', { routes: { '310c': 10 } }],
  ['negative route seconds', { routes: { '310C': -1 } }],
  ['fractional route seconds', { routes: { '310C': 1.5 } }],
  ['string route seconds', { routes: { '310C': '10' } }],
  ['null route seconds', { routes: { '310C': null } }],
  ['route sum beyond 60 second tolerance', { routes: { '310C': 10800, '310D': 61 } }],
]) {
  test(`timing validation rejects ${name}`, async () => {
    await expectSqlError(() => save(values));
    assert.equal((await db.query('select count(*)::integer as n from public.quickflex_work_timings')).rows[0].n, 0);
  });
}

test('zero duration and zero records are valid metadata', async () => {
  await save({ end: '2026-10-02T23:00:00+09:00', active: 0, items: 0, routes: {} });
  assert.equal((await db.query('select active_seconds from public.quickflex_work_timings')).rows[0].active_seconds, 0);
});

test('24 hour work and 60 second route rounding tolerance are inclusive', async () => {
  await save({ end: '2026-10-03T23:00:00+09:00', active: 86400, routes: { '310C': 86400, '310D': 60 } });
  assert.equal((await db.query('select active_seconds from public.quickflex_work_timings')).rows[0].active_seconds, 86400);
});

test('account deletion cascades timing with the finalized work', async () => {
  await save();
  await asUser(other); await save({ workId: 'work-other-0001' });
  await asUser(owner, 'postgres');
  await db.query('delete from auth.users where id=$1', [owner]);
  assert.deepEqual((await db.query('select user_id from public.quickflex_work_timings')).rows, [{ user_id: other }]);
  assert.equal((await db.query('select count(*)::integer as n from public.quickflex_work_results where user_id=$1', [owner])).rows[0].n, 0);
});
