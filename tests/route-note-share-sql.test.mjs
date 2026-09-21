import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const base = readFileSync(new URL("../supabase/migrations/20260921110850_company_route_notes.sql", import.meta.url), "utf8");
const imported = readFileSync(new URL("../supabase/migrations/20260921110900_route_note_import_provenance.sql", import.meta.url), "utf8");
const shares = readFileSync(new URL("../supabase/migrations/20260921114325_route_note_shares.sql", import.meta.url), "utf8");
const company = "a97aa223-25ba-461c-a5b3-a96b8bf5c604";
const owner = "10000000-0000-4000-8000-000000000001";
const member = "10000000-0000-4000-8000-000000000002";
const blocked = "10000000-0000-4000-8000-000000000003";
const zone = "20000000-0000-4000-8000-000000000001";
const otherZone = "20000000-0000-4000-8000-000000000002";
const outsideCompany = "90000000-0000-4000-8000-000000000001";
const outsideZone = "20000000-0000-4000-8000-000000000003";
const tip = "30000000-0000-4000-8000-000000000001";
const otherTip = "30000000-0000-4000-8000-000000000002";
const zonePhoto = "40000000-0000-4000-8000-000000000001";
let db;

async function as(userId, role = "authenticated") {
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
}
async function rejected(operation) {
  await db.exec("savepoint expected_failure");
  try { await operation(); assert.fail("Expected operation to be denied"); }
  catch (error) { assert.match(String(error?.code || error?.message), /42501|permission denied|22023/i); }
  finally { await db.exec("rollback to savepoint expected_failure; release savepoint expected_failure"); }
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role with bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create table auth.users(id uuid primary key);
    create table public.quickflex_profiles(id uuid primary key references auth.users(id),display_name text not null default '기사',status text not null,role text not null default 'member');
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,metadata jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function extensions.gen_random_bytes(p_size integer) returns bytea language sql volatile as $$select decode(substring(md5(random()::text)||md5(random()::text) from 1 for p_size*2),'hex')$$;
    create function extensions.digest(p_value text,p_algorithm text) returns bytea language sql immutable as $$select decode(md5(p_value)||md5(p_value),'hex')$$;
    create function public.quickflex_is_approved() returns boolean language sql security definer stable as $$select exists(select 1 from public.quickflex_profiles where id=auth.uid() and status='approved')$$;
    grant usage on schema auth,storage,extensions to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant select on public.quickflex_profiles to authenticated;
    alter table public.quickflex_profiles enable row level security;
    create policy profiles_own_read on public.quickflex_profiles for select to authenticated using(id=(select auth.uid()));
    grant select,insert,delete on storage.objects to authenticated;
    alter table storage.objects enable row level security;
  `);
  for (const id of [owner, member, blocked]) await db.query("insert into auth.users(id) values($1)", [id]);
  await db.query("insert into public.quickflex_profiles(id,display_name,status,role) values($1,'작성자','approved','admin'),($2,'회사 기사','approved','member'),($3,'중지 기사','blocked','member')", [owner, member, blocked]);
  await db.exec(base);
  await db.exec(imported);
  await db.exec(shares);
  await db.query("insert into public.quickflex_note_zones(id,company_id,name,memo,created_by,updated_by) values($1,$2,'공유 구역','공유 메모',$3,$3)", [zone, company, owner]);
  await db.query("insert into public.quickflex_note_zones(id,company_id,name,memo,created_by,updated_by) values($1,$2,'다른 구역','비공개',$3,$3)", [otherZone, company, owner]);
  await db.query("insert into public.quickflex_note_companies(id,name) values($1,'외부 회사')", [outsideCompany]);
  await db.query("insert into public.quickflex_note_zones(id,company_id,name,memo,created_by,updated_by) values($1,$2,'외부 구역','',$3,$3)", [outsideZone, outsideCompany, owner]);
  await db.query("insert into public.quickflex_note_tips(id,company_id,zone_id,title,marker_type,memo,created_by,updated_by,author_name) values($1,$2,$3,'공유 팁','note','', $4,$4,'작성자')", [tip, company, zone, owner]);
  await db.query("insert into public.quickflex_note_tips(id,company_id,zone_id,title,marker_type,memo,created_by,updated_by,author_name) values($1,$2,$3,'다른 팁','note','비공개', $4,$4,'작성자')", [otherTip, company, otherZone, owner]);
  await db.query("insert into public.quickflex_note_zone_photos(id,company_id,zone_id,path) values($1,$2,$3,$4)", [zonePhoto, company, zone, `zones/${company}/${zone}/${zonePhoto}.png`]);
});
beforeEach(async () => { await db.exec("begin"); await as(owner); });
afterEach(async () => { await db.exec("rollback"); });
after(async () => { await db.close(); });

test("approved member creates a zone-scoped token once and only sees their own share rows", async () => {
  const created = (await db.query("select * from public.quickflex_create_route_note_share($1,7)", [zone])).rows[0];
  assert.match(created.token, /^[0-9a-f]{64}$/);
  assert.equal((await db.query("select token_hash from public.quickflex_route_note_shares where id=$1", [created.id])).rows.length, 1);
  assert.equal((await db.query("select * from public.quickflex_list_route_note_shares()")).rows.length, 1);
  await rejected(() => db.query("insert into public.quickflex_route_note_shares(company_id,zone_id,created_by,token_hash,expires_at) values($1,$2,$3,$4,clock_timestamp()+interval '1 day')", [company, zone, owner, "b".repeat(64)]));
  await as(member);
  assert.equal((await db.query("select * from public.quickflex_list_route_note_shares()")).rows.length, 0);
  await rejected(() => db.query("select * from public.quickflex_update_route_note_share($1,7,false)", [created.id]));
  await as(owner);
  await rejected(() => db.query("select * from public.quickflex_create_route_note_share($1,7)", [outsideZone]));
});

test("anonymous getter exposes one zone snapshot without internal ownership or provenance", async () => {
  await as(owner);
  const created = (await db.query("select * from public.quickflex_create_route_note_share($1,7)", [zone])).rows[0];
  await as("", "anon");
  const snapshot = (await db.query("select public.quickflex_get_shared_route($1) as data", [created.token])).rows[0].data;
  assert.equal(snapshot.zone.id, zone);
  assert.equal(snapshot.tips.length, 1);
  assert.equal(snapshot.tips[0].author_name, "작성자");
  assert.equal(snapshot.zone_photos.length, 1);
  assert.equal(JSON.stringify(snapshot).includes(otherZone), false);
  assert.equal(JSON.stringify(snapshot).includes(otherTip), false);
  assert.equal(JSON.stringify(snapshot).includes("created_by"), false);
  assert.equal(JSON.stringify(snapshot).includes("source_record"), false);
  assert.equal((await db.query("select public.quickflex_get_shared_route($1) as data", ["b".repeat(64)])).rows[0].data, null);
});

test("expiry, revocation, creator approval, and membership loss revoke anonymous access", async () => {
  const created = (await db.query("select * from public.quickflex_create_route_note_share($1,1)", [zone])).rows[0];
  await as("", "anon");
  assert.ok((await db.query("select public.quickflex_get_shared_route($1) as data", [created.token])).rows[0].data);
  await db.exec("reset role");
  await db.query("update public.quickflex_route_note_shares set created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 second' where id=$1", [created.id]);
  await as("", "anon");
  assert.equal((await db.query("select public.quickflex_get_shared_route($1) as data", [created.token])).rows[0].data, null);

  await db.exec("reset role");
  await db.query("update public.quickflex_route_note_shares set expires_at=clock_timestamp()+interval '1 day' where id=$1", [created.id]);
  await as(owner);
  assert.equal((await db.query("select * from public.quickflex_update_route_note_share($1,null,true)", [created.id])).rows[0].revoked_at instanceof Date, true);
  await as("", "anon");
  assert.equal((await db.query("select public.quickflex_get_shared_route($1) as data", [created.token])).rows[0].data, null);

  await db.exec("reset role");
  await db.query("update public.quickflex_route_note_shares set revoked_at=null where id=$1", [created.id]);
  await db.query("update public.quickflex_profiles set status='blocked' where id=$1", [owner]);
  await as("", "anon");
  assert.equal((await db.query("select public.quickflex_get_shared_route($1) as data", [created.token])).rows[0].data, null);
  await db.exec("reset role");
  await db.query("update public.quickflex_profiles set status='approved' where id=$1", [owner]);
  await db.query("delete from public.quickflex_note_memberships where company_id=$1 and user_id=$2", [company, owner]);
  await as(owner, "anon");
  assert.equal((await db.query("select public.quickflex_get_shared_route($1) as data", [created.token])).rows[0].data, null);
});
