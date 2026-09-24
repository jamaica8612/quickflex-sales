import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { koreanDateKey, resolveWorkDates } from '../src/lib/work-date.js';
import { toDateKey, parseDateKey } from '../src/lib/date.js';

const source = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
function load(names, globals) {
  const context = vm.createContext(globals);
  for (const name of names) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf('\n}', start) + 2;
    vm.runInContext(source.slice(source.slice(start - 6, start) === 'async ' ? start - 6 : start, end), context);
  }
  return context;
}
const now = new Date('2026-09-24T08:00:00+09:00');
function harness() {
  return load(['currentWorkDates', 'defaultMeasurementWorkDate', 'currentMeasurementWorkDate'], {
    state: { entries: {}, session: { user: { id: 'owner' } }, workDateDataLoaded: true,
      workDateScheduleDates: new Set(), measurementDateAuto: true },
    koreanDateKey, resolveWorkDates, isNightShift: () => true,
    getRecord: () => ({ off: false, rows: [{ route: '111A' }] }),
    hasAutomaticEntries: () => false,
  });
}
test('PWA uses actual stored schedule evidence, not synthesized fixed routes, and preserves manual dates', () => {
  const c = harness();
  assert.equal(c.currentWorkDates(now).reason, 'empty');
  c.state.workDateScheduleDates.add('2026-09-24');
  assert.equal(c.defaultMeasurementWorkDate(now), '2026-09-24');
  c.hasAutomaticEntries = () => true;
  assert.equal(c.defaultMeasurementWorkDate(now), '2026-09-25');
  c.state.measurementDate = '2026-09-12'; c.state.measurementDateAuto = false;
  assert.equal(c.currentMeasurementWorkDate(now), '2026-09-12');
  c.state.workDateDataLoaded = false;
  assert.equal(c.currentWorkDates(now).reason, 'clock');
});
test('PWA active measurement date requires the same account and an unreleased live lease', () => {
  const c = harness();
  const lease = { user_id: 'owner', work_date: '2026-09-23', lease_expires_at: '2026-09-24T09:00:00+09:00' };
  c.state.activeMeasurementLease = lease;
  assert.equal(c.currentWorkDates(now).activeWorkDate, '2026-09-23');
  for (const patch of [{ user_id: 'other' }, { released_at: now.toISOString() }, { lease_expires_at: now.toISOString() }]) {
    c.state.activeMeasurementLease = { ...lease, ...patch };
    assert.equal(c.currentWorkDates(now).reason, 'empty');
  }
});
test('night Today button moves into the next work month without altering inspection date', () => {
  const selected = [];
  const c = load(['selectToday'], { state: { inspectionDate: '2026-12-31' }, isNightShift: () => true,
    currentWorkDates: () => ({ nextWorkDate: '2027-01-01' }), koreanDateKey, parseDateKey,
    periodForDate: (d) => ({ year: d.getFullYear(), month: d.getMonth() + 1 }),
    selectDate: (d) => selected.push(d), renderSummary() {},
  });
  c.selectToday();
  assert.deepEqual(selected, ['2027-01-01']);
  assert.equal(c.state.year, 2027); assert.equal(c.state.month, 1);
  assert.equal(c.state.inspectionDate, '2026-12-31');
});
test('calendar keeps the actual today marker while marking a separate night work date', () => {
  const cells = [];
  const c = load(['renderMonth'], {
    state: { inspections: {}, selectedDate: '2026-09-25', mode: 'count' },
    isNightShift: () => true, currentWorkDates: () => ({ nextWorkDate: '2026-09-25' }),
    el: { modeBtns: [], monthCalendar: { appendChild: (cell) => cells.push(cell) } },
    periodBounds: () => ({ start: parseDateKey('2026-09-01'), end: parseDateKey('2026-09-30') }),
    periodKeys: () => ['2026-09-24', '2026-09-25'], toDateKey, todayKey: () => '2026-09-24',
    getRecord: () => ({ off: false, rows: [] }), calcRecord: () => ({ count: 0, revenue: 0 }),
    koreanHoliday: () => '', shouldShowCalendarRoutes: () => false, formatCalendarWon: () => '',
    formatLong: (d) => d, selectDate() {},
    document: { createElement: () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {} }) },
  });
  c.renderMonth();
  const today = cells.find((cell) => cell.attrs['aria-label'].startsWith('2026-09-24'));
  const work = cells.find((cell) => cell.attrs['aria-label'].startsWith('2026-09-25'));
  assert.equal(today.attrs['aria-current'], 'date');
  assert.equal(work.attrs['aria-current'], undefined);
  assert.match(work.innerHTML, /today-work-badge.*오늘 업무/);
  assert.doesNotMatch(today.innerHTML, /today-work-badge/);
});
