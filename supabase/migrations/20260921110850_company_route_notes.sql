-- Company route notes are independent of personal finance/measurement records.
create schema if not exists quickflex_notes_private;
revoke all on schema quickflex_notes_private from public;
grant usage on schema quickflex_notes_private to authenticated;

create table if not exists public.quickflex_note_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now()
);
create table if not exists public.quickflex_note_memberships (
  company_id uuid not null references public.quickflex_note_companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','editor','member')),
  primary key(company_id,user_id)
);
create index if not exists quickflex_note_memberships_user_idx on public.quickflex_note_memberships(user_id,company_id);

-- Single-company installation bootstrap. Disable this trigger before admitting other companies.
insert into public.quickflex_note_companies(id,name)
values('a97aa223-25ba-461c-a5b3-a96b8bf5c604','우리 회사') on conflict(id) do nothing;
insert into public.quickflex_note_memberships(company_id,user_id,role)
select 'a97aa223-25ba-461c-a5b3-a96b8bf5c604',p.id,case when p.role='admin' then 'admin' else 'member' end
from public.quickflex_profiles p
where p.status='approved' and not exists(select 1 from public.quickflex_note_memberships m where m.user_id=p.id)
on conflict do nothing;

-- Only a profile's existing, server-guarded approval may create membership. This function
-- is a private trigger, has no public RPC, and never changes profile/financial data.
create or replace function quickflex_notes_private.sync_internal_member()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status='approved' then
    if not exists(select 1 from public.quickflex_note_memberships where user_id=new.id) then
      insert into public.quickflex_note_memberships(company_id,user_id,role)
      values('a97aa223-25ba-461c-a5b3-a96b8bf5c604',new.id,case when new.role='admin' then 'admin' else 'member' end)
      on conflict do nothing;
    elsif tg_op='UPDATE' and old.role is distinct from new.role then
      update public.quickflex_note_memberships set role=case when new.role='admin' then 'admin' else 'member' end
      where company_id='a97aa223-25ba-461c-a5b3-a96b8bf5c604' and user_id=new.id;
    end if;
  end if;
  return new;
end $$;
revoke all on function quickflex_notes_private.sync_internal_member() from public,anon,authenticated;
drop trigger if exists quickflex_note_sync_member on public.quickflex_profiles;
create trigger quickflex_note_sync_member after insert or update of status,role on public.quickflex_profiles
for each row execute function quickflex_notes_private.sync_internal_member();

alter table public.quickflex_note_companies enable row level security;
alter table public.quickflex_note_memberships enable row level security;
revoke all on public.quickflex_note_companies,public.quickflex_note_memberships from public,anon,authenticated;
grant select on public.quickflex_note_companies,public.quickflex_note_memberships to authenticated;
drop policy if exists quickflex_notes_own_membership on public.quickflex_note_memberships;
create policy quickflex_notes_own_membership on public.quickflex_note_memberships for select to authenticated
using(user_id=(select auth.uid()) and (select public.quickflex_is_approved()));

-- Invoker rights: membership RLS already limits this lookup to the approved caller.
create or replace function quickflex_notes_private.can_access(p_company uuid,p_min_role text default 'member')
returns boolean language sql stable security invoker set search_path='' as $$
 select auth.uid() is not null and public.quickflex_is_approved() and exists(
   select 1 from public.quickflex_note_memberships m
   where m.company_id=p_company and m.user_id=auth.uid()
   and case p_min_role when 'member' then true when 'editor' then m.role in ('editor','admin') when 'admin' then m.role='admin' else false end
 )
$$;
revoke all on function quickflex_notes_private.can_access(uuid,text) from public,anon;
grant execute on function quickflex_notes_private.can_access(uuid,text) to authenticated;
drop policy if exists quickflex_notes_company_read on public.quickflex_note_companies;
create policy quickflex_notes_company_read on public.quickflex_note_companies for select to authenticated
using(quickflex_notes_private.can_access(id));

