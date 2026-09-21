-- A company detail code is claimed by one zone, regardless of how many
-- postcode polygons within that zone carry the same label.
alter table public.quickflex_note_zones
  add constraint quickflex_note_zone_color_hex check(color is null or color ~ '^#[0-9A-Fa-f]{6}$');

create or replace function quickflex_notes_private.detail_codes(p_polygon jsonb)
returns text[] language sql immutable security invoker set search_path='' as $$
  with labels as (
    select value #>> '{}' as label
    from jsonb_array_elements(case when jsonb_typeof(p_polygon->'subLabels')='array'
      then p_polygon->'subLabels' else '[]'::jsonb end)
    union all
    select code->>'label'
    from jsonb_array_elements(case when jsonb_typeof(p_polygon->'codeGroups')='array'
      then p_polygon->'codeGroups' else '[]'::jsonb end) as groups(group_value)
    cross join lateral jsonb_array_elements(case when jsonb_typeof(group_value->'codes')='array'
      then group_value->'codes' else '[]'::jsonb end) as codes(code)
  ), normalized as (
    select upper(regexp_replace(normalize(coalesce(label,''),NFKC),'[[:space:]]+','','g')) as label from labels
  ), tokens as (
    select token,
      substring(label from '^([0-9]{3}[A-Z])[0-9]{2}([/,]|$)') as prefix
    from normalized cross join lateral regexp_split_to_table(label,'[/,]') token
  ), codes as (
    select case when token ~ '^[0-9]{3}[A-Z][0-9]{2}$' then token
      when prefix is not null and token ~ '^[0-9]{2}$' then prefix||token end as code from tokens
  )
  select coalesce(array_agg(distinct code order by code),'{}'::text[])
  from codes where code is not null
$$;
revoke all on function quickflex_notes_private.detail_codes(jsonb) from public,anon,authenticated;

create table if not exists quickflex_notes_private.zone_detail_code_claims (
  company_id uuid not null,
  detail_code text not null,
  zone_id uuid not null,
  primary key(company_id,detail_code),
  foreign key(company_id,zone_id) references public.quickflex_note_zones(company_id,id) on delete cascade
);
revoke all on quickflex_notes_private.zone_detail_code_claims from public,anon,authenticated;
alter table quickflex_notes_private.zone_detail_code_claims enable row level security;

-- Duplicate legacy codes abort this transaction; no existing zone or tip is rewritten.
insert into quickflex_notes_private.zone_detail_code_claims(company_id,detail_code,zone_id)
select z.company_id,unnest(quickflex_notes_private.detail_codes(z.polygon)),z.id
from public.quickflex_note_zones z
on conflict(company_id,detail_code) do nothing;
do $$ begin
  if exists (
    select 1 from public.quickflex_note_zones z
    cross join lateral unnest(quickflex_notes_private.detail_codes(z.polygon)) code
    join quickflex_notes_private.zone_detail_code_claims c
      on c.company_id=z.company_id and c.detail_code=code and c.zone_id<>z.id
  ) then raise exception 'Existing company detail codes belong to multiple zones'; end if;
end $$;

create or replace function quickflex_notes_private.sync_zone_detail_codes()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then
    delete from quickflex_notes_private.zone_detail_code_claims where zone_id=old.id;
    return old;
  end if;
  delete from quickflex_notes_private.zone_detail_code_claims where zone_id=new.id;
  insert into quickflex_notes_private.zone_detail_code_claims(company_id,detail_code,zone_id)
    select new.company_id,unnest(quickflex_notes_private.detail_codes(new.polygon)),new.id;
  return new;
end $$;
revoke all on function quickflex_notes_private.sync_zone_detail_codes() from public,anon,authenticated;
drop trigger if exists quickflex_note_zone_detail_codes on public.quickflex_note_zones;
create trigger quickflex_note_zone_detail_codes after insert or update of polygon or delete
on public.quickflex_note_zones for each row execute function quickflex_notes_private.sync_zone_detail_codes();

