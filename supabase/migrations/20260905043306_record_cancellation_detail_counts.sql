begin;

-- Cancellation attribution is immutable annotation, not another delivery count.
-- Older clients omit the optional route maps; no historical routes are inferred.
create or replace function public.quickflex_finalize_work_result(
  p_expected_device_id text,
  p_expected_work_id text,
  p_finish_date date,
  p_work_shift text,
  p_total_households integer,
  p_total_items integer,
  p_fresh_count integer,
  p_return_count integer,
  p_cancel_count integer,
  p_routes jsonb
)
returns table(status text, work_id text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  finalized_status text;
  finalized_work_id text;
  stored_cancel_count integer;
  updated_day_count integer;
  cancellation_detail_counts jsonb;
  stored_cancellation_detail_counts jsonb;
  supplied_cancellation_detail_counts boolean;
  cancellation_detail_sum bigint;
begin
  if current_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_cancel_count is null
     or p_cancel_count < 0
     or p_total_items is null
     or p_cancel_count > p_total_items then
    raise exception 'invalid delivery cancellation count' using errcode = '22023';
  end if;
  if p_routes is null or jsonb_typeof(p_routes) is distinct from 'array' then
    raise exception 'invalid work result input' using errcode = '22023';
  end if;
  if jsonb_array_length(p_routes) not between 1 and 100 then
    raise exception 'invalid work result input' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_routes) as entry(value)
    where jsonb_typeof(entry.value) is distinct from 'object'
       or jsonb_typeof(entry.value -> 'route') is distinct from 'string'
       or upper(trim(entry.value ->> 'route')) !~ '^[0-9]{3}[A-Z]$'
       or (
         entry.value ? 'cancellation_detail_counts'
         and jsonb_typeof(entry.value -> 'cancellation_detail_counts') is distinct from 'object'
       )
  ) then
    raise exception 'invalid work result cancellation detail' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_routes) as entry(value)
    cross join lateral jsonb_each(
      coalesce(entry.value -> 'cancellation_detail_counts', '{}'::jsonb)
    ) as detail(key, value)
    where detail.key !~ '^[0-9]{3}[A-Z][0-9]{2}$'
       or left(detail.key, 4) <> upper(trim(entry.value ->> 'route'))
       or jsonb_typeof(detail.value) is distinct from 'number'
       or detail.value::text !~ '^(0|[1-9][0-9]*)$'
       or case
            when jsonb_typeof(detail.value) = 'number'
             and detail.value::text ~ '^(0|[1-9][0-9]*)$'
            then (detail.value::text)::numeric > 2147483647
            else false
          end
  ) then
    raise exception 'invalid work result cancellation detail' using errcode = '22023';
  end if;

  select bool_or(entry.value ? 'cancellation_detail_counts')
  into supplied_cancellation_detail_counts
  from jsonb_array_elements(p_routes) as entry(value);

  select coalesce(jsonb_object_agg(detail.key, detail.value order by detail.key)
           filter (where (detail.value::text)::integer > 0), '{}'::jsonb),
         coalesce(sum((detail.value::text)::integer), 0)
  into cancellation_detail_counts, cancellation_detail_sum
  from jsonb_array_elements(p_routes) as entry(value)
  cross join lateral jsonb_each(
    coalesce(entry.value -> 'cancellation_detail_counts', '{}'::jsonb)
  ) as detail(key, value);

  if cancellation_detail_sum > p_cancel_count then
    raise exception 'work result cancellation detail sum exceeds cancellation count'
      using errcode = '22023';
  end if;

  -- The existing finalizer remains authoritative for delivery totals, route
  -- reconciliation, approval, ownership, and idempotency. Its canonical route
  -- allowlist excludes this annotation, so the sales identity stays unchanged.
  select finalized.status, finalized.work_id
  into finalized_status, finalized_work_id
  from public.quickflex_finalize_work_result(
    p_expected_device_id,
    p_expected_work_id,
    p_finish_date,
    p_work_shift,
    p_total_households,
    p_total_items,
    p_fresh_count,
    p_return_count,
    p_routes
  ) as finalized;

  if finalized_status = 'applied' then
    update public.quickflex_work_results as result
    set cancel_count = p_cancel_count,
        canonical_payload = jsonb_set(
          jsonb_set(result.canonical_payload, '{cancel_count}', to_jsonb(p_cancel_count), true),
          '{cancellation_detail_counts}',
          cancellation_detail_counts,
          true
        )
    where result.user_id = current_user_id
      and result.work_id = finalized_work_id;

    update public.quickflex_day_records as day
    set cancel_count = greatest(
          day.cancel_count,
          coalesce((
            select sum(result.cancel_count)::integer
            from public.quickflex_work_results as result
            where result.user_id = current_user_id
              and result.work_date = p_finish_date
          ), 0)
        ),
        updated_at = clock_timestamp()
    where day.user_id = current_user_id::text
      and day.work_date = p_finish_date;
    get diagnostics updated_day_count = row_count;
    if updated_day_count <> 1 then
      raise exception 'work day record missing' using errcode = '55000';
    end if;
  elsif finalized_status = 'already_applied' then
    select result.cancel_count,
           coalesce(result.canonical_payload -> 'cancellation_detail_counts', '{}'::jsonb)
    into stored_cancel_count, stored_cancellation_detail_counts
    from public.quickflex_work_results as result
    where result.user_id = current_user_id
      and result.work_id = finalized_work_id;

    if stored_cancel_count is distinct from p_cancel_count then
      raise exception 'work result cancellation count conflicts with immutable receipt'
        using errcode = '23505';
    end if;
    -- An old client may retry without this field. Preserve the stored map.
    -- An explicitly supplied map (including {}) must match the first write.
    if supplied_cancellation_detail_counts
       and stored_cancellation_detail_counts is distinct from cancellation_detail_counts then
      raise exception 'work result cancellation details conflict with immutable receipt'
        using errcode = '23505';
    end if;
  else
    raise exception 'unexpected work result status' using errcode = '55000';
  end if;

  return query select finalized_status, finalized_work_id;
end;
$$;

revoke all on function public.quickflex_finalize_work_result(
  text, text, date, text, integer, integer, integer, integer, integer, jsonb
) from public, anon;
grant execute on function public.quickflex_finalize_work_result(
  text, text, date, text, integer, integer, integer, integer, integer, jsonb
) to authenticated, service_role;

comment on function public.quickflex_finalize_work_result(
  text, text, date, text, integer, integer, integer, integer, integer, jsonb
) is 'Finalizes inclusive delivery totals and immutable cancellation metadata; optional per-route cancellation_detail_counts are flattened in canonical_payload without adding revenue.';

commit;
