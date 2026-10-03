-- Optional measurement metadata. Final sales and counting rules are unchanged.
create table if not exists public.quickflex_work_timings (
  user_id uuid not null references auth.users(id) on delete cascade,
  work_id text not null check (char_length(work_id) between 8 and 128),
  work_date date not null,
  work_shift text not null check (work_shift in ('day', 'night')),
  started_at timestamptz not null check (isfinite(started_at)),
  ended_at timestamptz not null check (isfinite(ended_at)),
  active_seconds integer not null check (active_seconds >= 0),
  measured_items integer not null check (measured_items >= 0),
  route_active_seconds jsonb not null check (jsonb_typeof(route_active_seconds) = 'object'),
  updated_at timestamptz not null default now(),
  primary key (user_id, work_id),
  foreign key (user_id, work_id) references public.quickflex_work_results(user_id, work_id) on delete cascade,
  check (ended_at >= started_at and ended_at - started_at <= interval '24 hours'),
  check (active_seconds <= extract(epoch from ended_at - started_at))
);

create index if not exists quickflex_work_timings_user_date_idx
  on public.quickflex_work_timings(user_id, work_date);
alter table public.quickflex_work_timings enable row level security;
revoke all on public.quickflex_work_timings from public, anon, authenticated, service_role;
grant select on public.quickflex_work_timings to authenticated;
drop policy if exists "quickflex work timings select own approved" on public.quickflex_work_timings;
create policy "quickflex work timings select own approved"
  on public.quickflex_work_timings for select to authenticated
  using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

create or replace function public.quickflex_record_work_timing(
  p_work_id text,
  p_work_date date,
  p_work_shift text,
  p_started_at timestamptz,
  p_ended_at timestamptz,
  p_active_seconds integer,
  p_measured_items integer,
  p_route_active_seconds jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  saved_work public.quickflex_work_results%rowtype;
  route_entry record;
  route_seconds numeric := 0;
begin
  if current_user_id is null or not coalesce((select public.quickflex_is_approved()), false) then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  select * into saved_work from public.quickflex_work_results
    where user_id = current_user_id and work_id = p_work_id for key share;
  if not found then
    raise exception 'own finalized work required' using errcode = '42501';
  end if;
  if p_work_date is distinct from saved_work.work_date
     or p_work_shift is distinct from saved_work.work_shift then
    raise exception 'timing must match finalized work date and shift' using errcode = '22023';
  end if;
  if p_started_at is null or p_ended_at is null
     or not isfinite(p_started_at) or not isfinite(p_ended_at)
     or p_ended_at < p_started_at or p_ended_at - p_started_at > interval '24 hours'
     or p_active_seconds is null or p_active_seconds < 0
     or p_active_seconds > extract(epoch from p_ended_at - p_started_at)
     or p_measured_items is null or p_measured_items < 0
     or p_route_active_seconds is null or jsonb_typeof(p_route_active_seconds) <> 'object' then
    raise exception 'invalid work timing range' using errcode = '22023';
  end if;
  for route_entry in select key, value from jsonb_each(p_route_active_seconds) loop
    if route_entry.key !~ '^[0-9]{3}[A-Z]$'
       or jsonb_typeof(route_entry.value) <> 'number'
       or route_entry.value::text !~ '^(0|[1-9][0-9]*)$' then
      raise exception 'invalid route timing' using errcode = '22023';
    end if;
    route_seconds := route_seconds + route_entry.value::text::numeric;
  end loop;
  if route_seconds > p_active_seconds::numeric + 60 then
    raise exception 'route timing exceeds active time' using errcode = '22023';
  end if;
  insert into public.quickflex_work_timings as timing
    (user_id, work_id, work_date, work_shift, started_at, ended_at,
     active_seconds, measured_items, route_active_seconds)
  values
    (current_user_id, p_work_id, p_work_date, p_work_shift, p_started_at, p_ended_at,
     p_active_seconds, p_measured_items, p_route_active_seconds)
  on conflict (user_id, work_id) do update set
    work_date = excluded.work_date, work_shift = excluded.work_shift,
    started_at = excluded.started_at, ended_at = excluded.ended_at,
    active_seconds = excluded.active_seconds, measured_items = excluded.measured_items,
    route_active_seconds = excluded.route_active_seconds, updated_at = now();
  return jsonb_build_object('status', 'applied', 'work_id', p_work_id);
end;
$$;
revoke all on function public.quickflex_record_work_timing(text, date, text, timestamptz, timestamptz, integer, integer, jsonb)
  from public, anon, service_role;
grant execute on function public.quickflex_record_work_timing(text, date, text, timestamptz, timestamptz, integer, integer, jsonb)
  to authenticated;
