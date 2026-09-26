-- 20260926100000 적용 뒤 확인에서 나온 두 문제를 고친다.
-- 1) quickflex_usage_events의 properties 검사 제약도 화면 목록을 따로 검사해 noah·routes 기록이 23514로 거절됐다.
--    같은 조건으로 제약을 다시 만들고 두 화면만 더한다.
-- 2) 20260901110218이 private 스키마 사용 권한을 authenticated에서 회수해, private 내부 함수를 부르는 관리자 집계가
--    42501로 거절됐다. private 권한은 되살리지 않고, 두 관리자 함수를 관리자 검사를 직접 하는 SECURITY DEFINER로 바꾼 뒤
--    쓰지 않게 된 private 함수를 지운다.
begin;

alter table public.quickflex_usage_events
  drop constraint if exists quickflex_usage_events_properties_check;
alter table public.quickflex_usage_events
  add constraint quickflex_usage_events_properties_check check (
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
          'home', 'inspection', 'record', 'measurement', 'stats', 'settings', 'admin',
          'noah', 'routes'
        )
      )
      or (
        event_name = 'stats_control_used'
        and jsonb_typeof(properties -> 'control') = 'string'
        and properties = jsonb_build_object('control', properties ->> 'control')
        and properties ->> 'control' in (
          'range_changed', 'custom_range_applied', 'chart_metric_changed',
          'chart_point_viewed', 'section_viewed'
        )
      )
    )
  );

create or replace function public.quickflex_usage_screen_summary(
  p_window_days integer default 30
)
returns table (
  screen text,
  user_count bigint,
  view_count bigint
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

create or replace function public.quickflex_pending_signups()
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

drop function if exists private.quickflex_usage_screen_summary_internal(integer);
drop function if exists private.quickflex_pending_signups_internal();

revoke execute on function public.quickflex_usage_screen_summary(integer)
  from public, anon, authenticated;
grant execute on function public.quickflex_usage_screen_summary(integer)
  to authenticated;
revoke execute on function public.quickflex_pending_signups()
  from public, anon, authenticated;
grant execute on function public.quickflex_pending_signups()
  to authenticated;

commit;
