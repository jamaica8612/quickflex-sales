-- Immutable per-phone submissions; sales are a date-scoped union, not a sum of
-- shared Coupang counters. No headcount, device lease, or team-owner selection.
create table public.quickflex_team_work_inputs (
  user_id uuid not null references auth.users(id) on delete cascade,
  work_id text not null check (length(work_id) between 8 and 128),
  device_id text not null check (length(device_id) between 8 and 128),
  work_date date not null,
  payload jsonb not null,
  finalized_at timestamptz not null default clock_timestamp(),
  primary key (user_id, work_id)
);
create index quickflex_team_work_date on public.quickflex_team_work_inputs(user_id, work_date);
alter table public.quickflex_team_work_inputs enable row level security;
revoke all on public.quickflex_team_work_inputs from public, anon, authenticated;
grant select on public.quickflex_team_work_inputs to authenticated;
create policy "team inputs read own or admin" on public.quickflex_team_work_inputs
for select to authenticated using (user_id = (select auth.uid()) or (select public.quickflex_is_admin()));

-- First combine split render increments within one phone/work, then union the
-- invoice between phones. Unknown invoices remain distinct; never dedupe by route alone.
create view public.quickflex_team_observations with (security_invoker = true) as
select w.user_id, w.work_date, w.work_id,
  coalesce(nullif(d->>'invoiceHash',''), w.work_id || ':' || (d->>'id')) as identity,
  d->>'route' as route, d->>'detailedRoute' as detail_route,
  sum((d->>'count')::integer)::integer as count,
  sum(coalesce((d->>'cancellationCount')::integer,case when coalesce((d->>'cancellation')::boolean,false) then (d->>'count')::integer else 0 end))::integer as cancels,
  sum(case when coalesce((d->>'returned')::boolean,false) then (d->>'count')::integer else 0 end)::integer as returns
from public.quickflex_team_work_inputs w,
  lateral jsonb_array_elements(w.payload->'evidence'->'deliveries') d
group by w.user_id, w.work_date, w.work_id, identity, route, detail_route;

create view public.quickflex_team_unique_deliveries with (security_invoker = true) as
select user_id, work_date, identity, min(route) as route,
  case when count(distinct detail_route) = 1 then min(detail_route) end as detail_route,
  max(count)::integer as count, max(cancels)::integer as cancels, max(returns)::integer as returns
from public.quickflex_team_observations group by user_id, work_date, identity;

create view public.quickflex_team_route_totals with (security_invoker = true) as
with contributions as (
  select w.user_id, w.work_date, r->>'route' as route,
    (r->>'delivery_count')::integer as count,
    (r->>'unit_snapshot')::integer as unit, w.finalized_at
  from public.quickflex_team_work_inputs w, lateral jsonb_array_elements(w.payload->'routes') r
  union all
  select user_id, work_date, route, -count, null::integer, null::timestamptz from public.quickflex_team_observations
  union all
  select user_id, work_date, route, count, null::integer, null::timestamptz from public.quickflex_team_unique_deliveries
)
select user_id, work_date, route, greatest(0, sum(count))::integer as delivery_count,
  coalesce((array_agg(unit order by finalized_at, unit) filter(where unit is not null))[1], 0) as unit_snapshot,
  (row_number() over(partition by user_id, work_date order by route)-1)::integer as sort_order
from contributions group by user_id, work_date, route;

create view public.quickflex_team_detail_totals with (security_invoker = true) as
with contributions as (
  select w.user_id, w.work_date, e.key as detail_route, e.value::integer as count
  from public.quickflex_team_work_inputs w, lateral jsonb_array_elements(w.payload->'routes') r,
    lateral jsonb_each_text(coalesce(r->'detail_counts','{}')) e
  union all
  select user_id, work_date, detail_route, -count from public.quickflex_team_observations where detail_route is not null
  union all
  select user_id, work_date, detail_route, count from public.quickflex_team_unique_deliveries where detail_route is not null
), totals as (
  select user_id, work_date, detail_route, greatest(0,sum(count))::integer as count
  from contributions group by user_id, work_date, detail_route
), bounded as (
  select *, sum(count) over(partition by user_id, work_date, left(detail_route,4)) as base_sum from totals
)
select t.user_id, t.work_date, t.detail_route, t.count as delivery_count
from bounded t join public.quickflex_team_route_totals r
  on r.user_id=t.user_id and r.work_date=t.work_date and r.route=left(t.detail_route,4)
