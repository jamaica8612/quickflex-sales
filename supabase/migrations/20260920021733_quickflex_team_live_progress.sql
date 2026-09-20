-- Additive, account-scoped phone progress. This is deliberately separate from
-- final work receipts and every sales/finance projection.
create or replace function public.quickflex_team_live_progress_routes_valid(p_routes text[])
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select cardinality(p_routes) <= 100
     and p_routes = array(select route from unnest(p_routes) as route order by route)
     and not exists (select 1 from unnest(p_routes) as route where route !~ '^[0-9]{3}[A-Z]$');
$$;

create table public.quickflex_team_live_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (device_id ~ '^[A-Za-z0-9._:-]{8,128}$'),
  work_id text not null check (work_id ~ '^[A-Za-z0-9._:-]{8,128}$'),
  work_date date not null,
  work_shift text not null check (work_shift in ('day', 'night')),
  device_name text not null check (length(device_name) between 1 and 80 and device_name !~ '[[:cntrl:]]'),
  revision bigint not null check (revision >= 0),
  households integer not null check (households between 0 and 1000000),
  items integer not null check (items between 0 and 1000000),
  routes text[] not null default '{}'::text[] check (public.quickflex_team_live_progress_routes_valid(routes)),
  status text not null check (status in ('active', 'paused', 'finished')),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (user_id, work_id)
);

create index quickflex_team_live_progress_account_shift_date
  on public.quickflex_team_live_progress (user_id, work_date, work_shift, updated_at desc);

alter table public.quickflex_team_live_progress enable row level security;
revoke all on table public.quickflex_team_live_progress from public, anon, authenticated;
grant select on table public.quickflex_team_live_progress to authenticated;

create policy "quickflex team live progress select own approved"
on public.quickflex_team_live_progress for select to authenticated
using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

