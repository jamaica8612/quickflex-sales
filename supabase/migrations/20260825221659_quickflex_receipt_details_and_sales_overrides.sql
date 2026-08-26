create table if not exists public.quickflex_work_result_route_details (
  user_id uuid not null,
  work_id text not null,
  base_route text not null check (base_route ~ '^[0-9]{3}[A-Z]$'),
  detail_route text not null check (detail_route ~ '^[0-9]{3}[A-Z][0-9]{2}$'),
  delivery_count integer not null check (delivery_count >= 0),
  primary key (user_id, work_id, detail_route),
  constraint quickflex_work_result_route_details_base_matches
    check (left(detail_route, 4) = base_route),
  foreign key (user_id, work_id, base_route)
    references public.quickflex_work_result_routes(user_id, work_id, route)
    on delete cascade
);

create table if not exists public.quickflex_automatic_sales_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  work_date date not null,
  revision bigint not null check (revision >= 1),
  request_id text not null check (char_length(request_id) between 8 and 128),
  routes jsonb not null check (jsonb_typeof(routes) = 'array'),
  total_items integer not null check (total_items >= 0),
  reason text not null default '' check (char_length(reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, work_date)
);

create index if not exists idx_quickflex_work_result_route_details_work
  on public.quickflex_work_result_route_details (user_id, work_id, base_route);
create index if not exists idx_quickflex_automatic_sales_overrides_date_user
  on public.quickflex_automatic_sales_overrides (work_date, user_id);

alter table public.quickflex_work_result_route_details enable row level security;
alter table public.quickflex_automatic_sales_overrides enable row level security;

revoke all on table public.quickflex_work_result_route_details from public, anon, authenticated;
grant select on table public.quickflex_work_result_route_details to authenticated;

revoke all on table public.quickflex_automatic_sales_overrides from public, anon, authenticated;
grant select on table public.quickflex_automatic_sales_overrides to authenticated;

drop policy if exists "quickflex work result route details select own or admin"
  on public.quickflex_work_result_route_details;
create policy "quickflex work result route details select own or admin"
on public.quickflex_work_result_route_details
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.quickflex_is_admin())
);

drop policy if exists "quickflex automatic sales overrides select own or admin"
  on public.quickflex_automatic_sales_overrides;
