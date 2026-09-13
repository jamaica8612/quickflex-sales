-- Beta access is an administrator-owned profile attribute. Account deletion is
-- a durable request only: it does not remove Auth users or application data.

alter table public.quickflex_profiles
  add column if not exists beta_enabled boolean not null default false;

create schema if not exists private;
create table if not exists private.quickflex_profile_bootstrap_guard (
  singleton boolean primary key default true check (singleton),
  claimed_at timestamptz not null default clock_timestamp()
);
alter table private.quickflex_profile_bootstrap_guard enable row level security;
revoke all on table private.quickflex_profile_bootstrap_guard from public, anon, authenticated;

-- Any existing profile means the one-time administrator bootstrap was already
-- consumed. This preserves every existing account and role unchanged.
insert into private.quickflex_profile_bootstrap_guard (singleton)
select true
where exists (select 1 from public.quickflex_profiles)
on conflict (singleton) do nothing;

create or replace function public.quickflex_ensure_profile(
  profile_email text,
  profile_display_name text,
  profile_driver_type text
)
returns public.quickflex_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_id uuid := (select auth.uid());
  trusted_email text;
  result public.quickflex_profiles;
begin
  if requester_id is null then
    raise exception 'login is required' using errcode = '42501';
  end if;

  select u.email into trusted_email
    from auth.users as u
   where u.id = requester_id;
  if not found then
    raise exception 'authenticated user not found' using errcode = 'P0002';
  end if;

  -- profile_email stays in the signature for existing clients, but identity
  -- email is copied only from the authenticated Auth row.
  insert into public.quickflex_profiles (id, email, display_name, driver_type, status, role, fixed_routes)
  values (
    requester_id,
    trusted_email,
    coalesce(nullif(profile_display_name, ''), nullif(split_part(coalesce(trusted_email, ''), '@', 1), ''), '사용자'),
    case when profile_driver_type = 'fixed' then 'fixed' else 'backup' end,
    'pending',
    'driver',
    '{}'
  )
  on conflict (id) do update
    set email = coalesce(public.quickflex_profiles.email, excluded.email),
        display_name = case
          when public.quickflex_profiles.display_name is null
            or public.quickflex_profiles.display_name in ('', 'user', '사용자')
          then excluded.display_name
          else public.quickflex_profiles.display_name
        end,
        updated_at = clock_timestamp();

  select * into result
    from public.quickflex_profiles
   where id = requester_id;
  return result;
end;
$$;

create or replace function public.quickflex_guard_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) = old.id then
    new.id := old.id;
    new.email := old.email;
    new.status := old.status;
    new.role := old.role;
    new.beta_enabled := old.beta_enabled;
    new.created_at := old.created_at;

    if new.deletion_requested_at is distinct from old.deletion_requested_at then
      if old.deletion_requested_at is null and new.deletion_requested_at is not null then
        new.deletion_requested_at := clock_timestamp();
      else
        new.deletion_requested_at := old.deletion_requested_at;
      end if;
    end if;

    new.updated_at := clock_timestamp();
    return new;
  end if;

  if (select public.quickflex_is_admin()) then
    return new;
  end if;

  raise exception 'profile update is not allowed' using errcode = '42501';
end;
$$;

create or replace function public.quickflex_bootstrap_first_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bootstrap_claimed boolean;
begin
  new.beta_enabled := false;
  new.deletion_requested_at := null;

  -- The unique singleton claim is atomic even when two Auth signups commit at
  -- the same time. A failed profile insert rolls this claim back with it.
  insert into private.quickflex_profile_bootstrap_guard (singleton)
  values (true)
  on conflict (singleton) do nothing
  returning singleton into bootstrap_claimed;

  if bootstrap_claimed then
    new.status := 'approved';
    new.role := 'admin';
    if new.display_name is null or new.display_name = '' then
      new.display_name := '관리자';
    end if;
  else
    new.status := 'pending';
    new.role := 'driver';
  end if;

  return new;
end;
$$;

drop function if exists public.quickflex_list_admin_members();
drop function if exists public.quickflex_update_admin_member(uuid, text, text, text[]);

create function public.quickflex_list_admin_members()
returns table (
  id uuid,
  display_name text,
  role text,
  status text,
  driver_type text,
  fixed_routes text[],
  beta_enabled boolean,
  deletion_requested_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.quickflex_is_admin()) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;

  return query
  select p.id, p.display_name, p.role, p.status, p.driver_type,
         p.fixed_routes, p.beta_enabled, p.deletion_requested_at
    from public.quickflex_profiles as p
   order by p.created_at, p.id;
end;
$$;

