import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20260924081941_noah_notice_feedback.sql", import.meta.url), "utf8");
const profileMigration = readFileSync(new URL("../supabase/migrations/20260913114410_quickflex_beta_enrollment_and_deletion_request_security.sql", import.meta.url), "utf8");
const previousNoahMigration = readFileSync(new URL("../supabase/migrations/20260924001910_quickflex_noah_confirmed_actions.sql", import.meta.url), "utf8");
const guardStart = profileMigration.indexOf("create or replace function public.quickflex_guard_profile_update()");
const guardMatch = profileMigration.slice(guardStart).match(/\r?\nend;\r?\n\$\$;/);
assert.ok(guardStart >= 0 && guardMatch);
const guardEnd = guardStart + guardMatch.index + guardMatch[0].length;
const existingProfileGuard = profileMigration.slice(guardStart, guardEnd);
const quotaStart = previousNoahMigration.indexOf("create or replace function quickflex_noah_private.quickflex_noah_consume_quota()");
const quotaMatch = previousNoahMigration.slice(quotaStart).match(/\r?\nend \$\$;/);
assert.ok(quotaStart >= 0 && quotaMatch);
const existingQuota = previousNoahMigration.slice(quotaStart, quotaStart + quotaMatch.index + quotaMatch[0].length);

const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const pending = "33333333-3333-4333-8333-333333333333";
const future = "44444444-4444-4444-8444-444444444444";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema quickflex_noah_private; create schema private;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.quickflex_profiles(
      id uuid primary key references auth.users(id), email text,
      display_name text not null default 'User', status text not null default 'pending',
      role text not null default 'driver', beta_enabled boolean not null default false,
      deletion_requested_at timestamptz, created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create function public.quickflex_is_admin() returns boolean language sql stable security definer as $$
      select exists(select 1 from public.quickflex_profiles where id=auth.uid() and role='admin' and status='approved') $$;
    create function public.quickflex_is_approved() returns boolean language sql stable security definer as $$
      select exists(select 1 from public.quickflex_profiles where id=auth.uid() and status='approved') $$;
    create table quickflex_noah_private.minute_usage(
      user_id uuid not null references auth.users(id), usage_day date not null,
      usage_minute timestamp not null, requests integer not null check(requests between 1 and 10),
      primary key(user_id,usage_minute)
    );
    insert into auth.users values ('${owner}'),('${other}'),('${pending}'),('${future}');
    insert into public.quickflex_profiles(id,status,beta_enabled)
      values ('${owner}','approved',true),('${other}','approved',true),('${pending}','pending',false);
    grant usage on schema public,auth,quickflex_noah_private to authenticated;
    grant usage on schema public,auth to anon;
    grant execute on function auth.uid() to authenticated,anon;
    grant select,update on table public.quickflex_profiles to authenticated;
    alter table public.quickflex_profiles enable row level security;
    create policy profiles_own_select on public.quickflex_profiles for select to authenticated using(id=auth.uid());
    create policy profiles_own_update on public.quickflex_profiles for update to authenticated
      using(id=auth.uid()) with check(id=auth.uid());
  `);
  await db.exec(existingProfileGuard);
  await db.exec(`
    create trigger quickflex_guard_profile_update_trigger before update on public.quickflex_profiles
      for each row execute function public.quickflex_guard_profile_update();
    create function private.quickflex_sync_measurement_approval() returns trigger
      language plpgsql security invoker set search_path='' as $$
      begin new.beta_enabled := (new.status = 'approved'); return new; end $$;
    create trigger zz_quickflex_sync_measurement_approval before insert or update on public.quickflex_profiles
      for each row execute function private.quickflex_sync_measurement_approval();
  `);
  await db.exec(existingQuota);
  await db.exec(`
    create function public.quickflex_noah_consume_quota() returns jsonb
      language sql security invoker set search_path='' as $$
      select quickflex_noah_private.quickflex_noah_consume_quota() $$;
    revoke all on function quickflex_noah_private.quickflex_noah_consume_quota() from public,anon,authenticated;
    grant execute on function quickflex_noah_private.quickflex_noah_consume_quota() to authenticated;
    revoke all on function public.quickflex_noah_consume_quota() from public,anon,authenticated;
    grant execute on function public.quickflex_noah_consume_quota() to authenticated;
  `);
  await db.exec(migration);
  await db.exec("set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  return db;
}

async function identity(db, role, userId) {
  await db.exec(`reset role; set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId || ""]);
}