where t.count>0 and t.base_sum<=r.delivery_count;

create view public.quickflex_team_sales with (security_invoker = true) as
with totals as (
  select user_id, work_date, min(payload->>'work_shift') as work_shift,
    sum((payload->>'total_households')::integer)::integer as total_households,
    sum((payload->>'fresh_count')::integer - jsonb_array_length(payload->'evidence'->'freshSerials'))::integer as fresh_adjustment,
    sum((payload->>'return_count')::integer)::integer as raw_returns,
    sum((payload->>'cancel_count')::integer)::integer as raw_cancels,
    max(finalized_at) as finalized_at
  from public.quickflex_team_work_inputs group by user_id, work_date
)
select t.user_id, t.work_date, 'team:' || t.work_date::text as work_id, t.work_shift,
  least(t.total_households, routes.total_items)::integer as total_households, routes.total_items,
  greatest(0, t.fresh_adjustment + (
    select count(distinct serial)::integer from public.quickflex_team_work_inputs w,
      lateral jsonb_array_elements_text(w.payload->'evidence'->'freshSerials') serial
    where w.user_id=t.user_id and w.work_date=t.work_date
  ))::integer as fresh_count,
  least(routes.total_items, greatest(0, t.raw_returns - coalesce(ob.returns,0) + coalesce(uniq.returns,0)))::integer as return_count,
  least(routes.total_items, greatest(0, t.raw_cancels - coalesce(ob.cancels,0) + coalesce(uniq.cancels,0)))::integer as cancel_count,
  routes.rows as routes, coalesce(uniq.cancel_details,'{}') as cancellation_detail_counts, t.finalized_at
from totals t
cross join lateral (
  select coalesce(sum(r.delivery_count),0)::integer as total_items,
    jsonb_agg(jsonb_build_object('route',r.route,'delivery_count',r.delivery_count,
      'unit_snapshot',r.unit_snapshot,'sort_order',r.sort_order,'household_count',0) order by r.route) as rows
  from public.quickflex_team_route_totals r where r.user_id=t.user_id and r.work_date=t.work_date
) routes
left join lateral (
  select sum(o.returns) as returns, sum(o.cancels) as cancels
  from public.quickflex_team_observations o where o.user_id=t.user_id and o.work_date=t.work_date
) ob on true
left join lateral (
  select sum(u.returns) as returns, sum(u.cancels) as cancels,
    (select jsonb_object_agg(detail_route,cnt) from (
      select detail_route, sum(cancels) as cnt from public.quickflex_team_unique_deliveries
      where user_id=t.user_id and work_date=t.work_date and detail_route is not null and cancels>0
      group by detail_route
    ) c) as cancel_details
  from public.quickflex_team_unique_deliveries u where u.user_id=t.user_id and u.work_date=t.work_date
) uniq on true;

-- These read models leave all old receipts unchanged and present new team work
-- as one date record to Android, the PWA, statistics and administrator reports.
create view public.quickflex_sales_work_results with (security_invoker = true) as
select user_id, work_id, work_date, work_shift, total_households, total_items,
  fresh_count, return_count, cancel_count, canonical_payload, finalized_at
from public.quickflex_work_results
union all
select user_id, work_id, work_date, work_shift, total_households, total_items,
  fresh_count, return_count, cancel_count,
  jsonb_build_object('work_date',work_date,'work_shift',work_shift,'total_items',total_items,
    'routes',routes,'cancellation_detail_counts',cancellation_detail_counts), finalized_at
