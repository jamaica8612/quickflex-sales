import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { after, afterEach, before, beforeEach } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20260921110850_company_route_notes.sql", import.meta.url), "utf8");
const importMigration = readFileSync(new URL("../supabase/migrations/20260921110900_route_note_import_provenance.sql", import.meta.url), "utf8");
const company = "a97aa223-25ba-461c-a5b3-a96b8bf5c604";
const otherCompany = "90000000-0000-4000-8000-000000000001";
const admin = "10000000-0000-4000-8000-000000000001";
const editor = "10000000-0000-4000-8000-000000000002";
const memberA = "10000000-0000-4000-8000-000000000003";
const memberB = "10000000-0000-4000-8000-000000000004";
const outsider = "10000000-0000-4000-8000-000000000005";
const pending = "10000000-0000-4000-8000-000000000006";
const blocked = "10000000-0000-4000-8000-000000000007";
const late = "10000000-0000-4000-8000-000000000008";
const zoneId = "20000000-0000-4000-8000-000000000001";
const tipA = "30000000-0000-4000-8000-000000000001";
const photoId = "40000000-0000-4000-8000-000000000001";
const importedZone = "20000000-0000-4000-8000-000000000002";
const importedTip = "30000000-0000-4000-8000-000000000010";
const importedZonePhoto = "40000000-0000-4000-8000-000000000010";
let db;

const square = JSON.stringify({ type: "Polygon", coordinates: [[[127, 37], [127.01, 37], [127.01, 37.01], [127, 37]]] });

