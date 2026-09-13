create index if not exists quickflex_expense_receipts_expense_id_idx
  on public.quickflex_expense_receipts (expense_id);

create index if not exists quickflex_expense_adjustments_expense_id_idx
  on public.quickflex_expense_adjustments (expense_id);

create index if not exists quickflex_calendar_oauth_states_user_id_idx
  on public.quickflex_calendar_oauth_states (user_id);

create index if not exists quickflex_calendar_sync_jobs_user_id_idx
  on public.quickflex_calendar_sync_jobs (user_id);

revoke all on sequence public.quickflex_calendar_oauth_states_id_seq,
  public.quickflex_calendar_sync_jobs_id_seq from public, anon, authenticated;
grant usage, select on sequence public.quickflex_calendar_oauth_states_id_seq,
  public.quickflex_calendar_sync_jobs_id_seq to service_role;
