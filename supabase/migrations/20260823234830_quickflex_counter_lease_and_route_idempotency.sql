-- One canonical row per account/date/raw route makes Android retry idempotent.
alter table public.quickflex_day_route_items
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quickflex_day_route_items_user_date_route_key'
      and conrelid = 'public.quickflex_day_route_items'::regclass
  ) then
    if exists (
      select 1
      from public.quickflex_day_route_items
      group by user_id, work_date, route
      having count(*) > 1
    ) then
      raise exception 'duplicate quickflex_day_route_items rows must be reconciled before adding the route identity constraint'
        using errcode = '23505';
    end if;

    alter table public.quickflex_day_route_items
      add constraint quickflex_day_route_items_user_date_route_key
      unique (user_id, work_date, route);
  end if;
end $$;

create table if not exists public.quickflex_active_work_leases (
  user_id uuid primary key references auth.users(id) on delete cascade,
  device_id text not null check (char_length(device_id) between 8 and 128),
  work_id text not null check (char_length(work_id) between 8 and 128),
  work_date date not null,
  work_shift text not null check (work_shift in ('day', 'night')),
  claimed_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  released_at timestamptz,
  work_date_finalized_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.quickflex_active_work_leases
  add column if not exists released_at timestamptz,
  add column if not exists work_date_finalized_at timestamptz;

create table if not exists public.quickflex_work_results (
  user_id uuid not null references auth.users(id) on delete cascade,
  work_id text not null check (char_length(work_id) between 8 and 128),
  device_id text not null check (char_length(device_id) between 8 and 128),
  work_date date not null,
  work_shift text not null check (work_shift in ('day', 'night')),
  total_households integer not null check (total_households >= 0),
  total_items integer not null check (total_items >= 0),
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object'),
  finalized_at timestamptz not null default now(),
  primary key (user_id, work_id)
);

create table if not exists public.quickflex_work_result_routes (
  user_id uuid not null,
  work_id text not null,
  route text not null check (route ~ '^[0-9]{3}[A-Z]$'),
  delivery_count integer not null check (delivery_count >= 0),
  household_count integer not null check (household_count >= 0),
  unit_snapshot integer not null check (unit_snapshot >= 0),
  sort_order integer not null check (sort_order >= 0),
  primary key (user_id, work_id, route),
  foreign key (user_id, work_id)
    references public.quickflex_work_results(user_id, work_id)
    on delete cascade
);

create index if not exists idx_quickflex_work_results_user_date
  on public.quickflex_work_results (user_id, work_date, finalized_at);

alter table public.quickflex_active_work_leases enable row level security;
alter table public.quickflex_work_results enable row level security;
alter table public.quickflex_work_result_routes enable row level security;

revoke all on table public.quickflex_active_work_leases from public;
revoke all on table public.quickflex_active_work_leases from anon;
revoke all on table public.quickflex_active_work_leases from authenticated;
grant select on table public.quickflex_active_work_leases to authenticated;

revoke all on table public.quickflex_work_results from public;
revoke all on table public.quickflex_work_results from anon;
revoke all on table public.quickflex_work_results from authenticated;
grant select on table public.quickflex_work_results to authenticated;

revoke all on table public.quickflex_work_result_routes from public;
revoke all on table public.quickflex_work_result_routes from anon;
revoke all on table public.quickflex_work_result_routes from authenticated;
grant select on table public.quickflex_work_result_routes to authenticated;

drop policy if exists "quickflex active work leases select own" on public.quickflex_active_work_leases;
drop policy if exists "quickflex active work leases insert own" on public.quickflex_active_work_leases;
drop policy if exists "quickflex active work leases update own" on public.quickflex_active_work_leases;
drop policy if exists "quickflex active work leases delete own" on public.quickflex_active_work_leases;

create policy "quickflex active work leases select own"
on public.quickflex_active_work_leases
for select
to authenticated
using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

drop policy if exists "quickflex work results select own or admin" on public.quickflex_work_results;
drop policy if exists "quickflex work result routes select own or admin" on public.quickflex_work_result_routes;

create policy "quickflex work results select own or admin"
on public.quickflex_work_results
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.quickflex_is_admin())
);