async function submit(db, rating = 1, sources = ["sales_days", "finance_summary"], proposal = false,
  responseMs = 1200, model = "gpt-6-luna") {
  return (await db.query(
    "select public.quickflex_noah_submit_feedback($1,$2::text[],$3,$4,$5) as id",
    [rating, sources, proposal, responseMs, model]
  )).rows[0].id;
}

test("notice can only be acknowledged by its approved owner RPC and stays idempotent", async () => {
  const db = await fixture();
  try {
    await assert.rejects(() => db.query(
      "update public.quickflex_profiles set noah_notice_acknowledged_at=now() where id=$1", [owner]
    ), (error) => error.code === "42501");
    await assert.rejects(() => db.query(
      "update public.quickflex_profiles set display_name='Forged',noah_notice_acknowledged_at=now() where id=$1", [owner]
    ), (error) => error.code === "42501");
    await db.query("update public.quickflex_profiles set display_name='Changed' where id=$1", [owner]);
    assert.equal((await db.query("select display_name from public.quickflex_profiles where id=$1", [owner])).rows[0].display_name, "Changed");
    await db.exec("reset role; alter table public.quickflex_profiles add column future_preference text; set role authenticated");
    await db.query("update public.quickflex_profiles set future_preference='works' where id=$1", [owner]);
    assert.equal((await db.query("select future_preference from public.quickflex_profiles where id=$1", [owner])).rows[0].future_preference, "works");
    const first = (await db.query("select public.quickflex_noah_acknowledge_notice() as at")).rows[0].at;
    const updatedAt = (await db.query("select updated_at from public.quickflex_profiles where id=$1", [owner])).rows[0].updated_at;
    const second = (await db.query("select public.quickflex_noah_acknowledge_notice() as at")).rows[0].at;
    assert.ok(first);
    assert.equal(second.toISOString(), first.toISOString());
    assert.equal((await db.query("select updated_at from public.quickflex_profiles where id=$1", [owner])).rows[0].updated_at.toISOString(), updatedAt.toISOString());
    await identity(db, "authenticated", other);
    assert.equal((await db.query("select noah_notice_acknowledged_at from public.quickflex_profiles where id=$1", [other])).rows[0].noah_notice_acknowledged_at, null);
    assert.equal((await db.query("select count(*)::integer as n from public.quickflex_profiles where noah_notice_acknowledged_at is not null")).rows[0].n, 0);
    assert.ok((await db.query("select public.quickflex_noah_acknowledge_notice() as at")).rows[0].at);
    await identity(db, "authenticated", pending);
    await assert.rejects(() => db.query("select public.quickflex_noah_acknowledge_notice()"), (error) => error.code === "42501");
    await identity(db, "anon", "");
    await assert.rejects(() => db.query("select public.quickflex_noah_acknowledge_notice()"));
  } finally { await db.close(); }
});

test("direct profile insert cannot forge acknowledgment even if an insert grant appears", async () => {
  const db = await fixture();
  try {
    await identity(db, "authenticated", future);
    await assert.rejects(() => db.query(
      "insert into public.quickflex_profiles(id,status,noah_notice_acknowledged_at) values($1,'approved',now())", [future]
    ));
    await db.exec("reset role; grant insert on public.quickflex_profiles to authenticated; create policy test_future_insert on public.quickflex_profiles for insert to authenticated with check(id=auth.uid()); set role authenticated");
    await assert.rejects(() => db.query(
      "insert into public.quickflex_profiles(id,noah_notice_acknowledged_at) values($1,now())", [future]
    ), (error) => error.code === "42501");
    await db.query("insert into public.quickflex_profiles(id) values($1)", [future]);
    assert.equal((await db.query("select noah_notice_acknowledged_at from public.quickflex_profiles where id=$1", [future])).rows[0].noah_notice_acknowledged_at, null);
  } finally { await db.close(); }
});

