-- 퀵플렉스 매출관리 스키마
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run

-- ─────────────────────────────────────────────
-- 1) Route별 단가 (현재 단가만 보관)
-- ─────────────────────────────────────────────
create table if not exists public.quickflex_route_rates (
  user_id      text        not null,
  route        text        not null,
  current_unit integer     not null,
  updated_at   timestamptz not null default now(),
  primary key (user_id, route)
);

-- ─────────────────────────────────────────────
-- 2) 일별 기록 (휴무·프레시백·백업단가)
-- ─────────────────────────────────────────────
create table if not exists public.quickflex_day_records (
  user_id      text        not null,
  work_date    date        not null,
  is_off       boolean     not null default false,
  fresh_count  integer     not null default 0,
  fresh_unit   integer     not null default 100,
  backup_unit  integer     not null default 30,
  updated_at   timestamptz not null default now(),
  primary key (user_id, work_date)
);

-- 기존 테이블이 있다면 backup_unit 컬럼만 보강
alter table public.quickflex_day_records
  add column if not exists backup_unit integer not null default 30;

-- ─────────────────────────────────────────────
-- 3) 일별 Route 항목 (날짜별 여러 Route)
-- ─────────────────────────────────────────────
create table if not exists public.quickflex_day_route_items (
  id              bigserial   primary key,
  user_id         text        not null,
  work_date       date        not null,
  route           text        not null,
  delivery_count  integer     not null default 0,
  unit_snapshot   integer     not null default 0,
  sort_order      integer     not null default 0,
  updated_at      timestamptz not null default now()
);

create index if not exists quickflex_day_route_items_user_date_idx
  on public.quickflex_day_route_items (user_id, work_date, sort_order);

-- ─────────────────────────────────────────────
-- 4) 레거시 blob (예전 단일 row 백업) — 마이그레이션 대상이라 비워둬도 됨
-- ─────────────────────────────────────────────
create table if not exists public.quickflex_data (
  user_id    text        primary key,
  rates      jsonb,
  entries    jsonb,
  updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────
-- 5) RLS — anon key로도 읽고 쓸 수 있게 정책 오픈
--    (개인용 단일 사용자 앱이고 user_id를 코드에 박아 쓰므로 OK)
-- ─────────────────────────────────────────────
alter table public.quickflex_route_rates     enable row level security;
alter table public.quickflex_day_records     enable row level security;
alter table public.quickflex_day_route_items enable row level security;
alter table public.quickflex_data            enable row level security;

drop policy if exists "open_all" on public.quickflex_route_rates;
drop policy if exists "open_all" on public.quickflex_day_records;
drop policy if exists "open_all" on public.quickflex_day_route_items;
drop policy if exists "open_all" on public.quickflex_data;

create policy "open_all" on public.quickflex_route_rates
  for all using (true) with check (true);
create policy "open_all" on public.quickflex_day_records
  for all using (true) with check (true);
create policy "open_all" on public.quickflex_day_route_items
  for all using (true) with check (true);
create policy "open_all" on public.quickflex_data
  for all using (true) with check (true);
