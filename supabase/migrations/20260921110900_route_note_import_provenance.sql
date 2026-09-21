-- One-time legacy RouteNote import support. Apply after company_route_notes.sql.
-- Public provenance is a media-safe summary; full source records live in the private archive below.

alter table public.quickflex_note_zones
  alter column created_by drop not null,
  alter column updated_by drop not null,
  add column if not exists color text check(char_length(color)<=32),
  add column if not exists source_project text check(char_length(btrim(source_project)) between 1 and 120),
  add column if not exists source_id uuid,
  add column if not exists source_record jsonb not null default '{}'::jsonb;

alter table public.quickflex_note_tips
  alter column created_by drop not null,
  alter column updated_by drop not null,
  add column if not exists source_project text check(char_length(btrim(source_project)) between 1 and 120),
  add column if not exists source_id uuid,
  add column if not exists source_record jsonb not null default '{}'::jsonb,
  add column if not exists tags text[] not null default '{}',
  add column if not exists last_verified_at timestamptz,
  add column if not exists last_verified_by uuid references auth.users(id);

alter table public.quickflex_note_photos
  alter column created_by drop not null,
  add column if not exists source_project text check(char_length(btrim(source_project)) between 1 and 120),
  add column if not exists source_id uuid,
  add column if not exists source_record jsonb not null default '{}'::jsonb;

create unique index if not exists quickflex_note_zones_source_identity_idx
  on public.quickflex_note_zones(source_project,source_id)
  where source_project is not null and source_id is not null;
create unique index if not exists quickflex_note_tips_source_identity_idx
  on public.quickflex_note_tips(source_project,source_id)
  where source_project is not null and source_id is not null;
create unique index if not exists quickflex_note_photos_source_identity_idx
  on public.quickflex_note_photos(source_project,source_id)
  where source_project is not null and source_id is not null;
grant select,insert on public.quickflex_note_zones,public.quickflex_note_tips,public.quickflex_note_photos to service_role;
grant execute on function quickflex_notes_private.valid_polygon(jsonb) to service_role;

create table if not exists quickflex_notes_private.import_records (
  company_id uuid not null references public.quickflex_note_companies(id) on delete cascade,
  entity_type text not null,
  entity_id uuid not null,
  source_project text not null,
  source_id uuid not null,
  source_record jsonb not null,
  archived_at timestamptz not null default clock_timestamp(),
  primary key(entity_type,entity_id),
  unique(source_project,source_id,entity_type)
);
alter table quickflex_notes_private.import_records enable row level security;
revoke all on quickflex_notes_private.import_records from public,anon,authenticated;
grant usage on schema quickflex_notes_private to service_role;
grant select,insert,update,delete on quickflex_notes_private.import_records to service_role;

create or replace function quickflex_notes_private.is_route_note_importer()
returns boolean language sql stable security invoker set search_path='' as $$
  select current_user in ('postgres','service_role')
$$;
revoke all on function quickflex_notes_private.is_route_note_importer() from public,anon,authenticated;
grant execute on function quickflex_notes_private.is_route_note_importer() to authenticated,service_role;

create or replace function quickflex_notes_private.stamp_record()
returns trigger language plpgsql security invoker set search_path='' as $$
declare privileged_import boolean := quickflex_notes_private.is_route_note_importer();
begin
 if tg_op='INSERT' and not privileged_import then
   if new.source_project is not null or new.source_id is not null or new.source_record is distinct from '{}'::jsonb then
     raise exception 'Route-note provenance is import-only' using errcode='42501';
   end if;
   new.created_at=clock_timestamp();
   if tg_table_name='quickflex_note_tips' then
     select coalesce(nullif(left(btrim(display_name),80),''),'기사') into new.author_name
     from public.quickflex_profiles where id=auth.uid();
     new.author_name=coalesce(new.author_name,'기사');
   end if;
 end if;
 if tg_op='UPDATE' then
   if new.id<>old.id or new.company_id<>old.company_id
     or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
     or (to_jsonb(new)->'zone_id') is distinct from (to_jsonb(old)->'zone_id')
     or new.source_project is distinct from old.source_project
     or new.source_id is distinct from old.source_id
     or new.source_record is distinct from old.source_record then
     raise exception 'Route-note ownership, identity, and provenance cannot change' using errcode='42501';
   end if;
   if tg_table_name='quickflex_note_tips' and (to_jsonb(new)->'author_name') is distinct from (to_jsonb(old)->'author_name') then
     raise exception 'Route-note author cannot change' using errcode='42501';
   end if;
 end if;
 if not privileged_import and auth.uid() is not null then new.updated_by=auth.uid(); end if;
 if not privileged_import then new.updated_at=clock_timestamp(); end if;
 return new;
