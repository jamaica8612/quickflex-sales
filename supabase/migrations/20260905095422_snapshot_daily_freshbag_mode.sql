alter table public.quickflex_day_records
  add column if not exists freshbag_mode text;

update public.quickflex_day_records
set freshbag_mode = case
  when coalesce(fresh_solo_count, 0) > 0 or coalesce(fresh_linked_count, 0) > 0 then 'dual'
  else 'single'
end
where freshbag_mode is null;

alter table public.quickflex_day_records
  alter column freshbag_mode set default 'single',
  alter column freshbag_mode set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'quickflex_day_records_freshbag_mode_check'
      and conrelid = 'public.quickflex_day_records'::regclass
  ) then
    alter table public.quickflex_day_records
      add constraint quickflex_day_records_freshbag_mode_check
      check (freshbag_mode in ('single', 'dual'));
  end if;
end $$;

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
  p_items jsonb,
  p_freshbag_mode text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  replaced boolean;
  current_user_id text := (select auth.uid())::text;
begin
  if p_freshbag_mode is null or p_freshbag_mode not in ('single', 'dual') then
    raise exception 'invalid freshbag mode' using errcode = '22023';
  end if;

  select public.quickflex_replace_manual_day_record(
    p_work_date,
    p_delete_day,
    p_is_off,
    p_fresh_count,
    p_fresh_unit,
    p_fresh_solo_count,
    p_fresh_linked_count,
    p_backup_unit,
    p_driver_type,
    p_items
  )
  into replaced;

  if replaced and not p_delete_day then
    update public.quickflex_day_records as day
    set freshbag_mode = p_freshbag_mode,
        updated_at = clock_timestamp()
    where day.user_id = current_user_id
      and day.work_date = p_work_date;
  end if;

  return replaced;
end;
$$;

revoke all on function public.quickflex_replace_manual_day_record(
  date, boolean, boolean, integer, integer, integer, integer, integer, text, jsonb, text
) from public, anon, authenticated;

grant execute on function public.quickflex_replace_manual_day_record(
  date, boolean, boolean, integer, integer, integer, integer, integer, text, jsonb, text
) to authenticated;

comment on column public.quickflex_day_records.freshbag_mode is
  'Snapshots the fresh-bag pricing mode for this work date so later profile changes do not recalculate historical sales.';

comment on function public.quickflex_replace_manual_day_record(
  date, boolean, boolean, integer, integer, integer, integer, integer, text, jsonb, text
) is 'Atomically replaces one authenticated user manual day and snapshots that date fresh-bag pricing mode.';
