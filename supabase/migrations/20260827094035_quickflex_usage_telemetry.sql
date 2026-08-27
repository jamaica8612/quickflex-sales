create table if not exists public.quickflex_usage_events (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_event_id uuid not null,
  session_id uuid not null,
  event_name text not null check (
    event_name in ('app_session_started', 'screen_viewed', 'stats_control_used')
  ),
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp(),
  primary key (user_id, client_event_id),
  constraint quickflex_usage_events_properties_check check ((
    jsonb_typeof(properties) = 'object'
    and (
      (
        event_name = 'app_session_started'
        and properties = '{}'::jsonb
      )
      or (
        event_name = 'screen_viewed'
        and jsonb_typeof(properties -> 'screen') = 'string'
        and properties = jsonb_build_object('screen', properties ->> 'screen')
        and properties ->> 'screen' in (
          'home', 'inspection', 'record', 'measurement', 'stats', 'settings', 'admin'
        )
      )
      or (
        event_name = 'stats_control_used'
        and jsonb_typeof(properties -> 'control') = 'string'
        and properties = jsonb_build_object('control', properties ->> 'control')
        and properties ->> 'control' in (
          'range_changed',
          'custom_range_applied',
          'chart_metric_changed',
          'chart_point_viewed',
          'section_viewed'
        )
      )
    )
  ) is true)
);

create index if not exists idx_quickflex_usage_events_created_at
  on public.quickflex_usage_events (created_at);
create index if not exists idx_quickflex_usage_events_summary
  on public.quickflex_usage_events (event_name, created_at, user_id, session_id);

alter table public.quickflex_usage_events enable row level security;

revoke all on table public.quickflex_usage_events from public, anon, authenticated;
grant insert (user_id, client_event_id, session_id, event_name, properties)
  on table public.quickflex_usage_events to authenticated;

drop policy if exists "quickflex usage events insert own approved"
  on public.quickflex_usage_events;
create policy "quickflex usage events insert own approved"
on public.quickflex_usage_events
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and (select public.quickflex_is_approved())
);