from public.quickflex_team_sales;

create view public.quickflex_sales_work_routes with (security_invoker = true) as
select user_id, work_id, route, delivery_count, household_count, unit_snapshot, sort_order
from public.quickflex_work_result_routes
union all
select user_id, 'team:' || work_date::text, route, delivery_count, 0, unit_snapshot, sort_order
from public.quickflex_team_route_totals;

create view public.quickflex_sales_work_details with (security_invoker = true) as
select user_id, work_id, base_route, detail_route, delivery_count from public.quickflex_work_result_route_details
union all
select user_id, 'team:' || work_date::text, left(detail_route,4), detail_route, delivery_count
from public.quickflex_team_detail_totals;

-- Pure validation is shared by the write endpoints, not a new public write path.
create or replace function public.quickflex_team_validate_routes(p_routes jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if jsonb_typeof(p_routes) is distinct from 'array' then raise exception 'invalid routes' using errcode='22023'; end if;
  if jsonb_array_length(p_routes) not between 1 and 100 then raise exception 'invalid route count' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_routes) r
    where coalesce(r->>'route','') !~ '^[0-9]{3}[A-Z]$'
    or coalesce(r->>'delivery_count','') !~ '^(0|[1-9][0-9]{0,6})$'
    or coalesce(r->>'unit_snapshot','') !~ '^(0|[1-9][0-9]{0,6})$'
    or coalesce(r->>'sort_order','') !~ '^(0|[1-9][0-9]{0,2})$')
    or (select count(distinct r->>'route') from jsonb_array_elements(p_routes) r)<>jsonb_array_length(p_routes)
  then raise exception 'invalid or duplicate route' using errcode='22023'; end if;
end;
$$;

create or replace function public.quickflex_finalize_team_work(p_expected_device_id text, p_payload jsonb)
returns table(status text, work_id text) language plpgsql security definer set search_path='' as $$
declare
  owner uuid := (select auth.uid());
  wid text := p_payload->>'work_id';
  day_key date := (p_payload->>'work_date')::date;
  existing public.quickflex_team_work_inputs%rowtype;
  old_totals public.quickflex_team_sales%rowtype;
  new_totals public.quickflex_team_sales%rowtype;
  d jsonb;
  r jsonb;
  n text;
