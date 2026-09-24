import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const expenseMigration = readFileSync(new URL("../supabase/migrations/20260913030523_expense_privacy_and_receipts.sql", import.meta.url), "utf8");
const refundGuardMigration = readFileSync(new URL("../supabase/migrations/20260920012920_ocr_quota_and_expense_refund_guard.sql", import.meta.url), "utf8").split("create schema if not exists quickflex_private;")[0];
const noahMigration = readFileSync(new URL("../supabase/migrations/20260924001910_quickflex_noah_confirmed_actions.sql", import.meta.url), "utf8");
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit integer,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,metadata jsonb not null default '{}'::jsonb);
    create function storage.foldername(name text) returns text[] language sql immutable as $$
      select case when strpos(name,'/')=0 then array[]::text[] else string_to_array(regexp_replace(name,'/[^/]*$',''),'/') end $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create table public.quickflex_profiles(id uuid primary key references auth.users(id),display_name text not null default 'User',role text not null default 'driver',status text not null default 'pending',driver_type text not null default 'backup',fixed_routes text[] not null default '{}',email text,goal_amount integer not null default 6000000,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
    create table public.quickflex_route_rates(id bigint generated always as identity primary key,user_id text not null,route text not null,current_unit integer not null,updated_at timestamptz not null default now(),unique(user_id,route));
    create table public.quickflex_day_records(id bigint generated always as identity primary key,user_id text not null,work_date date);
    create table public.quickflex_day_route_items(id bigint generated always as identity primary key,user_id text not null,work_date date);
    create table public.quickflex_work_results(user_id uuid not null,work_id text not null,primary key(user_id,work_id));
    create table public.quickflex_work_result_routes(user_id uuid not null,work_id text not null);
    create table public.quickflex_work_result_route_details(user_id uuid not null,work_id text not null);
    create table public.quickflex_automatic_sales_overrides(user_id uuid not null,work_date date not null,primary key(user_id,work_date));
    create table public.quickflex_team_work_inputs(user_id uuid not null,work_id text not null,primary key(user_id,work_id));
    create table public.quickflex_daily_inspections(id bigint generated always as identity primary key,user_id uuid not null);
    create table public.quickflex_inspection_signatures(user_id uuid primary key);
    create table public.quickflex_measurement_diagnostics(id bigint generated always as identity primary key,user_id uuid not null,client_event_id text,captured_at timestamptz,level text,summary text,details jsonb,app_version text,created_at timestamptz);
    create function public.quickflex_is_admin() returns boolean language sql security definer stable as $$ select exists(select 1 from public.quickflex_profiles where id=auth.uid() and role='admin' and status='approved') $$;
    create function public.quickflex_is_approved() returns boolean language sql security definer stable as $$ select exists(select 1 from public.quickflex_profiles where id=auth.uid() and status='approved') $$;
    insert into auth.users values ('${owner}'),('${other}');
    insert into public.quickflex_profiles(id,status) values ('${owner}','approved'),('${other}','approved');
    alter table public.quickflex_profiles enable row level security;
    alter table public.quickflex_route_rates enable row level security;
    alter table public.quickflex_day_records enable row level security;
    alter table public.quickflex_day_route_items enable row level security;
    alter table public.quickflex_work_results enable row level security;
    alter table public.quickflex_work_result_routes enable row level security;
    alter table public.quickflex_work_result_route_details enable row level security;
    alter table public.quickflex_automatic_sales_overrides enable row level security;
    alter table public.quickflex_team_work_inputs enable row level security;
    alter table public.quickflex_daily_inspections enable row level security;
    alter table public.quickflex_inspection_signatures enable row level security;
    alter table public.quickflex_measurement_diagnostics enable row level security;
    alter table storage.objects enable row level security;
  `);
  await db.exec(expenseMigration);
  await db.exec(refundGuardMigration);
  await db.exec(noahMigration);
  await db.exec("grant usage on schema public to authenticated,anon; grant execute on function auth.uid() to authenticated; grant select on public.quickflex_profiles,public.quickflex_route_rates to authenticated; create policy noah_test_profile_read on public.quickflex_profiles for select to authenticated using(id=auth.uid()); create policy noah_test_rate_read on public.quickflex_route_rates for select to authenticated using(user_id=auth.uid()::text); set role authenticated");
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[owner]);
  return db;
}

async function prepare(db,action,values) {
  return (await db.query("select public.quickflex_noah_prepare_write($1,$2::jsonb) as proposal",[action,JSON.stringify(values)])).rows[0].proposal;
}
async function confirm(db,id) {
  return (await db.query("select public.quickflex_noah_confirm_write($1) as proposal",[id])).rows[0].proposal;
}
async function count(db,table) {
  return Number((await db.query(`select count(*) as n from ${table}`)).rows[0].n);
}

test("Noah proposal has no business side effect until one confirmed transaction",async()=>{
  const db=await fixture();
  try {
    const proposed=await prepare(db,"add_expense",{actual_date:"2026-09-24",gross_amount:10000,category:"fuel",merchant:"Station"});
    assert.equal(proposed.status,"pending");
    assert.match(proposed.title,/2026-09-24.*Station.*10000원/);
    assert.deepEqual(proposed.changes.find((item)=>item.label==="총액").after,"10000원");
    assert.deepEqual(proposed.changes.find((item)=>item.label==="분류").after,"주유·충전");
    assert.equal(await count(db,"public.quickflex_expenses"),0);
    await assert.rejects(()=>db.query("select * from quickflex_noah_private.proposals"));
    await assert.rejects(()=>db.query("update quickflex_noah_private.proposals set status='confirmed' where id=$1",[proposed.id]));
    const confirmed=await confirm(db,proposed.id);
    assert.equal(confirmed.status,"confirmed");
    assert.equal(await count(db,"public.quickflex_expenses"),1);
    assert.deepEqual(await confirm(db,proposed.id),confirmed);
    assert.equal(await count(db,"public.quickflex_expenses"),1);
    const usage=await prepare(db,"update_expense",{id:confirmed.result.expenseId,usage_type:"personal"});
    assert.match(usage.title,/2026-09-24.*Station.*10000원.*지출 수정/);
    assert.deepEqual(usage.changes.find((item)=>item.label==="사용 용도"),{label:"사용 용도",before:"업무용",after:"개인용"});
    await db.query("select public.quickflex_noah_cancel_write($1)",[usage.id]);
    const cancelled=await prepare(db,"delete_expense",{id:confirmed.result.expenseId});
    assert.match(cancelled.title,/2026-09-24.*Station.*10000원.*지출 삭제/);
    assert.deepEqual(cancelled.changes,[{label:"상태",before:"확정",after:"휴지통"}]);
    await db.query("select public.quickflex_noah_cancel_write($1)",[cancelled.id]);
    await assert.rejects(()=>confirm(db,cancelled.id));
    assert.equal((await db.query("select status from public.quickflex_expenses where id=$1",[confirmed.result.expenseId])).rows[0].status,"confirmed");
  } finally { await db.close(); }
});

test("editing a photo-only expense draft preserves draft status without inventing a confirmation",async()=>{
  const db=await fixture();
  try {
    const id=(await db.query("select public.quickflex_save_expense(p_status=>'draft',p_request_id=>'noah-draft-1') as id")).rows[0].id;
    const proposal=await prepare(db,"update_expense",{id,memo:"점검 후 금액 입력"});
    assert.equal(proposal.status,"pending");
    assert.equal(proposal.changes.some((change)=>change.label==="상태"),false);
    assert.equal((await db.query("select status,memo,actual_date,gross_amount from public.quickflex_expenses where id=$1",[id])).rows[0].status,"draft");
    const applied=await confirm(db,proposal.id);
    assert.equal(applied.result.expenseId,id);
    const saved=(await db.query("select status,memo,actual_date,gross_amount from public.quickflex_expenses where id=$1",[id])).rows[0];
    assert.equal(saved.status,"draft");
    assert.equal(saved.memo,"점검 후 금액 입력");
    assert.equal(saved.actual_date,null);
    assert.equal(saved.gross_amount,null);
    assert.deepEqual(await confirm(db,proposal.id),applied);
    await assert.rejects(()=>prepare(db,"update_expense",{id,status:"confirmed"}),(error)=>error.code==="22023");
  } finally { await db.close(); }
});

test("ownership, expiry, stale updates and refund floor survive confirmation",async()=>{
  const db=await fixture();
  try {
    const created=await confirm(db,(await prepare(db,"add_expense",{actual_date:"2026-09-24",gross_amount:100,category:"fuel"})).id);
    const id=created.result.expenseId;
    const stale=await prepare(db,"update_expense",{id,gross_amount:80});
    const fresh=await prepare(db,"update_expense",{id,gross_amount:90});
    await confirm(db,fresh.id);
    await assert.rejects(()=>confirm(db,stale.id),(error)=>error.code==="40001");
    await db.query("select public.quickflex_add_expense_adjustment($1,'refund',70,'2026-09-24','partial','refund-test-0001')",[id]);
    await assert.rejects(()=>prepare(db,"update_expense",{id,gross_amount:60}),(error)=>error.code==="22023");
    const refundRace=await prepare(db,"update_expense",{id,gross_amount:80});
    await db.query("select public.quickflex_add_expense_adjustment($1,'refund',20,'2026-09-24','second','refund-test-0002')",[id]);
    assert.equal((await db.query("select sum(amount) as total from public.quickflex_expense_adjustments where expense_id=$1 and kind='refund'",[id])).rows[0].total,"90");
    await assert.rejects(()=>confirm(db,refundRace.id),(error)=>error.code==="22023");
    assert.equal((await db.query("select gross_amount from public.quickflex_expenses where id=$1",[id])).rows[0].gross_amount,"90");
    const expiration=await prepare(db,"delete_expense",{id});
    await db.exec("reset role");
    await db.query("update quickflex_noah_private.proposals set expires_at=clock_timestamp()-interval '1 second' where id=$1",[expiration.id]);
    await db.exec("set role authenticated");
    await assert.rejects(()=>confirm(db,expiration.id));
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
    await assert.rejects(()=>confirm(db,fresh.id));
  } finally { await db.close(); }
});

test("goal and route rate compare against prior value; quota is per account",async()=>{
  const db=await fixture();
  try {
    const goal=await prepare(db,"set_monthly_goal",{goal_amount:7000000});
    const rate=await prepare(db,"set_route_rate",{route:"318A",current_unit:900});
    const staleGoal=await prepare(db,"set_monthly_goal",{goal_amount:8000000});
    const staleRate=await prepare(db,"set_route_rate",{route:"318A",current_unit:1000});
    assert.equal((await db.query("select goal_amount from public.quickflex_profiles where id=$1",[owner])).rows[0].goal_amount,6000000);
    assert.equal(await count(db,"public.quickflex_route_rates"),0);
    await confirm(db,goal.id);
    await confirm(db,rate.id);
    await assert.rejects(()=>confirm(db,staleGoal.id),(error)=>error.code==="40001");
    await assert.rejects(()=>confirm(db,staleRate.id),(error)=>error.code==="40001");
    assert.equal((await db.query("select goal_amount from public.quickflex_profiles where id=$1",[owner])).rows[0].goal_amount,7000000);
    assert.equal((await db.query("select current_unit from public.quickflex_route_rates where user_id=$1",[owner])).rows[0].current_unit,900);
    for(let i=0;i<10;i++) assert.equal((await db.query("select public.quickflex_noah_consume_quota() as quota")).rows[0].quota.allowed,true);
    assert.equal((await db.query("select public.quickflex_noah_consume_quota() as quota")).rows[0].quota.allowed,false);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[other]);
    assert.equal((await db.query("select public.quickflex_noah_consume_quota() as quota")).rows[0].quota.allowed,true);
  } finally { await db.close(); }
});

test("anonymous callers cannot execute Noah RPCs and daily limit rejects atomically",async()=>{
  const db=await fixture();
  try {
    await db.exec("set role anon");
    await assert.rejects(()=>db.query("select public.quickflex_noah_consume_quota()"),(error)=>error.code==="42501");
    await db.exec("reset role");
    for(let i=1;i<=10;i++) await db.query("insert into quickflex_noah_private.minute_usage(user_id,usage_day,usage_minute,requests) values($1,(clock_timestamp() at time zone 'Asia/Seoul')::date,date_trunc('minute',clock_timestamp() at time zone 'Asia/Seoul')-$2::interval,10)",[owner,`${i} minutes`]);
    await db.exec("set role authenticated");
    const denied=(await db.query("select public.quickflex_noah_consume_quota() as quota")).rows[0].quota;
    assert.equal(denied.allowed,false);
    assert.equal(denied.remainingDaily,0);
  } finally { await db.close(); }
});
