-- All approved company members may create zones. Authors may remove empty zones;
-- existing editors retain maintenance access to imported/shared boundaries.
create or replace function quickflex_notes_private.zone_name_key(value text)
returns text language sql immutable strict security invoker set search_path='' as $$
  select upper(regexp_replace(normalize(value, NFKC), '[[:space:]]+', '', 'g'))
$$;
revoke all on function quickflex_notes_private.zone_name_key(text) from public,anon;
grant execute on function quickflex_notes_private.zone_name_key(text) to authenticated,service_role;

-- Fail on pre-existing collisions; never merge or delete existing notes automatically.
create unique index if not exists quickflex_note_zones_name_key_idx
  on public.quickflex_note_zones(company_id,quickflex_notes_private.zone_name_key(name));

grant delete on public.quickflex_note_zones to authenticated;
drop policy if exists quickflex_notes_zones_create on public.quickflex_note_zones;
create policy quickflex_notes_zones_create on public.quickflex_note_zones for insert to authenticated
with check(quickflex_notes_private.can_access(company_id) and created_by=(select auth.uid()) and updated_by=(select auth.uid()));

drop policy if exists quickflex_notes_zones_edit on public.quickflex_note_zones;
create policy quickflex_notes_zones_edit on public.quickflex_note_zones for update to authenticated
using(quickflex_notes_private.can_access(company_id) and (created_by=(select auth.uid()) or quickflex_notes_private.can_access(company_id,'editor')))
with check(quickflex_notes_private.can_access(company_id) and (created_by=(select auth.uid()) or quickflex_notes_private.can_access(company_id,'editor')) and updated_by=(select auth.uid()));

drop policy if exists quickflex_notes_zones_delete on public.quickflex_note_zones;
create policy quickflex_notes_zones_delete on public.quickflex_note_zones for delete to authenticated
using(quickflex_notes_private.can_access(company_id) and created_by=(select auth.uid()));

-- Referential checks also protect another author's tips/photos during concurrent writes.
alter table public.quickflex_note_tips
  drop constraint if exists quickflex_note_tips_company_id_zone_id_fkey;
alter table public.quickflex_note_tips
  add constraint quickflex_note_tips_company_id_zone_id_fkey
  foreign key(company_id,zone_id) references public.quickflex_note_zones(company_id,id) on delete restrict;
alter table public.quickflex_note_zone_photos
  drop constraint if exists quickflex_note_zone_photos_company_id_zone_id_fkey;
alter table public.quickflex_note_zone_photos
  add constraint quickflex_note_zone_photos_company_id_zone_id_fkey
  foreign key(company_id,zone_id) references public.quickflex_note_zones(company_id,id) on delete restrict;
