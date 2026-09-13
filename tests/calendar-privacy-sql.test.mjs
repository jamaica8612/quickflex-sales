import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const root = new URL('../', import.meta.url);

test('finance reference hardening preserves private calendar access and adds FK indexes', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create schema auth;
      create table auth.users (id uuid primary key);
      create role anon;
      create role authenticated;
      create role service_role;
      create table public.quickflex_expense_receipts (expense_id uuid);
      create table public.quickflex_expense_adjustments (expense_id uuid);
      grant usage on schema public to public;
    `);
    const calendar = await readFile(new URL('supabase/migrations/20260913030622_quickflex_calendar_sync.sql', root), 'utf8');
    await db.exec(calendar);
    await db.exec('grant usage, select on sequence public.quickflex_calendar_oauth_states_id_seq, public.quickflex_calendar_sync_jobs_id_seq to public, anon, authenticated;');
    const hardening = await readFile(new URL('supabase/migrations/20260913035729_quickflex_finance_reference_hardening.sql', root), 'utf8');
    await db.exec(hardening);

    const indexes = await db.query(`
      select indexname from pg_indexes
      where schemaname = 'public'
        and indexname in ('quickflex_expense_receipts_expense_id_idx', 'quickflex_expense_adjustments_expense_id_idx', 'quickflex_calendar_oauth_states_user_id_idx', 'quickflex_calendar_sync_jobs_user_id_idx')
    `);
    assert.deepEqual(indexes.rows.map((row) => row.indexname).sort(), [
      'quickflex_calendar_oauth_states_user_id_idx',
      'quickflex_calendar_sync_jobs_user_id_idx',
      'quickflex_expense_adjustments_expense_id_idx',
      'quickflex_expense_receipts_expense_id_idx',
    ]);

    const policies = await db.query(`select relrowsecurity from pg_class where relname in ('quickflex_calendar_oauth_states', 'quickflex_calendar_sync_jobs') order by relname`);
    assert.deepEqual(policies.rows.map((row) => row.relrowsecurity), [true, true]);
    const privileges = await db.query(`
      select has_sequence_privilege('anon', 'public.quickflex_calendar_oauth_states_id_seq', 'USAGE') as anon_usage,
             has_sequence_privilege('authenticated', 'public.quickflex_calendar_sync_jobs_id_seq', 'USAGE') as authenticated_usage,
             has_sequence_privilege('service_role', 'public.quickflex_calendar_oauth_states_id_seq', 'USAGE') as service_usage,
             has_sequence_privilege('service_role', 'public.quickflex_calendar_sync_jobs_id_seq', 'SELECT') as service_select
    `);
    assert.deepEqual(privileges.rows[0], { anon_usage: false, authenticated_usage: false, service_usage: true, service_select: true });
    await db.exec('set role service_role');
    const serviceNextval = await db.query("select nextval('public.quickflex_calendar_oauth_states_id_seq') as value");
    assert.equal(serviceNextval.rows[0].value, 1);
    await db.exec('set role anon');
    await assert.rejects(() => db.query("select nextval('public.quickflex_calendar_oauth_states_id_seq')"));
  } finally {
    await db.close();
  }
});
