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
declare owner_id uuid := (select auth.uid()); saved_id uuid; existing public.quickflex_expenses%rowtype; matches boolean; prior_refunds numeric;
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
    -- Serialize edits and new refunds on the same owned expense row.
    select * into existing from public.quickflex_expenses where id=p_id and user_id=owner_id and status <> 'trashed' for update;
    if not found then raise exception 'expense not found or trashed' using errcode = 'P0002'; end if;
    select coalesce(sum(amount),0) into prior_refunds from public.quickflex_expense_adjustments
      where expense_id=p_id and user_id=owner_id and kind='refund';
    if prior_refunds > 0 and (p_gross_amount is null or p_gross_amount < prior_refunds) then
      raise exception 'gross amount cannot be less than existing refunds' using errcode = '22023';
    end if;
    update public.quickflex_expenses set actual_date=p_actual_date,gross_amount=p_gross_amount,category=nullif(trim(p_category),''),merchant=nullif(trim(p_merchant),''),payment_method=nullif(trim(p_payment_method),''),evidence_type=nullif(trim(p_evidence_type),''),memo=nullif(p_memo,''),supply_amount=p_supply_amount,vat_amount=p_vat_amount,business_amount=p_business_amount,usage_type=p_usage_type,status=p_status,pre_trash_status=null,trashed_at=null,request_id=trim(p_request_id),updated_at=clock_timestamp()
    where id=p_id and user_id=owner_id and status <> 'trashed' returning id into saved_id;
    if saved_id is null then raise exception 'expense not found or trashed' using errcode = 'P0002'; end if;
  end if;
  return saved_id;
end;
$$;

create schema if not exists quickflex_private;
revoke all on schema quickflex_private from public, anon;
grant usage on schema quickflex_private to authenticated;

create table if not exists quickflex_private.ocr_limits (
  singleton boolean primary key default true check (singleton),
  daily_units integer not null default 240 check (daily_units between 1 and 10000)
);
insert into quickflex_private.ocr_limits(singleton) values (true) on conflict do nothing;
create table if not exists quickflex_private.ocr_daily_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  usage_date date not null,
  units integer not null check (units >= 0)
);
alter table quickflex_private.ocr_limits enable row level security;
alter table quickflex_private.ocr_daily_usage enable row level security;
revoke all on quickflex_private.ocr_limits, quickflex_private.ocr_daily_usage from public, anon, authenticated;

create or replace function quickflex_private.consume_ocr_quota(p_units integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := (select auth.uid());
  today date := (clock_timestamp() at time zone 'Asia/Seoul')::date;
  daily_cap integer;
  charged integer;
begin
  if owner_id is null or not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  if p_units is null or p_units not between 1 and 64 then
    raise exception 'invalid OCR units' using errcode = '22023';
  end if;
  select daily_units into daily_cap from quickflex_private.ocr_limits where singleton;
  if daily_cap is null or p_units > daily_cap then return false; end if;
  insert into quickflex_private.ocr_daily_usage as usage(user_id,usage_date,units)
    values(owner_id,today,p_units)
  on conflict(user_id) do update set usage_date=excluded.usage_date,
    units=(case when usage.usage_date=excluded.usage_date then usage.units else 0 end)+excluded.units
    where (case when usage.usage_date=excluded.usage_date then usage.units else 0 end)+excluded.units <= daily_cap
  returning units into charged;
  return charged is not null;
end;
$$;
revoke all on function quickflex_private.consume_ocr_quota(integer) from public, anon, authenticated;
grant execute on function quickflex_private.consume_ocr_quota(integer) to authenticated;

create or replace function public.quickflex_consume_ocr_quota(p_units integer)
returns boolean language sql security invoker set search_path = '' as $$
  select quickflex_private.consume_ocr_quota(p_units);
$$;
revoke all on function public.quickflex_consume_ocr_quota(integer) from public, anon, authenticated;
grant execute on function public.quickflex_consume_ocr_quota(integer) to authenticated;
comment on table quickflex_private.ocr_limits is 'Server-managed daily OCR image-unit cap per approved user, reset at midnight Asia/Seoul. Clients cannot change limits or usage.';

-- Optimistic concurrency for new clients; legacy signatures stay unchanged.
create or replace function public.quickflex_replace_manual_day_record_checked(
  p_work_date date, p_delete_day boolean, p_is_off boolean,
  p_fresh_count integer, p_fresh_unit integer, p_fresh_solo_count integer,
  p_fresh_linked_count integer, p_backup_unit integer, p_driver_type text,
  p_items jsonb, p_freshbag_mode text, p_expected_updated_at timestamptz
)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  owner_id text := (select auth.uid())::text;
  existing public.quickflex_day_records%rowtype;
  saved jsonb;
begin
  if owner_id is null or not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  if p_work_date is null then raise exception 'work date is required' using errcode = '22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner_id||':'||p_work_date::text,0));
  select * into existing from public.quickflex_day_records
    where user_id=owner_id and work_date=p_work_date for update;
  if (found and (p_expected_updated_at is null or existing.updated_at is distinct from p_expected_updated_at))
    or (not found and p_expected_updated_at is not null) then
    raise exception 'manual day record changed; reload before saving' using errcode = '40001';
  end if;
  perform public.quickflex_replace_manual_day_record(
    p_work_date,p_delete_day,p_is_off,p_fresh_count,p_fresh_unit,p_fresh_solo_count,
    p_fresh_linked_count,p_backup_unit,p_driver_type,p_items,p_freshbag_mode
  );
  select to_jsonb(day) into saved from public.quickflex_day_records as day
    where day.user_id=owner_id and day.work_date=p_work_date;
  return saved;
end;
$$;
revoke all on function public.quickflex_replace_manual_day_record_checked(date,boolean,boolean,integer,integer,integer,integer,integer,text,jsonb,text,timestamptz) from public, anon, authenticated;
grant execute on function public.quickflex_replace_manual_day_record_checked(date,boolean,boolean,integer,integer,integer,integer,integer,text,jsonb,text,timestamptz) to authenticated;