begin
  if owner is null or not (select public.quickflex_is_approved()) then raise exception 'approved account required' using errcode='42501'; end if;
  if coalesce(length(wid),0) not between 8 and 128 or wid like 'team:%'
    or coalesce(length(p_expected_device_id),0) not between 8 and 128
    or day_key is null or coalesce(p_payload->>'work_shift','') not in ('day','night')
    or jsonb_typeof(p_payload->'evidence'->'deliveries') is distinct from 'array'
    or jsonb_typeof(p_payload->'evidence'->'freshSerials') is distinct from 'array'
  then raise exception 'invalid team work payload' using errcode='22023'; end if;
  perform public.quickflex_team_validate_routes(p_payload->'routes');
  foreach n in array array['total_households','total_items','fresh_count','return_count','cancel_count'] loop
    if coalesce(p_payload->>n,'') !~ '^(0|[1-9][0-9]{0,6})$' then raise exception 'invalid count %',n using errcode='22023'; end if;
  end loop;
  if (select sum((x->>'delivery_count')::integer) from jsonb_array_elements(p_payload->'routes') x)<>(p_payload->>'total_items')::integer
    or (p_payload->>'return_count')::integer>(p_payload->>'total_items')::integer
    or (p_payload->>'cancel_count')::integer>(p_payload->>'total_items')::integer
  then raise exception 'team work totals do not match routes' using errcode='22023'; end if;
  if jsonb_array_length(p_payload->'evidence'->'deliveries')>10000
    or jsonb_array_length(p_payload->'evidence'->'freshSerials')>10000
  then raise exception 'evidence too large' using errcode='22023'; end if;
  for d in select value from jsonb_array_elements(p_payload->'evidence'->'deliveries') loop
    if coalesce(length(d->>'id'),0) not between 1 and 128
      or coalesce(d->>'route','') !~ '^[0-9]{3}[A-Z]$'
      or coalesce(d->>'count','') !~ '^[1-9][0-9]{0,4}$'
      or (d->>'invoiceHash' is not null and d->>'invoiceHash' !~ '^[a-f0-9]{64}$')
      or (d->>'detailedRoute' is not null and (d->>'detailedRoute' !~ '^[0-9]{3}[A-Z][0-9]{2}$' or left(d->>'detailedRoute',4)<>d->>'route'))
      or coalesce(d->>'cancellation','false') not in ('true','false')
      or coalesce(d->>'returned','false') not in ('true','false')
      or coalesce(d->>'cancellationCount','0') !~ '^(0|[1-9][0-9]{0,4})$'
    then raise exception 'invalid local delivery evidence' using errcode='22023'; end if;
    if coalesce((d->>'cancellationCount')::integer,0)>(d->>'count')::integer then raise exception 'invalid cancellation evidence count' using errcode='22023'; end if;
  end loop;
  if (select count(distinct x->>'id') from jsonb_array_elements(p_payload->'evidence'->'deliveries') x)
    <>jsonb_array_length(p_payload->'evidence'->'deliveries') then raise exception 'duplicate local event' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_payload->'evidence'->'deliveries') x
    where x->>'invoiceHash' is not null group by x->>'invoiceHash' having count(distinct x->>'route')>1)
  then raise exception 'conflicting invoice routes in one work' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_payload->'evidence'->'freshSerials') s where s !~ '^C[12]-[A-Z0-9]{5}$')
    or (select count(distinct s) from jsonb_array_elements_text(p_payload->'evidence'->'freshSerials') s)
    <>jsonb_array_length(p_payload->'evidence'->'freshSerials') then raise exception 'invalid fresh serials' using errcode='22023'; end if;
  for r in select value from jsonb_array_elements(p_payload->'routes') loop
    if jsonb_typeof(coalesce(r->'detail_counts','{}')) is distinct from 'object'
      or jsonb_typeof(coalesce(r->'cancellation_detail_counts','{}')) is distinct from 'object'
    then raise exception 'invalid detailed counts' using errcode='22023'; end if;
    if exists(select 1 from jsonb_each_text(coalesce(r->'detail_counts','{}')) e
      where e.key !~ '^[0-9]{3}[A-Z][0-9]{2}$' or left(e.key,4)<>r->>'route' or e.value !~ '^(0|[1-9][0-9]{0,6})$')
    then raise exception 'invalid detailed route' using errcode='22023'; end if;
    if (select coalesce(sum(value::integer),0) from jsonb_each_text(coalesce(r->'detail_counts','{}')))>(r->>'delivery_count')::integer
    then raise exception 'detail exceeds base route' using errcode='22023'; end if;
  end loop;
  -- One short lock per account/date also protects simultaneous fresh-bag adjustments.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner::text||':'||day_key::text,0));
  select * into existing from public.quickflex_team_work_inputs w where w.user_id=owner and w.work_id=wid;
  if found then
    if existing.payload<>p_payload or existing.device_id<>p_expected_device_id then raise exception 'work receipt conflict' using errcode='23505'; end if;
    return query select 'already_applied'::text,wid; return;
  end if;
  if exists(select 1 from public.quickflex_work_results w where w.user_id=owner and w.work_id=wid)
    then raise exception 'legacy work receipt already exists' using errcode='23505'; end if;
  if exists(
    select 1 from jsonb_array_elements(p_payload->'evidence'->'deliveries') incoming
    join public.quickflex_team_observations seen on seen.user_id=owner and seen.work_date=day_key
      and seen.identity=incoming->>'invoiceHash'
    where seen.route<>incoming->>'route'
  ) then raise exception '같은 송장의 구역이 다릅니다. 구역을 확인해 주세요.' using errcode='22023'; end if;
  select * into old_totals from public.quickflex_team_sales s where s.user_id=owner and s.work_date=day_key;
  insert into public.quickflex_team_work_inputs(user_id,work_id,device_id,work_date,payload)
    values(owner,wid,p_expected_device_id,day_key,p_payload);
  select * into new_totals from public.quickflex_team_sales s where s.user_id=owner and s.work_date=day_key;
  insert into public.quickflex_day_records(user_id,work_date) values(owner::text,day_key) on conflict(user_id,work_date) do nothing;
  update public.quickflex_day_records day set
    is_off=false,
    fresh_count=greatest(0,day.fresh_count+new_totals.fresh_count-coalesce(old_totals.fresh_count,0)),
    return_count=greatest(0,day.return_count+new_totals.return_count-coalesce(old_totals.return_count,0)),
    cancel_count=greatest(0,day.cancel_count+new_totals.cancel_count-coalesce(old_totals.cancel_count,0)),
    updated_at=clock_timestamp()
  where day.user_id=owner::text and day.work_date=day_key;
  return query select 'applied'::text,wid;
