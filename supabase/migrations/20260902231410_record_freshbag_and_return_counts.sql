begin;

alter table public.quickflex_work_results
  add column if not exists fresh_count integer not null default 0 check (fresh_count >= 0),
  add column if not exists return_count integer not null default 0 check (return_count >= 0);

alter table public.quickflex_day_records
  add column if not exists return_count integer not null default 0 check (return_count >= 0);

create or replace function public.quickflex_finalize_work_result(
  p_expected_device_id text,
  p_expected_work_id text,
  p_finish_date date,
  p_work_shift text,
  p_total_households integer,
  p_total_items integer,
  p_fresh_count integer,
  p_return_count integer,
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
  stored_fresh_count integer;
  stored_return_count integer;
  updated_day_count integer;
begin
  if p_fresh_count is null
     or p_fresh_count < 0
     or p_return_count is null
     or p_return_count < 0
     or p_total_items is null
     or p_return_count > p_total_items then
    raise exception 'invalid freshbag or return count' using errcode = '22023';
  end if;

  select finalized.status, finalized.work_id
  into finalized_status, finalized_work_id
  from public.quickflex_finalize_work_result(
    p_expected_device_id,
    p_expected_work_id,
    p_finish_date,
    p_work_shift,
    p_total_households,
    p_total_items,
    p_routes
  ) as finalized;

  if finalized_status = 'applied' then
    update public.quickflex_work_results as result
    set fresh_count = p_fresh_count,
        return_count = p_return_count,
        canonical_payload = jsonb_set(
          jsonb_set(result.canonical_payload, '{fresh_count}', to_jsonb(p_fresh_count), true),
          '{return_count}',
          to_jsonb(p_return_count),
          true
        )
    where result.user_id = current_user_id
      and result.work_id = finalized_work_id;

    update public.quickflex_day_records as day
    set fresh_count = greatest(
          day.fresh_count,
          coalesce((
            select sum(result.fresh_count)::integer
            from public.quickflex_work_results as result
            where result.user_id = current_user_id
              and result.work_date = p_finish_date
          ), 0)
        ),
        return_count = greatest(
          day.return_count,
          coalesce((
            select sum(result.return_count)::integer
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
    select result.fresh_count, result.return_count
    into stored_fresh_count, stored_return_count
    from public.quickflex_work_results as result
    where result.user_id = current_user_id
      and result.work_id = finalized_work_id;

    if stored_fresh_count <> p_fresh_count or stored_return_count <> p_return_count then
      raise exception 'work result auxiliary counts conflict with immutable receipt'
        using errcode = '23505';
    end if;
  else
    raise exception 'unexpected work result status' using errcode = '55000';
  end if;

  return query select finalized_status, finalized_work_id;
end;
$$;

revoke all on function public.quickflex_finalize_work_result(
  text, text, date, text, integer, integer, integer, integer, jsonb
) from public, anon;
grant execute on function public.quickflex_finalize_work_result(
  text, text, date, text, integer, integer, integer, integer, jsonb
) to authenticated, service_role;

comment on column public.quickflex_work_results.fresh_count is
  'Unique C1/C2 five-character fresh-bag serials detected during this Android work.';
comment on column public.quickflex_work_results.return_count is
  'Return items included in total_items and delivery revenue for this Android work.';
comment on column public.quickflex_day_records.return_count is
  'Return items already included in route delivery counts; displayed separately without extra revenue.';

commit;
