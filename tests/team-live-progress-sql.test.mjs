import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, afterEach, before, beforeEach } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const migration = readFileSync(new URL('../supabase/migrations/20260920021733_quickflex_team_live_progress.sql', import.meta.url), 'utf8');
const owner = '00000000-0000-4000-8000-000000000001';
const admin = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const pending = '00000000-0000-4000-8000-000000000004';
let db;

function progress(workId, overrides = {}) {
  return {
    work_id: workId,
    work_date: '2026-09-20',
    work_shift: 'night',
    device_name: 'Phone A',
    revision: 0,
    households: 12,
    items: 24,
    routes: ['310A', '310B'],
    status: 'active',
    ...overrides,
  };
}

async function publish(payload, deviceId = 'device-a1') {
  return (await db.query(
    'select * from public.quickflex_publish_team_progress($1,$2::jsonb)',
    [deviceId, JSON.stringify(payload)],
  )).rows[0];
}

async function read(date = '2026-09-20', shift = 'night') {
  return (await db.query('select * from public.quickflex_read_team_progress($1,$2)', [date, shift])).rows;
}

async function sqlError(fn, code) {
  await db.exec('savepoint expected_error');
  await assert.rejects(fn, (error) => {
    assert.equal(error.code, code, error.message);
    return true;
  });
  await db.exec('rollback to savepoint expected_error; release savepoint expected_error');
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table public.quickflex_profiles(
      id uuid primary key references auth.users(id),
      status text not null,
      role text not null default 'driver'
    );
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create function public.quickflex_is_approved() returns boolean language sql security definer stable as
      $$ select exists(select 1 from public.quickflex_profiles where id=auth.uid() and status='approved') $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant execute on function public.quickflex_is_approved() to authenticated;
  `);
  await db.exec(migration);
  await db.query('insert into auth.users values($1),($2),($3),($4)', [owner, admin, other, pending]);
  await db.query(
    "insert into public.quickflex_profiles(id,status,role) values($1,'approved','driver'),($2,'approved','admin'),($3,'approved','driver'),($4,'pending','driver')",
    [owner, admin, other, pending],
  );
});

beforeEach(async () => {
  await db.exec('begin');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
});
afterEach(async () => {
  await db.exec('rollback');
});
after(async () => {
  await db.close();
});

test('migration is additive and never names existing sales or finance storage', () => {
  for (const existingTable of [
    'quickflex_team_work_inputs', 'quickflex_work_results', 'quickflex_day_records',
    'quickflex_day_route_items', 'quickflex_expenses', 'quickflex_expense_receipts',
  ]) assert.equal(migration.includes(existingTable), false, existingTable);
});

test('two phones under one approved account publish separate live work and ended work stays readable', async () => {
  const first = await publish(progress('work-phone-a1'));
  const second = await publish(progress('work-phone-b1', {
    device_name: 'Phone B', households: 20, items: 40, routes: ['312A'], status: 'finished',
  }), 'device-b1');
  assert.equal(first.device_id, 'device-a1');
  assert.equal(second.device_id, 'device-b1');
  assert.deepEqual((await read()).map((row) => row.work_id).sort(), ['work-phone-a1', 'work-phone-b1']);
  assert.equal((await read()).find((row) => row.work_id === 'work-phone-b1').status, 'finished');
});

test('another approved account, including an admin, cannot read or overwrite this account progress', async () => {
  await publish(progress('work-owner-a'));
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [admin]);
  await db.exec('set local role authenticated');
  assert.equal((await read()).length, 0);
  assert.equal((await db.query('select * from public.quickflex_team_live_progress')).rows.length, 0);
  await sqlError(() => db.query("update public.quickflex_team_live_progress set items=999 where work_id='work-owner-a'"), '42501');
  const ownAdmin = await publish(progress('work-admin-a'));
  assert.equal(ownAdmin.user_id, admin);
  assert.equal((await read()).length, 1);
});

test('anonymous and pending accounts cannot publish or read', async () => {
  await db.exec('set local role anon');
  await sqlError(() => publish(progress('work-anon-a')), '42501');
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [pending]);
  await db.exec('set local role authenticated');
  await sqlError(() => publish(progress('work-pending-a')), '42501');
  await sqlError(() => read(), '42501');
});

test('exact resend refreshes heartbeat, out-of-order and reset revisions preserve newer data, and equal conflicts fail', async () => {
  const initial = progress('work-revision-a');
  const stored = await publish(initial);
  const retry = await publish(initial);
  assert.equal(retry.revision, 0);
  assert.ok(new Date(retry.updated_at) >= new Date(stored.updated_at));
  const revisionTwo = progress('work-revision-a', { revision: 2, households: 18, items: 36, status: 'paused' });
  assert.equal((await publish(revisionTwo)).revision, 2);
  const stale = await publish(progress('work-revision-a', { revision: 1, households: 13, items: 26 }));
  assert.deepEqual([stale.revision, stale.households, stale.items, stale.status], [2, 18, 36, 'paused']);
  const reset = await publish(initial);
  assert.equal(reset.revision, 2);
  await sqlError(() => publish({ ...revisionTwo, items: 37 }), '23505');
});

test('a first delivery may start after offline coalescing, and its older late delivery is ignored', async () => {
  const coalesced = progress('work-offline-first', { revision: 7, households: 19, items: 38, status: 'paused' });
  const first = await publish(coalesced);
  assert.deepEqual([first.revision, first.households, first.items, first.status], [7, 19, 38, 'paused']);
  const late = await publish(progress('work-offline-first', { revision: 6, households: 1, items: 2 }));
  assert.deepEqual([late.revision, late.households, late.items, late.status], [7, 19, 38, 'paused']);
});

test('finished work is terminal while later finished heartbeats or renames remain valid', async () => {
  const completed = progress('work-terminal-a', { revision: 3, status: 'finished' });
  await publish(completed);
  await sqlError(() => publish({ ...completed, revision: 4, status: 'active' }), '23505');
  await sqlError(() => publish({ ...completed, revision: 4, status: 'paused' }), '23505');
  const renamedPayload = { ...completed, revision: 4, device_name: 'Renamed phone' };
  const renamed = await publish(renamedPayload);
  assert.deepEqual([renamed.revision, renamed.device_name, renamed.status], [4, 'Renamed phone', 'finished']);
  assert.equal((await publish(renamedPayload)).status, 'finished');
});

test('device, date, and shift are immutable for a work while separate dates and shifts stay isolated', async () => {
  await publish(progress('work-isolation-a'));
  await sqlError(() => publish(progress('work-isolation-a', { work_date: '2026-09-21', revision: 1 })), '23505');
  await sqlError(() => publish(progress('work-isolation-a', { work_shift: 'day', revision: 1 })), '23505');
  await sqlError(() => publish(progress('work-isolation-a', { revision: 1 }), 'device-b1'), '23505');
  await publish(progress('work-day-a', { work_shift: 'day' }));
  await publish(progress('work-next-date-a', { work_date: '2026-09-21' }));
  assert.deepEqual((await read()).map((row) => row.work_id), ['work-isolation-a']);
  assert.deepEqual((await read('2026-09-20', 'day')).map((row) => row.work_id), ['work-day-a']);
  assert.deepEqual((await read('2026-09-21', 'night')).map((row) => row.work_id), ['work-next-date-a']);
});

test('payload permits only bounded progress fields and cannot carry addresses, invoices, or financial data', async () => {
  await sqlError(() => publish(progress('work-bounds-a', { households: 1000001 })), '22023');
  await sqlError(() => publish(progress('work-bounds-b', { routes: ['310A', '310A'] })), '22023');
  await sqlError(() => publish({ ...progress('work-bounds-c'), address: 'private address' }), '22023');
  await sqlError(() => publish({ ...progress('work-bounds-d'), invoiceHash: 'secret' }), '22023');
  await sqlError(() => publish({ ...progress('work-bounds-e'), total_sales: 123456 }), '22023');
});