create policy "quickflex automatic sales overrides select own or admin"
on public.quickflex_automatic_sales_overrides
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.quickflex_is_admin())
);

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
  canonical_identity_routes jsonb;
  canonical_identity_payload jsonb;
  existing_identity_payload jsonb;
  parsed_route_count integer;
  distinct_route_count integer;
  route_delivery_sum bigint;
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
       or case
            when (entry.value ->> 'delivery_count') ~ '^(0|[1-9][0-9]*)$'
            then (entry.value ->> 'delivery_count')::numeric > 2147483647
            else false
          end
       or case
            when (entry.value ->> 'household_count') ~ '^(0|[1-9][0-9]*)$'
            then (entry.value ->> 'household_count')::numeric > 2147483647
            else false
          end
       or case
            when (entry.value ->> 'unit_snapshot') ~ '^(0|[1-9][0-9]*)$'
            then (entry.value ->> 'unit_snapshot')::numeric > 2147483647
            else false
          end
       or case
            when (entry.value ->> 'sort_order') ~ '^(0|[1-9][0-9]*)$'
            then (entry.value ->> 'sort_order')::numeric > 2147483647
            else false
          end
       or (
         entry.value ? 'detail_counts'
         and jsonb_typeof(entry.value -> 'detail_counts') is distinct from 'object'
       )
  ) then
    raise exception 'invalid work result route' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_routes) as entry(value)
    cross join lateral jsonb_each(
      coalesce(entry.value -> 'detail_counts', '{}'::jsonb)
    ) as detail(key, value)
    where detail.key !~ '^[0-9]{3}[A-Z][0-9]{2}$'
       or left(detail.key, 4) <> upper(trim(entry.value ->> 'route'))
       or jsonb_typeof(detail.value) is distinct from 'number'
       or detail.value::text !~ '^(0|[1-9][0-9]*)$'
       or case
            when jsonb_typeof(detail.value) = 'number'
             and detail.value::text ~ '^(0|[1-9][0-9]*)$'
            then (detail.value::text)::numeric > 2147483647
            else false
          end
  ) then
    raise exception 'invalid work result route detail' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_routes) as entry(value)
    cross join lateral (
      select coalesce(sum((detail.value::text)::bigint), 0) as detail_sum
      from jsonb_each(coalesce(entry.value -> 'detail_counts', '{}'::jsonb)) as detail(key, value)
    ) as totals
    where totals.detail_sum > (entry.value ->> 'delivery_count')::bigint
  ) then
    raise exception 'work result route detail sum exceeds base route count'
      using errcode = '22023';
  end if;

  select count(*),
         count(distinct upper(trim(entry.value ->> 'route'))),
         coalesce(sum((entry.value ->> 'delivery_count')::integer), 0),
         jsonb_agg(
           jsonb_build_object(
             'route', upper(trim(entry.value ->> 'route')),
             'delivery_count', (entry.value ->> 'delivery_count')::integer,
             'household_count', (entry.value ->> 'household_count')::integer,
             'unit_snapshot', (entry.value ->> 'unit_snapshot')::integer,
             'sort_order', (entry.value ->> 'sort_order')::integer,
             'detail_counts', coalesce(entry.value -> 'detail_counts', '{}'::jsonb)
           )
           order by upper(trim(entry.value ->> 'route'))
         )
  into parsed_route_count,
       distinct_route_count,
       route_delivery_sum,
       canonical_routes
  from jsonb_array_elements(p_routes) as entry(value);

  if parsed_route_count <> distinct_route_count then
    raise exception 'duplicate work result route' using errcode = '22023';
  end if;
  if route_delivery_sum <> p_total_items::bigint then
    raise exception 'work result item total does not match route sum' using errcode = '22023';
  end if;

  select jsonb_agg(entry.value - 'household_count' order by entry.value ->> 'route')
  into canonical_identity_routes
  from jsonb_array_elements(canonical_routes) as entry(value);

  canonical_payload := jsonb_build_object(
    'work_date', p_finish_date,
    'work_shift', p_work_shift,
    'total_households', p_total_households,
    'total_items', p_total_items,
    'routes', canonical_routes
  );
  canonical_identity_payload := jsonb_build_object(
    'work_date', p_finish_date,
    'work_shift', p_work_shift,
    'total_items', p_total_items,
    'routes', canonical_identity_routes
  );

  select result.*
  into existing_result
  from public.quickflex_work_results as result
  where result.user_id = current_user_id
    and result.work_id = normalized_work_id;

  if found then
    select jsonb_build_object(
      'work_date', existing_result.work_date,
      'work_shift', existing_result.work_shift,
      'total_items', existing_result.total_items,
      'routes', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'route', route_row.route,
            'delivery_count', route_row.delivery_count,
            'unit_snapshot', route_row.unit_snapshot,
            'sort_order', route_row.sort_order,
            'detail_counts', coalesce((
              select jsonb_object_agg(detail.detail_route, detail.delivery_count order by detail.detail_route)
              from public.quickflex_work_result_route_details as detail
              where detail.user_id = route_row.user_id
                and detail.work_id = route_row.work_id
                and detail.base_route = route_row.route
            ), '{}'::jsonb)
          )
          order by route_row.route
        )
        from public.quickflex_work_result_routes as route_row
        where route_row.user_id = existing_result.user_id
          and route_row.work_id = existing_result.work_id
      ), '[]'::jsonb)
    )
    into existing_identity_payload;

    if existing_identity_payload = canonical_identity_payload then
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
    select jsonb_build_object(
      'work_date', existing_result.work_date,
      'work_shift', existing_result.work_shift,
      'total_items', existing_result.total_items,
      'routes', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'route', route_row.route,
            'delivery_count', route_row.delivery_count,
            'unit_snapshot', route_row.unit_snapshot,
            'sort_order', route_row.sort_order,
            'detail_counts', coalesce((
              select jsonb_object_agg(detail.detail_route, detail.delivery_count order by detail.detail_route)
              from public.quickflex_work_result_route_details as detail
              where detail.user_id = route_row.user_id
                and detail.work_id = route_row.work_id
                and detail.base_route = route_row.route
            ), '{}'::jsonb)
          )
          order by route_row.route
        )
        from public.quickflex_work_result_routes as route_row
        where route_row.user_id = existing_result.user_id
          and route_row.work_id = existing_result.work_id
      ), '[]'::jsonb)
    )
    into existing_identity_payload;

    if existing_identity_payload = canonical_identity_payload then
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
        and item.delivery_count <> 0
    ) then
      with incoming as (
        select entry.value ->> 'route' as route,
               (entry.value ->> 'delivery_count')::integer as delivery_count
        from jsonb_array_elements(canonical_routes) as entry(value)
      ),
      manual_rows as (
        select item.id,
               item.route,
               item.delivery_count
        from public.quickflex_day_route_items as item
        where item.user_id = current_user_id::text
          and item.work_date = p_finish_date
          and item.delivery_count <> 0
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

  insert into public.quickflex_work_result_route_details (
    user_id,
    work_id,
    base_route,
    detail_route,
    delivery_count
  )
  select current_user_id,
         normalized_work_id,
         entry.value ->> 'route',
         detail.key,
         (detail.value::text)::integer
  from jsonb_array_elements(canonical_routes) as entry(value)
  cross join lateral jsonb_each(
    coalesce(entry.value -> 'detail_counts', '{}'::jsonb)
  ) as detail(key, value);

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

create or replace function public.quickflex_replace_automatic_sales_override(
  p_work_date date,
  p_expected_revision bigint,
  p_request_id text,
  p_reason text,
  p_routes jsonb
)
returns table (
  status text,
  revision bigint,
  total_items integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_request_id text := trim(coalesce(p_request_id, ''));
  normalized_reason text := trim(coalesce(p_reason, ''));
  canonical_routes jsonb;
  parsed_route_count integer;
  distinct_route_count integer;
  route_delivery_sum bigint;
  next_revision bigint;
  existing_override public.quickflex_automatic_sales_overrides%rowtype;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  if p_work_date is null
     or p_expected_revision is null
     or p_expected_revision < 0
     or char_length(normalized_request_id) not between 8 and 128
     or char_length(normalized_reason) > 1000
     or p_routes is null
     or jsonb_typeof(p_routes) is distinct from 'array' then
    raise exception 'invalid automatic sales override input' using errcode = '22023';
  end if;
  if jsonb_array_length(p_routes) not between 1 and 100 then
    raise exception 'automatic sales override requires 1 to 100 routes' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_routes) as entry(value)
    where jsonb_typeof(entry.value) is distinct from 'object'
       or jsonb_typeof(entry.value -> 'route') is distinct from 'string'
       or upper(trim(entry.value ->> 'route')) !~ '^[0-9]{3}[A-Z]$'
       or jsonb_typeof(entry.value -> 'delivery_count') is distinct from 'number'
       or (entry.value ->> 'delivery_count') !~ '^(0|[1-9][0-9]*)$'
       or jsonb_typeof(entry.value -> 'unit_snapshot') is distinct from 'number'
       or (entry.value ->> 'unit_snapshot') !~ '^(0|[1-9][0-9]*)$'
       or jsonb_typeof(entry.value -> 'sort_order') is distinct from 'number'
       or (entry.value ->> 'sort_order') !~ '^(0|[1-9][0-9]*)$'
       or case
            when (entry.value ->> 'delivery_count') ~ '^(0|[1-9][0-9]*)$'
            then (entry.value ->> 'delivery_count')::numeric > 2147483647
            else false
          end
       or case
            when (entry.value ->> 'unit_snapshot') ~ '^(0|[1-9][0-9]*)$'
            then (entry.value ->> 'unit_snapshot')::numeric > 2147483647
            else false
          end
       or case
            when (entry.value ->> 'sort_order') ~ '^(0|[1-9][0-9]*)$'
            then (entry.value ->> 'sort_order')::numeric > 2147483647
            else false
          end
  ) then
    raise exception 'invalid automatic sales override route' using errcode = '22023';
  end if;

  select count(*),
         count(distinct upper(trim(entry.value ->> 'route'))),
         coalesce(sum((entry.value ->> 'delivery_count')::bigint), 0),
         jsonb_agg(
           jsonb_build_object(
             'route', upper(trim(entry.value ->> 'route')),
             'delivery_count', (entry.value ->> 'delivery_count')::integer,
             'unit_snapshot', (entry.value ->> 'unit_snapshot')::integer,
             'sort_order', (entry.value ->> 'sort_order')::integer
           )
           order by upper(trim(entry.value ->> 'route'))
         )
  into parsed_route_count,
       distinct_route_count,
       route_delivery_sum,
       canonical_routes
  from jsonb_array_elements(p_routes) as entry(value);

  if parsed_route_count <> distinct_route_count then
    raise exception 'duplicate automatic sales override route' using errcode = '22023';
  end if;
  if route_delivery_sum > 2147483647 then
    raise exception 'automatic sales override total is too large' using errcode = '22023';
  end if;

  -- Serialize all edits for one owner/date on one immutable receipt row.
  perform 1
  from public.quickflex_work_results as result
  where result.user_id = current_user_id
    and result.work_date = p_work_date
  order by result.work_id
  limit 1
  for update;
  if not found then
    raise exception 'automatic work result required for override' using errcode = '55000';
  end if;

  select override_row.*
  into existing_override
  from public.quickflex_automatic_sales_overrides as override_row
  where override_row.user_id = current_user_id
    and override_row.work_date = p_work_date
  for update;

  if found then
    if existing_override.request_id = normalized_request_id then
      if existing_override.routes = canonical_routes
         and existing_override.reason = normalized_reason then
        return query
        select 'already_applied'::text,
               existing_override.revision,
               existing_override.total_items;
        return;
      end if;
      raise exception 'automatic sales override request id conflicts with another payload'
        using errcode = '23505';
    end if;

    if existing_override.revision <> p_expected_revision then
      raise exception 'automatic sales override revision conflict' using errcode = '40001';
    end if;

    next_revision := existing_override.revision + 1;
    update public.quickflex_automatic_sales_overrides as override_row
    set revision = next_revision,
        request_id = normalized_request_id,
        routes = canonical_routes,
        total_items = route_delivery_sum::integer,
        reason = normalized_reason,
        updated_at = clock_timestamp()
    where override_row.user_id = current_user_id
      and override_row.work_date = p_work_date;
  else
    if p_expected_revision <> 0 then
      raise exception 'automatic sales override revision conflict' using errcode = '40001';
    end if;

    next_revision := 1;
    insert into public.quickflex_automatic_sales_overrides (
      user_id,
      work_date,
      revision,
      request_id,
      routes,
      total_items,
      reason,
      created_at,
      updated_at
    ) values (
      current_user_id,
      p_work_date,
      next_revision,
      normalized_request_id,
      canonical_routes,
      route_delivery_sum::integer,
      normalized_reason,
      clock_timestamp(),
      clock_timestamp()
    );
  end if;

  return query select 'applied'::text, next_revision, route_delivery_sum::integer;
end;
$$;

revoke execute on function public.quickflex_finalize_work_result(text, text, date, text, integer, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.quickflex_finalize_work_result(text, text, date, text, integer, integer, jsonb)
  to authenticated;

revoke execute on function public.quickflex_replace_automatic_sales_override(date, bigint, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.quickflex_replace_automatic_sales_override(date, bigint, text, text, jsonb)
  to authenticated;

comment on table public.quickflex_work_result_route_details is
  'Immutable optional detailed-route evidence stored atomically with one Android work receipt';
comment on table public.quickflex_automatic_sales_overrides is
  'One editable full automatic-sales snapshot per owner/date; consumers replace original receipt rows instead of adding both';
comment on function public.quickflex_finalize_work_result(text, text, date, text, integer, integer, jsonb) is
  'Atomically records one immutable Android work receipt and optional detail_counts; household counts are stored as first-write reference values but excluded from sales identity and legacy projection matching';
comment on function public.quickflex_replace_automatic_sales_override(date, bigint, text, text, jsonb) is
  'Replaces the authenticated owner date automatic-sales snapshot with optimistic revision and request-id idempotency';
