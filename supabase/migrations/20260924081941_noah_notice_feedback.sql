begin;
set local lock_timeout = '5s';

alter table public.quickflex_profiles
  add column if not exists noah_notice_acknowledged_at timestamptz default null;

-- The existing profile UPDATE grant is needed by ordinary profile editing. This
-- invoker trigger sees the caller role, unlike the older definer profile guard.
create or replace function quickflex_noah_private.guard_notice_acknowledgment()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' and new.noah_notice_acknowledged_at is not null then
      raise exception 'Noah notice acknowledgment must use its RPC' using errcode = '42501';
    end if;
    if tg_op = 'UPDATE' and new.noah_notice_acknowledged_at is distinct from old.noah_notice_acknowledged_at then
      raise exception 'Noah notice acknowledgment must use its RPC' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function quickflex_noah_private.guard_notice_acknowledgment() from public, anon, authenticated;

drop trigger if exists zz_quickflex_noah_notice_guard on public.quickflex_profiles;
create trigger zz_quickflex_noah_notice_guard
before insert or update on public.quickflex_profiles
for each row execute function quickflex_noah_private.guard_notice_acknowledgment();

create or replace function public.quickflex_noah_acknowledge_notice()
returns timestamptz language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := (select auth.uid());
  acknowledged_at timestamptz;
begin
  if owner is null then
    raise exception 'approved account required' using errcode = '42501';
  end if;
  update public.quickflex_profiles as p
     set noah_notice_acknowledged_at = pg_catalog.clock_timestamp()
   where p.id = owner and p.status = 'approved' and p.noah_notice_acknowledged_at is null
   returning p.noah_notice_acknowledged_at into acknowledged_at;
  if not found then
    select p.noah_notice_acknowledged_at into acknowledged_at
      from public.quickflex_profiles as p where p.id = owner and p.status = 'approved';
    if not found then
      raise exception 'approved account required' using errcode = '42501';
    end if;
  end if;
  return acknowledged_at;
end $$;
revoke all on function public.quickflex_noah_acknowledge_notice() from public, anon, authenticated;
grant execute on function public.quickflex_noah_acknowledge_notice() to authenticated;

create table if not exists quickflex_noah_private.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  rating smallint not null check (rating in (-1, 1)),
  sources text[] not null default '{}'::text[] check (cardinality(sources) <= 13),
  has_proposal boolean not null,
  response_ms integer not null check (response_ms between 0 and 80000),
  model text not null check (char_length(model) <= 64 and model ~ '^gpt-[a-z0-9]+([.-][a-z0-9]+)*$')
);
create index if not exists quickflex_noah_feedback_owner_idx
  on quickflex_noah_private.feedback(user_id, created_at desc);
alter table quickflex_noah_private.feedback enable row level security;
revoke all on table quickflex_noah_private.feedback from public, anon, authenticated;

create or replace function public.quickflex_noah_submit_feedback(
  p_rating integer, p_sources text[], p_has_proposal boolean,
  p_response_ms integer, p_model text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := (select auth.uid());
  selected_sources text[] := coalesce(p_sources, '{}'::text[]);
  saved_id uuid;
  source text;
begin
  if owner is null or not exists (
    select 1 from public.quickflex_profiles as p
    where p.id = owner and p.status = 'approved' and p.noah_notice_acknowledged_at is not null
  ) then
    raise exception 'NOAH_NOTICE_REQUIRED' using errcode = '42501';
  end if;
  if p_rating is null or p_rating not in (-1, 1)
     or p_has_proposal is null or p_response_ms is null or p_response_ms not between 0 and 80000
     or p_model is null or char_length(p_model) > 64
     or p_model !~ '^gpt-[a-z0-9]+([.-][a-z0-9]+)*$'
     or coalesce(array_ndims(selected_sources), 1) <> 1
     or cardinality(selected_sources) > 13 then
    raise exception 'invalid Noah feedback metadata' using errcode = '22023';
  end if;
  foreach source in array selected_sources loop
    if source is null or source not in (
      'profile', 'sales_days', 'sales_manual_items', 'sales_automatic_work',
      'sales_overrides', 'expenses', 'expense_adjustments', 'route_rates',
      'daily_inspections', 'note_zones', 'note_tips', 'note_favorites',
      'finance_summary'
    ) then
      raise exception 'invalid Noah feedback source' using errcode = '22023';
    end if;
  end loop;
  if cardinality(selected_sources) <> (
    select count(distinct value) from unnest(selected_sources) as source_row(value)
  ) then
    raise exception 'duplicate Noah feedback source' using errcode = '22023';
  end if;
  insert into quickflex_noah_private.feedback
    (user_id, rating, sources, has_proposal, response_ms, model)
  values
    (owner, p_rating, selected_sources, p_has_proposal, p_response_ms, p_model)
  returning id into saved_id;
  return saved_id;
end $$;
revoke all on function public.quickflex_noah_submit_feedback(integer,text[],boolean,integer,text)
  from public, anon, authenticated;
grant execute on function public.quickflex_noah_submit_feedback(integer,text[],boolean,integer,text)
  to authenticated;

-- Preserve the original per-minute and KST-day enforcement; return a stable
-- machine code for the first limit that rejected this request.
create or replace function quickflex_noah_private.quickflex_noah_consume_quota()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := (select auth.uid());
  kst timestamp := clock_timestamp() at time zone 'Asia/Seoul';
  minute_key timestamp;
  day_key date;
  daily_count integer;
  minute_count integer;
begin
  if owner is null or not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode='42501';
  end if;
  minute_key := date_trunc('minute',kst);
  day_key := kst::date;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('noah-quota:' || owner::text,0));
  select coalesce(sum(requests),0)::integer into daily_count
    from quickflex_noah_private.minute_usage where user_id=owner and usage_day=day_key;
  select coalesce(requests,0) into minute_count
    from quickflex_noah_private.minute_usage where user_id=owner and usage_minute=minute_key;
  minute_count := coalesce(minute_count,0);
  if daily_count >= 100 or minute_count >= 10 then
    return jsonb_build_object('allowed',false,
      'code',case when daily_count>=100 then 'NOAH_DAY_LIMIT' else 'NOAH_MINUTE_LIMIT' end,
      'remainingDaily',greatest(0,100-daily_count),
      'remainingMinute',greatest(0,10-minute_count),
      'retryAfterSeconds',case when daily_count>=100 then extract(epoch from ((day_key+1)::timestamp-kst))::integer
                              else 60-extract(second from kst)::integer end);
  end if;
  insert into quickflex_noah_private.minute_usage(user_id,usage_day,usage_minute,requests)
    values(owner,day_key,minute_key,1)
    on conflict (user_id,usage_minute) do update set requests=quickflex_noah_private.minute_usage.requests+1;
  return jsonb_build_object('allowed',true,'remainingDaily',99-daily_count,'remainingMinute',9-minute_count);
end $$;

commit;
