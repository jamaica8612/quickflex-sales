create index if not exists quickflex_measurement_diagnostics_created_at_idx
  on public.quickflex_measurement_diagnostics (created_at);

create or replace function private.quickflex_prune_measurement_diagnostics()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  deleted_count bigint;
begin
  delete from public.quickflex_measurement_diagnostics
  where created_at < clock_timestamp() - interval '3 days';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke execute on function private.quickflex_prune_measurement_diagnostics()
  from public, anon, authenticated;

comment on function private.quickflex_prune_measurement_diagnostics() is
  'Deletes Android measurement diagnostics older than 3 days; invoked by pg_cron only';
