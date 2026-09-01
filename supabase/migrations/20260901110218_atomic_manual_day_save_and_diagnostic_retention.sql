create or replace function public.quickflex_replace_manual_day_record(
  p_work_date date,
  p_delete_day boolean,
  p_is_off boolean,
  p_fresh_count integer,
  p_fresh_unit integer,
  p_fresh_solo_count integer,
  p_fresh_linked_count integer,
  p_backup_unit integer,
  p_driver_type text,
  p_items jsonb default '[]'::jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id text := (select auth.uid())::text;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_work_date is null then
    raise exception 'work date is required' using errcode = '22023';
  end if;
  if p_driver_type not in ('backup', 'fixed') then
    raise exception 'invalid driver type' using errcode = '22023';
  end if;
  if least(
    coalesce(p_fresh_count, -1),
    coalesce(p_fresh_unit, -1),
    coalesce(p_fresh_solo_count, -1),
    coalesce(p_fresh_linked_count, -1),
    coalesce(p_backup_unit, -1)
  ) < 0 then
    raise exception 'day counts and units must be non-negative' using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'items must be a JSON array' using errcode = '22023';
  end if;

  -- Android automatic close takes the same table lock, so manual replacement and
  -- immutable receipt finalization cannot interleave between DELETE and INSERT.
  lock table public.quickflex_day_route_items in share row exclusive mode;

  if exists (
    select 1
    from public.quickflex_work_results as result
    where result.user_id::text = current_user_id
      and result.work_date = p_work_date
  ) then
    raise exception 'automatic work result exists for this date' using errcode = '55000';
  end if;

  delete from public.quickflex_day_route_items as item
  where item.user_id = current_user_id
    and item.work_date = p_work_date;

  if p_delete_day then
    delete from public.quickflex_day_records as day
    where day.user_id = current_user_id
      and day.work_date = p_work_date;
    return true;
  end if;

  insert into public.quickflex_day_records (
    user_id,
    work_date,
    is_off,
    fresh_count,
    fresh_unit,
    fresh_solo_count,
    fresh_linked_count,
    backup_unit,
    driver_type,
    updated_at
  ) values (
    current_user_id,
    p_work_date,
    coalesce(p_is_off, false),
    p_fresh_count,
    p_fresh_unit,
    p_fresh_solo_count,
    p_fresh_linked_count,
    p_backup_unit,
    p_driver_type,
    clock_timestamp()
  )
  on conflict (user_id, work_date) do update
  set is_off = excluded.is_off,
      fresh_count = excluded.fresh_count,
      fresh_unit = excluded.fresh_unit,
      fresh_solo_count = excluded.fresh_solo_count,
      fresh_linked_count = excluded.fresh_linked_count,
      backup_unit = excluded.backup_unit,
      driver_type = excluded.driver_type,
      updated_at = excluded.updated_at;

  insert into public.quickflex_day_route_items (
    user_id,
    work_date,
    route,
    delivery_count,
    household_count,
    unit_snapshot,
    sort_order,
    updated_at
  )
  select current_user_id,
         p_work_date,
         parsed.route,
         parsed.delivery_count,
         parsed.household_count,
         parsed.unit_snapshot,
         parsed.sort_order,
         clock_timestamp()
  from jsonb_to_recordset(coalesce(p_items, '[]'::jsonb)) as parsed(
    route text,
    delivery_count integer,
    household_count integer,
    unit_snapshot integer,
    sort_order integer
  )
  where nullif(btrim(parsed.route), '') is not null
    and parsed.delivery_count >= 0
    and parsed.household_count >= 0
    and parsed.unit_snapshot >= 0
    and parsed.sort_order >= 0;

  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) <> (
    select count(*)
    from public.quickflex_day_route_items as item
    where item.user_id = current_user_id
      and item.work_date = p_work_date
  ) then
    raise exception 'one or more manual route rows are invalid' using errcode = '22023';
  end if;

  return true;
end;
$$;

revoke execute on function public.quickflex_replace_manual_day_record(
  date, boolean, boolean, integer, integer, integer, integer, integer, text, jsonb
) from public, anon, authenticated;
grant execute on function public.quickflex_replace_manual_day_record(
  date, boolean, boolean, integer, integer, integer, integer, integer, text, jsonb
) to authenticated;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.quickflex_prune_measurement_diagnostics()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  delete from public.quickflex_measurement_diagnostics
  where created_at < clock_timestamp() - interval '14 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke execute on function private.quickflex_prune_measurement_diagnostics()
  from public, anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'quickflex-measurement-diagnostics-retention',
  '27 3 * * *',
  $$select private.quickflex_prune_measurement_diagnostics()$$
);

comment on function public.quickflex_replace_manual_day_record(
  date, boolean, boolean, integer, integer, integer, integer, integer, text, jsonb
) is 'Atomically replaces one authenticated user manual day header and route rows while excluding immutable Android work receipts';
comment on function private.quickflex_prune_measurement_diagnostics() is
  'Deletes Android measurement diagnostics older than 14 days; invoked by pg_cron only';
