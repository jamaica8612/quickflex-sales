create table if not exists public.quickflex_data (
  user_id text primary key,
  rates jsonb not null default '[]'::jsonb,
  entries jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.quickflex_data enable row level security;

drop policy if exists "quickflex read own app row" on public.quickflex_data;
drop policy if exists "quickflex insert own app row" on public.quickflex_data;
drop policy if exists "quickflex update own app row" on public.quickflex_data;

create policy "quickflex read own app row"
on public.quickflex_data
for select
to anon
using (user_id = 'kim-gwanhyun');

create policy "quickflex insert own app row"
on public.quickflex_data
for insert
to anon
with check (user_id = 'kim-gwanhyun');

create policy "quickflex update own app row"
on public.quickflex_data
for update
to anon
using (user_id = 'kim-gwanhyun')
with check (user_id = 'kim-gwanhyun');
