# Expense backend contract

`createExpenseService(db)` in `src/services/expenses.js` is the only browser-facing expense data API. `list({ from, to, includeDrafts, includeTrashed })` returns every matching owner row with `receipts` and `adjustments` arrays, pages past Supabase's 1,000-row default, and keeps date-less photo-only drafts in a filtered result when `includeDrafts` is true. UI code must not call the expense tables or Storage bucket directly.

`save(input)` accepts snake_case row-shaped fields: `id`, `actual_date`, `gross_amount`, `category`, `merchant`, `payment_method`, `evidence_type`, `memo`, `supply_amount`, `vat_amount`, `business_amount`, `usage_type`, `status`, and `request_id`. A draft may contain only a receipt photo. A confirmed row requires `actual_date` and a positive whole-won `gross_amount`. Reuse `request_id` when retrying the same save.

`addReceipt(expenseId, file)` accepts JPEG, PNG, WebP, HEIC, or PDF up to 10 MB. It computes a SHA-256 fingerprint, uploads to a randomized UUID-only private path, writes immutable metadata, and removes the new private object if metadata persistence fails. Original filenames are stored only in metadata. `receiptUrl(receipt)` creates a 60-second authenticated signed preview URL; it never returns a public URL.

`adjust(expenseId, { kind, amount, actual_date, memo, request_id })` stores either `refund` or `reimbursement`. Refunds are serialized against the original confirmed gross amount, so concurrent partial refunds cannot exceed it. Reimbursements remain separate adjustment rows and are not folded into expense cost fields.

`setStatus(id, 'trashed' | 'restore')` is a soft-delete flow. There is no client-accessible hard deletion of expenses, receipt metadata, or adjustments.

The `quickflex-expense-receipts` Storage bucket is private. RLS permits only the owning authenticated account, including for administrators. The member settings screen must use `quickflex_list_admin_members()` and `quickflex_update_admin_member(p_member_id, p_status, p_driver_type, p_fixed_routes)` instead of selecting all profiles or changing unrelated member fields.