test("feedback stores only owner-scoped bounded metadata through the RPC", async () => {
  const db = await fixture();
  try {
    await assert.rejects(() => submit(db), (error) => error.code === "42501");
    await db.query("select public.quickflex_noah_acknowledge_notice()");
    const id = await submit(db, -1, ["expenses", "finance_summary"], true, 79999, "gpt-6-luna");
    assert.match(id, /^[0-9a-f-]{36}$/i);
    await assert.rejects(() => db.query("select * from quickflex_noah_private.feedback"));
    await assert.rejects(() => db.query("insert into quickflex_noah_private.feedback(user_id,rating,has_proposal,response_ms,model) values($1,1,false,1,'gpt-6-luna')", [other]));
    await assert.rejects(() => db.query("select public.quickflex_noah_submit_feedback(1,array[]::text[],false,1,'gpt-6-luna',$1::uuid)", [other]));
    await identity(db, "authenticated", other);
    await assert.rejects(() => submit(db), (error) => error.code === "42501");
    await identity(db, "authenticated", pending);
    await assert.rejects(() => submit(db), (error) => error.code === "42501");
    await identity(db, "anon", "");
    await assert.rejects(() => submit(db));
    await identity(db, "postgres", "");
    const row = (await db.query("select * from quickflex_noah_private.feedback where id=$1", [id])).rows[0];
    assert.equal(row.user_id, owner);
    assert.equal(row.rating, -1);
    assert.deepEqual(row.sources, ["expenses", "finance_summary"]);
    assert.equal(row.has_proposal, true);
    assert.equal(row.response_ms, 79999);
    assert.equal(row.model, "gpt-6-luna");
    const fields = (await db.query("select column_name from information_schema.columns where table_schema='quickflex_noah_private' and table_name='feedback' order by ordinal_position")).rows.map((item) => item.column_name);
    assert.deepEqual(fields, ["id", "user_id", "created_at", "rating", "sources", "has_proposal", "response_ms", "model"]);
    const security = (await db.query(`select c.relrowsecurity as rls,
      has_table_privilege('authenticated','quickflex_noah_private.feedback','SELECT') as can_read,
      has_table_privilege('authenticated','quickflex_noah_private.feedback','INSERT') as can_insert
      from pg_class as c join pg_namespace as n on n.oid=c.relnamespace
      where n.nspname='quickflex_noah_private' and c.relname='feedback'`)).rows[0];
    assert.deepEqual(security, { rls: true, can_read: false, can_insert: false });
  } finally { await db.close(); }
});

test("hostile feedback sources, model and metrics are rejected without storing a row", async () => {
  const db = await fixture();
  try {
    await db.query("select public.quickflex_noah_acknowledge_notice()");
    const bad = [
      [0, ["profile"], false, 1, "gpt-6-luna"],
      [1, ["profile", "profile"], false, 1, "gpt-6-luna"],
      [1, ["profile", "other_user_data"], false, 1, "gpt-6-luna"],
      [1, Array(14).fill("profile"), false, 1, "gpt-6-luna"],
      [1, ["profile"], false, -1, "gpt-6-luna"],
      [1, ["profile"], false, 80001, "gpt-6-luna"],
      [1, ["profile"], false, 1, "gpt-6-luna;drop table profiles"],
      [1, ["profile"], false, 1, "gpt-" + "a".repeat(65)],
      [1, ["profile"], null, 1, "gpt-6-luna"],
    ];
    for (const args of bad) await assert.rejects(() => submit(db, ...args), (error) => error.code === "22023");
    await identity(db, "postgres", "");
    assert.equal((await db.query("select count(*)::integer as n from quickflex_noah_private.feedback")).rows[0].n, 0);
  } finally { await db.close(); }
});

test("quota keeps 10 per minute and 100 per KST day with distinct machine codes", async () => {
  const db = await fixture();
  try {
    for (let i = 0; i < 10; i += 1) {
      const quota = (await db.query("select public.quickflex_noah_consume_quota() as q")).rows[0].q;
      assert.equal(quota.allowed, true);
    }
    const minute = (await db.query("select public.quickflex_noah_consume_quota() as q")).rows[0].q;
    assert.equal(minute.allowed, false);
    assert.equal(minute.code, "NOAH_MINUTE_LIMIT");
    assert.equal(minute.remainingMinute, 0);
    await identity(db, "postgres", "");
    await db.query(`insert into quickflex_noah_private.minute_usage(user_id,usage_day,usage_minute,requests)
      values($1,(clock_timestamp() at time zone 'Asia/Seoul')::date,
        date_trunc('minute',clock_timestamp() at time zone 'Asia/Seoul') - interval '1 minute',10)`, [owner]);
    for (let i = 2; i <= 9; i += 1) {
      await db.query(`insert into quickflex_noah_private.minute_usage(user_id,usage_day,usage_minute,requests)
        values($1,(clock_timestamp() at time zone 'Asia/Seoul')::date,
          date_trunc('minute',clock_timestamp() at time zone 'Asia/Seoul') - ($2 * interval '1 minute'),10)`, [owner, i]);
    }
    await identity(db, "authenticated", owner);
    const day = (await db.query("select public.quickflex_noah_consume_quota() as q")).rows[0].q;
    assert.equal(day.allowed, false);
    assert.equal(day.code, "NOAH_DAY_LIMIT");
    assert.equal(day.remainingDaily, 0);
  } finally { await db.close(); }
});
