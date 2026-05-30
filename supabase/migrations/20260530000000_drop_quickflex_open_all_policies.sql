-- Drop the permissive `open_all` RLS policies that had been added directly to
-- the live database (drift: they were never in source control). Each granted
-- role `public` (anon + authenticated) `USING (true) WITH CHECK (true)` for ALL
-- commands, which — because permissive policies are OR'd — completely overrode
-- the per-user quickflex policies and exposed every driver's data to anyone
-- holding the public anon key. This shared Supabase project also hosts a recipe
-- app and an `rn_*` app, so the leak crossed app boundaries.
--
-- The intended own/admin policies already exist on these tables and take effect
-- once `open_all` is gone. quickflex_data keeps its dedicated anon own-row
-- policies for the single legacy app row (user_id = 'kim-gwanhyun').

drop policy if exists "open_all" on public.quickflex_route_rates;
drop policy if exists "open_all" on public.quickflex_day_records;
drop policy if exists "open_all" on public.quickflex_day_route_items;
drop policy if exists "open_all" on public.quickflex_data;
