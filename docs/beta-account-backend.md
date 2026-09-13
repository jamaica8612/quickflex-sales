# Beta Account Backend Contract

## Profile state

`quickflex_profiles.beta_enabled` is a server-owned boolean with default `false`.
Beta-only client entry requires both `status = 'approved'` and `beta_enabled = true`.
The temporary, verified legacy test-account exception remains a client release
compatibility rule; this migration does not grant it to another account.

New Auth users are created as `role = 'driver'`, `status = 'pending'`, and
`beta_enabled = false`. The existing first-profile bootstrap remains the sole
exception for role and status: it creates exactly one approved administrator,
using an atomic private singleton claim even under concurrent signups, but still
leaves beta disabled. Direct profile inserts and deletes are not
available to browser roles. An owner may update ordinary profile preferences,
but cannot change their ID, email, role, status, beta flag, or creation time.
The existing `quickflex_ensure_profile(profile_email, profile_display_name,
profile_driver_type)` signature remains compatible, but its email argument is
not trusted: the stored identity email is read from `auth.users`.

Administrators continue to use the narrow member APIs instead of reading raw
profiles:

- `quickflex_list_admin_members()` returns `id`, `display_name`, `role`,
  `status`, `driver_type`, `fixed_routes`, `beta_enabled`, and
  `deletion_requested_at`.
- `quickflex_update_admin_member(p_member_id, p_status, p_driver_type,
  p_fixed_routes, p_beta_enabled)` may approve/block another member, change
  their driver settings, and enable or disable beta access. Every argument
  except `p_member_id` is optional. It cannot update the calling administrator.

## Account deletion request

`quickflex_request_account_deletion(p_expected_user_id default null)` is
available only to an authenticated profile and returns its
`deletion_requested_at` timestamp. Existing no-argument calls remain valid. A
provided expected ID must match `auth.uid()`, preventing an account switch
between client confirmation and the RPC. The function has no target-user
argument, so a caller can request deletion only for their own profile. Pending,
approved, and blocked profiles may call it. Repeated calls return the original
timestamp.

The request timestamp is terminal for the client flow: users cannot clear or
backdate it. The RPC deliberately does not change approval status, sign the user
out, delete the Supabase Auth user, or remove any saved work, logs, receipts, or
other application data. A separately verified administrator process must review
and complete actual account/data deletion.

## Applying the change

Apply only
`supabase/migrations/20260913114410_quickflex_beta_enrollment_and_deletion_request_security.sql`
to an existing project. Do not reapply the full canonical schema. Confirm the
first approved administrator exists before opening signup, then use the narrow
member RPC to enroll beta testers.

Deployment on 2026-09-13 applied this migration to the configured project as
server migration `20260913123542`. Existing 36 profiles and the sole approved
administrator were preserved; no account was bulk-enrolled. Live read-only
transaction checks verified own-profile RLS, disabled-by-default beta access,
non-administrator member-list denial, and mismatched-account deletion denial.
The checks rolled back without creating deletion requests or changing records.
