import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import * as routeHelpers from '../src/lib/route.js';
import { DEFAULT_ROUTE_BUNDLES, DEFAULT_ROUTE_MASTER } from '../src/config.js';
import { bindOcrEvents } from '../src/ui/ocr.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function extract(name) {
  const start = main.search(new RegExp('(?:async )?function ' + name + '\\('));
  assert.ok(start >= 0, name);
  const next = main.slice(start + 1).search(/\n(?:async )?function /);
  return next < 0 ? main.slice(start) : main.slice(start, start + 1 + next);
}
const names = ['routeCandidateSet', 'routeDistance', 'correctRoute', 'correctRouteList',
  'activeRouteBundles', 'completeRouteBundles', 'escapeAttr', 'setOcrDraft', 'renderDraftCards'];
const correction = { routes: ['316A', '316B', '313C'], active: true };
function harness(bundles = [correction], extra = {}) {
  const cards = { innerHTML: '' };
  const context = vm.createContext({ ...routeHelpers, DEFAULT_ROUTE_BUNDLES, DEFAULT_ROUTE_MASTER,
    state: { routeBundles: bundles, rates: [] }, fixedRoutes: () => [], draftWorkRoutes: () => [],
    el: { scheduleDraftCards: cards, scheduleDraftSection: { classList: { toggle() {} } } },
    ocrDraftMap: null, formatLongShort: date => date, ...extra });
  vm.runInContext(names.map(extract).join('\n'), context);
  return { context, cards };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('missing 319C is ordered in the OCR draft, not just its displayed chips', () => {
  const { context: c } = harness([]);
  const observed = Object.freeze(['319A', '319B', '319D']);
  c.setOcrDraft({ '2026-10-04': observed }, { preserveUnresolved: true });
  assert.deepEqual(plain(c.ocrDraftMap['2026-10-04']), ['319A', '319B', '319C', '319D']);
  assert.equal(routeHelpers.compactRouteList(c.ocrDraftMap['2026-10-04']), '319ABCD');
  assert.deepEqual(observed, ['319A', '319B', '319D']);
});

test('one unambiguous registered OCR suffix correction replaces A with C instead of adding C', () => {
  const { context: c, cards } = harness();
  c.setOcrDraft({ '2026-10-04': ['316A', '316B', '313A'] }, { preserveUnresolved: true });
  assert.deepEqual(plain(c.ocrDraftMap['2026-10-04']), ['316A', '316B', '313C']);
  assert.equal(routeHelpers.compactRouteList(c.ocrDraftMap['2026-10-04']), '316AB 313C');
  assert.deepEqual([...cards.innerHTML.matchAll(/data-route="([^"]+)"/g)].map(m => m[1]), ['316A', '316B', '313C']);
});

test('competing registered corrections never union different guesses or depend on database order', () => {
  const alternative = { routes: ['316A', '316B', '313D'], active: true };
  for (const bundles of [[correction, alternative], [alternative, correction]]) {
    const { context: c } = harness(bundles);
    for (const observed of [['316A', '316B'], ['316A', '316B', '313A'], ['316A', '316B', '313C']]) {
      c.setOcrDraft({ '2026-10-04': observed }, { preserveUnresolved: true });
      assert.deepEqual(plain(c.ocrDraftMap['2026-10-04']), observed);
    }
  }
});

test('equivalent compact registered patterns are one correction, not an ambiguity', () => {
  const { context: c } = harness([correction, { routes: ['316AB313C'], active: true }]);
  c.setOcrDraft({ '2026-10-04': ['316A', '316B', '313A'] }, { preserveUnresolved: true });
  assert.deepEqual(plain(c.ocrDraftMap['2026-10-04']), ['316A', '316B', '313C']);
});

test('different observed anchors cannot combine competing guesses for the same route prefix', () => {
  const alternative = { routes: ['316B', '316D', '313D'], active: true };
  for (const bundles of [[correction, alternative], [alternative, correction]]) {
    const { context: c } = harness(bundles);
    const observed = ['316A', '316B', '316D'];
    c.setOcrDraft({ '2026-10-04': observed }, { preserveUnresolved: true });
    assert.deepEqual(plain(c.ocrDraftMap['2026-10-04']), observed);
  }
});

test('fallback agrees with 316AB313C and never adds a conflicting suffix', () => {
  for (const bundles of [[], [{ ...correction, active: false }]]) {
    const { context: c } = harness(bundles);
    for (const observed of [['316A', '316B'], ['316A', '316B', '313C']]) {
      assert.deepEqual(plain(c.correctRouteList(observed)), ['316A', '316B', '313C']);
    }
    assert.deepEqual(plain(c.correctRouteList(['316A', '316B', '313A'])), ['316A', '316B', '313A']);
  }
});

test('OCR suffix correction preserves independent routes and does not guess through multiple conflicts', () => {
  const { context: c } = harness();
  const cases = [
    [['316A', '316B', '999Z'], ['316A', '316B', '999Z', '313C']],
    [['316A', '316B', '313A', '999Z'], ['316A', '316B', '313A', '999Z']],
    [['316A', '316B', '313A', '313D'], ['316A', '316B', '313A', '313D']],
    [['316A', '316B', '313C', '313A'], ['316A', '316B', '313A', '313C']],
  ];
  for (const [observed, expected] of cases) {
    c.setOcrDraft({ '2026-10-04': observed }, { preserveUnresolved: true });
    assert.deepEqual(plain(c.ocrDraftMap['2026-10-04']), expected);
  }
});

test('multiple missing routes and same-prefix bundles do not authorize replacing an observed suffix', () => {
  for (const [bundle, observed] of [
    [{ routes: ['316A', '316B', '313C', '999Z'], active: true }, ['316A', '316B', '313A']],
    [{ routes: ['319A', '319B', '319C'], active: true }, ['319A', '319B', '319D']],
  ]) {
    const { context: c } = harness([bundle]);
    c.setOcrDraft({ '2026-10-04': observed }, { preserveUnresolved: true });
    assert.deepEqual(plain(c.ocrDraftMap['2026-10-04']), observed);
  }
});

test('manual review additions keep explicit routes, skip bundle inference, and order edited suffixes', () => {
  const { context: c } = harness();
  const handlers = {};
  const date = '2026-10-04';
  const input = { value: '', focus() {} };
  const state = { [date]: [] };
  const node = name => ({ addEventListener: (_, fn) => { handlers[name] = fn; } });
  const el = Object.fromEntries(['parseCsv', 'scheduleImage', 'runScheduleOcr', 'settlementImage',
    'runSettlementOcr', 'scheduleDraftCards', 'parseSchedule', 'parseScheduleCsv'].map(n => [n, node(n)]));
  Object.assign(el.scheduleDraftCards, { querySelector: () => input, querySelectorAll: () => [] });
  bindOcrEvents({ el, ocrDraftState: { get: () => state }, correctRouteList: (...args) => c.correctRouteList(...args),
    renderDraftCards() {}, toast: message => assert.fail(message) });
  for (const [value, before, expected] of [
    ['316AB313A', [], ['316A', '316B', '313A']],
    ['316AB', [], ['316A', '316B']],
    ['319C', ['319A', '319B', '319D'], ['319A', '319B', '319C', '319D']],
  ]) {
    state[date] = before;
    input.value = value;
    handlers.scheduleDraftCards({ target: { closest: () => ({ dataset: { date, action: 'add' } }) } });
    assert.deepEqual(plain(state[date]), expected);
  }
});

test('the corrected draft reaches schedule saving with the same route identities and order', async () => {
  const records = new Map();
  const received = [];
  const { context: c } = harness([], {
    getRecord: date => records.get(date) || { rows: [] }, hasEnteredCounts: () => false,
    mergeScheduleRowsWithExisting: (_rows, routes) => { received.push(plain(routes)); return routes.map(route => ({ route })); },
    setRecord: (date, record) => records.set(date, record), scheduleSave() {}, renderAll() {},
    ensurePendingSavesFlushed: async () => {}, toast() {},
  });
  c.el.app = { dataset: { view: 'settings' } };
  vm.runInContext(extract('applySchedule'), c);
  c.setOcrDraft({ '2026-10-04': ['319A', '319B', '319D'] }, { preserveUnresolved: true });
  assert.equal(await c.applySchedule(c.ocrDraftMap), true);
  assert.deepEqual(received, [['319A', '319B', '319C', '319D']]);
});
