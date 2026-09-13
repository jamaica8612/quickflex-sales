-- Expense records are private to their owner.  This migration intentionally
-- removes the historical administrator bypass for operational records.

alter table public.quickflex_profiles
  add column if not exists deletion_requested_at timestamptz;

create or replace function public.quickflex_list_admin_members()
returns table (
  id uuid,
  display_name text,
  role text,
  status text,
  driver_type text,
  fixed_routes text[],
  deletion_requested_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.quickflex_is_admin()) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  return query
  select p.id, p.display_name, p.role, p.status, p.driver_type,
         p.fixed_routes, p.deletion_requested_at
    from public.quickflex_profiles as p
   order by p.created_at, p.id;
end;
$$;

create or replace function public.quickflex_update_admin_member(
  p_member_id uuid,
  p_status text default null,
  p_driver_type text default null,
  p_fixed_routes text[] default null
)
returns table (
  id uuid,
  display_name text,
  role text,
  status text,
  driver_type text,
  fixed_routes text[],
  deletion_requested_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.quickflex_is_admin()) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_member_id is null or p_member_id = (select auth.uid()) then
    raise exception 'another member is required' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending', 'approved', 'blocked') then
    raise exception 'invalid member status' using errcode = '22023';
  end if;
  if p_driver_type is not null and p_driver_type not in ('backup', 'fixed') then
    raise exception 'invalid driver type' using errcode = '22023';
  end if;
  if p_fixed_routes is not null and (
    cardinality(p_fixed_routes) > 50
    or exists (select 1 from unnest(p_fixed_routes) as route where route !~ '^[0-9]{3}[A-Z]$')
  ) then
    raise exception 'invalid fixed routes' using errcode = '22023';
  end if;

  update public.quickflex_profiles as p
     set status = coalesce(p_status, p.status),
         driver_type = coalesce(p_driver_type, p.driver_type),
         fixed_routes = coalesce(p_fixed_routes, p.fixed_routes),
         updated_at = clock_timestamp()
   where p.id = p_member_id;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  return query
  select p.id, p.display_name, p.role, p.status, p.driver_type,
         p.fixed_routes, p.deletion_requested_at
    from public.quickflex_profiles as p
   where p.id = p_member_id;
end;
$$;

revoke all on function public.quickflex_list_admin_members() from public, anon, authenticated;
revoke all on function public.quickflex_update_admin_member(uuid, text, text, text[]) from public, anon, authenticated;
grant execute on function public.quickflex_list_admin_members() to authenticated;
grant execute on function public.quickflex_update_admin_member(uuid, text, text, text[]) to authenticated;

-- Direct profile access stays self-only. The two RPCs above expose the small
-- member-management projection and cannot return email or private settings.
drop policy if exists "quickflex profiles select own or admin" on public.quickflex_profiles;
drop policy if exists "quickflex profiles select own" on public.quickflex_profiles;
drop policy if exists "quickflex profiles admin update" on public.quickflex_profiles;
drop policy if exists "quickflex profiles admin delete" on public.quickflex_profiles;
create policy "quickflex profiles select own"
on public.quickflex_profiles for select to authenticated
using (id = (select auth.uid()));

-- No administrator bypass for members' rates, sales records, immutable work,
-- inspections, signatures, or same-account team inputs.
drop policy if exists "quickflex route rates select" on public.quickflex_route_rates;
drop policy if exists "quickflex route rates insert" on public.quickflex_route_rates;
drop policy if exists "quickflex route rates update" on public.quickflex_route_rates;
drop policy if exists "quickflex route rates delete" on public.quickflex_route_rates;
create policy "quickflex route rates select own" on public.quickflex_route_rates
for select to authenticated using (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()));
create policy "quickflex route rates insert own" on public.quickflex_route_rates
for insert to authenticated with check (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()));
create policy "quickflex route rates update own" on public.quickflex_route_rates
for update to authenticated using (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()))
with check (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()));
create policy "quickflex route rates delete own" on public.quickflex_route_rates
for delete to authenticated using (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()));

