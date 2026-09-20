import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as routes from '../src/lib/route.js';
import { toDateKey } from '../src/lib/date.js';

const source = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function load(names, extra = {}) {
  const declarations = names.map((name) => {
    const start = source.search(new RegExp('(?:async )?function ' + name + '\\('));
    assert.ok(start >= 0, name);
    const end = source.slice(start + 1).search(/\n(?:async )?function /);
    return source.slice(start, end < 0 ? undefined : start + 1 + end);
  }).join('\n');
  const context = vm.createContext({ ...routes, toNum: (n) => Number(n) || 0, ...extra });
  vm.runInContext(declarations, context);
  return context;
}
function rowHarness() {
  return load(['mergeGroupedRows', 'buildGroupedRows', 'mergeScheduleRowsWithExisting'], {
    isAutomaticRow: (row) => row.source === 'automatic',
    sharedRateForRoutes: () => 1000, rateFor: () => 1000,
  });
}

test('schedule reimport preserves entered routes, snapshots and explicit zero without duplication', () => {
  const c = rowHarness();
  const prior = [
    { route: '425C', count: '150', households: '99', unit: 1200 },
    { route: '425D', count: '0', unit: 1150 },
  ];
  const result = c.mergeScheduleRowsWithExisting(prior, ['425B']);
  assert.deepEqual(JSON.parse(JSON.stringify(result.slice(0, 2))), prior);
  assert.equal(result[2].route, '425B');
  assert.equal(c.mergeScheduleRowsWithExisting(result, ['425B']).length, 3);
});

test('distinct entered quantities stay 100/60 while empty schedule placeholders still group', () => {
  const c = rowHarness();
  const rows = c.mergeGroupedRows([
    { route: '425B', count: 100, unit: 1000 },
    { route: '425D', count: 60, unit: 1000 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].count, 100);
  assert.equal(rows[1].count, 60);
  assert.equal(c.buildGroupedRows(['425B', '425D'])[0].route, '425B|425D');
});

test('reimport never clones a bundle total into two differently priced schedule rows', () => {
  const c = rowHarness();
  c.rateFor = (route) => route === '425B' ? 1000 : 1100;
  const result = c.mergeScheduleRowsWithExisting([{route:'425B|425D',count:160,unit:900}], ['425B','425D']);
  assert.equal(result.length, 1);
  assert.equal(result[0].count, 160);
  assert.equal(result[0].unit, 900);
});

test('native resume cannot reload over a failed save or an open edit', async () => {
  let loads = 0;
  const state = { recordDraft: null };
  const c = load(['refreshAfterNativeMeasurement'], {
    state, currentUserId: () => 'a', captureAccountContext: () => ({userId:'a'}),
    isAccountContextCurrent: () => true,
    ensurePendingSavesFlushed: async () => { throw Error('offline'); },
    loadFromDb: async () => { loads++; return true; }, renderAll: () => {},
    el: { app: {dataset:{view:'record'}} },
  });
  await c.refreshAfterNativeMeasurement();
  c.ensurePendingSavesFlushed = async () => true;
  state.recordDraft = {rows:[{count:123}]};
  await c.refreshAfterNativeMeasurement();
  assert.equal(loads, 0);
});

test('recovery event opens reset UI even after the URL fragment disappeared', () => {
  let callback; const modes = [];
  const c = load(['bindNativeAuthSync'], {
    nativeAuthSubscription: null, nativeLogoutInProgress: false, state: {},
    applyAuthSession: () => ({}), showPending: () => {}, showAuth: () => {},
    setAuthMode: (mode) => modes.push(mode), window: {FlexNoteStartup:{finish(){}}},
    syncNativeSession: () => assert.fail('recovery must not trigger native import'),
  });
  c.bindNativeAuthSync({auth:{onAuthStateChange(fn){callback=fn;return {data:{subscription:{}}};}}});
  callback('PASSWORD_RECOVERY', {user:{id:'a'}});
  assert.equal(c.state.passwordRecovery, true);
  assert.deepEqual(modes, ['reset']);
});

test('text headers handle both year boundaries and reject invalid calendar dates', () => {
  const c = load(['parseHeaderDate'], {state:{year:2026,month:12},toDateKey});
  assert.equal(c.parseHeaderDate('1/1'), '2027-01-01');
  c.state.month = 1;
  assert.equal(c.parseHeaderDate('12/31'), '2025-12-31');
  assert.equal(c.parseHeaderDate('2/30'), '');
});

test('an unsigned old inspection never borrows the current signature', () => {
  const c = load(['inspectionSignatureForRecord'], {
    state:{inspectionSignature:'current'}, isValidSignatureData: (s) => Boolean(s),
  });
  assert.equal(c.inspectionSignatureForRecord({signature_data:null}), '');
  assert.equal(c.inspectionSignatureForRecord({signature_data:'original'}), 'original');
  assert.equal(c.inspectionSignatureForRecord(null), 'current');
});

test('conflict review retains the visible draft before replacing the entry with the confirmed server record', async () => {
  const dateKey = '2026-09-19';
  const entry = { rows: [{ route: '425B', count: 5, unit: 1000 }] };
  const visibleDraft = { rows: [{ route: '425B', count: 9, unit: 1000 }] };
  const server = { rows: [{ route: '425B', count: 2, unit: 1000 }], manualDayUpdatedAt: 'server-time' };
  const state = {
    saveConflict: true, saveConflictDate: dateKey, recordDraftDate: dateKey, recordDraft: visibleDraft,
    entries: { [dateKey]: entry }, receiptEntries: {}, automaticSalesOverrides: {}, retainedEdits: [],
    pendingDates: new Set([dateKey]), pendingRates: false,
    db: { from(table) {
      if (table === 'days') return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }) };
      return { select: () => ({ eq: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }) };
    } },
  };
  const c = load(['reviewPendingSave'], {
    state, TABLES: { days: 'days', items: 'items' }, captureAccountContext: () => ({ userId: 'a' }), isAccountContextCurrent: () => true,
    getRecord: () => state.entries[dateKey], setRecord: (_key, value) => { state.entries[dateKey] = value; },
    cloneRecord: (value) => JSON.parse(JSON.stringify(value)), emptyRecord: () => ({}),
    loadVerifiedWorkLedger: async () => ({ workResults: [], workRoutes: [] }), fetchAutomaticSalesOverrides: async () => ({ rows: [] }),
    entriesFromDb: () => ({ [dateKey]: server }), automaticSalesOverridesByDate: () => ({}), applyAutomaticSalesOverrideToRecord: (value) => value,
    hasAutomaticEntries: () => false, recordInputSummary: () => '', discardRecordDraft: () => { state.recordDraft = null; },
    setSaveFeedback: () => {}, renderAll: () => {}, window: { confirm: () => true, alert: () => {} },
  });
  await c.reviewPendingSave(true);
  assert.equal(state.entries[dateKey], server);
  assert.equal(state.retainedEdits.length, 1);
  assert.equal(state.retainedEdits[0].record.rows[0].count, 9);
  assert.equal(state.pendingDates.has(dateKey), false);
});

