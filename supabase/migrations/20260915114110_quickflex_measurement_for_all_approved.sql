-- PWA approval is also measurement approval. beta_enabled remains a compatibility
-- field for already installed APKs; it is not diagnostic upload consent.
begin;
set local lock_timeout = '5s';

create or replace function private.quickflex_sync_measurement_approval()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.beta_enabled := (new.status = 'approved');
  return new;
end;
$$;
revoke all on function private.quickflex_sync_measurement_approval() from public, anon, authenticated;

-- BEFORE triggers execute by name. Run AFTER bootstrap / self-update guards
-- so forged approval input has already been rejected or normalized.
drop trigger if exists zz_quickflex_sync_measurement_approval on public.quickflex_profiles;
create trigger zz_quickflex_sync_measurement_approval
before insert or update on public.quickflex_profiles
for each row execute function private.quickflex_sync_measurement_approval();

-- The exclusive DDL lock lasts through this transaction. Only this exact
-- profile-update guard is suspended for the compatibility backfill; RLS,
-- bootstrap and all other triggers remain enabled. Rollback restores the guard.
alter table public.quickflex_profiles disable trigger quickflex_guard_profile_update_trigger;
update public.quickflex_profiles
set beta_enabled = (status = 'approved')
where beta_enabled is distinct from (status = 'approved');
alter table public.quickflex_profiles enable trigger quickflex_guard_profile_update_trigger;

comment on column public.quickflex_profiles.beta_enabled is
  'Compatibility flag derived from approved membership for native measurement entry. Not diagnostic upload consent.';
comment on function private.quickflex_sync_measurement_approval() is
  'Derives measurement access after membership guards; pending and blocked accounts cannot enable themselves.';
commit;