create policy "quickflex work result routes select own or admin"
on public.quickflex_work_result_routes
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.quickflex_is_admin())
);

create or replace function public.quickflex_guard_manual_counts_after_work_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.delivery_count <> 0 or new.household_count <> 0)
     and exists (
       select 1
       from public.quickflex_work_results as result
       where result.user_id::text = new.user_id
         and result.work_date = new.work_date
     ) then
    raise exception 'manual route counts are locked after an automatic work result exists for this date'
      using errcode = '55000';
  end if;
  return new;
end;
$$;

revoke execute on function public.quickflex_guard_manual_counts_after_work_result()
  from public, anon, authenticated;

drop trigger if exists quickflex_guard_manual_counts_after_work_result
  on public.quickflex_day_route_items;
create trigger quickflex_guard_manual_counts_after_work_result
before insert or update on public.quickflex_day_route_items
for each row execute function public.quickflex_guard_manual_counts_after_work_result();

create or replace function public.quickflex_claim_work_lease(
  p_device_id text,
  p_work_id text,
  p_work_date date,
  p_work_shift text
)
returns table (
  claimed boolean,
  active_device_id text,
  active_work_id text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  existing_lease public.quickflex_active_work_leases%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_device_id, ''))) not between 8 and 128
     or char_length(trim(coalesce(p_work_id, ''))) not between 8 and 128
     or p_work_date is null
     or p_work_shift is null
     or p_work_shift not in ('day', 'night') then
    raise exception 'invalid work lease input' using errcode = '22023';
  end if;

  select lease.*
  into existing_lease
  from public.quickflex_active_work_leases as lease
  where lease.user_id = current_user_id
  for update;

  if exists (
    select 1
    from public.quickflex_work_results as result
    where result.user_id = current_user_id
      and result.work_id = trim(p_work_id)
  ) then
    return query
    select false,
           case
             when existing_lease.user_id is not null and existing_lease.released_at is null
               then existing_lease.device_id
             else trim(p_device_id)
           end,
           case
             when existing_lease.user_id is not null and existing_lease.released_at is null
               then existing_lease.work_id
             else trim(p_work_id)
           end,
           coalesce(existing_lease.lease_expires_at, clock_timestamp());
    return;
  end if;

  if existing_lease.user_id is not null then
    if existing_lease.released_at is null then
      if existing_lease.device_id = trim(p_device_id)
         and existing_lease.work_id = trim(p_work_id) then
        if existing_lease.work_date <> p_work_date
           or existing_lease.work_shift <> p_work_shift then
          raise exception 'active work lease settings are immutable' using errcode = '22023';
        end if;

        update public.quickflex_active_work_leases
        set heartbeat_at = clock_timestamp(),
            lease_expires_at = clock_timestamp() + interval '5 minutes',
            updated_at = clock_timestamp()
        where user_id = current_user_id;
      else
        -- Expiry is not ownership release. A stale conflicting lease requires
        -- explicit release or the exact-id 30-minute stale recovery RPC first.
        null;
      end if;
    else
      if existing_lease.device_id = trim(p_device_id)
         and existing_lease.work_id = trim(p_work_id) then
        if existing_lease.work_date <> p_work_date
           or existing_lease.work_shift <> p_work_shift then
          raise exception 'released work lease settings are immutable' using errcode = '22023';
        end if;

        -- A legacy/stale recovery may have released the exact work before
        -- its immutable receipt existed. Reopen only that same identity.
        update public.quickflex_active_work_leases
        set heartbeat_at = clock_timestamp(),
            lease_expires_at = clock_timestamp() + interval '5 minutes',
            released_at = null,
            updated_at = clock_timestamp()
        where user_id = current_user_id;
      else
        if not exists (
          select 1
          from public.quickflex_profiles as profile
          where profile.id = current_user_id
            and profile.status = 'approved'
            and profile.work_shift = p_work_shift
        ) then
          raise exception 'work shift setting changed' using errcode = '22023';
        end if;

        update public.quickflex_active_work_leases
        set device_id = trim(p_device_id),
            work_id = trim(p_work_id),
            work_date = p_work_date,
            work_shift = p_work_shift,
            claimed_at = clock_timestamp(),
            heartbeat_at = clock_timestamp(),
            lease_expires_at = clock_timestamp() + interval '5 minutes',
            released_at = null,
            work_date_finalized_at = null,
            updated_at = clock_timestamp()
        where user_id = current_user_id;
      end if;
    end if;
  else
    if not exists (
      select 1
      from public.quickflex_profiles as profile
      where profile.id = current_user_id
        and profile.status = 'approved'
        and profile.work_shift = p_work_shift
    ) then
      raise exception 'work shift setting changed' using errcode = '22023';
    end if;

    insert into public.quickflex_active_work_leases (
      user_id,
      device_id,
      work_id,
      work_date,
      work_shift,
      claimed_at,
      heartbeat_at,
      lease_expires_at,
      released_at,
      work_date_finalized_at,
      updated_at
    ) values (
      current_user_id,
      trim(p_device_id),
      trim(p_work_id),
      p_work_date,
      p_work_shift,
      clock_timestamp(),
      clock_timestamp(),
      clock_timestamp() + interval '5 minutes',
      null,
      null,
      clock_timestamp()
    )
    on conflict (user_id) do update
    set device_id = excluded.device_id,
        work_id = excluded.work_id,
        work_date = excluded.work_date,
        work_shift = excluded.work_shift,
        claimed_at = clock_timestamp(),
        heartbeat_at = clock_timestamp(),
        lease_expires_at = clock_timestamp() + interval '5 minutes',
        released_at = null,
        work_date_finalized_at = null,
        updated_at = clock_timestamp()
    where public.quickflex_active_work_leases.released_at is not null
      and (
        public.quickflex_active_work_leases.device_id <> excluded.device_id
        or public.quickflex_active_work_leases.work_id <> excluded.work_id
      );
  end if;

  return query
  select
    lease.released_at is null
      and lease.device_id = trim(p_device_id)
      and lease.work_id = trim(p_work_id)
      and lease.work_date = p_work_date
      and lease.work_shift = p_work_shift,
    lease.device_id,
    lease.work_id,
    lease.lease_expires_at
  from public.quickflex_active_work_leases as lease
  where lease.user_id = current_user_id;
