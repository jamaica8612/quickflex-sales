-- Expiring, zone-scoped public read links. Raw tokens are returned once and never stored.

create table if not exists public.quickflex_route_note_shares (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  zone_id uuid not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  foreign key(company_id,zone_id) references public.quickflex_note_zones(company_id,id) on delete cascade,
  check(expires_at>created_at)
);
create index if not exists quickflex_route_note_shares_owner_idx on public.quickflex_route_note_shares(created_by,created_at desc);

alter table public.quickflex_route_note_shares enable row level security;
revoke all on public.quickflex_route_note_shares from public,anon,authenticated;
grant usage on schema quickflex_notes_private to anon,authenticated,service_role;
grant select on public.quickflex_route_note_shares to authenticated;
drop policy if exists quickflex_route_note_shares_owner_read on public.quickflex_route_note_shares;
create policy quickflex_route_note_shares_owner_read on public.quickflex_route_note_shares for select to authenticated
using(created_by=(select auth.uid()));

create or replace function quickflex_notes_private.route_note_share_hash(p_token text)
returns text language sql immutable security invoker set search_path='' as $$
  select encode(extensions.digest(p_token,'sha256'),'hex')
$$;
revoke all on function quickflex_notes_private.route_note_share_hash(text) from public,anon,authenticated;

