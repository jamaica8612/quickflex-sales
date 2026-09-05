import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260905095422_snapshot_daily_freshbag_mode.sql", import.meta.url), "utf8").trim();
const schema = readFileSync(new URL("../supabase-schema.sql", import.meta.url), "utf8").trim();

test("canonical schema ends with the daily fresh-bag mode migration", () => {
  assert.equal(schema.endsWith(migration), true);
});

test("daily mode is constrained and the authenticated atomic save snapshots it", () => {
  assert.match(migration, /freshbag_mode text/);
  assert.match(migration, /check \(freshbag_mode in \('single', 'dual'\)\)/);
  assert.match(migration, /p_freshbag_mode text/);
  assert.match(migration, /set freshbag_mode = p_freshbag_mode/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /revoke all on function[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function[\s\S]*to authenticated/);
});