end;
$$;

create or replace function public.quickflex_release_work_lease(
  p_device_id text,
  p_work_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  released_count integer;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_device_id, ''))) not between 8 and 128
     or char_length(trim(coalesce(p_work_id, ''))) not between 8 and 128 then
    raise exception 'invalid work lease input' using errcode = '22023';
  end if;

  update public.quickflex_active_work_leases
  set lease_expires_at = clock_timestamp(),
      released_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where user_id = current_user_id
    and device_id = trim(p_device_id)
    and work_id = trim(p_work_id)
    and released_at is null;
  get diagnostics released_count = row_count;
  if released_count = 1 then
    return true;
  end if;
  return exists (
    select 1
    from public.quickflex_active_work_leases as lease
    where lease.user_id = current_user_id
      and lease.device_id = trim(p_device_id)
      and lease.work_id = trim(p_work_id)
      and lease.released_at is not null
  );
end;
$$;

create or replace function public.quickflex_renew_work_lease(
  p_device_id text,
  p_work_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  renewed_count integer;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_device_id, ''))) not between 8 and 128
     or char_length(trim(coalesce(p_work_id, ''))) not between 8 and 128 then
    raise exception 'invalid work lease input' using errcode = '22023';
  end if;

  update public.quickflex_active_work_leases
  set heartbeat_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + interval '5 minutes',
      updated_at = clock_timestamp()
  where user_id = current_user_id
    and device_id = trim(p_device_id)
    and work_id = trim(p_work_id)
    and released_at is null;
  get diagnostics renewed_count = row_count;
  return renewed_count = 1;
end;
$$;

create or replace function public.quickflex_force_release_stale_work_lease(
  p_expected_work_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  released_count integer;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_expected_work_id, ''))) not between 8 and 128 then
    raise exception 'invalid expected work id' using errcode = '22023';
  end if;

  update public.quickflex_active_work_leases
  set released_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where user_id = current_user_id
    and work_id = trim(p_expected_work_id)
    and released_at is null
    and lease_expires_at <= clock_timestamp() - interval '30 minutes';
  get diagnostics released_count = row_count;
  return released_count = 1;