create policy "quickflex team live progress insert own approved"
on public.quickflex_team_live_progress for insert to authenticated
with check (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

create policy "quickflex team live progress update own approved"
on public.quickflex_team_live_progress for update to authenticated
using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()))
with check (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

create or replace function public.quickflex_publish_team_progress(
  p_device_id text,
  p_payload jsonb
)
returns public.quickflex_team_live_progress
language plpgsql
security definer
set search_path = ''
as $$
declare
  owner_id uuid := (select auth.uid());
  incoming_work_id text := p_payload->>'work_id';
  incoming_work_date date;
  incoming_work_shift text := p_payload->>'work_shift';
  incoming_device_name text := p_payload->>'device_name';
  incoming_revision bigint;
  incoming_households integer;
  incoming_items integer;
  incoming_routes text[];
  incoming_status text := p_payload->>'status';
  existing public.quickflex_team_live_progress%rowtype;
  saved public.quickflex_team_live_progress%rowtype;
begin
  if owner_id is null or not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object'
    or exists (
      select 1 from jsonb_object_keys(p_payload) as key
      where key not in ('work_id', 'work_date', 'work_shift', 'device_name', 'revision', 'households', 'items', 'routes', 'status')
    )
    or (select count(*) from jsonb_object_keys(p_payload)) <> 9
    or coalesce(p_device_id, '') !~ '^[A-Za-z0-9._:-]{8,128}$'
    or coalesce(incoming_work_id, '') !~ '^[A-Za-z0-9._:-]{8,128}$'
    or incoming_work_shift not in ('day', 'night')
    or coalesce(length(incoming_device_name), 0) not between 1 and 80
    or incoming_device_name ~ '[[:cntrl:]]'
    or coalesce(p_payload->>'revision', '') !~ '^(0|[1-9][0-9]{0,15})$'
    or coalesce(p_payload->>'households', '') !~ '^(0|[1-9][0-9]{0,6})$'
    or coalesce(p_payload->>'items', '') !~ '^(0|[1-9][0-9]{0,6})$'
    or incoming_status not in ('active', 'paused', 'finished')
    or jsonb_typeof(p_payload->'routes') is distinct from 'array'
    or jsonb_array_length(p_payload->'routes') > 100
  then
    raise exception 'invalid live progress payload' using errcode = '22023';
  end if;

  begin
    incoming_work_date := (p_payload->>'work_date')::date;
    incoming_revision := (p_payload->>'revision')::bigint;
    incoming_households := (p_payload->>'households')::integer;
    incoming_items := (p_payload->>'items')::integer;
  exception when others then
    raise exception 'invalid live progress payload' using errcode = '22023';
  end;
  if incoming_work_date is null
    or incoming_households not between 0 and 1000000
    or incoming_items not between 0 and 1000000 then
    raise exception 'invalid live progress payload' using errcode = '22023';
  end if;

  select coalesce(array_agg(route order by route), '{}'::text[])
    into incoming_routes
    from jsonb_array_elements_text(p_payload->'routes') as route;
  if exists (
    select 1 from jsonb_array_elements_text(p_payload->'routes') as route
    where route !~ '^[0-9]{3}[A-Z]$'
  ) or cardinality(incoming_routes) <> jsonb_array_length(p_payload->'routes')
    or (select count(distinct route) from jsonb_array_elements_text(p_payload->'routes') as route)
      <> jsonb_array_length(p_payload->'routes') then
    raise exception 'invalid live progress routes' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(owner_id::text || ':' || incoming_work_id, 0)
  );
  select * into existing
    from public.quickflex_team_live_progress as progress
   where progress.user_id = owner_id and progress.work_id = incoming_work_id
   for update;

  if found then
    if existing.device_id <> p_device_id
      or existing.work_date <> incoming_work_date
      or existing.work_shift <> incoming_work_shift then
      raise exception 'live progress work identity cannot change' using errcode = '23505';
    end if;
    if incoming_revision < existing.revision then
      return existing;
    end if;
    if incoming_revision = existing.revision then
      if existing.device_name is distinct from incoming_device_name
        or existing.households <> incoming_households
        or existing.items <> incoming_items
        or existing.routes <> incoming_routes
        or existing.status <> incoming_status then
        raise exception 'live progress revision conflicts with a different payload' using errcode = '23505';
      end if;
      update public.quickflex_team_live_progress as progress
         set updated_at = clock_timestamp()
       where progress.user_id = owner_id and progress.work_id = incoming_work_id
       returning * into saved;
      return saved;
    end if;

    if existing.status = 'finished' and incoming_status <> 'finished' then
      raise exception 'finished live progress cannot return to an active state' using errcode = '23505';
    end if;

    update public.quickflex_team_live_progress as progress
       set device_name = incoming_device_name,
           revision = incoming_revision,
           households = incoming_households,
           items = incoming_items,
           routes = incoming_routes,
           status = incoming_status,
           updated_at = clock_timestamp()
     where progress.user_id = owner_id and progress.work_id = incoming_work_id
     returning * into saved;
    return saved;
  end if;

  insert into public.quickflex_team_live_progress (
    user_id, device_id, work_id, work_date, work_shift, device_name,
    revision, households, items, routes, status
  ) values (
    owner_id, p_device_id, incoming_work_id, incoming_work_date, incoming_work_shift, incoming_device_name,
    incoming_revision, incoming_households, incoming_items, incoming_routes, incoming_status
  ) returning * into saved;
  return saved;
end;
$$;

create or replace function public.quickflex_read_team_progress(
  p_work_date date,
  p_work_shift text
)
returns setof public.quickflex_team_live_progress
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  if p_work_date is null or p_work_shift not in ('day', 'night') then
    raise exception 'invalid live progress query' using errcode = '22023';
  end if;
  return query
  select progress.*
    from public.quickflex_team_live_progress as progress
   where progress.user_id = (select auth.uid())
     and progress.work_date = p_work_date
     and progress.work_shift = p_work_shift
   order by progress.updated_at desc, progress.work_id;
end;
$$;

revoke all on function public.quickflex_publish_team_progress(text, jsonb) from public, anon, authenticated;
revoke all on function public.quickflex_read_team_progress(date, text) from public, anon, authenticated;
grant execute on function public.quickflex_publish_team_progress(text, jsonb) to authenticated;
grant execute on function public.quickflex_read_team_progress(date, text) to authenticated;

comment on table public.quickflex_team_live_progress is
  'Additive phone progress only. It never feeds sales, finance, invoice de-duplication, addresses, or final work receipts.';
comment on function public.quickflex_publish_team_progress(text, jsonb) is
  'Approved owner-only live-progress upsert. Older revisions return the stored row; exact retries refresh updated_at; equal revisions with different data fail.';
comment on function public.quickflex_read_team_progress(date, text) is
  'Approved owner-only day/shift progress read. Clients derive stale state from updated_at and keep ended work rows visible.';