create or replace function quickflex_notes_private.assert_route_note_share_member(p_company_id uuid,p_owner uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if p_owner is null or not exists(
    select 1 from public.quickflex_profiles p where p.id=p_owner and p.status='approved'
  ) or not exists(
    select 1 from public.quickflex_note_memberships m where m.company_id=p_company_id and m.user_id=p_owner
  ) then
    raise exception 'Approved company membership is required' using errcode='42501';
  end if;
end $$;
revoke all on function quickflex_notes_private.assert_route_note_share_member(uuid,uuid) from public,anon,authenticated;

create or replace function quickflex_notes_private.create_route_note_share(p_zone_id uuid,p_expires_in_days integer default 7)
returns table(id uuid,token text,expires_at timestamptz,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare owner uuid := (select auth.uid()); company uuid; raw_token text; now_at timestamptz := clock_timestamp();
begin
  if p_expires_in_days is null or p_expires_in_days not between 1 and 30 then
    raise exception 'Share duration must be between 1 and 30 days' using errcode='22023';
  end if;
  select z.company_id into company from public.quickflex_note_zones z where z.id=p_zone_id;
  if company is null then raise exception 'Route-note zone was not found' using errcode='42501'; end if;
  perform quickflex_notes_private.assert_route_note_share_member(company,owner);
  raw_token:=encode(extensions.gen_random_bytes(32),'hex');
  return query insert into public.quickflex_route_note_shares(company_id,zone_id,created_by,token_hash,expires_at,created_at)
    values(company,p_zone_id,owner,quickflex_notes_private.route_note_share_hash(raw_token),now_at+(p_expires_in_days||' days')::interval,now_at)
    returning quickflex_route_note_shares.id,raw_token,quickflex_route_note_shares.expires_at,quickflex_route_note_shares.created_at;
end $$;
revoke all on function quickflex_notes_private.create_route_note_share(uuid,integer) from public,anon;
grant execute on function quickflex_notes_private.create_route_note_share(uuid,integer) to authenticated;

create or replace function quickflex_notes_private.list_route_note_shares()
returns table(id uuid,zone_id uuid,expires_at timestamptz,revoked_at timestamptz,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare owner uuid := (select auth.uid());
begin
  if owner is null then raise exception 'Authentication is required' using errcode='42501'; end if;
  return query select s.id,s.zone_id,s.expires_at,s.revoked_at,s.created_at
    from public.quickflex_route_note_shares s where s.created_by=owner order by s.created_at desc;
end $$;
revoke all on function quickflex_notes_private.list_route_note_shares() from public,anon;
grant execute on function quickflex_notes_private.list_route_note_shares() to authenticated;

create or replace function quickflex_notes_private.update_route_note_share(p_share_id uuid,p_expires_in_days integer default null,p_revoke boolean default false)
returns table(id uuid,zone_id uuid,expires_at timestamptz,revoked_at timestamptz,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare owner uuid := (select auth.uid()); current_share public.quickflex_route_note_shares%rowtype; now_at timestamptz := clock_timestamp();
begin
  select s.* into current_share from public.quickflex_route_note_shares s where s.id=p_share_id and s.created_by=owner for update;
  if not found then raise exception 'Route-note share was not found' using errcode='42501'; end if;
  perform quickflex_notes_private.assert_route_note_share_member(current_share.company_id,owner);
  if p_revoke then
    update public.quickflex_route_note_shares as s set revoked_at=coalesce(s.revoked_at,now_at) where s.id=current_share.id;
  else
    if p_expires_in_days is null or p_expires_in_days not between 1 and 30 or current_share.revoked_at is not null then
      raise exception 'Active share duration must be between 1 and 30 days' using errcode='22023';
    end if;
    update public.quickflex_route_note_shares as s set expires_at=now_at+(p_expires_in_days||' days')::interval where s.id=current_share.id;
  end if;
  return query select s.id,s.zone_id,s.expires_at,s.revoked_at,s.created_at from public.quickflex_route_note_shares s where s.id=current_share.id;
end $$;
revoke all on function quickflex_notes_private.update_route_note_share(uuid,integer,boolean) from public,anon;
grant execute on function quickflex_notes_private.update_route_note_share(uuid,integer,boolean) to authenticated;

create or replace function quickflex_notes_private.get_shared_route(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare share_row public.quickflex_route_note_shares%rowtype;
begin
  if p_token !~ '^[0-9a-f]{64}$' then return null; end if;
  select s.* into share_row from public.quickflex_route_note_shares s
  where s.token_hash=quickflex_notes_private.route_note_share_hash(p_token)
    and s.expires_at>clock_timestamp() and s.revoked_at is null
    and exists(select 1 from public.quickflex_profiles p where p.id=s.created_by and p.status='approved')
    and exists(select 1 from public.quickflex_note_memberships m where m.company_id=s.company_id and m.user_id=s.created_by);
  if not found then return null; end if;
  return jsonb_build_object(
    'expires_at',share_row.expires_at,
    'company',(select jsonb_build_object('id',c.id,'name',c.name) from public.quickflex_note_companies c where c.id=share_row.company_id),
    'zone',(select jsonb_build_object('id',z.id,'name',z.name,'memo',z.memo,'color',z.color,'polygon',z.polygon) from public.quickflex_note_zones z where z.company_id=share_row.company_id and z.id=share_row.zone_id),
    'tips',coalesce((select jsonb_agg(jsonb_build_object('id',t.id,'zone_id',t.zone_id,'title',t.title,'marker_type',t.marker_type,'memo',t.memo,'lat',t.lat,'lng',t.lng,'author_name',t.author_name,'tags',t.tags,'last_verified_at',t.last_verified_at) order by t.created_at,t.id) from public.quickflex_note_tips t where t.company_id=share_row.company_id and t.zone_id=share_row.zone_id),'[]'::jsonb),
    'tip_photos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'tip_id',p.tip_id,'path',p.path,'created_at',p.created_at) order by p.created_at,p.id) from public.quickflex_note_photos p join public.quickflex_note_tips t on t.company_id=p.company_id and t.id=p.tip_id where p.company_id=share_row.company_id and t.zone_id=share_row.zone_id),'[]'::jsonb),
    'zone_photos',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'zone_id',p.zone_id,'path',p.path,'created_at',p.created_at) order by p.created_at,p.id) from public.quickflex_note_zone_photos p where p.company_id=share_row.company_id and p.zone_id=share_row.zone_id),'[]'::jsonb)
  );
end $$;
revoke all on function quickflex_notes_private.get_shared_route(text) from public,anon,authenticated;
grant execute on function quickflex_notes_private.get_shared_route(text) to anon,authenticated,service_role;

create or replace function public.quickflex_create_route_note_share(p_zone_id uuid,p_expires_in_days integer default 7)
returns table(id uuid,token text,expires_at timestamptz,created_at timestamptz)
language sql security invoker set search_path='' as $$
  select * from quickflex_notes_private.create_route_note_share(p_zone_id,p_expires_in_days)
$$;
create or replace function public.quickflex_list_route_note_shares()
returns table(id uuid,zone_id uuid,expires_at timestamptz,revoked_at timestamptz,created_at timestamptz)
language sql security invoker set search_path='' as $$
  select * from quickflex_notes_private.list_route_note_shares()
$$;
create or replace function public.quickflex_update_route_note_share(p_share_id uuid,p_expires_in_days integer default null,p_revoke boolean default false)
returns table(id uuid,zone_id uuid,expires_at timestamptz,revoked_at timestamptz,created_at timestamptz)
language sql security invoker set search_path='' as $$
  select * from quickflex_notes_private.update_route_note_share(p_share_id,p_expires_in_days,p_revoke)
$$;
create or replace function public.quickflex_get_shared_route(p_token text)
returns jsonb language sql security invoker set search_path='' as $$
  select quickflex_notes_private.get_shared_route(p_token)
$$;
revoke all on function public.quickflex_create_route_note_share(uuid,integer),public.quickflex_list_route_note_shares(),public.quickflex_update_route_note_share(uuid,integer,boolean),public.quickflex_get_shared_route(text) from public;
grant execute on function public.quickflex_create_route_note_share(uuid,integer),public.quickflex_list_route_note_shares(),public.quickflex_update_route_note_share(uuid,integer,boolean) to authenticated;
grant execute on function public.quickflex_get_shared_route(text) to anon,authenticated,service_role;
