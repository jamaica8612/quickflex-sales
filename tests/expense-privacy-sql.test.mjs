import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const migration = readFileSync(new URL("../supabase/migrations/20260913030523_expense_privacy_and_receipts.sql", import.meta.url), "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const admin = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";

async function denied(work) {
  await assert.rejects(work, (error) => ["42501", "P0002", "22023", "23505"].includes(error?.code));
}

test("expense and private-record policies are owner-only, including for administrators", async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create schema auth;
    create schema storage;
    create table auth.users(id uuid primary key);
    create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit integer, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, metadata jsonb not null default '{}'::jsonb);
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select case when strpos(name, '/') = 0 then array[]::text[] else string_to_array(regexp_replace(name, '/[^/]*$', ''), '/') end
    $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create table public.quickflex_profiles (id uuid primary key references auth.users(id), display_name text not null default 'User', role text not null default 'driver', status text not null default 'pending', driver_type text not null default 'backup', fixed_routes text[] not null default '{}', email text, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.quickflex_route_rates (id bigint generated always as identity primary key, user_id text not null, route text, current_unit integer);
    create table public.quickflex_day_records (id bigint generated always as identity primary key, user_id text not null, work_date date);
    create table public.quickflex_day_route_items (id bigint generated always as identity primary key, user_id text not null, work_date date);
    create table public.quickflex_work_results (user_id uuid not null, work_id text not null, primary key(user_id,work_id));
    create table public.quickflex_work_result_routes (user_id uuid not null, work_id text not null);
    create table public.quickflex_work_result_route_details (user_id uuid not null, work_id text not null);
    create table public.quickflex_automatic_sales_overrides (user_id uuid not null, work_date date not null, primary key(user_id,work_date));
    create table public.quickflex_team_work_inputs (user_id uuid not null, work_id text not null, primary key(user_id,work_id));
    create table public.quickflex_daily_inspections (id bigint generated always as identity primary key, user_id uuid not null);
    create table public.quickflex_inspection_signatures (user_id uuid primary key);
    create table public.quickflex_measurement_diagnostics (id bigint generated always as identity primary key, user_id uuid not null, client_event_id text, captured_at timestamptz, level text, summary text, details jsonb, app_version text, created_at timestamptz);
    create function public.quickflex_is_admin() returns boolean language sql security definer stable as $$ select exists(select 1 from public.quickflex_profiles where id=auth.uid() and role='admin' and status='approved') $$;
    create function public.quickflex_is_approved() returns boolean language sql security definer stable as $$ select exists(select 1 from public.quickflex_profiles where id=auth.uid() and status='approved') $$;
    insert into auth.users values ('${owner}'),('${admin}'),('${other}');
    insert into public.quickflex_profiles(id,display_name,role,status) values ('${owner}','Owner','driver','approved'),('${admin}','Admin','admin','approved'),('${other}','Other','driver','approved');
    insert into public.quickflex_route_rates(user_id,route,current_unit) values ('${owner}','314D',1000);
    insert into public.quickflex_day_records(user_id,work_date) values ('${owner}','2026-09-01');
    insert into public.quickflex_day_route_items(user_id,work_date) values ('${owner}','2026-09-01');
    insert into public.quickflex_work_results values ('${owner}','work-0001');
    insert into public.quickflex_work_result_routes values ('${owner}','work-0001');
    insert into public.quickflex_work_result_route_details values ('${owner}','work-0001');
    insert into public.quickflex_automatic_sales_overrides values ('${owner}','2026-09-01');
    insert into public.quickflex_team_work_inputs values ('${owner}','team-0001');
    insert into public.quickflex_daily_inspections(user_id) values ('${owner}');
    insert into public.quickflex_inspection_signatures values ('${owner}');
  `);
  await db.exec([
    "quickflex_profiles", "quickflex_route_rates", "quickflex_day_records", "quickflex_day_route_items",
    "quickflex_work_results", "quickflex_work_result_routes", "quickflex_work_result_route_details",
    "quickflex_automatic_sales_overrides", "quickflex_team_work_inputs", "quickflex_daily_inspections",
    "quickflex_inspection_signatures", "quickflex_measurement_diagnostics",
  ].map((name) => `alter table public.${name} enable row level security;`).join("\n"));
  await db.exec("alter table storage.objects enable row level security;");
  // This stub matches Supabase Storage: foldername omits the final filename.
  await db.exec(migration);
  await db.exec(`
    grant usage on schema public to authenticated;
    grant select on public.quickflex_route_rates, public.quickflex_day_records, public.quickflex_day_route_items,
      public.quickflex_work_results, public.quickflex_work_result_routes, public.quickflex_work_result_route_details,
      public.quickflex_automatic_sales_overrides, public.quickflex_team_work_inputs, public.quickflex_daily_inspections,
      public.quickflex_inspection_signatures, public.quickflex_profiles to authenticated;
    grant usage on schema storage to authenticated;
    grant select, insert, delete on storage.objects to authenticated;
    set role authenticated;
  `);

  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
  for (const table of ["quickflex_route_rates", "quickflex_day_records", "quickflex_day_route_items", "quickflex_work_results", "quickflex_work_result_routes", "quickflex_work_result_route_details", "quickflex_automatic_sales_overrides", "quickflex_team_work_inputs", "quickflex_daily_inspections", "quickflex_inspection_signatures"]) {
    assert.equal((await db.query(`select * from public.${table}`)).rows.length, 0, `${table} must hide another owner from an admin`);
  }
  assert.equal((await db.query("select * from public.quickflex_profiles")).rows.length, 1, "admin only reads own raw profile");
  assert.equal((await db.query("select * from public.quickflex_list_admin_members()")).rows.length, 3, "narrow member RPC remains available");
  await denied(() => db.query("update public.quickflex_profiles set status='blocked' where id=$1 returning id", [owner]));

  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  const draft = (await db.query("select public.quickflex_save_expense(null,null,null,null,null,null,null,null,null,null,null,'business','draft','draft-request-1') as id")).rows[0].id;
  assert.ok(draft, "photo-only draft is accepted");
  const promoted = (await db.query("select public.quickflex_save_expense($1,'2026-09-02',100,'fuel','Merchant',null,'receipt',null,null,null,100,'business','confirmed','draft-request-1') as id", [draft])).rows[0].id;
  assert.equal(promoted, draft, "the same expense ID can promote a draft without a duplicate request row");
  assert.equal((await db.query("select status,gross_amount from public.quickflex_expenses where id=$1", [draft])).rows[0].status, "confirmed");
  await denied(() => db.query("select public.quickflex_save_expense(null,'2026-09-02',101,'fuel','Merchant',null,'receipt',null,null,null,101,'business','confirmed','draft-request-1')"));
  await denied(() => db.query("select public.quickflex_save_expense(null,null,null,null,null,null,null,null,null,null,null,'business','confirmed','bad-confirmed-request')"));
  const confirmed = (await db.query("select public.quickflex_save_expense(null,'2026-09-02',100,'fuel','Merchant',null,'receipt',null,null,null,100,'business','confirmed','confirmed-request-1') as id")).rows[0].id;
  await db.query("select public.quickflex_add_expense_adjustment($1,'refund',40,'2026-09-03','partial','refund-request-1')", [confirmed]);
  await denied(() => db.query("select public.quickflex_add_expense_adjustment($1,'refund',70,'2026-09-03','too much','refund-request-2')", [confirmed]));
  await db.query("select public.quickflex_add_expense_adjustment($1,'reimbursement',70,'2026-09-03','separate','reimbursement-request-1')", [confirmed]);
  assert.deepEqual((await db.query("select kind,amount from public.quickflex_expense_adjustments order by kind")).rows, [{ kind: "refund", amount: "40" }, { kind: "reimbursement", amount: "70" }]);

  const referencedPath = `${owner}/44444444-4444-4444-8444-444444444444`;
  const orphanPath = `${owner}/55555555-5555-4555-8555-555555555555`;
  await db.query("insert into storage.objects(bucket_id,name,metadata) values('quickflex-expense-receipts',$1,'{}'),('quickflex-expense-receipts',$2,'{}')", [referencedPath, orphanPath]);
  await db.query("select public.quickflex_add_expense_receipt($1,$2,'receipt.jpg','image/jpeg',1,$3)", [confirmed, referencedPath, "aa".repeat(32)]);
  assert.equal((await db.query("delete from storage.objects where name=$1 returning name", [referencedPath])).rows.length, 0, "referenced receipt binary is immutable");
  assert.equal((await db.query("delete from storage.objects where name=$1 returning name", [orphanPath])).rows.length, 1, "owner can clean an unreferenced private orphan");

  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [admin]);
  assert.equal((await db.query("select * from public.quickflex_expenses")).rows.length, 0);
  assert.equal((await db.query("select * from public.quickflex_expense_adjustments")).rows.length, 0);
  assert.equal((await db.query("select * from storage.objects")).rows.length, 0, "admin cannot read another owner's receipt object");
  await db.exec("reset role");
  await db.close();
});