end;
$$;

-- Corrections are relative to exactly the automatic counts the user edited.
alter table public.quickflex_automatic_sales_overrides add column basis_counts jsonb;
create view public.quickflex_sales_basis with (security_invoker=true) as
select h.user_id,h.work_date,jsonb_object_agg(r.route,r.count) as counts
from (select distinct user_id,work_date from public.quickflex_sales_work_results) h
cross join lateral (
  select r.route,sum(r.delivery_count)::integer as count
  from public.quickflex_sales_work_routes r join public.quickflex_sales_work_results w using(user_id,work_id)
  where w.user_id=h.user_id and w.work_date=h.work_date group by r.route
) r group by h.user_id,h.work_date;
update public.quickflex_automatic_sales_overrides o set basis_counts=b.counts
from public.quickflex_sales_basis b where b.user_id=o.user_id and b.work_date=o.work_date;

create view public.quickflex_sales_overrides with (security_invoker=true) as
select o.user_id,o.work_date,o.revision,o.request_id,o.reason,o.created_at,o.updated_at,
  o.basis_counts, effective.routes, effective.total_items
from public.quickflex_automatic_sales_overrides o
cross join lateral (
  select jsonb_agg(jsonb_build_object('route',route,'delivery_count',count,'unit_snapshot',unit,'sort_order',sort_order) order by route) as routes,
    sum(count)::integer as total_items
  from (
    select names.route,
      greatest(0,coalesce((edited.value->>'delivery_count')::integer,0) +
        case when o.basis_counts is null then 0 else
          coalesce(current_counts.count,0)-coalesce((o.basis_counts->>names.route)::integer,0) end)::integer as count,
      coalesce((edited.value->>'unit_snapshot')::integer,current_counts.unit,0) as unit,
      (row_number() over(order by names.route)-1)::integer as sort_order
    from (
      select value->>'route' as route from jsonb_array_elements(o.routes)
      union select key from jsonb_each(coalesce(o.basis_counts,'{}'))
      union select r.route from public.quickflex_sales_work_routes r join public.quickflex_sales_work_results w using(user_id,work_id)
        where w.user_id=o.user_id and w.work_date=o.work_date and o.basis_counts is not null
    ) names
    left join lateral (select value from jsonb_array_elements(o.routes) where value->>'route'=names.route) edited on true
    left join lateral (
      select sum(r.delivery_count)::integer as count,(array_agg(r.unit_snapshot order by w.finalized_at,r.work_id))[1] as unit
      from public.quickflex_sales_work_routes r join public.quickflex_sales_work_results w using(user_id,work_id)
      where w.user_id=o.user_id and w.work_date=o.work_date and r.route=names.route
    ) current_counts on true
  ) rows
) effective;

