import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import test from "node:test";
import * as browser from "../src/lib/work-date.js";
import * as server from "../supabase/functions/noah/work-date.js";

const browserUrl = new URL("../src/lib/work-date.js", import.meta.url);
const serverUrl = new URL("../supabase/functions/noah/work-date.js", import.meta.url);
const on = (iso, workShift = "night", dayState = {}) => ({ now: new Date(iso), workShift, dayState });
const expected = (nextWorkDate, previousWorkDate, reason) => ({ nextWorkDate, previousWorkDate, activeWorkDate: nextWorkDate, reason });

const matrix = [
  // a: a validated ongoing date outranks completion, off and schedule evidence.
  ["active takes precedence", on("2026-09-24T02:30:00Z", "night", {
    activeWorkDate: "2026-09-24", hasAutomaticCompletion: true, isOff: true, hasSchedule: false,
  }), expected("2026-09-24", "2026-09-23", "active")],
  // b: completion advances night work to tomorrow even if a schedule remains.
  ["completed advances", on("2026-09-24T00:30:00Z", "night", {
    hasAutomaticCompletion: true, hasSchedule: true,
  }), expected("2026-09-25", "2026-09-24", "completed")],
  // c: an explicit off day or a known empty schedule advances night work.
  ["off advances", on("2026-09-24T00:30:00Z", "night", { isOff: true, hasSchedule: true }),
    expected("2026-09-25", "2026-09-24", "off")],
  ["known empty advances", on("2026-09-24T00:30:00Z", "night", {
    hasSchedule: false, hasAutomaticCompletion: false,
  }), expected("2026-09-25", "2026-09-24", "empty")],
  ["known empty with a saved record still advances", on("2026-09-24T00:30:00Z", "night", {
    hasSchedule: false, hasRecord: true, hasAutomaticCompletion: false,
  }), expected("2026-09-25", "2026-09-24", "empty")],
  // d: a known scheduled, incomplete night remains today after the noon clock boundary.
  ["scheduled incomplete stays today", on("2026-09-24T04:00:00Z", "night", {
    hasSchedule: true, hasAutomaticCompletion: false,
  }), expected("2026-09-24", "2026-09-23", "scheduled")],
  // e: only unavailable evidence falls back to the Korean noon clock.
  ["unavailable before noon", on("2026-09-24T02:59:59Z"), expected("2026-09-24", "2026-09-23", "clock")],
  ["unavailable at noon", on("2026-09-24T03:00:00Z"), expected("2026-09-25", "2026-09-24", "clock")],
  ["null is unavailable", on("2026-09-24T02:30:00Z", "night", {
    hasSchedule: null, hasAutomaticCompletion: null,
  }), expected("2026-09-24", "2026-09-23", "clock")],
  ["false schedule with unknown completion is unavailable", on("2026-09-24T02:30:00Z", "night", {
    hasSchedule: false,
  }), expected("2026-09-24", "2026-09-23", "clock")],
  ["record alone does not prove an ongoing shift", on("2026-09-24T02:30:00Z", "night", {
    hasRecord: true,
  }), expected("2026-09-24", "2026-09-23", "clock")],
  ["invalid active date does not override schedule", on("2026-09-24T04:00:00Z", "night", {
    activeWorkDate: "2026-02-30", hasSchedule: true, hasAutomaticCompletion: false,
  }), expected("2026-09-24", "2026-09-23", "scheduled")],
  ["day shift ignores night evidence", on("2026-09-24T15:00:00Z", "day", {
    activeWorkDate: "2026-09-23", hasAutomaticCompletion: true, isOff: true, hasSchedule: false,
  }), expected("2026-09-25", "2026-09-25", "day")],
  ["KST midnight rollover", on("2026-09-23T15:00:00Z"), expected("2026-09-24", "2026-09-23", "clock")],
  ["month end", on("2026-09-30T03:00:00Z"), expected("2026-10-01", "2026-09-30", "clock")],
  ["year end", on("2026-12-31T03:00:00Z"), expected("2027-01-01", "2026-12-31", "clock")],
  ["leap day", on("2028-02-28T03:00:00Z"), expected("2028-02-29", "2028-02-28", "clock")],
  ["leap day rollover", on("2028-02-29T03:00:00Z"), expected("2028-03-01", "2028-02-29", "clock")],
];

test("browser and Noah work-date modules remain byte-identical", () => {
  assert.deepEqual(readFileSync(browserUrl), readFileSync(serverUrl));
});

test("both modules resolve the same Korean civil dates and evidence precedence", () => {
  for (const [name, input, want] of matrix) {
    assert.deepEqual(browser.resolveWorkDates(input), want, `browser: ${name}`);
    assert.deepEqual(server.resolveWorkDates(input), want, `server: ${name}`);
    assert.equal(browser.koreanDateKey(input.now), server.koreanDateKey(input.now), name);
  }
  for (const [iso, date] of [
    ["2026-09-23T14:59:59Z", "2026-09-23"],
    ["2026-09-23T15:00:00Z", "2026-09-24"],
    ["2026-12-31T15:00:00Z", "2027-01-01"],
    ["2028-02-28T15:00:00Z", "2028-02-29"],
  ]) assert.equal(browser.koreanDateKey(new Date(iso)), date, iso);
});

test("legacy measurement helper retains caller-local noon and calendar semantics", () => {
  for (const implementation of [browser, server]) {
    for (const [hour, minute, want] of [[0, 0, "2026-09-30"], [11, 59, "2026-09-30"], [12, 0, "2026-10-01"]]) {
      const local = new Date(2026, 8, 30, hour, minute);
      assert.equal(implementation.measurementWorkDateForClock(local, "night"), want);
      assert.equal(implementation.measurementWorkDateForClock(local, "day"), "2026-09-30");
    }
    assert.equal(implementation.measurementWorkDateForClock(new Date(2026, 11, 31, 12), "night"), "2027-01-01");
    assert.equal(implementation.measurementWorkDateForClock(new Date(2028, 1, 29, 12), "night"), "2028-03-01");
  }
});

test("Korean work-date resolution is independent of process timezone", () => {
  const cases = matrix.map(([name, input]) => [name, { ...input, now: input.now.toISOString() }]);
  const script = `
    const browser = await import(${JSON.stringify(pathToFileURL(fileURLToPath(browserUrl)).href)});
    const server = await import(${JSON.stringify(pathToFileURL(fileURLToPath(serverUrl)).href)});
    const cases = ${JSON.stringify(cases)};
    const result = cases.map(([name, input]) => [name,
      browser.resolveWorkDates({ ...input, now: new Date(input.now) }),
      server.resolveWorkDates({ ...input, now: new Date(input.now) }),
      browser.koreanDateKey(new Date(input.now)),
      server.koreanDateKey(new Date(input.now))]);
    process.stdout.write(JSON.stringify(result));
  `;
  const expectedOutput = cases.map(([name, input]) => [name,
    browser.resolveWorkDates({ ...input, now: new Date(input.now) }),
    server.resolveWorkDates({ ...input, now: new Date(input.now) }),
    browser.koreanDateKey(new Date(input.now)), server.koreanDateKey(new Date(input.now))]);
  for (const tz of ["UTC", "Asia/Seoul", "America/Los_Angeles"]) {
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8", env: { ...process.env, TZ: tz }, timeout: 10_000,
    });
    assert.equal(run.status, 0, `${tz}: ${run.stderr}`);
    assert.deepEqual(JSON.parse(run.stdout), expectedOutput, tz);
  }
});
