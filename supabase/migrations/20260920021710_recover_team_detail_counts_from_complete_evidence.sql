-- Legacy/native payloads can have a complete, precise delivery ledger while
-- omitting routes[].detail_counts. Recover only that work's missing breakdown;
-- supplied detail counts, base route totals, money and date corrections remain
-- the authoritative projections.
create or replace view public.quickflex_team_detail_totals with (security_invoker = true) as
with supplied_contributions as (
  select w.user_id, w.work_date, e.key as detail_route, e.value::integer as count
  from public.quickflex_team_work_inputs w,
    lateral jsonb_array_elements(w.payload->'routes') r,
    lateral jsonb_each_text(coalesce(r->'detail_counts','{}')) e
), recovered_contributions as (
  select w.user_id, w.work_date, d->>'detailedRoute' as detail_route,
    sum((d->>'count')::integer)::integer as count
  from public.quickflex_team_work_inputs w,
    lateral jsonb_array_elements(w.payload->'routes') r,
    lateral jsonb_array_elements(w.payload->'evidence'->'deliveries') d
  where jsonb_typeof(coalesce(r->'detail_counts','{}')) = 'object'
    -- A nonempty supplied breakdown is intentionally left untouched, including
    -- a partial one. It may be a manual/correction-era authoritative value.
    and coalesce(r->'detail_counts','{}') = '{}'::jsonb
    and coalesce(r->>'route','') ~ '^[0-9]{3}[A-Z]$'
    and coalesce(r->>'delivery_count','') ~ '^(0|[1-9][0-9]{0,6})$'
    and d->>'route' = r->>'route'
    -- An unknown/null route in this work could be a partial observation of
    -- the same completion. Do not recover any route from such a work.
    and not exists (
      select 1
      from jsonb_array_elements(w.payload->'evidence'->'deliveries') candidate
      where coalesce(candidate->>'route','') !~ '^[0-9]{3}[A-Z]$'
        or coalesce(candidate->>'detailedRoute','') !~ '^[0-9]{3}[A-Z][0-9]{2}$'
        or left(candidate->>'detailedRoute',4) <> candidate->>'route'
        or coalesce(candidate->>'count','') !~ '^[1-9][0-9]{0,4}$'
    )
    and not exists (
      select 1
      from jsonb_array_elements(w.payload->'evidence'->'deliveries') candidate
      where candidate->>'route' = r->>'route'
        and (
          coalesce(candidate->>'detailedRoute','') !~ '^[0-9]{3}[A-Z][0-9]{2}$'
          or left(candidate->>'detailedRoute',4) <> r->>'route'
          or coalesce(candidate->>'count','') !~ '^[1-9][0-9]{0,4}$'
        )
    )
    and coalesce((
      select sum((candidate->>'count')::integer)
      from jsonb_array_elements(w.payload->'evidence'->'deliveries') candidate
      where candidate->>'route' = r->>'route'
    ),0) = (r->>'delivery_count')::integer
    -- A repeated invoice is okay only when every observation in this work
    -- agrees on both base and detailed route. Cross-phone union still happens
    -- below through quickflex_team_unique_deliveries.
    and not exists (
      select 1
      from jsonb_array_elements(w.payload->'evidence'->'deliveries') candidate
      where nullif(candidate->>'invoiceHash','') is not null
      group by candidate->>'invoiceHash'
      having count(distinct candidate->>'route') <> 1
        or count(distinct candidate->>'detailedRoute') <> 1
    )
  group by w.user_id, w.work_date, d->>'detailedRoute'
), contributions as (
  select * from supplied_contributions
  union all
  select * from recovered_contributions
  union all
  select user_id, work_date, detail_route, -count
  from public.quickflex_team_observations
  where detail_route is not null
  union all
  select user_id, work_date, detail_route, count
  from public.quickflex_team_unique_deliveries
  where detail_route is not null
), totals as (
  select user_id, work_date, detail_route, greatest(0,sum(count))::integer as count
  from contributions
  group by user_id, work_date, detail_route
), bounded as (
  select *, sum(count) over(partition by user_id, work_date, left(detail_route,4)) as base_sum
  from totals
)
select t.user_id, t.work_date, t.detail_route, t.count as delivery_count
from bounded t
join public.quickflex_team_route_totals r
  on r.user_id=t.user_id
  and r.work_date=t.work_date
  and r.route=left(t.detail_route,4)
where t.count>0 and t.base_sum<=r.delivery_count;
