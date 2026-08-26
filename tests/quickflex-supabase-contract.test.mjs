import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../supabase-schema.sql", import.meta.url), "utf8");
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260825221659_quickflex_receipt_details_and_sales_overrides.sql",
    import.meta.url,
  ),
  "utf8",
);

function sqlFunction(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(`create or replace function public\\.${escaped}\\([\\s\\S]*?\\n\\$\\$;`),
  );
  assert.ok(match, `${name} must exist`);
  return match[0];
}

function sqlTable(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(
    new RegExp(`create table if not exists public\\.${escaped} \\([\\s\\S]*?\\n\\);`),
  );
  assert.ok(match, `${name} must exist`);
  return match[0];
}

const canonicalFinalize = sqlFunction(schema, "quickflex_finalize_work_result");
const migrationFinalize = sqlFunction(migration, "quickflex_finalize_work_result");
const canonicalOverride = sqlFunction(schema, "quickflex_replace_automatic_sales_override");
const migrationOverride = sqlFunction(migration, "quickflex_replace_automatic_sales_override");

test("canonical schema and generated migration keep identical RPC bodies", () => {
  assert.equal(canonicalFinalize, migrationFinalize);
  assert.equal(canonicalOverride, migrationOverride);
  for (const table of [
    "quickflex_work_result_route_details",
    "quickflex_automatic_sales_overrides",
  ]) {
    assert.equal(sqlTable(schema, table), sqlTable(migration, table));
  }
});

test("finalize keeps its old signature and stores households without using them as sales identity", () => {
  assert.match(
    canonicalFinalize,
    /quickflex_finalize_work_result\(\s*p_expected_device_id text,\s*p_expected_work_id text,\s*p_finish_date date,\s*p_work_shift text,\s*p_total_households integer,\s*p_total_items integer,\s*p_routes jsonb/s,
  );
  assert.match(canonicalFinalize, /'total_households', p_total_households/);
  assert.match(canonicalFinalize, /p_total_households,\s*p_total_items,\s*canonical_payload/s);
  assert.doesNotMatch(canonicalFinalize, /route_household_sum/);
  assert.doesNotMatch(canonicalFinalize, /existing_result\.canonical_payload = canonical_payload/);
  assert.doesNotMatch(canonicalFinalize, /sum\(household_count\).*p_total_households/s);
  assert.match(
    canonicalFinalize,
    /canonical_identity_payload := jsonb_build_object\(\s*'work_date', p_finish_date,\s*'work_shift', p_work_shift,\s*'total_items', p_total_items,\s*'routes', canonical_identity_routes/s,
  );
  assert.match(canonicalFinalize, /entry\.value - 'household_count'/);
});

test("optional detailed routes are validated and inserted in the receipt transaction", () => {
  assert.match(
    schema,
    /create table if not exists public\.quickflex_work_result_route_details[\s\S]*?base_route text not null[\s\S]*?detail_route text not null[\s\S]*?left\(detail_route, 4\) = base_route[\s\S]*?references public\.quickflex_work_result_routes\(user_id, work_id, route\)/,
  );
  assert.match(canonicalFinalize, /entry\.value \? 'detail_counts'/);
  for (const field of ["delivery_count", "household_count", "unit_snapshot", "sort_order"]) {
    assert.match(
      canonicalFinalize,
      new RegExp(`entry\\.value ->> '${field}'\\)::numeric > 2147483647`),
      `${field} must be range-checked before its integer cast`,
    );
  }
  assert.match(canonicalFinalize, /detail\.key !~ '\^\[0-9\]\{3\}\[A-Z\]\[0-9\]\{2\}\$'/);
  assert.match(canonicalFinalize, /left\(detail\.key, 4\) <> upper\(trim\(entry\.value ->> 'route'\)\)/);
  assert.match(canonicalFinalize, /totals\.detail_sum > \(entry\.value ->> 'delivery_count'\)::bigint/);
  assert.match(canonicalFinalize, /insert into public\.quickflex_work_result_route_details/);
  assert.ok(
    canonicalFinalize.indexOf("insert into public.quickflex_work_result_route_details")
      < canonicalFinalize.indexOf("update public.quickflex_active_work_leases"),
    "detail rows must be written before the lease is released in the same RPC transaction",
  );
});

test("new exposed tables are read-only through Data API and select is owner-or-admin", () => {
  for (const table of [
    "quickflex_work_result_route_details",
    "quickflex_automatic_sales_overrides",
  ]) {
    assert.match(schema, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(schema, new RegExp(`revoke all on table public\\.${table} from authenticated`));
    assert.match(schema, new RegExp(`grant select on table public\\.${table} to authenticated`));
  }
  assert.match(
    schema,
    /create policy "quickflex work result route details select own or admin"[\s\S]*?user_id = \(select auth\.uid\(\)\)[\s\S]*?public\.quickflex_is_admin\(\)/,
  );
  assert.match(
    schema,
    /create policy "quickflex automatic sales overrides select own or admin"[\s\S]*?user_id = \(select auth\.uid\(\)\)[\s\S]*?public\.quickflex_is_admin\(\)/,
  );
});

test("override RPC is owner-only, full-snapshot, server-totalled, revisioned, and idempotent", () => {
  assert.match(canonicalOverride, /security definer\s*set search_path = ''/);
  assert.match(canonicalOverride, /current_user_id uuid := \(select auth\.uid\(\)\)/);
  assert.match(canonicalOverride, /approved account required/);
  assert.match(canonicalOverride, /jsonb_array_length\(p_routes\) not between 1 and 100/);
  assert.match(canonicalOverride, /parsed_route_count <> distinct_route_count/);
  assert.match(canonicalOverride, /route_delivery_sum::integer/);
  assert.match(canonicalOverride, /existing_override\.request_id = normalized_request_id/);
  assert.match(canonicalOverride, /existing_override\.revision <> p_expected_revision/);
  assert.match(canonicalOverride, /'already_applied'::text/);
  assert.doesNotMatch(canonicalOverride, /household_count/);
  assert.doesNotMatch(canonicalOverride, /update public\.quickflex_work_results/);
  assert.doesNotMatch(canonicalOverride, /update public\.quickflex_work_result_routes/);
  assert.match(
    schema,
    /consumers replace original receipt rows instead of adding both/,
  );
});

test("RPC execute privileges are authenticated-only", () => {
  assert.match(
    schema,
    /revoke execute on function public\.quickflex_replace_automatic_sales_override\(date, bigint, text, text, jsonb\) from public, anon, authenticated/,
  );
  assert.match(
    schema,
    /grant execute on function public\.quickflex_replace_automatic_sales_override\(date, bigint, text, text, jsonb\) to authenticated/,
  );
});