end $$;
revoke all on function quickflex_notes_private.stamp_record() from public,anon,authenticated;

create or replace function quickflex_notes_private.stamp_tip_photo_provenance()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' and not quickflex_notes_private.is_route_note_importer() then
   if new.source_project is not null or new.source_id is not null or new.source_record is distinct from '{}'::jsonb then
     raise exception 'Route-note provenance is import-only' using errcode='42501';
   end if;
   new.created_at=clock_timestamp();
 elsif tg_op='UPDATE' and (
   new.id<>old.id or new.company_id<>old.company_id or new.tip_id<>old.tip_id
   or new.path<>old.path or new.created_by is distinct from old.created_by
   or new.created_at is distinct from old.created_at
   or new.source_project is distinct from old.source_project
   or new.source_id is distinct from old.source_id
   or new.source_record is distinct from old.source_record
 ) then
   raise exception 'Route-note photo identity and provenance cannot change' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function quickflex_notes_private.stamp_tip_photo_provenance() from public,anon,authenticated;
drop trigger if exists quickflex_note_stamp_tip_photo on public.quickflex_note_photos;
create trigger quickflex_note_stamp_tip_photo before insert or update on public.quickflex_note_photos
for each row execute function quickflex_notes_private.stamp_tip_photo_provenance();

create table if not exists public.quickflex_note_zone_photos (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,
 zone_id uuid not null,
 path text not null unique check(char_length(path)<=220),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 source_project text check(char_length(btrim(source_project)) between 1 and 120),
 source_id uuid,
 source_record jsonb not null default '{}'::jsonb,
 foreign key(company_id,zone_id) references public.quickflex_note_zones(company_id,id) on delete cascade,
 check(split_part(path,'/',2)=company_id::text and split_part(path,'/',3)=zone_id::text
   and path ~ '^zones/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png)$')
);
create unique index if not exists quickflex_note_zone_photos_source_identity_idx
  on public.quickflex_note_zone_photos(source_project,source_id)
  where source_project is not null and source_id is not null;
alter table public.quickflex_note_zone_photos enable row level security;
revoke all on public.quickflex_note_zone_photos from public,anon,authenticated;
grant select on public.quickflex_note_zone_photos to authenticated;
grant select,insert,update,delete on public.quickflex_note_zone_photos to service_role;
drop policy if exists quickflex_notes_zone_photos_read on public.quickflex_note_zone_photos;
create policy quickflex_notes_zone_photos_read on public.quickflex_note_zone_photos for select to authenticated
using(quickflex_notes_private.can_access(company_id));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('quickflex-route-note-zone-photos','quickflex-route-note-zone-photos',false,20971520,array['image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create or replace function quickflex_notes_private.can_access_zone_photo(p_path text)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare company uuid; zone uuid;
begin
 if p_path !~ '^zones/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f-]{36}\.(jpg|jpeg|png)$' then return false; end if;
 company=split_part(p_path,'/',2)::uuid;
 zone=split_part(p_path,'/',3)::uuid;
 return quickflex_notes_private.can_access(company) and exists(
   select 1 from public.quickflex_note_zones z where z.company_id=company and z.id=zone
 );
end $$;
revoke all on function quickflex_notes_private.can_access_zone_photo(text) from public,anon;
grant execute on function quickflex_notes_private.can_access_zone_photo(text) to authenticated;
drop policy if exists quickflex_notes_zone_storage_read on storage.objects;
create policy quickflex_notes_zone_storage_read on storage.objects for select to authenticated
using(bucket_id='quickflex-route-note-zone-photos' and quickflex_notes_private.can_access_zone_photo(name));
grant usage on schema storage to service_role;
grant select,insert,delete on storage.objects to service_role;