drop policy if exists "quickflex day records select" on public.quickflex_day_records;
drop policy if exists "quickflex day records insert" on public.quickflex_day_records;
drop policy if exists "quickflex day records update" on public.quickflex_day_records;
drop policy if exists "quickflex day records delete" on public.quickflex_day_records;
create policy "quickflex day records select own" on public.quickflex_day_records
for select to authenticated using (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()));
create policy "quickflex day records insert own" on public.quickflex_day_records
for insert to authenticated with check (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()));
create policy "quickflex day records update own" on public.quickflex_day_records
for update to authenticated using (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()))
with check (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()));
create policy "quickflex day records delete own" on public.quickflex_day_records
for delete to authenticated using (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()));

drop policy if exists "quickflex day items select" on public.quickflex_day_route_items;
drop policy if exists "quickflex day items insert" on public.quickflex_day_route_items;
drop policy if exists "quickflex day items update" on public.quickflex_day_route_items;
drop policy if exists "quickflex day items delete" on public.quickflex_day_route_items;
create policy "quickflex day items select own" on public.quickflex_day_route_items
for select to authenticated using (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()));
create policy "quickflex day items insert own" on public.quickflex_day_route_items
for insert to authenticated with check (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()));
create policy "quickflex day items update own" on public.quickflex_day_route_items
for update to authenticated using (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()))
with check (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()));
create policy "quickflex day items delete own" on public.quickflex_day_route_items
for delete to authenticated using (user_id = (select auth.uid())::text and (select public.quickflex_is_approved()));

drop policy if exists "quickflex work results select own or admin" on public.quickflex_work_results;
drop policy if exists "quickflex work results select own" on public.quickflex_work_results;
drop policy if exists "quickflex work result routes select own or admin" on public.quickflex_work_result_routes;
drop policy if exists "quickflex work result routes select own" on public.quickflex_work_result_routes;
drop policy if exists "quickflex work result route details select own or admin" on public.quickflex_work_result_route_details;
drop policy if exists "quickflex work result route details select own" on public.quickflex_work_result_route_details;
drop policy if exists "quickflex automatic sales overrides select own or admin" on public.quickflex_automatic_sales_overrides;
drop policy if exists "quickflex automatic sales overrides select own" on public.quickflex_automatic_sales_overrides;
create policy "quickflex work results select own" on public.quickflex_work_results
for select to authenticated using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));
create policy "quickflex work result routes select own" on public.quickflex_work_result_routes
for select to authenticated using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));
create policy "quickflex work result route details select own" on public.quickflex_work_result_route_details
for select to authenticated using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));
create policy "quickflex automatic sales overrides select own" on public.quickflex_automatic_sales_overrides
for select to authenticated using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

drop policy if exists "team inputs read own or admin" on public.quickflex_team_work_inputs;
drop policy if exists "team inputs read own" on public.quickflex_team_work_inputs;
create policy "team inputs read own" on public.quickflex_team_work_inputs
for select to authenticated using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

drop policy if exists "quickflex inspections select own or admin" on public.quickflex_daily_inspections;
drop policy if exists "quickflex inspections select own" on public.quickflex_daily_inspections;
create policy "quickflex inspections select own" on public.quickflex_daily_inspections
for select to authenticated using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

drop policy if exists "quickflex inspection signatures delete own" on public.quickflex_inspection_signatures;
create policy "quickflex inspection signatures delete own" on public.quickflex_inspection_signatures
for delete to authenticated using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

drop policy if exists "quickflex measurement diagnostics admin select" on public.quickflex_measurement_diagnostics;
drop policy if exists "quickflex measurement diagnostics admin delete" on public.quickflex_measurement_diagnostics;
create policy "quickflex measurement diagnostics select own" on public.quickflex_measurement_diagnostics
for select to authenticated using (user_id = (select auth.uid()));
create policy "quickflex measurement diagnostics delete own" on public.quickflex_measurement_diagnostics
for delete to authenticated using (user_id = (select auth.uid()));

