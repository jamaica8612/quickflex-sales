-- 사용 통계가 한 번도 저장되지 않던 문제를 고치고, 관리자에게 가입 대기 수를 보여 줄 함수를 더한다.
--
-- 1) quickflex_track_usage_event는 호출자 권한(security invoker)으로 insert한다. authenticated에는
--    컬럼 단위 INSERT만 있고 SELECT가 없다. `on conflict (user_id, client_event_id)`처럼 대상을 지정하면
--    PostgreSQL이 그 컬럼의 SELECT 권한을 요구해 매번 42501(403)로 거절됐다(2026-08-27 이후 0건).
--    대상 없는 `on conflict do nothing`은 같은 유일 제약으로 중복을 막으면서 SELECT가 필요 없다.
--    권한은 넓히지 않는다.
-- 2) 화면 목록에 나중에 생긴 노아(noah)와 구역노트(routes)를 더한다.
-- 3) 관리자 전용 집계 두 개를 더한다: 화면별 사용자 수, 가입 승인 대기 수.
--    원본 이벤트나 개인 식별 정보는 돌려주지 않는다.
begin;

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
           'home', 'inspection', 'record', 'measurement', 'stats', 'settings', 'admin',
           'noah', 'routes'
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
  on conflict do nothing;
  get diagnostics inserted_count = row_count;

  return query select true, inserted_count = 1;
end;
$$;

create or replace function private.quickflex_usage_screen_summary_internal(
  p_window_days integer
)
returns table (
  screen text,
  user_count bigint,
  view_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select public.quickflex_is_admin()) then
    raise exception 'admin required' using errcode = '42501';
  end if;
  if p_window_days is null or p_window_days not between 1 and 90 then
    raise exception 'window days must be between 1 and 90' using errcode = '22023';
  end if;

  return query
  select event.properties ->> 'screen',
         count(distinct event.user_id),
         count(*)
  from public.quickflex_usage_events as event
  where event.event_name = 'screen_viewed'
    and event.created_at >= clock_timestamp() - pg_catalog.make_interval(days => p_window_days)
  group by 1
  order by 2 desc, 3 desc;
end;
$$;

create or replace function public.quickflex_usage_screen_summary(
  p_window_days integer default 30
)
returns table (
  screen text,
  user_count bigint,
  view_count bigint
)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.quickflex_usage_screen_summary_internal(p_window_days)
$$;

create or replace function private.quickflex_pending_signups_internal()
returns table (
  pending_count integer,
  oldest_waiting_days integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not (select public.quickflex_is_admin()) then
    raise exception 'admin required' using errcode = '42501';
  end if;

  return query
  select count(*)::integer,
         coalesce(max(extract(day from clock_timestamp() - profile.created_at))::integer, 0)
  from public.quickflex_profiles as profile
  where profile.status = 'pending'
    and profile.deletion_requested_at is null;
end;
$$;

create or replace function public.quickflex_pending_signups()
returns table (
  pending_count integer,
  oldest_waiting_days integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.quickflex_pending_signups_internal()
$$;

revoke execute on function private.quickflex_usage_screen_summary_internal(integer)
  from public, anon, authenticated;
grant execute on function private.quickflex_usage_screen_summary_internal(integer)
  to authenticated;
revoke execute on function public.quickflex_usage_screen_summary(integer)
  from public, anon, authenticated;
grant execute on function public.quickflex_usage_screen_summary(integer)
  to authenticated;

revoke execute on function private.quickflex_pending_signups_internal()
  from public, anon, authenticated;
grant execute on function private.quickflex_pending_signups_internal()
  to authenticated;
revoke execute on function public.quickflex_pending_signups()
  from public, anon, authenticated;
grant execute on function public.quickflex_pending_signups()
  to authenticated;

comment on function public.quickflex_usage_screen_summary(integer) is
  'Admin-only per-screen unique users and views for the last N days; never returns raw events';
comment on function public.quickflex_pending_signups() is
  'Admin-only count of QuickFlex sign-ups waiting for approval and the oldest wait in days';

commit;
