import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const schema=readFileSync(new URL('../supabase-schema.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const migration=readFileSync(new URL('../supabase/migrations/20260919083335_ocr_quota_and_expense_refund_guard.sql',import.meta.url),'utf8').replaceAll('\r\n','\n');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
function declaration(name,last=false){const search=`create or replace function public.${name}(`;const start=last?schema.lastIndexOf(search):schema.indexOf(search);return schema.slice(start,schema.indexOf('$$;',start)+3);}
function table(name){const start=schema.indexOf(`create table if not exists public.${name} (`);return schema.slice(start,schema.indexOf('\n);',start)+3);}
async function fixture(){
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated;create schema auth;create table auth.users(id uuid primary key);create table public.quickflex_profiles(id uuid primary key,status text);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;create function public.quickflex_is_approved() returns boolean language sql security definer stable as $$select exists(select 1 from public.quickflex_profiles where id=auth.uid() and status='approved')$$;insert into auth.users values('${owner}'),('${other}');insert into public.quickflex_profiles values('${owner}','approved'),('${other}','pending');
 create table public.quickflex_day_records(user_id text,work_date date,is_off boolean,fresh_count integer,fresh_unit integer,fresh_solo_count integer,fresh_linked_count integer,backup_unit integer,driver_type text,freshbag_mode text,updated_at timestamptz not null default clock_timestamp(),primary key(user_id,work_date));
 create table public.quickflex_day_route_items(user_id text,work_date date,route text,delivery_count integer,household_count integer,unit_snapshot integer,sort_order integer,updated_at timestamptz);
 create table public.quickflex_sales_work_results(user_id uuid,work_date date);
 grant all on public.quickflex_day_records,public.quickflex_day_route_items,public.quickflex_sales_work_results to authenticated;
 alter table public.quickflex_day_records enable row level security;
 create policy own_day on public.quickflex_day_records to authenticated using(user_id=auth.uid()::text) with check(user_id=auth.uid()::text);
 `);
 await db.exec(table('quickflex_expenses')+table('quickflex_expense_adjustments')+declaration('quickflex_add_expense_adjustment')+declaration('quickflex_replace_manual_day_record',true));
 // Load the actual 11-argument freshbag wrapper rather than a behavior stub.
 const overload=schema.indexOf('  p_freshbag_mode text\n)\nreturns boolean');
 const begin=schema.lastIndexOf('create or replace function public.quickflex_replace_manual_day_record(',overload);
 await db.exec(schema.slice(begin,schema.indexOf('$$;',overload)+3));
 await db.exec(migration);
 await db.exec(`set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`);
 return db;
}
test('atomic persistent OCR quota rejects unapproved access, isolates users and resets KST day',async()=>{
 const db=await fixture();try{
  assert.equal((await db.query('select public.quickflex_consume_ocr_quota(64) as ok')).rows[0].ok,true);
  await db.query('select public.quickflex_consume_ocr_quota(64)');await db.query('select public.quickflex_consume_ocr_quota(64)');
  const results=await Promise.all(Array.from({length:6},()=>db.query('select public.quickflex_consume_ocr_quota(16) as ok')));
  assert.equal(results.filter(r=>r.rows[0].ok).length,3);
  await assert.rejects(()=>db.query('update quickflex_private.ocr_limits set daily_units=9999'),{code:'42501'});
  await assert.rejects(()=>db.query('delete from quickflex_private.ocr_daily_usage'),{code:'42501'});
  await db.exec(`select set_config('request.jwt.claim.sub','${other}',false);`);
  await assert.rejects(()=>db.query('select public.quickflex_consume_ocr_quota(1)'),{code:'42501'});
  await db.exec(`reset role;update public.quickflex_profiles set status='approved' where id='${other}';set role authenticated;`);
  assert.equal((await db.query('select public.quickflex_consume_ocr_quota(1) as ok')).rows[0].ok,true);
  await db.exec(`reset role;update quickflex_private.ocr_daily_usage set usage_date=usage_date-1 where user_id='${owner}';set role authenticated;select set_config('request.jwt.claim.sub','${owner}',false);`);
  assert.equal((await db.query('select public.quickflex_consume_ocr_quota(1) as ok')).rows[0].ok,true);
  await assert.rejects(()=>db.query('select public.quickflex_consume_ocr_quota(0)'),{code:'22023'});
  await db.exec('reset role;set role anon;');await assert.rejects(()=>db.query('select public.quickflex_consume_ocr_quota(1)'),{code:'42501'});
 }finally{await db.close();}
});
test('actual expense RPC cannot reduce original below accumulated refunds with fresh or reused request ids',async()=>{
 const db=await fixture();try{
  const save=(id,amount,request,status='confirmed')=>db.query(`select public.quickflex_save_expense(p_id=>$1,p_actual_date=>'2026-09-19',p_gross_amount=>$2,p_status=>$3,p_request_id=>$4) as id`,[id,amount,status,request]);
  const id=(await save(null,100,'original-request')).rows[0].id;
  await db.query(`select public.quickflex_add_expense_adjustment($1,'refund',40,'2026-09-19','','refund-request')`,[id]);
  for(const request of ['original-request','new-edit-request']) await assert.rejects(()=>save(id,30,request),{code:'22023'});
  await assert.rejects(()=>save(id,null,'null-edit-request','draft'),{code:'22023'});
  await save(id,40,'valid-edit-request');await save(id,150,'higher-edit-request');
  await db.query(`select public.quickflex_add_expense_adjustment($1,'refund',110,'2026-09-19','','refund-request-2')`,[id]);
  await assert.rejects(()=>save(id,149,'too-low-request'),{code:'22023'});
 }finally{await db.close();}
});
test('actual checked manual RPC blocks stale create/edit/delete and preserves freshbag snapshot',async()=>{
 const db=await fixture();try{
  const save=(date,expected=null,remove=false)=>db.query(`select public.quickflex_replace_manual_day_record_checked($1,$2,false,2,100,1,1,30,'backup','[]','dual',$3) as day`,[date,remove,expected]);
  const first=(await save('2026-09-19')).rows[0].day;assert.equal(first.freshbag_mode,'dual');
  await assert.rejects(()=>save('2026-09-19'),{code:'40001'});
  const second=(await save('2026-09-19',first.updated_at)).rows[0].day;
  await assert.rejects(()=>save('2026-09-19',first.updated_at),{code:'40001'});
  await assert.rejects(()=>save('2026-09-19',first.updated_at,true),{code:'40001'});
  assert.equal((await save('2026-09-19',second.updated_at,true)).rows[0].day,null);
  await assert.rejects(()=>save('2026-09-19',second.updated_at),{code:'40001'});
  await db.exec(`select set_config('request.jwt.claim.sub','${other}',false);`);
  await assert.rejects(()=>save('2026-09-19'),{code:'42501'});
 }finally{await db.close();}
});