create table if not exists public.quickflex_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  actual_date date,
  gross_amount numeric(14, 0),
  category text,
  merchant text,
  payment_method text,
  evidence_type text,
  memo text,
  supply_amount numeric(14, 0),
  vat_amount numeric(14, 0),
  business_amount numeric(14, 0),
  usage_type text not null default 'business' check (usage_type in ('business', 'personal', 'mixed')),
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'trashed')),
  pre_trash_status text check (pre_trash_status in ('draft', 'confirmed')),
  request_id text not null check (char_length(request_id) between 8 and 128),
  trashed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (user_id, request_id),
  check (status <> 'confirmed' or (actual_date is not null and gross_amount is not null)),
  check (gross_amount is null or (gross_amount > 0 and gross_amount = trunc(gross_amount))),
  check (supply_amount is null or (supply_amount >= 0 and supply_amount = trunc(supply_amount))),
  check (vat_amount is null or (vat_amount >= 0 and vat_amount = trunc(vat_amount))),
  check (business_amount is null or (gross_amount is not null and business_amount between 0 and gross_amount and business_amount = trunc(business_amount))),
  check (category is null or char_length(category) between 1 and 100),
  check (merchant is null or char_length(merchant) <= 200),
  check (payment_method is null or char_length(payment_method) <= 64),
  check (evidence_type is null or char_length(evidence_type) <= 64),
  check (memo is null or char_length(memo) <= 2000)
);
create index if not exists quickflex_expenses_owner_date_idx on public.quickflex_expenses(user_id, actual_date desc, created_at desc);
create index if not exists quickflex_expenses_owner_status_idx on public.quickflex_expenses(user_id, status, updated_at desc);
alter table public.quickflex_expenses enable row level security;
revoke all on public.quickflex_expenses from public, anon, authenticated;
grant select on public.quickflex_expenses to authenticated;
create policy "quickflex expenses select own" on public.quickflex_expenses
for select to authenticated using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

create table if not exists public.quickflex_expense_receipts (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.quickflex_expenses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  object_path text not null unique,
  original_name text not null check (char_length(original_name) between 1 and 255 and original_name !~ '[\\x00-\\x1F]'),
  content_type text not null check (content_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf')),
  byte_size integer not null check (byte_size between 1 and 10485760),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, expense_id, sha256),
  check (object_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}$')
);
create index if not exists quickflex_expense_receipts_owner_expense_idx on public.quickflex_expense_receipts(user_id, expense_id, created_at);
alter table public.quickflex_expense_receipts enable row level security;
revoke all on public.quickflex_expense_receipts from public, anon, authenticated;
grant select on public.quickflex_expense_receipts to authenticated;
create policy "quickflex expense receipts select own" on public.quickflex_expense_receipts
for select to authenticated using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

create table if not exists public.quickflex_expense_adjustments (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.quickflex_expenses(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('refund', 'reimbursement')),
  amount numeric(14, 0) not null check (amount > 0 and amount = trunc(amount)),
  actual_date date not null,
  memo text not null default '' check (char_length(memo) <= 2000),
  request_id text not null check (char_length(request_id) between 8 and 128),
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, request_id)
);
create index if not exists quickflex_expense_adjustments_owner_expense_idx on public.quickflex_expense_adjustments(user_id, expense_id, actual_date, created_at);
alter table public.quickflex_expense_adjustments enable row level security;
revoke all on public.quickflex_expense_adjustments from public, anon, authenticated;
grant select on public.quickflex_expense_adjustments to authenticated;
create policy "quickflex expense adjustments select own" on public.quickflex_expense_adjustments
for select to authenticated using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

create or replace function public.quickflex_guard_expense_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'expense receipt metadata is immutable' using errcode = '55000';
  end if;
  if new.user_id <> (select auth.uid()) then
    raise exception 'receipt owner must be the authenticated user' using errcode = '42501';
  end if;
  if not exists (select 1 from public.quickflex_expenses e where e.id = new.expense_id and e.user_id = new.user_id) then
    raise exception 'receipt must belong to an owned expense' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function public.quickflex_guard_expense_receipt() from public, anon, authenticated;