create or replace function quickflex_notes_private.valid_polygon(p jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare groups jsonb; rings jsonb; ring jsonb; point jsonb; n integer:=0; x numeric; y numeric;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) is distinct from 'object' or octet_length(p::text)>300000 then return false; end if;
  if p->>'type'='Polygon' then groups=jsonb_build_array(p->'coordinates');
  elsif p->>'type'='MultiPolygon' then groups=p->'coordinates'; else return false; end if;
  if jsonb_typeof(groups) is distinct from 'array' or jsonb_array_length(groups) not between 1 and 100 then return false; end if;
  for rings in select value from jsonb_array_elements(groups) loop
    if jsonb_typeof(rings) is distinct from 'array' or jsonb_array_length(rings) not between 1 and 100 then return false; end if;
    for ring in select value from jsonb_array_elements(rings) loop
      if jsonb_typeof(ring) is distinct from 'array' or jsonb_array_length(ring)<4 or ring->0 is distinct from ring->(jsonb_array_length(ring)-1) then return false; end if;
      for point in select value from jsonb_array_elements(ring) loop
        n=n+1;
        if n>5000 or jsonb_typeof(point) is distinct from 'array' or jsonb_array_length(point)<>2
          or jsonb_typeof(point->0) is distinct from 'number' or jsonb_typeof(point->1) is distinct from 'number' then return false; end if;
        x=(point->>0)::numeric; y=(point->>1)::numeric;
        if x not between -180 and 180 or y not between -90 and 90 then return false; end if;
      end loop;
    end loop;
  end loop;
  return true;
exception when others then return false;
end $$;
revoke all on function quickflex_notes_private.valid_polygon(jsonb) from public,anon;
grant execute on function quickflex_notes_private.valid_polygon(jsonb) to authenticated;

