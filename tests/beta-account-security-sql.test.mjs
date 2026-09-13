import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  new URL("../supabase/migrations/20260913114410_quickflex_beta_enrollment_and_deletion_request_security.sql", import.meta.url),
  "utf8",
);

const admin = "11111111-1111-4111-8111-111111111111";
const accountA = "22222222-2222-4222-8222-222222222222";
const accountB = "33333333-3333-4333-8333-333333333333";
const forgedServerAccount = "44444444-4444-4444-8444-444444444444";
const directInsertTarget = "55555555-5555-4555-8555-555555555555";
const ensureTarget = "66666666-6666-4666-8666-666666666666";

async function denied(work) {
  await assert.rejects(work, (error) => ["42501", "P0002", "22023", "23505"].includes(error?.code));
}

async function setActor(db, role, userId = "") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [userId]);
  await db.exec(`set role ${role}`);
}

async function createBaseline({ withAdmin = true } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create table auth.users (
      id uuid primary key,
      email text,
      raw_user_meta_data jsonb not null default '{}'::jsonb
    );
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;

    create table public.quickflex_profiles (
      id uuid primary key references auth.users(id),
      email text,
      display_name text not null default 'User',
      driver_type text not null default 'backup' check (driver_type in ('backup', 'fixed')),
      status text not null default 'pending' check (status in ('pending', 'approved', 'blocked')),
      role text not null default 'driver' check (role in ('driver', 'admin')),
      fixed_routes text[] not null default '{}',
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deletion_requested_at timestamptz
    );
    alter table public.quickflex_profiles enable row level security;
    grant select, insert, update, delete on public.quickflex_profiles to authenticated;

    create function public.quickflex_is_admin()
    returns boolean language sql security definer stable set search_path = '' as $$
      select exists (
        select 1 from public.quickflex_profiles
         where id = (select auth.uid()) and role = 'admin' and status = 'approved'
      )
    $$;
    create function public.quickflex_is_approved()
    returns boolean language sql security definer stable set search_path = '' as $$
      select exists (
        select 1 from public.quickflex_profiles
         where id = (select auth.uid()) and status = 'approved'
      )
    $$;

    create function public.quickflex_guard_profile_update()
    returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      if (select public.quickflex_is_admin()) then return new; end if;
      if (select auth.uid()) = old.id then
        new.id := old.id;
        new.email := old.email;
        new.status := old.status;
        new.role := old.role;
        return new;
      end if;
      raise exception 'profile update is not allowed';
    end;
    $$;
    create trigger quickflex_guard_profile_update_trigger
      before update on public.quickflex_profiles
      for each row execute function public.quickflex_guard_profile_update();

    create function public.quickflex_bootstrap_first_profile()
    returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      if not exists (select 1 from public.quickflex_profiles) then
        new.status := 'approved';
        new.role := 'admin';
      end if;
      return new;
    end;
    $$;
    create trigger quickflex_bootstrap_first_profile_trigger
      before insert on public.quickflex_profiles
      for each row execute function public.quickflex_bootstrap_first_profile();

    create policy "quickflex profiles select own or admin" on public.quickflex_profiles
      for select to authenticated using (id = (select auth.uid()) or (select public.quickflex_is_admin()));
    create policy "quickflex profiles insert own" on public.quickflex_profiles
      for insert to authenticated with check (id = (select auth.uid()));
    create policy "quickflex profiles update own" on public.quickflex_profiles
      for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));
    create policy "quickflex profiles admin update" on public.quickflex_profiles
      for update to authenticated using ((select public.quickflex_is_admin())) with check ((select public.quickflex_is_admin()));
    create policy "quickflex profiles admin delete" on public.quickflex_profiles
      for delete to authenticated using ((select public.quickflex_is_admin()) and id <> (select auth.uid()));

    create function public.quickflex_handle_new_auth_user()
    returns trigger language plpgsql security definer set search_path = '' as $$
    begin
      insert into public.quickflex_profiles(id,email,display_name,driver_type,status,role,fixed_routes)
      values (
        new.id,
        new.email,
        coalesce(nullif(new.raw_user_meta_data ->> 'display_name',''),'User'),
        case when new.raw_user_meta_data ->> 'driver_type' = 'fixed' then 'fixed' else 'backup' end,
        'pending',
        'driver',
        '{}'
      ) on conflict (id) do nothing;
      return new;
    end;
    $$;
  `);

  if (withAdmin) {
    await db.query(
      "insert into auth.users(id,email) values($1,'admin@example.test'),($2,'forged@example.test'),($3,'direct@example.test'),($4,'trusted@example.test')",
      [admin, forgedServerAccount, directInsertTarget, ensureTarget],
    );
    await db.query(
      "insert into public.quickflex_profiles(id,email,display_name,role,status) values($1,'admin@example.test','Existing admin','admin','approved')",
      [admin],
    );
  }

  await db.exec(`
    create trigger quickflex_handle_new_auth_user_trigger
      after insert on auth.users
      for each row execute function public.quickflex_handle_new_auth_user();
  `);
  await db.exec(migration);
  return db;
}

test("bootstrap normalizes every new profile and preserves the existing administrator", async () => {
  const db = await createBaseline();

  const existing = (await db.query("select role,status,beta_enabled from public.quickflex_profiles where id=$1", [admin])).rows[0];
  assert.deepEqual(existing, { role: "admin", status: "approved", beta_enabled: false });

  await db.query(
    "insert into public.quickflex_profiles(id,role,status,beta_enabled,deletion_requested_at) values($1,'admin','approved',true,now())",
    [forgedServerAccount],
  );
  const normalized = (await db.query(
    "select role,status,beta_enabled,deletion_requested_at from public.quickflex_profiles where id=$1",
    [forgedServerAccount],
  )).rows[0];
  assert.equal(normalized.role, "driver");
  assert.equal(normalized.status, "pending");
  assert.equal(normalized.beta_enabled, false);
  assert.equal(normalized.deletion_requested_at, null);

  await db.query(
    "insert into auth.users(id,email,raw_user_meta_data) values($1,'a@example.test',$2),($3,'b@example.test',$4)",
    [accountA, { display_name: "A", role: "admin", status: "approved", beta_enabled: true }, accountB, { display_name: "B" }],
  );
  assert.deepEqual(
    (await db.query("select role,status,beta_enabled from public.quickflex_profiles where id=$1", [accountA])).rows[0],
    { role: "driver", status: "pending", beta_enabled: false },
  );

  await setActor(db, "authenticated", accountB);
  await denied(() => db.query(
    "insert into public.quickflex_profiles(id,role,status,beta_enabled) values($1,'admin','approved',true)",
    [directInsertTarget],
  ));

  await setActor(db, "authenticated", ensureTarget);
  const ensured = (await db.query(
    "select (public.quickflex_ensure_profile('admin@example.test','Ensured user','fixed')).*",
  )).rows[0];
  assert.equal(ensured.email, "trusted@example.test", "ensure_profile ignores a spoofed identity email");
  assert.equal(ensured.role, "driver");
  assert.equal(ensured.status, "pending");
  assert.equal(ensured.beta_enabled, false);

  await setActor(db, "anon");
  await denied(() => db.query("select public.quickflex_request_account_deletion()"));
  await db.close();
});

test("only the narrow admin RPC grants beta and deletion requests are owner-only, terminal, and non-destructive", async () => {
  const db = await createBaseline();
  await db.query("insert into auth.users(id,email) values($1,'a@example.test'),($2,'b@example.test')", [accountA, accountB]);
  await db.exec(`
    create table public.quickflex_user_payloads (
      user_id uuid primary key,
      payload text not null
    );
  `);
  await db.query("insert into public.quickflex_user_payloads values($1,'A existing work')", [accountA]);

  await setActor(db, "authenticated", accountA);
  await db.query(`
    update public.quickflex_profiles
       set display_name='A renamed', role='admin', status='approved', beta_enabled=true,
           deletion_requested_at=null
     where id=$1
  `, [accountA]);
  assert.deepEqual(
    (await db.query("select display_name,role,status,beta_enabled from public.quickflex_profiles where id=$1", [accountA])).rows[0],
    { display_name: "A renamed", role: "driver", status: "pending", beta_enabled: false },
  );
  await denied(() => db.query(
    "select * from public.quickflex_update_admin_member($1,'approved',null,null,true)",
    [accountA],
  ));
  await denied(() => db.query("select * from public.quickflex_list_admin_members()"));

  await setActor(db, "authenticated", admin);
  assert.equal((await db.query("select * from public.quickflex_profiles")).rows.length, 1, "raw profile reads remain owner-only for admins");
  const legacyFourArgumentCall = (await db.query(
    "select * from public.quickflex_update_admin_member($1,null,'fixed',null)",
    [accountB],
  )).rows[0];
  assert.equal(legacyFourArgumentCall.driver_type, "fixed", "the existing four-argument admin call remains valid");
  assert.equal(legacyFourArgumentCall.beta_enabled, false, "an omitted beta argument preserves the prior value");
  const approved = (await db.query(
    "select * from public.quickflex_update_admin_member($1,'approved',null,null,true)",
    [accountA],
  )).rows[0];
  assert.equal(approved.status, "approved");
  assert.equal(approved.beta_enabled, true);
  await db.query("select * from public.quickflex_update_admin_member($1,'blocked',null,null,false)", [accountB]);
  await denied(() => db.query("select * from public.quickflex_update_admin_member($1,null,null,null,true)", [admin]));

  const members = (await db.query("select * from public.quickflex_list_admin_members() order by id")).rows;
  assert.ok(members.every((member) => Object.hasOwn(member, "beta_enabled") && Object.hasOwn(member, "deletion_requested_at")));
  assert.ok(members.every((member) => !Object.hasOwn(member, "email")), "admin projection must not expose email");

  await setActor(db, "authenticated", accountB);
  await denied(() => db.query("select public.quickflex_request_account_deletion($1)", [accountA]));
  assert.equal(
    (await db.query("select deletion_requested_at from public.quickflex_profiles where id=$1", [accountB])).rows[0].deletion_requested_at,
    null,
    "an expected-account mismatch cannot write the request timestamp",
  );
  const blockedRequestedAt = (await db.query("select public.quickflex_request_account_deletion() as requested_at")).rows[0].requested_at;
  assert.ok(blockedRequestedAt, "blocked profiles may still request deletion");
  assert.equal((await db.query("select status from public.quickflex_profiles where id=$1", [accountB])).rows[0].status, "blocked");
  assert.equal((await db.query("update public.quickflex_profiles set deletion_requested_at=now() where id=$1 returning id", [accountA])).rows.length, 0);

  await setActor(db, "authenticated", accountA);
  const first = (await db.query("select public.quickflex_request_account_deletion($1) as requested_at", [accountA])).rows[0].requested_at;
  const second = (await db.query("select public.quickflex_request_account_deletion() as requested_at")).rows[0].requested_at;
  assert.equal(String(second), String(first), "repeated deletion requests keep the first server timestamp");

  await db.exec("reset role");
  assert.deepEqual(
    (await db.query("select payload from public.quickflex_user_payloads where user_id=$1", [accountA])).rows,
    [{ payload: "A existing work" }],
    "requesting deletion does not remove existing work or user data",
  );
  assert.equal((await db.query("select status,beta_enabled from public.quickflex_profiles where id=$1", [accountA])).rows[0].status, "approved");
  await db.close();
});

test("an empty database bootstraps exactly one non-beta administrator", async () => {
  const db = await createBaseline({ withAdmin: false });
  await db.query("insert into auth.users(id,email) values($1,'first@example.test'),($2,'second@example.test')", [admin, accountA]);
  const profiles = (await db.query("select id,role,status,beta_enabled from public.quickflex_profiles order by created_at,id")).rows;
  assert.equal(profiles.filter((profile) => profile.role === "admin" && profile.status === "approved").length, 1);
  assert.equal(profiles.find((profile) => profile.id === admin).beta_enabled, false);
  assert.deepEqual(
    profiles.find((profile) => profile.id === accountA),
    { id: accountA, role: "driver", status: "pending", beta_enabled: false },
  );
  await db.close();
});