create or replace function public.quickflex_replace_team_sales_override(
  p_work_date date,p_expected_revision bigint,p_request_id text,p_reason text,p_routes jsonb,p_basis_counts jsonb
) returns table(status text,revision bigint,total_items integer)
language plpgsql security definer set search_path='' as $$
declare
  owner uuid := (select auth.uid());
  old public.quickflex_automatic_sales_overrides%rowtype;
  actual_basis jsonb;
  next_revision bigint;
  total integer;
begin
  if owner is null or not (select public.quickflex_is_approved()) then raise exception 'approved account required' using errcode='42501'; end if;
  perform public.quickflex_team_validate_routes(p_routes);
  if p_work_date is null or coalesce(p_expected_revision,-1)<0
    or coalesce(length(p_request_id),0) not between 8 and 128 or coalesce(length(p_reason),0)>1000
    or jsonb_typeof(p_basis_counts) is distinct from 'object'
  then raise exception 'invalid correction' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner::text||':'||p_work_date::text,0));
  select * into old from public.quickflex_automatic_sales_overrides o where o.user_id=owner and o.work_date=p_work_date for update;
  if found and old.request_id=p_request_id then
    if old.routes<>p_routes or old.basis_counts<>p_basis_counts or old.reason<>coalesce(p_reason,'')
    then raise exception 'correction request conflict' using errcode='23505'; end if;
    return query select 'already_applied'::text,old.revision,old.total_items; return;
  end if;
  if coalesce(old.revision,0)<>p_expected_revision then raise exception 'correction revision conflict' using errcode='40001'; end if;
  select counts into actual_basis from public.quickflex_sales_basis b where b.user_id=owner and b.work_date=p_work_date;
  if actual_basis is null then raise exception 'automatic work required' using errcode='55000'; end if;
  if actual_basis<>p_basis_counts then raise exception '동료의 실적이 추가되었습니다. 새로고침 후 다시 확인해 주세요. (revision conflict)' using errcode='40001'; end if;
  select sum((value->>'delivery_count')::integer)::integer into total from jsonb_array_elements(p_routes);
  next_revision := coalesce(old.revision,0)+1;
  insert into public.quickflex_automatic_sales_overrides(user_id,work_date,revision,request_id,routes,total_items,reason,basis_counts)
    values(owner,p_work_date,next_revision,p_request_id,p_routes,total,coalesce(p_reason,''),p_basis_counts)
  on conflict(user_id,work_date) do update set revision=excluded.revision,request_id=excluded.request_id,
    routes=excluded.routes,total_items=excluded.total_items,reason=excluded.reason,basis_counts=excluded.basis_counts,updated_at=clock_timestamp();
  return query select 'applied'::text,next_revision,total;
end;
$$;

revoke all on function public.quickflex_finalize_team_work(text,jsonb),
  public.quickflex_replace_team_sales_override(date,bigint,text,text,jsonb,jsonb),
  public.quickflex_team_validate_routes(jsonb) from public, anon, authenticated;
grant execute on function public.quickflex_finalize_team_work(text,jsonb),
  public.quickflex_replace_team_sales_override(date,bigint,text,text,jsonb,jsonb) to authenticated;
grant select on public.quickflex_team_observations, public.quickflex_team_unique_deliveries,
  public.quickflex_team_route_totals, public.quickflex_team_detail_totals, public.quickflex_team_sales,
  public.quickflex_sales_work_results, public.quickflex_sales_work_routes, public.quickflex_sales_work_details,
  public.quickflex_sales_basis, public.quickflex_sales_overrides to authenticated;

-- Only manual edits increment this revision. Automatic arrivals add their fresh
-- delta to the current value and cannot erase an in-progress manual correction.
alter table public.quickflex_day_records
  add column sales_edit_revision bigint not null default 0,
  add column sales_last_edit jsonb;
