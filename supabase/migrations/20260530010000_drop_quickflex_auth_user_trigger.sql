-- The Supabase project is shared by three apps (QuickFlex, a recipe app, and an
-- rn_* app) over one auth.users table, and each app had registered its own
-- AFTER INSERT trigger. As a result, every signup in the recipe or rn app also
-- auto-created a quickflex_profiles row that appeared in QuickFlex's
-- pending-approval admin list.
--
-- QuickFlex does not need an auth trigger: the client self-provisions a profile
-- on first QuickFlex login via the quickflex_ensure_profile RPC (see loadProfile
-- in src/main.js). Remove the QuickFlex trigger and its function so other apps'
-- signups stop leaking into QuickFlex. The recipe (handle_new_user) and rn
-- (rn_handle_new_user) triggers are intentionally left in place.
--
-- Note: a one-time data cleanup deleted the 24 already-leaked profiles
-- (status <> 'approved', non-admin, zero QuickFlex activity, all present in the
-- recipe app's profiles table). That delete is environment-specific and is not
-- replayed here.

drop trigger if exists quickflex_handle_new_auth_user_trigger on auth.users;
drop function if exists public.quickflex_handle_new_auth_user();
