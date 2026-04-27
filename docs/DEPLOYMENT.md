# QuickFlex Deployment Guide

This guide is the first file to read before deployment, schema, Auth, OCR, or service-worker changes.

## Source Of Truth

- The canonical schema file is the repository-root `supabase-schema.sql`.
- `supabase/schema.sql` is intentionally only a pointer. Do not maintain two schema copies.
- The app is a static GitHub Pages/PWA app. Keep paths relative (`./...`) so it works under `https://jamaica8612.github.io/quickflex-sales/`.
- GitHub Pages already provides HTTPS, so no extra rewrite or proxy is required for the PWA.

## Supabase Auth

In Supabase Dashboard:

- Enable Email provider.
- Set Site URL to `https://jamaica8612.github.io/quickflex-sales/`.
- Add the same URL to Redirect URLs.
- For early operation, `Confirm email` can be OFF so the admin approval flow is the main gate. Turn it ON later if email verification is required.
- After the first admin is created, prefer closing public signup and inviting users from **Authentication > Users > Invite user**. If temporary signup is needed, turn it on briefly and turn it off again.

## First Admin And Migration Guard

The first profile inserted into `quickflex_profiles` becomes `role='admin'` and `status='approved'` through `quickflex_bootstrap_first_profile`.

If old single-user rows still use `user_id = 'kim-gwanhyun'`, migrate them only after an approved admin exists:

```sql
do $$
declare
  admin_id text;
begin
  select id::text
  into admin_id
  from public.quickflex_profiles
  where role = 'admin' and status = 'approved'
  order by created_at
  limit 1;

  if admin_id is null then
    raise exception 'Create and approve the first admin profile before migrating legacy data.';
  end if;

  update public.quickflex_route_rates
     set user_id = admin_id
   where user_id = 'kim-gwanhyun';

  update public.quickflex_day_records
     set user_id = admin_id
   where user_id = 'kim-gwanhyun';

  update public.quickflex_day_route_items
     set user_id = admin_id
   where user_id = 'kim-gwanhyun';
end $$;
```

This `do $$` block prevents accidental NULL writes when no admin exists.

## Approval Gate And RLS

- `quickflex_profiles` controls `role`, `status`, `driver_type`, and `fixed_routes`.
- `approved` is enforced in the client UI and in RLS helper `quickflex_is_approved()`.
- Normal users can read/write only their own route rates and daily records after approval.
- Admin users can read member profiles and user-by-user revenue data through RLS-backed queries.
- Pending users should see only the approval-waiting screen.

## Production DB Configuration

Production should not show the DB connection form to drivers.

- Put the public Supabase Project URL and anon public key in `src/main.js` / `src/config.js` public config before release.
- `anon public key` is safe to expose in a browser app. Security depends on Supabase Auth and RLS.
- Never put `service_role`, Gemini keys, or other server secrets in frontend files.
- The manual DB connection screen is development-only: `localhost`, `127.0.0.1`, `file:`, or empty local config.
- If deployed without public config, the app must show a deployment configuration error instead of a DB input form.

Supabase Auth stores a browser session token like `sb-<project-ref>-auth-token` in localStorage. On shared PCs, users should log out after use.

## OCR Edge Function

Recommended `supabase/config.toml`:

```toml
[functions.ocr-schedule]
verify_jwt = true
```

Keeping `verify_jwt = false` makes the OCR endpoint callable without login and can create cost/abuse risk. If unauthenticated OCR is temporarily kept, document the reason and expected lifetime.

Deploy OCR changes with:

```powershell
npx supabase functions deploy ocr-schedule
```

## Route Rates

- Use one current default unit price per Route in `quickflex_route_rates`.
- Do not use period-based rate history.
- Daily entries preserve the price used that day in `unit_snapshot`, so old revenue remains stable after changing the default route price.

## Service Worker And PWA

Every release that changes cached assets must bump `sw.js`:

```js
const CACHE_NAME = "quickflex-shell-v2";
```

Increase the `vN` number on each release (`v2`, `v3`, ...), and keep `SHELL_FILES` updated with new module files under `src/`.

## Release Checklist

- [ ] `supabase-schema.sql` reviewed and applied in Supabase SQL Editor if schema changed.
- [ ] Site URL and Redirect URLs point to `https://jamaica8612.github.io/quickflex-sales/`.
- [ ] First admin profile exists and is approved.
- [ ] Public Supabase URL and anon key are set for production.
- [ ] OCR has `verify_jwt = true` unless there is a documented exception.
- [ ] `sw.js` `CACHE_NAME` is bumped and `SHELL_FILES` includes changed assets.
- [ ] `node --check` passes for `app.js`, `sw.js`, and `src/**/*.js`.
- [ ] Login, signup, pending approval, approved user entry, and admin-only screens are tested.