-- Return 2 on a boundary, 1 strictly inside, 0 outside.
create or replace function quickflex_notes_private.point_in_ring(p_lng numeric,p_lat numeric,p_ring jsonb)
returns integer language plpgsql immutable security invoker set search_path='' as $$
declare i integer; j integer; ax numeric; ay numeric; bx numeric; b_y numeric; inside boolean:=false;
begin
  if jsonb_typeof(p_ring)<>'array' or jsonb_array_length(p_ring)<4 then return 0; end if;
  for i in 0..jsonb_array_length(p_ring)-2 loop
    j:=i+1;
    ax:=(p_ring->i->>0)::numeric; ay:=(p_ring->i->>1)::numeric;
    bx:=(p_ring->j->>0)::numeric; b_y:=(p_ring->j->>1)::numeric;
    if abs((p_lng-ax)*(b_y-ay)-(p_lat-ay)*(bx-ax))<=0.0000000001
      and p_lng between least(ax,bx)-0.0000000001 and greatest(ax,bx)+0.0000000001
      and p_lat between least(ay,b_y)-0.0000000001 and greatest(ay,b_y)+0.0000000001 then return 2; end if;
    if (ay>p_lat)<>(b_y>p_lat) and p_lng < (bx-ax)*(p_lat-ay)/(b_y-ay)+ax then
      inside:=not inside;
    end if;
  end loop;
  if inside then return 1; end if;
  return 0;
end $$;
revoke all on function quickflex_notes_private.point_in_ring(numeric,numeric,jsonb) from public,anon;
grant execute on function quickflex_notes_private.point_in_ring(numeric,numeric,jsonb) to authenticated,service_role;

create or replace function quickflex_notes_private.point_in_polygon(p_lng numeric,p_lat numeric,p_polygon jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare part jsonb; hole jsonb; outer_hit integer; hole_hit integer; excluded boolean;
begin
  if p_polygon is null then return false; end if;
  for part in select value from jsonb_array_elements(
    case p_polygon->>'type' when 'Polygon' then jsonb_build_array(p_polygon->'coordinates')
      when 'MultiPolygon' then p_polygon->'coordinates' else '[]'::jsonb end)
  loop
    outer_hit:=quickflex_notes_private.point_in_ring(p_lng,p_lat,part->0);
    if outer_hit=2 then return true; end if;
    if outer_hit=1 then
      excluded:=false;
      for hole in select value from jsonb_array_elements(part) with ordinality as rings(value,n) where n>1 loop
        hole_hit:=quickflex_notes_private.point_in_ring(p_lng,p_lat,hole);
        if hole_hit=2 then return true; end if;
        if hole_hit=1 then excluded:=true; exit; end if;
      end loop;
      if not excluded then return true; end if;
    end if;
  end loop;
  return false;
end $$;
revoke all on function quickflex_notes_private.point_in_polygon(numeric,numeric,jsonb) from public,anon;
grant execute on function quickflex_notes_private.point_in_polygon(numeric,numeric,jsonb) to authenticated,service_role;

create or replace function quickflex_notes_private.validate_tip_point()
returns trigger language plpgsql security definer set search_path='' as $$
declare boundary jsonb;
begin
  if new.lat is null and new.lng is null then return new; end if;
  -- Legacy points remain editable as text even when a later boundary edit puts
  -- their unchanged coordinates outside the new polygon.
  if tg_op='UPDATE' and new.lat is not distinct from old.lat
      and new.lng is not distinct from old.lng and new.zone_id=old.zone_id then return new; end if;
  select polygon into boundary from public.quickflex_note_zones
    where company_id=new.company_id and id=new.zone_id for share;
  if not found or not quickflex_notes_private.point_in_polygon(new.lng::numeric,new.lat::numeric,boundary) then
    raise exception 'Route-note point must be inside its zone' using errcode='23514';
  end if;
  return new;
end $$;
revoke all on function quickflex_notes_private.validate_tip_point() from public,anon,authenticated;
drop trigger if exists quickflex_note_tip_point on public.quickflex_note_tips;
create trigger quickflex_note_tip_point before insert or update of lat,lng,zone_id
on public.quickflex_note_tips for each row execute function quickflex_notes_private.validate_tip_point();