end;
$$;

create or replace function public.quickflex_apply_work_route_result(
  p_device_id text,
  p_work_id text,
  p_work_date date,
  p_work_shift text,
  p_route text,
  p_household_count integer,
  p_unit_snapshot integer,
  p_sort_order integer,
  p_delivery_count integer default null,
  p_item_id bigint default null
)
returns table (
  id bigint,
  route text,
  sort_order integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  renewed_count integer;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  if char_length(trim(coalesce(p_device_id, ''))) not between 8 and 128
     or char_length(trim(coalesce(p_work_id, ''))) not between 8 and 128
     or p_work_date is null
     or p_work_shift is null
     or p_work_shift not in ('day', 'night')
     or trim(coalesce(p_route, '')) = ''
     or p_household_count is null
     or p_household_count < 0
     or (p_delivery_count is not null and p_delivery_count < 0)
     or p_unit_snapshot is null
     or p_unit_snapshot < 0
     or p_sort_order is null
     or p_sort_order < 0
     or (p_item_id is not null and p_item_id <= 0) then
    raise exception 'invalid work route result input' using errcode = '22023';
  end if;
  update public.quickflex_active_work_leases
  set work_date = p_work_date,
      work_date_finalized_at = coalesce(work_date_finalized_at, clock_timestamp()),
      heartbeat_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + interval '5 minutes',
      updated_at = clock_timestamp()
  where user_id = current_user_id
    and device_id = trim(p_device_id)
    and work_id = trim(p_work_id)
    and work_shift = p_work_shift
    and released_at is null
    and lease_expires_at > clock_timestamp()
    and (
      (work_date_finalized_at is null
        and p_work_date between work_date - 1 and work_date + 1)
      or (work_date_finalized_at is not null and work_date = p_work_date)
    );
  get diagnostics renewed_count = row_count;
  if renewed_count <> 1 then
    raise exception 'active work lease lost' using errcode = '55000';
  end if;

  if p_item_id is not null then
    return query
    update public.quickflex_day_route_items as item
    set delivery_count = coalesce(p_delivery_count, item.delivery_count),
        household_count = p_household_count,
        updated_at = clock_timestamp()
    where item.id = p_item_id
      and item.user_id = current_user_id::text
      and item.work_date = p_work_date
      and item.route = p_route
    returning item.id, item.route, item.sort_order;
    if not found then
      raise exception 'route item not found for active work' using errcode = 'P0002';
    end if;
    return;
  end if;

  return query
  insert into public.quickflex_day_route_items (
    user_id,
    work_date,
    route,
    delivery_count,
    household_count,
    unit_snapshot,
    sort_order,
    updated_at
  ) values (
    current_user_id::text,
    p_work_date,
    upper(trim(p_route)),
    coalesce(p_delivery_count, 0),
    p_household_count,
    p_unit_snapshot,
    p_sort_order,
    clock_timestamp()
  )
  on conflict (user_id, work_date, route) do update
  set delivery_count = coalesce(p_delivery_count, public.quickflex_day_route_items.delivery_count),
      household_count = excluded.household_count,
      unit_snapshot = excluded.unit_snapshot,
      sort_order = excluded.sort_order,
      updated_at = clock_timestamp()
  returning quickflex_day_route_items.id,
            quickflex_day_route_items.route,
            quickflex_day_route_items.sort_order;
end;
$$;

create or replace function public.quickflex_finalize_work_result(
  p_expected_device_id text,
  p_expected_work_id text,
  p_finish_date date,
  p_work_shift text,
  p_total_households integer,
  p_total_items integer,
  p_routes jsonb
)
returns table (
  status text,
  work_id text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_device_id text := trim(coalesce(p_expected_device_id, ''));
  normalized_work_id text := trim(coalesce(p_expected_work_id, ''));
  canonical_routes jsonb;
  canonical_payload jsonb;
  parsed_route_count integer;
  distinct_route_count integer;
  route_delivery_sum bigint;
  route_household_sum bigint;
  has_prior_automatic_result boolean;
  legacy_projection_matches boolean;
  existing_result public.quickflex_work_results%rowtype;
  active_lease public.quickflex_active_work_leases%rowtype;
  released_count integer;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  if char_length(normalized_device_id) not between 8 and 128
     or char_length(normalized_work_id) not between 8 and 128
     or p_finish_date is null
     or p_work_shift is null
     or p_work_shift not in ('day', 'night')
     or p_total_households is null
     or p_total_households < 0
     or p_total_items is null
     or p_total_items < 0
     or p_routes is null
     or jsonb_typeof(p_routes) is distinct from 'array' then
    raise exception 'invalid work result input' using errcode = '22023';
  end if;
  if jsonb_array_length(p_routes) not between 1 and 100 then
    raise exception 'invalid work result input' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_routes) as entry(value)
    where jsonb_typeof(entry.value) is distinct from 'object'
       or jsonb_typeof(entry.value -> 'route') is distinct from 'string'
       or upper(trim(entry.value ->> 'route')) !~ '^[0-9]{3}[A-Z]$'
       or jsonb_typeof(entry.value -> 'delivery_count') is distinct from 'number'
       or (entry.value ->> 'delivery_count') !~ '^(0|[1-9][0-9]*)$'
       or jsonb_typeof(entry.value -> 'household_count') is distinct from 'number'
       or (entry.value ->> 'household_count') !~ '^(0|[1-9][0-9]*)$'
       or jsonb_typeof(entry.value -> 'unit_snapshot') is distinct from 'number'
       or (entry.value ->> 'unit_snapshot') !~ '^(0|[1-9][0-9]*)$'
       or jsonb_typeof(entry.value -> 'sort_order') is distinct from 'number'
       or (entry.value ->> 'sort_order') !~ '^(0|[1-9][0-9]*)$'
  ) then
    raise exception 'invalid work result route' using errcode = '22023';
  end if;

  select count(*),
         count(distinct upper(trim(entry.value ->> 'route'))),
         coalesce(sum((entry.value ->> 'delivery_count')::integer), 0),
         coalesce(sum((entry.value ->> 'household_count')::integer), 0),
         jsonb_agg(
           jsonb_build_object(
             'route', upper(trim(entry.value ->> 'route')),
             'delivery_count', (entry.value ->> 'delivery_count')::integer,
             'household_count', (entry.value ->> 'household_count')::integer,
             'unit_snapshot', (entry.value ->> 'unit_snapshot')::integer,
             'sort_order', (entry.value ->> 'sort_order')::integer
           )
           order by upper(trim(entry.value ->> 'route'))
         )
  into parsed_route_count,
       distinct_route_count,
       route_delivery_sum,
       route_household_sum,
       canonical_routes
  from jsonb_array_elements(p_routes) as entry(value);

  if parsed_route_count <> distinct_route_count then
    raise exception 'duplicate work result route' using errcode = '22023';
  end if;
  if route_delivery_sum <> p_total_items::bigint
     or route_household_sum <> p_total_households::bigint then
    raise exception 'work result totals do not match route sums' using errcode = '22023';
  end if;

  canonical_payload := jsonb_build_object(
    'work_date', p_finish_date,
    'work_shift', p_work_shift,
    'total_households', p_total_households,
    'total_items', p_total_items,
    'routes', canonical_routes
  );

  select result.*
  into existing_result
  from public.quickflex_work_results as result
  where result.user_id = current_user_id
    and result.work_id = normalized_work_id;

  if found then
    if existing_result.canonical_payload = canonical_payload then
      return query select 'already_applied'::text, normalized_work_id;
      return;
    end if;
    raise exception 'work result payload conflicts with immutable receipt'
      using errcode = '23505';
  end if;

  select lease.*
  into active_lease
  from public.quickflex_active_work_leases as lease
  where lease.user_id = current_user_id
  for update;

  -- A concurrent first request may have completed while this request waited
  -- for the account lease. Re-check the immutable receipt under that lock.
  select result.*
  into existing_result
  from public.quickflex_work_results as result
  where result.user_id = current_user_id
    and result.work_id = normalized_work_id;

  if found then
    if existing_result.canonical_payload = canonical_payload then
      return query select 'already_applied'::text, normalized_work_id;
      return;
    end if;
    raise exception 'work result payload conflicts with immutable receipt'
      using errcode = '23505';
  end if;

  if active_lease.user_id is null
     or active_lease.released_at is not null
     or active_lease.lease_expires_at <= clock_timestamp()
     or active_lease.device_id <> normalized_device_id
     or active_lease.work_id <> normalized_work_id
     or active_lease.work_shift <> p_work_shift then
    raise exception 'active work lease lost' using errcode = '55000';
  end if;
  if p_finish_date not between active_lease.work_date - 1 and active_lease.work_date + 1 then
    raise exception 'finish date is outside the active work window' using errcode = '22023';
  end if;

  select exists (
    select 1
    from public.quickflex_work_results as result
    where result.user_id = current_user_id
      and result.work_date = p_finish_date
  )
  into has_prior_automatic_result;

  if not has_prior_automatic_result then
    -- The first automatic receipt establishes a separate ledger for this
    -- date. Serialize against manual writes before checking for mixed data.
    lock table public.quickflex_day_route_items in share row exclusive mode;

    if exists (
      select 1
      from public.quickflex_day_route_items as item
      where item.user_id = current_user_id::text
        and item.work_date = p_finish_date
        and (item.delivery_count <> 0 or item.household_count <> 0)
    ) then
      with incoming as (
        select entry.value ->> 'route' as route,
               (entry.value ->> 'delivery_count')::integer as delivery_count
        from jsonb_array_elements(canonical_routes) as entry(value)
      ),
      manual_rows as (
        select item.id,
               item.route,
               item.delivery_count,
               item.household_count
        from public.quickflex_day_route_items as item
        where item.user_id = current_user_id::text
          and item.work_date = p_finish_date
          and (item.delivery_count <> 0 or item.household_count <> 0)
      ),
      manual_members as (
        select distinct manual.id,
               upper(trim(member.value)) as route
        from manual_rows as manual
        cross join lateral regexp_split_to_table(manual.route, '[|,/ ·]+') as member(value)
        where upper(trim(member.value)) ~ '^[0-9]{3}[A-Z]$'
      ),
      row_delivery as (
        select manual.id,
               count(member.route) as member_count,
               count(incoming.route) as matched_count,
               coalesce(sum(incoming.delivery_count), 0)::bigint as expected_delivery_count
        from manual_rows as manual
        left join manual_members as member on member.id = manual.id
        left join incoming on incoming.route = member.route
        group by manual.id
      ),
      route_coverage as (
        select incoming.route,
               incoming.delivery_count,
               count(member.id) as covering_rows
        from incoming
        left join manual_members as member on member.route = incoming.route
        group by incoming.route, incoming.delivery_count
      )
      select
        not exists (
          select 1
          from manual_members
          group by route
          having count(*) > 1
        )
        and not exists (
          select 1
          from row_delivery
          join manual_rows as manual on manual.id = row_delivery.id
          where row_delivery.member_count = 0
             or row_delivery.matched_count <> row_delivery.member_count
             or row_delivery.expected_delivery_count <> manual.delivery_count::bigint
        )
        and not exists (
          select 1
          from route_coverage
          where delivery_count > 0
            and covering_rows <> 1
        )
        and coalesce((select sum(delivery_count)::bigint from manual_rows), 0) = p_total_items::bigint
        and coalesce((select sum(household_count)::bigint from manual_rows), 0) = p_total_households::bigint
        and (select count(*) from manual_rows where household_count > 0) =
          case when p_total_households > 0 then 1 else 0 end
      into legacy_projection_matches;

      if legacy_projection_matches is distinct from true then
        raise exception 'existing day route counts do not exactly match a recoverable legacy work result'
          using errcode = '55000';
      end if;

      -- Keep route, unit, ordering, and schedule metadata. Only the legacy
      -- counts move from the manual ledger into the immutable work receipt.
      update public.quickflex_day_route_items as item
      set delivery_count = 0,
          household_count = 0,
          updated_at = clock_timestamp()
      where item.user_id = current_user_id::text
        and item.work_date = p_finish_date
        and (item.delivery_count <> 0 or item.household_count <> 0);
    end if;
  end if;

  insert into public.quickflex_work_results (
    user_id,
    work_id,
    device_id,
    work_date,
    work_shift,
    total_households,
    total_items,
    canonical_payload,
    finalized_at
  ) values (
    current_user_id,
    normalized_work_id,
    normalized_device_id,
    p_finish_date,
    p_work_shift,
    p_total_households,
    p_total_items,
    canonical_payload,
    clock_timestamp()
  );

  insert into public.quickflex_work_result_routes (
    user_id,
    work_id,
    route,
    delivery_count,
    household_count,
    unit_snapshot,
    sort_order
  )
  select current_user_id,
         normalized_work_id,
         entry.value ->> 'route',
         (entry.value ->> 'delivery_count')::integer,
         (entry.value ->> 'household_count')::integer,
         (entry.value ->> 'unit_snapshot')::integer,
         (entry.value ->> 'sort_order')::integer
  from jsonb_array_elements(canonical_routes) as entry(value);

  update public.quickflex_active_work_leases as lease
  set work_date = p_finish_date,
      work_date_finalized_at = clock_timestamp(),
      heartbeat_at = clock_timestamp(),
      lease_expires_at = clock_timestamp(),
      released_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where lease.user_id = current_user_id
    and lease.device_id = normalized_device_id
    and lease.work_id = normalized_work_id
    and lease.work_shift = p_work_shift
    and lease.released_at is null
    and lease.lease_expires_at > clock_timestamp();
  get diagnostics released_count = row_count;
  if released_count <> 1 then
    raise exception 'active work lease lost before commit' using errcode = '55000';
  end if;

  return query select 'applied'::text, normalized_work_id;