async function as(userId, role = "authenticated") {
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [userId]);
}
async function rejected(operation) {
  await db.exec("savepoint expected_denied");
  try {
    await operation();
    assert.fail("Expected RLS denial");
  } catch (error) {
    assert.match(String(error?.code || error?.message), /42501|permission denied|row-level security|23503|23514|check constraint/i);
  } finally {
    await db.exec("rollback to savepoint expected_denied; release savepoint expected_denied");
  }
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role with bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create table public.quickflex_profiles(id uuid primary key references auth.users(id), display_name text not null default '기사', status text not null, role text not null default 'member');
    create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,metadata jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function public.quickflex_is_approved() returns boolean language sql security definer stable as $$
      select exists(select 1 from public.quickflex_profiles where id=auth.uid() and status='approved')
    $$;
    grant usage on schema auth,storage to authenticated;
    grant execute on function auth.uid() to authenticated;
    grant select on public.quickflex_profiles to authenticated;
    alter table public.quickflex_profiles enable row level security;
    create policy quickflex_profiles_own_read on public.quickflex_profiles for select to authenticated using(id=(select auth.uid()));
    grant select,insert,delete on storage.objects to authenticated;
    alter table storage.objects enable row level security;
  `);
  const users = [admin, editor, memberA, memberB, outsider, pending, blocked, late];
  for (const id of users) await db.query("insert into auth.users(id) values($1)", [id]);
  for (const id of [admin, editor, memberA, memberB, outsider]) {
    const displayName = id === memberA ? "민수 기사" : id === memberB ? "   " : "운영 기사";
    await db.query("insert into public.quickflex_profiles(id,display_name,status,role) values($1,$2,'approved',$3)", [id, displayName, id === admin ? "admin" : "member"]);
  }
  await db.query("insert into public.quickflex_profiles(id,status,role) values($1,'pending','member'),($2,'blocked','member'),($3,'pending','member')", [pending, blocked, late]);
  await db.exec(migration);
  await db.exec(importMigration);
  await db.exec(importMigration);
  await db.query("update public.quickflex_note_memberships set role='editor' where company_id=$1 and user_id=$2", [company, editor]);
  await db.query("insert into public.quickflex_note_companies(id,name) values($1,'다른 회사')", [otherCompany]);
  // Give the external approved account a single membership only, so both sides exercise company isolation.
  await db.query("delete from public.quickflex_note_memberships where user_id=$1", [outsider]);
  await db.query("insert into public.quickflex_note_memberships(company_id,user_id,role) values($1,$2,'member')", [otherCompany, outsider]);
  await db.query("insert into public.quickflex_note_zones(id,company_id,name,memo,polygon,created_by,updated_by) values($1,$2,'A구역','',$3::jsonb,$4,$4)", [zoneId, company, square, editor]);
  await db.query("insert into public.quickflex_note_tips(id,company_id,zone_id,title,marker_type,memo,lat,lng,created_by,updated_by) values($1,$2,$3,'공동현관','entrance','',37,127,$4,$4)", [tipA, company, zoneId, memberA]);
});
beforeEach(async () => { await db.exec("begin"); await as(admin); });
afterEach(async () => { await db.exec("rollback"); });
after(async () => { await db.close(); });

test("bootstrap and later approval changes create only approved company membership", async () => {
  await db.exec("reset role");
  assert.deepEqual((await db.query("select user_id,role from public.quickflex_note_memberships where company_id=$1 order by user_id", [company])).rows.map((row) => row.user_id), [admin, editor, memberA, memberB]);
  assert.equal((await db.query("select count(*)::int as count from public.quickflex_note_memberships where user_id in ($1,$2)", [pending, blocked])).rows[0].count, 0);
  await db.query("update public.quickflex_profiles set status='approved' where id=$1", [late]);
  assert.equal((await db.query("select role from public.quickflex_note_memberships where user_id=$1", [late])).rows[0].role, "member");
  await db.query("update public.quickflex_profiles set role='admin' where id=$1", [late]);
  assert.equal((await db.query("select role from public.quickflex_note_memberships where user_id=$1", [late])).rows[0].role, "admin");
  await as(memberA);
  assert.equal((await db.query("select * from public.quickflex_note_zones")).rows.length, 1);
  await db.exec("reset role");
  await db.query("update public.quickflex_profiles set status='blocked' where id=$1", [memberA]);
  await as(memberA);
  assert.equal((await db.query("select * from public.quickflex_note_zones")).rows.length, 0);
});

test("company scopes reads and writes while pending, blocked, and external accounts see nothing", async () => {
  await as(admin, "anon");
  await rejected(() => db.query("select * from public.quickflex_note_zones"));
  await as(admin);
  await rejected(() => db.query("insert into public.quickflex_note_companies(id,name) values($1,'권한없음')", ["90000000-0000-4000-8000-000000000099"]));
  await rejected(() => db.query("update public.quickflex_note_companies set name='권한없음' where id=$1", [company]));
  await rejected(() => db.query("insert into public.quickflex_note_memberships(company_id,user_id,role) values($1,$2,'admin')", [company, admin]));
  await rejected(() => db.query("update public.quickflex_note_memberships set role='admin' where company_id=$1 and user_id=$2", [company, admin]));
  await as(memberB);
  assert.equal((await db.query("select * from public.quickflex_note_zones")).rows.length, 1);
  await as(outsider);
  assert.equal((await db.query("select * from public.quickflex_note_zones")).rows.length, 0);
  await rejected(() => db.query("insert into public.quickflex_note_tips(company_id,zone_id,title,marker_type,memo,lat,lng,created_by,updated_by) values($1,$2,'x','entrance','',37,127,$3,$3)", [company, zoneId, outsider]));
  await as(pending); assert.equal((await db.query("select * from public.quickflex_note_zones")).rows.length, 0);
  await as(blocked); assert.equal((await db.query("select * from public.quickflex_note_zones")).rows.length, 0);
});

test("editor manages zones while every member authors only their own tips", async () => {
  await as(editor);
  assert.equal((await db.query("update public.quickflex_note_zones set memo='editor' where id=$1 and company_id=$2 returning id", [zoneId, company])).rows.length, 1);
  await as(memberA);
  assert.equal((await db.query("select display_name from public.quickflex_profiles where id=$1", [memberA])).rows[0].display_name, "민수 기사");
  assert.equal((await db.query("select * from public.quickflex_profiles where id=$1", [admin])).rows.length, 0);
  const ownTip = "30000000-0000-4000-8000-000000000002";
  await rejected(() => db.query("insert into public.quickflex_note_zones(company_id,name,memo,polygon,created_by,updated_by) values($1,'member zone','',null,$2,$2)", [company, memberA]));
  assert.equal((await db.query("update public.quickflex_note_zones set memo='member edit' where id=$1 returning id", [zoneId])).rows.length, 0);
  await db.query("insert into public.quickflex_note_tips(id,company_id,zone_id,title,marker_type,memo,lat,lng,created_by,updated_by,author_name) values($1,$2,$3,'내 메모','warning','',37,127,$4,$4,'위조 이름')", [ownTip, company, zoneId, memberA]);
  assert.equal((await db.query("select author_name from public.quickflex_note_tips where id=$1", [ownTip])).rows[0].author_name, "민수 기사");
  await rejected(() => db.query("update public.quickflex_note_tips set author_name='바꾼 이름' where id=$1", [ownTip]));
  const textOnlyTip = "30000000-0000-4000-8000-000000000003";
  await as(memberB);
  await db.query("insert into public.quickflex_note_tips(id,company_id,zone_id,title,marker_type,memo,created_by,updated_by) values($1,$2,$3,'자유 메모','note','위치 없이',$4,$4)", [textOnlyTip, company, zoneId, memberB]);
  assert.deepEqual((await db.query("select author_name,lat,lng from public.quickflex_note_tips where id=$1", [textOnlyTip])).rows[0], { author_name: "기사", lat: null, lng: null });
  await rejected(() => db.query("insert into public.quickflex_note_tips(company_id,zone_id,title,marker_type,memo,lat,created_by,updated_by) values($1,$2,'반쪽','note','',37,$3,$3)", [company, zoneId, memberB]));
  await as(memberB);
  assert.equal((await db.query("update public.quickflex_note_tips set memo='탈취' where id=$1 returning id", [ownTip])).rows.length, 0);
  assert.equal((await db.query("delete from public.quickflex_note_tips where id=$1 returning id", [ownTip])).rows.length, 0);
  await as(editor);
  assert.equal((await db.query("update public.quickflex_note_tips set memo='editor cannot edit member tip' where id=$1 returning id", [ownTip])).rows.length, 0);
  await as(admin);
  assert.equal((await db.query("select author_name from public.quickflex_note_tips where id=$1", [ownTip])).rows[0].author_name, "민수 기사");
  assert.equal((await db.query("update public.quickflex_note_tips set memo='관리자' where id=$1 returning id", [ownTip])).rows.length, 0);
  assert.equal((await db.query("delete from public.quickflex_note_tips where id=$1 returning id", [ownTip])).rows.length, 0);
});

test("favorites are private to the member, identity and ownership fields cannot change, and stale revisions affect zero rows", async () => {
  await as(memberA);
  await db.query("insert into public.quickflex_note_favorites(company_id,user_id,zone_id) values($1,$2,$3)", [company, memberA, zoneId]);
  await as(memberB);
  assert.equal((await db.query("select * from public.quickflex_note_favorites")).rows.length, 0);
  await as(editor);
  await rejected(() => db.query("update public.quickflex_note_zones set company_id=$1 where id=$2", [otherCompany, zoneId]));
  await as(memberA);
  await rejected(() => db.query("update public.quickflex_note_tips set created_by=$1 where id=$2", [memberB, tipA]));
  const revision = (await db.query("select updated_at from public.quickflex_note_tips where id=$1", [tipA])).rows[0].updated_at;
  assert.equal((await db.query("update public.quickflex_note_tips set memo='new' where id=$1 and updated_at=$2 returning id", [tipA, "2000-01-01T00:00:00Z"])).rows.length, 0);
  assert.equal((await db.query("update public.quickflex_note_tips set memo='new' where id=$1 and updated_at=$2 returning id", [tipA, revision])).rows.length, 1);
});

test("polygon validation rejects malformed coordinates and private photos allow only the author to write", async () => {
  await as(editor);
  const malformed = JSON.stringify({ type: "Polygon", coordinates: [[["NaN", 37], [127, 37], [127, 38], ["NaN", 37]]] });
  await rejected(() => db.query("insert into public.quickflex_note_zones(company_id,name,memo,polygon,created_by,updated_by) values($1,'bad','',$2::jsonb,$3,$3)", [company, malformed, editor]));
  const missingCoordinates = JSON.stringify({ type: "Polygon" });
  const nullCoordinates = JSON.stringify({ type: "MultiPolygon", coordinates: null });
  await rejected(() => db.query("insert into public.quickflex_note_zones(company_id,name,memo,polygon,created_by,updated_by) values($1,'missing','',$2::jsonb,$3,$3)", [company, missingCoordinates, editor]));
  await rejected(() => db.query("insert into public.quickflex_note_zones(company_id,name,memo,polygon,created_by,updated_by) values($1,'null','',$2::jsonb,$3,$3)", [company, nullCoordinates, editor]));
  await db.exec("reset role");
  const bucket = (await db.query("select public,file_size_limit,allowed_mime_types from storage.buckets where id='quickflex-route-notes-photos'"))?.rows[0];
  assert.equal(bucket.public, false);
  assert.equal(Number(bucket.file_size_limit), 5 * 1024 * 1024);
  assert.deepEqual(bucket.allowed_mime_types, ["image/jpeg", "image/png", "image/webp"]);
  const path = `${company}/${tipA}/${photoId}.jpg`;
  await as(memberA);
  await rejected(() => db.query("insert into storage.objects(id,bucket_id,name) values($1,'quickflex-route-notes-photos','not-a-route-note-photo.jpg')", ["40000000-0000-4000-8000-000000000002"]));
  await rejected(() => db.query("insert into storage.objects(id,bucket_id,name) values($1,'quickflex-route-notes-photos',$2)", ["40000000-0000-4000-8000-000000000003", `${otherCompany}/${tipA}/40000000-0000-4000-8000-000000000003.jpg`]));
  await db.query("insert into storage.objects(id,bucket_id,name) values($1,'quickflex-route-notes-photos',$2)", [photoId, path]);
  await db.query("insert into public.quickflex_note_photos(id,company_id,tip_id,path,created_by) values($1,$2,$3,$4,$5)", [photoId, company, tipA, path, memberA]);
  await rejected(() => db.query("delete from public.quickflex_note_tips where id=$1", [tipA]));
  await as(memberB);
  assert.equal((await db.query("select name from storage.objects where bucket_id='quickflex-route-notes-photos'")).rows.length, 1);
  assert.equal((await db.query("delete from storage.objects where bucket_id='quickflex-route-notes-photos' and name=$1 returning name", [path])).rows.length, 0);
  await as(outsider);
  assert.equal((await db.query("select * from storage.objects where bucket_id='quickflex-route-notes-photos'")).rows.length, 0);
  await as(admin);
  assert.equal((await db.query("delete from storage.objects where bucket_id='quickflex-route-notes-photos' and name=$1 returning name", [path])).rows.length, 0);
  assert.equal((await db.query("delete from public.quickflex_note_photos where id=$1 returning id", [photoId])).rows.length, 0);
  await as(memberA);
  assert.equal((await db.query("delete from public.quickflex_note_photos where id=$1 returning id", [photoId])).rows.length, 1);
  assert.equal((await db.query("delete from storage.objects where bucket_id='quickflex-route-notes-photos' and name=$1 returning name", [path])).rows.length, 1);
});

test("legacy import preserves provenance only for the import role and keeps raw records private", async () => {
  await as(memberA);
  const ownTip = "30000000-0000-4000-8000-000000000020";
  await rejected(() => db.query("insert into public.quickflex_note_tips(company_id,zone_id,title,marker_type,memo,created_by,updated_by,source_project,source_id) values($1,$2,'위조 이관','note','',$3,$3,'legacy',$4)", [company, zoneId, memberA, "50000000-0000-4000-8000-000000000020"]));
  await db.query("insert into public.quickflex_note_tips(id,company_id,zone_id,title,marker_type,memo,created_by,updated_by) values($1,$2,$3,'일반 메모','note','',$4,$4)", [ownTip, company, zoneId, memberA]);
  await rejected(() => db.query("update public.quickflex_note_tips set source_record=$1::jsonb where id=$2", [JSON.stringify({ original_photo_url: "https://legacy.invalid/hidden.png" }), ownTip]));

  await db.exec("set local role service_role");
  await db.query("insert into public.quickflex_note_zones(id,company_id,name,memo,color,polygon,created_by,updated_by,created_at,updated_at,source_project,source_id) values($1,$2,'이관 구역','원본',$3,null,null,null,$4,$4,'legacy-route-notes',$5)", [importedZone, company, "#d97706", "2024-01-02T03:04:05Z", "60000000-0000-4000-8000-000000000001"]);
  await db.query("insert into public.quickflex_note_tips(id,company_id,zone_id,title,marker_type,memo,created_by,updated_by,author_name,created_at,updated_at,tags,last_verified_at,source_project,source_id) values($1,$2,$3,'이관 팁','note','원본 메모',null,null,'원래 기사',$4,$4,array['legacy','verified'],$5,'legacy-route-notes',$6)", [importedTip, company, importedZone, "2024-01-02T03:04:05Z", "2024-02-03T04:05:06Z", "60000000-0000-4000-8000-000000000002"]);
  const zonePhotoPath = `zones/${company}/${importedZone}/${importedZonePhoto}.png`;
  await rejected(() => db.query("insert into public.quickflex_note_zone_photos(id,company_id,zone_id,path) values($1,$2,$3,$4)", ["40000000-0000-4000-8000-000000000011", company, importedZone, `zones/${otherCompany}/${importedZone}/40000000-0000-4000-8000-000000000011.png`]));
  await db.query("insert into storage.objects(id,bucket_id,name) values($1,'quickflex-route-note-zone-photos',$2)", [importedZonePhoto, zonePhotoPath]);
  await db.query("insert into public.quickflex_note_zone_photos(id,company_id,zone_id,path,created_by,created_at,source_project,source_id) values($1,$2,$3,$4,null,$5,'legacy-route-notes',$6)", [importedZonePhoto, company, importedZone, zonePhotoPath, "2024-01-02T03:04:05Z", "60000000-0000-4000-8000-000000000003"]);
  await db.query("insert into quickflex_notes_private.import_records(company_id,entity_type,entity_id,source_project,source_id,source_record) values($1,'zone_photo',$2,'legacy-route-notes',$3,$4::jsonb)", [company, importedZonePhoto, "60000000-0000-4000-8000-000000000003", JSON.stringify({ original_photo_url: "https://legacy.invalid/private.png" })]);
  const imported = (await db.query("select created_by,updated_by,author_name,tags,last_verified_at,source_record from public.quickflex_note_tips where id=$1", [importedTip])).rows[0];
  assert.deepEqual(imported, { created_by: null, updated_by: null, author_name: "원래 기사", tags: ["legacy", "verified"], last_verified_at: new Date("2024-02-03T04:05:06Z"), source_record: {} });
  assert.equal((await db.query("select color from public.quickflex_note_zones where id=$1", [importedZone])).rows[0].color, "#d97706");

  await as(memberB);
  assert.equal((await db.query("select * from public.quickflex_note_zone_photos where id=$1", [importedZonePhoto])).rows.length, 1);
  assert.equal((await db.query("select * from storage.objects where bucket_id='quickflex-route-note-zone-photos'")).rows.length, 1);
  await rejected(() => db.query("insert into public.quickflex_note_zone_photos(company_id,zone_id,path) values($1,$2,$3)", [company, importedZone, zonePhotoPath]));
  await rejected(() => db.query("select * from quickflex_notes_private.import_records"));
  await as(outsider);
  assert.equal((await db.query("select * from public.quickflex_note_zone_photos")).rows.length, 0);
  assert.equal((await db.query("select * from storage.objects where bucket_id='quickflex-route-note-zone-photos'")).rows.length, 0);
});

test("migration stays isolated from personal finance and sales tables", () => {
  for (const name of ["quickflex_day_records", "quickflex_expenses", "quickflex_expense_receipts", "quickflex_work_results"]) {
    assert.equal(migration.includes(name), false, name);
  }
});