create function public.quickflex_update_admin_member(
  p_member_id uuid,
  p_status text default null,
  p_driver_type text default null,
  p_fixed_routes text[] default null,
  p_beta_enabled boolean default null
)
returns table (
  id uuid,
  display_name text,
  role text,
  status text,
  driver_type text,
  fixed_routes text[],
  beta_enabled boolean,
  deletion_requested_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select public.quickflex_is_admin()) then
    raise exception 'administrator access required' using errcode = '42501';
  end if;
  if p_member_id is null or p_member_id = (select auth.uid()) then
    raise exception 'another member is required' using errcode = '22023';
  end if;
  if p_status is not null and p_status not in ('pending', 'approved', 'blocked') then
    raise exception 'invalid member status' using errcode = '22023';
  end if;
  if p_driver_type is not null and p_driver_type not in ('backup', 'fixed') then
    raise exception 'invalid driver type' using errcode = '22023';
  end if;
  if p_fixed_routes is not null and (
    cardinality(p_fixed_routes) > 50
    or exists (select 1 from unnest(p_fixed_routes) as route where route !~ '^[0-9]{3}[A-Z]$')
  ) then
    raise exception 'invalid fixed routes' using errcode = '22023';
  end if;

  update public.quickflex_profiles as p
     set status = coalesce(p_status, p.status),
         driver_type = coalesce(p_driver_type, p.driver_type),
         fixed_routes = coalesce(p_fixed_routes, p.fixed_routes),
         beta_enabled = coalesce(p_beta_enabled, p.beta_enabled),
         updated_at = clock_timestamp()
   where p.id = p_member_id;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;

  return query
  select p.id, p.display_name, p.role, p.status, p.driver_type,
         p.fixed_routes, p.beta_enabled, p.deletion_requested_at
    from public.quickflex_profiles as p
   where p.id = p_member_id;
end;
$$;

drop function if exists public.quickflex_request_account_deletion();

create function public.quickflex_request_account_deletion(
  p_expected_user_id uuid default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_id uuid := (select auth.uid());
  requested_at timestamptz;
begin
  if requester_id is null then
    raise exception 'login is required' using errcode = '42501';
  end if;
  if p_expected_user_id is not null and p_expected_user_id <> requester_id then
    raise exception 'authenticated account changed' using errcode = '42501';
  end if;

  update public.quickflex_profiles as p
     set deletion_requested_at = coalesce(p.deletion_requested_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where p.id = requester_id
   returning p.deletion_requested_at into requested_at;

  if requested_at is null then
    raise exception 'profile not found' using errcode = 'P0002';
  end if;

  return requested_at;
end;
$$;

revoke all on table public.quickflex_profiles from public, anon, authenticated;
grant select, update on table public.quickflex_profiles to authenticated;

drop policy if exists "quickflex profiles select own or admin" on public.quickflex_profiles;
drop policy if exists "quickflex profiles select own" on public.quickflex_profiles;
drop policy if exists "quickflex profiles insert own" on public.quickflex_profiles;
drop policy if exists "quickflex profiles update own" on public.quickflex_profiles;
drop policy if exists "quickflex profiles admin update" on public.quickflex_profiles;
drop policy if exists "quickflex profiles admin delete" on public.quickflex_profiles;

create policy "quickflex profiles select own"
on public.quickflex_profiles for select to authenticated
using (id = (select auth.uid()));

create policy "quickflex profiles update own"
on public.quickflex_profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

revoke all on function public.quickflex_guard_profile_update() from public, anon, authenticated;
revoke all on function public.quickflex_bootstrap_first_profile() from public, anon, authenticated;
revoke all on function public.quickflex_ensure_profile(text, text, text) from public, anon, authenticated;
revoke all on function public.quickflex_list_admin_members() from public, anon, authenticated;
revoke all on function public.quickflex_update_admin_member(uuid, text, text, text[], boolean) from public, anon, authenticated;
revoke all on function public.quickflex_request_account_deletion(uuid) from public, anon, authenticated;

grant execute on function public.quickflex_ensure_profile(text, text, text) to authenticated;
grant execute on function public.quickflex_list_admin_members() to authenticated;
grant execute on function public.quickflex_update_admin_member(uuid, text, text, text[], boolean) to authenticated;
grant execute on function public.quickflex_request_account_deletion(uuid) to authenticated;

comment on column public.quickflex_profiles.beta_enabled is
  'Administrator-managed beta enrollment. Clients must require approved status and this flag before beta-only entry.';
comment on column public.quickflex_profiles.deletion_requested_at is
  'Immutable account deletion request time. Data remains available until an administrator completes a separately verified deletion.';
comment on table private.quickflex_profile_bootstrap_guard is
  'Atomic one-time claim preventing concurrent Auth signups from creating more than one first administrator.';
comment on function public.quickflex_request_account_deletion(uuid) is
  'Records the authenticated profile deletion request once; it never deletes Auth or application data.';