test('saving an unsigned historical inspection requires explicit re-sign confirmation', () => {
  let confirmations = 0;
  const c = load(['inspectionSignatureForRecord', 'inspectionSignatureForSave'], {
    state: { inspectionSignature: 'current-signature' }, isValidSignatureData: (value) => Boolean(value),
    window: { confirm: () => { confirmations += 1; return false; } },
  });
  assert.throws(() => c.inspectionSignatureForSave({ signature_data: null }), /재서명을 취소/);
  assert.equal(confirmations, 1);
  c.window.confirm = () => true;
  assert.equal(c.inspectionSignatureForSave({ signature_data: null }), 'current-signature');
});

test('dirty database reload returns before issuing reads', async () => {
  const c = load(['loadFromDb'], {
    state:{db:{from:()=>assert.fail('must not read')},pendingDates:new Set(['2026-09-19'])},
    captureAccountContext:()=>({userId:'a'}),isAccountContextCurrent:()=>true,
  });
  assert.equal(await c.loadFromDb(), false);
});

test('service worker never caches an HTTP error over the existing shell', async () => {
  const handlers = {}; const writes=[]; const sw=fs.readFileSync(new URL('../sw.js',import.meta.url),'utf8');
  let status=404;
  const c=vm.createContext({URL, self:{location:{origin:'https://example.test'},addEventListener:(name,handler)=>handlers[name]=handler},
    fetch:async()=>({ok:status===200,status,clone:()=>({status})}),
    caches:{open:async()=>({put:async(...args)=>writes.push(args)}),match:async()=>null}});
  vm.runInContext(sw,c);
  for(const next of [404,500,200]) { status=next;let response;const waits=[];
    handlers.fetch({request:{url:'https://example.test/src/main.js',method:'GET'},respondWith:p=>response=p,waitUntil:p=>waits.push(p)});
    await response;await Promise.all(waits);
  }
  assert.equal(writes.length,1);
});

test('OCR unread fixed-driver days remain unresolved while explicit off stays off', () => {
  const c = load(['setOcrDraft'], {
    ocrDraftMap: null, correctRouteList: (value) => value,
    routeListFromText: (value) => value, draftWorkRoutes: () => ['425B'],
    el: {scheduleDraftSection: {classList: {toggle() {}}}}, renderDraftCards() {},
  });
  c.setOcrDraft({'2026-09-19': [], '2026-09-20': null}, {preserveUnresolved: true});
  assert.equal(c.ocrDraftMap['2026-09-19'].length, 0);
  assert.equal(c.ocrDraftMap['2026-09-20'], null);
  c.setOcrDraft({'2026-09-19': []});
  assert.equal(c.ocrDraftMap['2026-09-19'][0], '425B');
});

test('an uncommitted form draft blocks direct finance reloads before any read', async () => {
  let reads = 0;
  const c = load(['loadFromDb'], {
    state: {db: {from() {reads++; throw Error('must not read');}}, pendingDates: new Set(),
      pendingRates: false, flushPromise: null, recordDraft: {rows:[{count:37}]}},
    captureAccountContext: () => ({userId:'a'}), isAccountContextCurrent: () => true,
  });
  assert.equal(await c.loadFromDb(), false);
  assert.equal(reads, 0);
});
