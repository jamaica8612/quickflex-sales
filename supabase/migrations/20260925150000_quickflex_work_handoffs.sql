-- 같은 근무를 다른 폰에서 이어 할 때 넘기는 업무 수량 (Android Beta 1.27).
-- 강제 종료가 폰의 구역별 수량을 지워서, 새 폰은 앞선 배송의 구역을 알 수 없었다.
-- 원문 송장·주소는 없고 구역 코드별 수량과 프레시백 일련번호 해시만 저장한다.
begin;

create table if not exists public.quickflex_work_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  work_date date not null,
  work_shift text not null check (work_shift in ('day', 'night')),
  source_work_id text not null check (char_length(source_work_id) between 8 and 128),
  source_device_id text not null check (char_length(source_device_id) between 8 and 128),
  routes text[] not null default '{}',
  items_by_route jsonb not null default '{}'::jsonb check (jsonb_typeof(items_by_route) = 'object'),
  items_by_detailed_route jsonb not null default '{}'::jsonb check (jsonb_typeof(items_by_detailed_route) = 'object'),
  completed_items integer not null check (completed_items between 0 and 9999),
  completed_households integer not null check (completed_households between 0 and 9999),
  unassigned_items integer not null default 0 check (unassigned_items between 0 and 9999),
  fresh_bag_serials text[] not null default '{}' check (cardinality(fresh_bag_serials) <= 2000),
  return_item_count integer not null default 0 check (return_item_count between 0 and 9999),
  cancellation_item_count integer not null default 0 check (cancellation_item_count between 0 and 9999),
  observed_completed_items integer check (observed_completed_items between 0 and 99999),
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  consumed_by_work_id text check (consumed_by_work_id is null or char_length(consumed_by_work_id) between 8 and 128),
  unique (user_id, source_work_id)
);

create index if not exists quickflex_work_handoffs_open_idx
  on public.quickflex_work_handoffs (user_id, work_date, work_shift, created_at desc)
  where consumed_at is null;

alter table public.quickflex_work_handoffs enable row level security;

drop policy if exists "own handoffs are readable" on public.quickflex_work_handoffs;
create policy "own handoffs are readable" on public.quickflex_work_handoffs
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

drop policy if exists "own handoffs are insertable" on public.quickflex_work_handoffs;
create policy "own handoffs are insertable" on public.quickflex_work_handoffs
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

drop policy if exists "own handoffs are updatable" on public.quickflex_work_handoffs;
create policy "own handoffs are updatable" on public.quickflex_work_handoffs
  for update to authenticated
  using (user_id = (select auth.uid()) and (select public.quickflex_is_approved()))
  with check (user_id = (select auth.uid()) and (select public.quickflex_is_approved()));

revoke all on public.quickflex_work_handoffs from anon;
grant select, insert, update on public.quickflex_work_handoffs to authenticated;

commit;