drop trigger if exists quickflex_guard_expense_receipt_trigger on public.quickflex_expense_receipts;
create trigger quickflex_guard_expense_receipt_trigger before insert or update on public.quickflex_expense_receipts
for each row execute function public.quickflex_guard_expense_receipt();

create or replace function public.quickflex_save_expense(
  p_id uuid default null,
  p_actual_date date default null,
  p_gross_amount numeric default null,
  p_category text default null,
  p_merchant text default null,
  p_payment_method text default null,
  p_evidence_type text default null,
  p_memo text default null,
  p_supply_amount numeric default null,
  p_vat_amount numeric default null,
  p_business_amount numeric default null,
  p_usage_type text default 'business',
  p_status text default 'draft',
  p_request_id text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := (select auth.uid()); saved_id uuid; existing public.quickflex_expenses%rowtype; matches boolean;
begin
  if owner_id is null or not (select public.quickflex_is_approved()) then raise exception 'approved account required' using errcode = '42501'; end if;
  if p_request_id is null or char_length(trim(p_request_id)) not between 8 and 128 then raise exception 'request id is required' using errcode = '22023'; end if;
  if p_status not in ('draft', 'confirmed') then raise exception 'invalid expense status' using errcode = '22023'; end if;
  if p_usage_type not in ('business', 'personal', 'mixed') then raise exception 'invalid usage type' using errcode = '22023'; end if;
  if p_status = 'confirmed' and (p_actual_date is null or p_gross_amount is null) then raise exception 'confirmed expense needs date and gross amount' using errcode = '22023'; end if;
  select * into existing from public.quickflex_expenses where user_id = owner_id and request_id = trim(p_request_id) for update;
  if found then
    matches := existing.actual_date is not distinct from p_actual_date and existing.gross_amount is not distinct from p_gross_amount
      and existing.category is not distinct from nullif(trim(p_category),'') and existing.merchant is not distinct from nullif(trim(p_merchant),'')
      and existing.payment_method is not distinct from nullif(trim(p_payment_method),'') and existing.evidence_type is not distinct from nullif(trim(p_evidence_type),'')
      and existing.memo is not distinct from nullif(p_memo,'') and existing.supply_amount is not distinct from p_supply_amount
      and existing.vat_amount is not distinct from p_vat_amount and existing.business_amount is not distinct from p_business_amount
      and existing.usage_type = p_usage_type and existing.status = p_status;
    if p_id is null then
      if matches then return existing.id; end if;
      raise exception 'request id conflicts with a different expense save' using errcode = '23505';
    end if;
    if existing.id <> p_id then raise exception 'request id belongs to another expense' using errcode = '23505'; end if;
    if matches then return existing.id; end if;
  end if;
  if p_id is null then
    insert into public.quickflex_expenses(user_id,actual_date,gross_amount,category,merchant,payment_method,evidence_type,memo,supply_amount,vat_amount,business_amount,usage_type,status,request_id)
    values(owner_id,p_actual_date,p_gross_amount,nullif(trim(p_category),''),nullif(trim(p_merchant),''),nullif(trim(p_payment_method),''),nullif(trim(p_evidence_type),''),nullif(p_memo,''),p_supply_amount,p_vat_amount,p_business_amount,p_usage_type,p_status,trim(p_request_id))
    on conflict (user_id, request_id) do nothing returning id into saved_id;
    if saved_id is null then
      select * into existing from public.quickflex_expenses where user_id=owner_id and request_id=trim(p_request_id) for update;
      matches := existing.actual_date is not distinct from p_actual_date and existing.gross_amount is not distinct from p_gross_amount
        and existing.category is not distinct from nullif(trim(p_category),'') and existing.merchant is not distinct from nullif(trim(p_merchant),'')
        and existing.payment_method is not distinct from nullif(trim(p_payment_method),'') and existing.evidence_type is not distinct from nullif(trim(p_evidence_type),'')
        and existing.memo is not distinct from nullif(p_memo,'') and existing.supply_amount is not distinct from p_supply_amount
        and existing.vat_amount is not distinct from p_vat_amount and existing.business_amount is not distinct from p_business_amount
        and existing.usage_type = p_usage_type and existing.status = p_status;
      if matches then return existing.id; end if;
      raise exception 'request id conflicts with a different expense save' using errcode = '23505';
    end if;
  else
    update public.quickflex_expenses set actual_date=p_actual_date,gross_amount=p_gross_amount,category=nullif(trim(p_category),''),merchant=nullif(trim(p_merchant),''),payment_method=nullif(trim(p_payment_method),''),evidence_type=nullif(trim(p_evidence_type),''),memo=nullif(p_memo,''),supply_amount=p_supply_amount,vat_amount=p_vat_amount,business_amount=p_business_amount,usage_type=p_usage_type,status=p_status,pre_trash_status=null,trashed_at=null,request_id=trim(p_request_id),updated_at=clock_timestamp()
    where id=p_id and user_id=owner_id and status <> 'trashed' returning id into saved_id;
    if saved_id is null then raise exception 'expense not found or trashed' using errcode = 'P0002'; end if;
  end if;
  return saved_id;
end;
$$;

create or replace function public.quickflex_add_expense_receipt(
  p_expense_id uuid, p_object_path text, p_original_name text, p_content_type text, p_byte_size integer, p_sha256 text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := (select auth.uid()); receipt_id uuid;
begin
  if owner_id is null or not (select public.quickflex_is_approved()) then raise exception 'approved account required' using errcode = '42501'; end if;
  if not exists(select 1 from public.quickflex_expenses where id=p_expense_id and user_id=owner_id) then raise exception 'expense not found' using errcode = 'P0002'; end if;
  if p_object_path !~ ('^' || owner_id::text || '/[0-9a-f-]{36}$') then raise exception 'invalid receipt object path' using errcode = '22023'; end if;
  select id into receipt_id from public.quickflex_expense_receipts where user_id=owner_id and expense_id=p_expense_id and sha256=lower(p_sha256);
  if found then return receipt_id; end if;
  insert into public.quickflex_expense_receipts(expense_id,user_id,object_path,original_name,content_type,byte_size,sha256)
  values(p_expense_id,owner_id,p_object_path,p_original_name,lower(p_content_type),p_byte_size,lower(p_sha256)) returning id into receipt_id;
  return receipt_id;
end;
$$;

create or replace function public.quickflex_add_expense_adjustment(
  p_expense_id uuid, p_kind text, p_amount numeric, p_actual_date date, p_memo text default '', p_request_id text default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := (select auth.uid()); expense public.quickflex_expenses%rowtype; adjustment_id uuid; prior_refunds numeric;
begin
  if owner_id is null or not (select public.quickflex_is_approved()) then raise exception 'approved account required' using errcode = '42501'; end if;
  if p_kind not in ('refund','reimbursement') or p_amount is null or p_amount <= 0 or p_amount <> trunc(p_amount) or p_actual_date is null or p_request_id is null or char_length(trim(p_request_id)) not between 8 and 128 then raise exception 'invalid adjustment' using errcode = '22023'; end if;
  select * into expense from public.quickflex_expenses where id=p_expense_id and user_id=owner_id for update;
  if not found or expense.status <> 'confirmed' then raise exception 'confirmed owned expense required' using errcode = '42501'; end if;
  select id into adjustment_id from public.quickflex_expense_adjustments where user_id=owner_id and request_id=trim(p_request_id);
  if found then return adjustment_id; end if;
  if p_kind = 'refund' then
    select coalesce(sum(amount),0) into prior_refunds from public.quickflex_expense_adjustments where expense_id=expense.id and user_id=owner_id and kind='refund';
    if prior_refunds + p_amount > expense.gross_amount then raise exception 'refund exceeds original gross amount' using errcode = '22023'; end if;
  end if;
  insert into public.quickflex_expense_adjustments(expense_id,user_id,kind,amount,actual_date,memo,request_id)
  values(expense.id,owner_id,p_kind,p_amount,p_actual_date,coalesce(p_memo,''),trim(p_request_id)) returning id into adjustment_id;
  return adjustment_id;
end;
$$;

create or replace function public.quickflex_set_expense_status(p_expense_id uuid, p_status text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := (select auth.uid()); result_id uuid;
begin
  if owner_id is null or not (select public.quickflex_is_approved()) then raise exception 'approved account required' using errcode = '42501'; end if;
  if p_status not in ('trashed','restore') then raise exception 'invalid expense status action' using errcode = '22023'; end if;
  if p_status='trashed' then
    update public.quickflex_expenses set pre_trash_status=status,status='trashed',trashed_at=clock_timestamp(),updated_at=clock_timestamp()
    where id=p_expense_id and user_id=owner_id and status in ('draft','confirmed') returning id into result_id;
  else
    update public.quickflex_expenses set status=coalesce(pre_trash_status,'draft'),pre_trash_status=null,trashed_at=null,updated_at=clock_timestamp()
    where id=p_expense_id and user_id=owner_id and status='trashed' returning id into result_id;
  end if;
  if result_id is null then raise exception 'expense not found or cannot change status' using errcode = 'P0002'; end if;
  return result_id;
end;
$$;

revoke all on function public.quickflex_save_expense(uuid,date,numeric,text,text,text,text,text,numeric,numeric,numeric,text,text,text) from public, anon, authenticated;
revoke all on function public.quickflex_add_expense_receipt(uuid,text,text,text,integer,text) from public, anon, authenticated;
revoke all on function public.quickflex_add_expense_adjustment(uuid,text,numeric,date,text,text) from public, anon, authenticated;
revoke all on function public.quickflex_set_expense_status(uuid,text) from public, anon, authenticated;
grant execute on function public.quickflex_save_expense(uuid,date,numeric,text,text,text,text,text,numeric,numeric,numeric,text,text,text) to authenticated;
grant execute on function public.quickflex_add_expense_receipt(uuid,text,text,text,integer,text) to authenticated;
grant execute on function public.quickflex_add_expense_adjustment(uuid,text,numeric,date,text,text) to authenticated;
grant execute on function public.quickflex_set_expense_status(uuid,text) to authenticated;

-- The bucket is private; object paths use only UUIDs, never original names.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('quickflex-expense-receipts','quickflex-expense-receipts',false,10485760,array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
on conflict (id) do update set public=false, file_size_limit=10485760, allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "quickflex expense receipts storage select own" on storage.objects;
drop policy if exists "quickflex expense receipts storage insert own" on storage.objects;
drop policy if exists "quickflex expense receipts storage delete own" on storage.objects;
create policy "quickflex expense receipts storage select own" on storage.objects for select to authenticated
using (bucket_id='quickflex-expense-receipts' and (select public.quickflex_is_approved()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "quickflex expense receipts storage insert own" on storage.objects for insert to authenticated
with check (bucket_id='quickflex-expense-receipts' and (select public.quickflex_is_approved()) and (storage.foldername(name))[1] = (select auth.uid())::text and array_length(storage.foldername(name),1)=1);
create policy "quickflex expense receipts storage delete own" on storage.objects for delete to authenticated
using (bucket_id='quickflex-expense-receipts' and (select public.quickflex_is_approved()) and (storage.foldername(name))[1] = (select auth.uid())::text and not exists (select 1 from public.quickflex_expense_receipts as receipt where receipt.object_path = name));

comment on table public.quickflex_expenses is 'Owner-only business expense records. Drafts may be photo-only; confirmed records require date and gross won.';
comment on table public.quickflex_expense_receipts is 'Owner-only immutable receipt metadata. Binary objects stay in the private quickflex-expense-receipts bucket.';
comment on table public.quickflex_expense_adjustments is 'Owner-only refunds and reimbursements. Refund caps are serialized against the original confirmed gross amount.';