create or replace function public.quickflex_track_usage_event(
  p_client_event_id uuid,
  p_session_id uuid,
  p_expected_user_id uuid,
  p_event_name text,
  p_properties jsonb
)
returns table (
  accepted boolean,
  inserted boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  normalized_properties jsonb := coalesce(p_properties, '{}'::jsonb);
  inserted_count integer := 0;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_expected_user_id is null or p_expected_user_id <> current_user_id then
    raise exception 'authenticated account changed' using errcode = '42501';
  end if;
  if not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  if p_client_event_id is null
     or p_session_id is null
     or p_event_name is null
     or p_event_name not in (
       'app_session_started', 'screen_viewed', 'stats_control_used'
     )
     or jsonb_typeof(normalized_properties) is distinct from 'object' then
    raise exception 'invalid usage event' using errcode = '22023';
  end if;

  if (
       p_event_name = 'app_session_started'
       and normalized_properties <> '{}'::jsonb
     )
     or (
       p_event_name = 'screen_viewed'
       and (
         jsonb_typeof(normalized_properties -> 'screen') is distinct from 'string'
         or normalized_properties <> jsonb_build_object(
           'screen', normalized_properties ->> 'screen'
         )
         or normalized_properties ->> 'screen' not in (
           'home', 'inspection', 'record', 'measurement', 'stats', 'settings', 'admin'
         )
       )
     )
     or (
       p_event_name = 'stats_control_used'
       and (
         jsonb_typeof(normalized_properties -> 'control') is distinct from 'string'
         or normalized_properties <> jsonb_build_object(
           'control', normalized_properties ->> 'control'
         )
         or normalized_properties ->> 'control' not in (
           'range_changed',
           'custom_range_applied',
           'chart_metric_changed',
           'chart_point_viewed',
           'section_viewed'
         )
       )
     ) then
    raise exception 'invalid usage event properties' using errcode = '22023';
  end if;

  insert into public.quickflex_usage_events (
    user_id,
    client_event_id,
    session_id,
    event_name,
    properties
  ) values (
    current_user_id,
    p_client_event_id,
    p_session_id,
    p_event_name,
    normalized_properties
  )
  on conflict (user_id, client_event_id) do nothing;
  get diagnostics inserted_count = row_count;

  return query select true, inserted_count = 1;
end;
$$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.quickflex_usage_summary_internal(
  p_window_days integer
)
returns table (
  active_user_count bigint,
  stats_viewer_count bigint,
  engaged_user_count bigint,
  repeat_viewer_count bigint,
  stats_reach_rate numeric,
  stats_engagement_rate numeric,
  repeat_viewer_rate numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select public.quickflex_is_admin()) then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if p_window_days is null or p_window_days not between 1 and 90 then
    raise exception 'window days must be between 1 and 90' using errcode = '22023';
  end if;

  return query
  with window_events as (
    select event.user_id,
           event.session_id,
           event.event_name,
           event.properties,
           event.created_at
    from public.quickflex_usage_events as event
    where event.created_at >= clock_timestamp() - pg_catalog.make_interval(days => p_window_days)
      and event.created_at <= clock_timestamp()
  ),
  counts as (
    select count(distinct event.user_id) as active_users,
           count(distinct event.user_id) filter (
             where event.event_name = 'screen_viewed'
               and event.properties ->> 'screen' = 'stats'
           ) as stats_viewers,
           count(distinct event.user_id) filter (
             where event.event_name = 'stats_control_used'
           ) as engaged_users
    from window_events as event
  ),
  repeat_count as (
    select count(*)::bigint as repeat_viewers
    from (
      select event.user_id
      from window_events as event
      where event.event_name = 'screen_viewed'
        and event.properties ->> 'screen' = 'stats'
      group by event.user_id
      having count(distinct pg_catalog.date_trunc(
        'week',
        event.created_at at time zone 'Asia/Seoul'
      )) >= 2
    ) as repeated
  )
  select counts.active_users,
         counts.stats_viewers,
         counts.engaged_users,
         repeat_count.repeat_viewers,
         round(
           coalesce(100.0 * counts.stats_viewers / nullif(counts.active_users, 0), 0),
           1
         ),
         round(
           coalesce(100.0 * counts.engaged_users / nullif(counts.stats_viewers, 0), 0),
           1
         ),
         round(
           coalesce(100.0 * repeat_count.repeat_viewers / nullif(counts.stats_viewers, 0), 0),
           1
         )
  from counts
  cross join repeat_count;
end;
$$;

create or replace function public.quickflex_usage_summary(
  p_window_days integer default 30
)
returns table (
  active_user_count bigint,
  stats_viewer_count bigint,
  engaged_user_count bigint,
  repeat_viewer_count bigint,
  stats_reach_rate numeric,
  stats_engagement_rate numeric,
  repeat_viewer_rate numeric
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.quickflex_usage_summary_internal(p_window_days)
$$;

revoke execute on function public.quickflex_track_usage_event(uuid, uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.quickflex_track_usage_event(uuid, uuid, uuid, text, jsonb)
  to authenticated;

revoke execute on function private.quickflex_usage_summary_internal(integer)
  from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.quickflex_usage_summary_internal(integer)
  to authenticated;

revoke execute on function public.quickflex_usage_summary(integer)
  from public, anon, authenticated;
grant execute on function public.quickflex_usage_summary(integer)
  to authenticated;

comment on table public.quickflex_usage_events is
  'Privacy-minimized product usage events; no amount, count, route, work date, free text, device identifier, or IP payload is accepted';
comment on function public.quickflex_track_usage_event(uuid, uuid, uuid, text, jsonb) is
  'Idempotently records one allowlisted event for the authenticated approved user';
comment on function public.quickflex_usage_summary(integer) is
  'Admin-only aggregate of unique active, stats viewer, engaged, and repeat-viewer usage; never returns raw events';

create extension if not exists pg_cron with schema pg_catalog;

-- cron.schedule with a stable job name safely replaces an existing job with
-- the same name. Supabase no longer permits direct cron.job modification.
select cron.schedule(
  'quickflex-usage-events-retention',
  '17 3 * * *',
  $$delete from public.quickflex_usage_events
    where created_at < clock_timestamp() - interval '90 days'$$
);