create table if not exists public.quickflex_note_zones (
 id uuid primary key default gen_random_uuid(), company_id uuid not null references public.quickflex_note_companies(id),
 name text not null check(char_length(btrim(name)) between 1 and 80), memo text not null default '' check(char_length(memo)<=4000),
 polygon jsonb check(quickflex_notes_private.valid_polygon(polygon)),
 created_by uuid not null references auth.users(id), updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default clock_timestamp(),
 unique(company_id,id),unique(company_id,name)
);
create table if not exists public.quickflex_note_tips (
 id uuid primary key default gen_random_uuid(), company_id uuid not null, zone_id uuid not null,
 title text not null check(char_length(btrim(title)) between 1 and 120),
 marker_type text not null check(marker_type in ('note','vehicle_entrance','parking','entrance','elevator','stairs','restroom','dog','cat','delivery_spot','warning','construction','access_code','security','storage','walk_in','unloading','locked','quiet','no_entry','important')),
 memo text not null default '' check(char_length(memo)<=4000),
 lat double precision check(lat between -90 and 90),lng double precision check(lng between -180 and 180),
 created_by uuid not null references auth.users(id),updated_by uuid not null references auth.users(id),
 author_name text not null default '기사' check(char_length(btrim(author_name)) between 1 and 80),
 created_at timestamptz not null default now(),updated_at timestamptz not null default clock_timestamp(),
 unique(company_id,id), foreign key(company_id,zone_id) references public.quickflex_note_zones(company_id,id) on delete cascade,
 check((lat is null)=(lng is null))
);
create index if not exists quickflex_note_tips_zone_idx on public.quickflex_note_tips(company_id,zone_id);
create table if not exists public.quickflex_note_favorites (
 company_id uuid not null,user_id uuid not null references auth.users(id) on delete cascade,zone_id uuid not null,
 created_at timestamptz not null default now(), primary key(user_id,zone_id),
 foreign key(company_id,zone_id) references public.quickflex_note_zones(company_id,id) on delete cascade
);
create index if not exists quickflex_note_favorites_zone_idx on public.quickflex_note_favorites(company_id,zone_id);
create table if not exists public.quickflex_note_photos (
 id uuid primary key default gen_random_uuid(),company_id uuid not null,tip_id uuid not null,
 path text not null unique check(char_length(path)<=200),created_by uuid not null references auth.users(id),created_at timestamptz not null default now(),
 foreign key(company_id,tip_id) references public.quickflex_note_tips(company_id,id) on delete cascade,
 check(split_part(path,'/',1)=company_id::text and split_part(path,'/',2)=tip_id::text
   and path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$')
);
create index if not exists quickflex_note_photos_tip_idx on public.quickflex_note_photos(company_id,tip_id);

create or replace function quickflex_notes_private.stamp_record()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_table_name='quickflex_note_tips' and tg_op='INSERT' then
   select coalesce(nullif(left(btrim(display_name),80),''),'기사') into new.author_name
   from public.quickflex_profiles where id=auth.uid();
   new.author_name=coalesce(new.author_name,'기사');
 end if;
 if tg_op='UPDATE' then
   if new.id<>old.id or new.company_id<>old.company_id or new.created_by<>old.created_by
     or new.created_at<>old.created_at or (to_jsonb(new)->'zone_id') is distinct from (to_jsonb(old)->'zone_id') then
     raise exception 'Route-note ownership and identity cannot change' using errcode='42501';
   end if;
   if tg_table_name='quickflex_note_tips' and (to_jsonb(new)->'author_name') is distinct from (to_jsonb(old)->'author_name') then
     raise exception 'Route-note author cannot change' using errcode='42501';
   end if;
 end if;
 if auth.uid() is not null then new.updated_by=auth.uid(); end if;
 new.updated_at=clock_timestamp();
 return new;
end $$;
revoke all on function quickflex_notes_private.stamp_record() from public,anon,authenticated;
drop trigger if exists quickflex_note_stamp_zone on public.quickflex_note_zones;
create trigger quickflex_note_stamp_zone before insert or update on public.quickflex_note_zones for each row execute function quickflex_notes_private.stamp_record();
drop trigger if exists quickflex_note_stamp_tip on public.quickflex_note_tips;
create trigger quickflex_note_stamp_tip before insert or update on public.quickflex_note_tips for each row execute function quickflex_notes_private.stamp_record();

-- Prevent concurrent/direct deletion from cascading away metadata before its binary.
create or replace function quickflex_notes_private.require_no_tip_photos()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if exists(select 1 from public.quickflex_note_photos where company_id=old.company_id and tip_id=old.id) then
   raise exception 'Remove tip photos before deleting the tip' using errcode='23503';
 end if;
 return old;
end $$;
revoke all on function quickflex_notes_private.require_no_tip_photos() from public,anon,authenticated;
drop trigger if exists quickflex_note_no_photos_delete on public.quickflex_note_tips;
create trigger quickflex_note_no_photos_delete before delete on public.quickflex_note_tips
for each row execute function quickflex_notes_private.require_no_tip_photos();

alter table public.quickflex_note_zones enable row level security;
alter table public.quickflex_note_tips enable row level security;
alter table public.quickflex_note_favorites enable row level security;
alter table public.quickflex_note_photos enable row level security;
revoke all on public.quickflex_note_zones,public.quickflex_note_tips,public.quickflex_note_favorites,public.quickflex_note_photos from public,anon,authenticated;
grant select,insert,update on public.quickflex_note_zones to authenticated;
grant select,insert,update,delete on public.quickflex_note_tips to authenticated;
grant select,insert,delete on public.quickflex_note_favorites,public.quickflex_note_photos to authenticated;
drop policy if exists quickflex_notes_zones_read on public.quickflex_note_zones;
create policy quickflex_notes_zones_read on public.quickflex_note_zones for select to authenticated using(quickflex_notes_private.can_access(company_id));
drop policy if exists quickflex_notes_zones_create on public.quickflex_note_zones;
create policy quickflex_notes_zones_create on public.quickflex_note_zones for insert to authenticated
with check(quickflex_notes_private.can_access(company_id,'editor') and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
drop policy if exists quickflex_notes_zones_edit on public.quickflex_note_zones;
create policy quickflex_notes_zones_edit on public.quickflex_note_zones for update to authenticated
using(quickflex_notes_private.can_access(company_id,'editor')) with check(quickflex_notes_private.can_access(company_id,'editor') and updated_by=(select auth.uid()));
drop policy if exists quickflex_notes_tips_read on public.quickflex_note_tips;
create policy quickflex_notes_tips_read on public.quickflex_note_tips for select to authenticated using(quickflex_notes_private.can_access(company_id));
drop policy if exists quickflex_notes_tips_create on public.quickflex_note_tips;
create policy quickflex_notes_tips_create on public.quickflex_note_tips for insert to authenticated
with check(quickflex_notes_private.can_access(company_id) and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
drop policy if exists quickflex_notes_tips_edit on public.quickflex_note_tips;
create policy quickflex_notes_tips_edit on public.quickflex_note_tips for update to authenticated
using(quickflex_notes_private.can_access(company_id) and created_by=(select auth.uid()))
with check(quickflex_notes_private.can_access(company_id) and created_by=(select auth.uid()) and updated_by=(select auth.uid()));
drop policy if exists quickflex_notes_tips_delete on public.quickflex_note_tips;
create policy quickflex_notes_tips_delete on public.quickflex_note_tips for delete to authenticated
using(quickflex_notes_private.can_access(company_id) and created_by=(select auth.uid()));
drop policy if exists quickflex_notes_favorites_read on public.quickflex_note_favorites;
create policy quickflex_notes_favorites_read on public.quickflex_note_favorites for select to authenticated
using(user_id=(select auth.uid()) and quickflex_notes_private.can_access(company_id));
drop policy if exists quickflex_notes_favorites_create on public.quickflex_note_favorites;
create policy quickflex_notes_favorites_create on public.quickflex_note_favorites for insert to authenticated
with check(user_id=(select auth.uid()) and quickflex_notes_private.can_access(company_id));
drop policy if exists quickflex_notes_favorites_delete on public.quickflex_note_favorites;
create policy quickflex_notes_favorites_delete on public.quickflex_note_favorites for delete to authenticated
using(user_id=(select auth.uid()) and quickflex_notes_private.can_access(company_id));
drop policy if exists quickflex_notes_photos_read on public.quickflex_note_photos;
create policy quickflex_notes_photos_read on public.quickflex_note_photos for select to authenticated using(quickflex_notes_private.can_access(company_id));
drop policy if exists quickflex_notes_photos_create on public.quickflex_note_photos;
create policy quickflex_notes_photos_create on public.quickflex_note_photos for insert to authenticated
with check(quickflex_notes_private.can_access(company_id) and created_by=(select auth.uid()) and exists(
 select 1 from public.quickflex_note_tips t where t.id=tip_id and t.company_id=quickflex_note_photos.company_id
 and t.created_by=(select auth.uid())));
drop policy if exists quickflex_notes_photos_delete on public.quickflex_note_photos;
create policy quickflex_notes_photos_delete on public.quickflex_note_photos for delete to authenticated
using(quickflex_notes_private.can_access(company_id) and exists(
 select 1 from public.quickflex_note_tips t where t.id=tip_id and t.company_id=quickflex_note_photos.company_id
 and t.created_by=(select auth.uid())));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('quickflex-route-notes-photos','quickflex-route-notes-photos',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function quickflex_notes_private.can_access_photo(p_path text,p_write boolean default false)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare company uuid; tip uuid;
begin
 if p_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp)$' then return false; end if;
 company=split_part(p_path,'/',1)::uuid; tip=split_part(p_path,'/',2)::uuid;
 return quickflex_notes_private.can_access(company) and exists(
  select 1 from public.quickflex_note_tips t where t.company_id=company and t.id=tip
  and (not p_write or t.created_by=auth.uid())
 );
end $$;
revoke all on function quickflex_notes_private.can_access_photo(text,boolean) from public,anon;
grant execute on function quickflex_notes_private.can_access_photo(text,boolean) to authenticated;
drop policy if exists quickflex_notes_storage_read on storage.objects;
create policy quickflex_notes_storage_read on storage.objects for select to authenticated
using(bucket_id='quickflex-route-notes-photos' and quickflex_notes_private.can_access_photo(name));
drop policy if exists quickflex_notes_storage_create on storage.objects;
create policy quickflex_notes_storage_create on storage.objects for insert to authenticated
with check(bucket_id='quickflex-route-notes-photos' and quickflex_notes_private.can_access_photo(name,true));
drop policy if exists quickflex_notes_storage_delete on storage.objects;
create policy quickflex_notes_storage_delete on storage.objects for delete to authenticated
using(bucket_id='quickflex-route-notes-photos' and quickflex_notes_private.can_access_photo(name,true));
-- Photos are immutable uploads (upsert=false); replacements use a fresh path, never UPDATE.