create or replace function public.quickflex_update_sales_day(
  p_work_date date,p_expected_revision bigint,p_expected jsonb,p_values jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  owner uuid := (select auth.uid());
  day public.quickflex_day_records%rowtype;
  request jsonb := jsonb_build_object('revision',p_expected_revision,'expected',p_expected,'values',p_values);
  key text;
begin
  if owner is null or not (select public.quickflex_is_approved()) then raise exception 'approved account required' using errcode='42501'; end if;
  if p_work_date is null or coalesce(p_expected_revision,-1)<0
    or jsonb_typeof(p_expected) is distinct from 'object' or jsonb_typeof(p_values) is distinct from 'object'
  then raise exception 'invalid day edit' using errcode='22023'; end if;
  foreach key in array array['fresh_count','fresh_unit','fresh_solo_count','fresh_linked_count','backup_unit'] loop
    if coalesce(p_values->>key,'') !~ '^(0|[1-9][0-9]{0,6})$'
      or coalesce(p_expected->>key,'') !~ '^(0|[1-9][0-9]{0,6})$'
    then raise exception 'invalid day count' using errcode='22023'; end if;
  end loop;
  if coalesce(p_values->>'freshbag_mode','') not in ('single','dual')
    or coalesce(p_values->>'driver_type','') not in ('backup','fixed')
  then raise exception 'invalid day pricing' using errcode='22023'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(owner::text||':'||p_work_date::text,0));
  select * into day from public.quickflex_day_records d where d.user_id=owner::text and d.work_date=p_work_date for update;
  if not found then raise exception 'sales day missing' using errcode='40001'; end if;
  if day.sales_last_edit=request then return to_jsonb(day); end if;
  if day.sales_edit_revision<>p_expected_revision then raise exception 'day edit revision conflict' using errcode='40001'; end if;
  update public.quickflex_day_records d set
    fresh_count=greatest(0,day.fresh_count+(p_values->>'fresh_count')::integer-(p_expected->>'fresh_count')::integer),
    fresh_unit=(p_values->>'fresh_unit')::integer,
    fresh_solo_count=(p_values->>'fresh_solo_count')::integer,
    fresh_linked_count=(p_values->>'fresh_linked_count')::integer,
    freshbag_mode=p_values->>'freshbag_mode',
    backup_unit=(p_values->>'backup_unit')::integer,
    driver_type=p_values->>'driver_type',
    sales_edit_revision=day.sales_edit_revision+1,sales_last_edit=request,updated_at=clock_timestamp()
  where d.user_id=owner::text and d.work_date=p_work_date returning * into day;
  return to_jsonb(day);
end;
$$;
revoke all on function public.quickflex_update_sales_day(date,bigint,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.quickflex_update_sales_day(date,bigint,jsonb,jsonb) to authenticated;

-- Preserve the existing manual-date save contract, including its conflict response,
-- when an automatic team receipt arrives while an older manual editor is open.
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_user_id||':'||p_work_date::text,0));
  lock table public.quickflex_day_route_items in share row exclusive mode;

  if exists (
    select 1
    from public.quickflex_sales_work_results as result
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
    user_id, work_date, is_off, fresh_count, fresh_unit, fresh_solo_count,
    fresh_linked_count, backup_unit, driver_type, updated_at
  ) values (
    current_user_id, p_work_date, coalesce(p_is_off, false), p_fresh_count,
    p_fresh_unit, p_fresh_solo_count, p_fresh_linked_count, p_backup_unit,
    p_driver_type, clock_timestamp()
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
    user_id, work_date, route, delivery_count, household_count, unit_snapshot,
    sort_order, updated_at
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
       from public.quickflex_sales_work_results as result
       where result.user_id::text = new.user_id
         and result.work_date = new.work_date
     ) then
    raise exception 'manual route counts are locked after an automatic work result exists for this date'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
revoke all on function public.quickflex_guard_manual_counts_after_work_result() from public, anon, authenticated;
revoke all on function public.quickflex_replace_manual_day_record(date,boolean,boolean,integer,integer,integer,integer,integer,text,jsonb) from public, anon, authenticated;
grant execute on function public.quickflex_replace_manual_day_record(date,boolean,boolean,integer,integer,integer,integer,integer,text,jsonb) to authenticated;
