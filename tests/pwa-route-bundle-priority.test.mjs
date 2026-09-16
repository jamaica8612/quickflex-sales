import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { DEFAULT_ROUTE_BUNDLES } from '../src/config.js';
import { routeListFromText, joinStoredRoutes, compactRouteList, parseScheduleRoutes } from '../src/lib/route.js';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const source = main.slice(main.indexOf('function activeRouteBundles()'), main.indexOf('function currentUserId()'));
function complete(input, bundles = []) {
  const context = vm.createContext({ DEFAULT_ROUTE_BUNDLES, routeListFromText, joinStoredRoutes, parseScheduleRoutes,
    state: { routeBundles: bundles } });
  vm.runInContext(source, context);
  return Array.from(context.completeRouteBundles(input));
}
const correction = { routes: ['316A', '316B', '313C'], active: true };

test('registered correction replaces conflicting fallback without adding 313A', () => {
  for (const input of [['316A', '316B'], ['316A', '316B', '313C']]) {
    const output = complete(input, [correction]);
    assert.deepEqual(output, ['316A', '316B', '313C']);
    assert.equal(compactRouteList(output), '316AB 313C');
  }
});
test('registered two-route pattern suppresses old three-route completion', () => {
  assert.deepEqual(complete(['316A', '316B'], [{ routes: ['316A', '316B'], active: true }]), ['316A', '316B']);
});
test('inactive or missing correction retains default completion', () => {
  for (const bundles of [[], [{ ...correction, active: false }]]) {
    assert.deepEqual(complete(['316A', '316B'], bundles), ['316A', '316B', '313A']);
  }
});
test('unrelated fallback remains available even with one shared route', () => {
  assert.deepEqual(complete(['405A', '405C'], [{ routes: ['405A', '999Z'], active: true }]), ['405A', '405C', '410B']);
});
test('trusted completion still requires two observed routes', () => {
  assert.deepEqual(complete(['316A'], [correction]), ['316A']);
  assert.deepEqual(complete(['316A', '316B'], [{ routes: ['316A', '316B', '313C', '999Z'], active: true }]),
    ['316A', '316B', '313C', '999Z']);
});
test('explicitly observed routes are preserved instead of deleting user data', () => {
  assert.deepEqual(complete(['316A', '316B', '313A'], [correction]), ['316A', '316B', '313A', '313C']);
});

test('registered 405AC correction suppresses fallback 410B', () => {
  assert.deepEqual(complete(['405A', '405C'], [{ routes: ['405A', '405C'], active: true }]),
    ['405A', '405C']);
});

test('completion does not use newly inferred routes to trigger another pattern', () => {
  const first = { routes: ['901A', '901B', '902C'], active: true };
  const second = { routes: ['901B', '902C', '903D'], active: true };
  for (const bundles of [[first, second], [second, first]]) {
    assert.deepEqual(complete(['901A', '901B'], bundles), ['901A', '901B', '902C']);
  }
});

test('a second pattern still completes when its anchors were explicitly observed', () => {
  const first = { routes: ['901A', '901B', '902C'], active: true };
  const second = { routes: ['901B', '902C', '903D'], active: true };
  for (const bundles of [[first, second], [second, first]]) {
    assert.deepEqual(new Set(complete(['901A', '901B', '902C'], bundles)),
      new Set(['901A', '901B', '902C', '903D']));
  }
});

test('compact registered patterns normalize before fallback conflict detection', () => {
  for (const routes of [['316AB', '313C'], ['316AB313C'], ['316AB 313C']]) {
    assert.deepEqual(complete(['316A', '316B'], [{ routes, active: true }]),
      ['316A', '316B', '313C']);
  }
});

test('schedule text preserves each suffix in separated or adjacent compressed routes', () => {
  for (const text of ['316AB 313C', '316AB313C', '316ab 313c', '316A|316B|313C']) {
    assert.deepEqual(parseScheduleRoutes(text), ['316A', '316B', '313C']);
  }
});

test('schedule text deduplicates codes and accepts an empty CSV route cell', () => {
  assert.deepEqual(parseScheduleRoutes('316AB 316A 313C'), ['316A', '316B', '313C']);
  assert.deepEqual(parseScheduleRoutes(''), []);
  assert.deepEqual(parseScheduleRoutes(null), []);
});