end;
$$;

revoke execute on function public.quickflex_claim_work_lease(text, text, date, text) from public, anon;
revoke execute on function public.quickflex_release_work_lease(text, text) from public, anon;
revoke execute on function public.quickflex_renew_work_lease(text, text) from public, anon;
revoke execute on function public.quickflex_force_release_stale_work_lease(text) from public, anon;
revoke execute on function public.quickflex_apply_work_route_result(text, text, date, text, text, integer, integer, integer, integer, bigint) from public, anon, authenticated;
revoke execute on function public.quickflex_finalize_work_result(text, text, date, text, integer, integer, jsonb) from public, anon, authenticated;
grant execute on function public.quickflex_claim_work_lease(text, text, date, text) to authenticated;
grant execute on function public.quickflex_release_work_lease(text, text) to authenticated;
grant execute on function public.quickflex_renew_work_lease(text, text) to authenticated;
grant execute on function public.quickflex_force_release_stale_work_lease(text) to authenticated;
grant execute on function public.quickflex_finalize_work_result(text, text, date, text, integer, integer, jsonb) to authenticated;

comment on table public.quickflex_active_work_leases is
  'One authoritative Android counter lease per QuickFlex account. Expiry does not release ownership; exact-id stale recovery is allowed only after 30 minutes.';

comment on column public.quickflex_active_work_leases.work_date_finalized_at is
  'Locks work_date to the first accepted result date, which may be within one day of the claimed date';

comment on function public.quickflex_claim_work_lease(text, text, date, text) is
  'Claims one account lease, reopens an exact released receipt-free work, and returns claimed=false for any immutable receipt work id';

comment on function public.quickflex_force_release_stale_work_lease(text) is
  'Releases only the authenticated caller''s exact expected work id after its unreleased lease has been expired for at least 30 minutes';

comment on table public.quickflex_work_results is
  'Immutable Android work result receipts kept separate from manual day route rows';

comment on table public.quickflex_work_result_routes is
  'Immutable normalized route counts belonging to an Android work result receipt';

comment on function public.quickflex_finalize_work_result(text, text, date, text, integer, integer, jsonb) is
  'Atomically records one immutable Android work result and releases its lease; only an exact first-date legacy duplicate has its manual counts zeroed';

comment on function public.quickflex_guard_manual_counts_after_work_result() is
  'Rejects nonzero manual route counts after an automatic receipt exists while allowing zero-count route metadata';
