import assert from 'node:assert/strict';
import test from 'node:test';
import { buildStatsReport } from '../src/lib/stats-report.js';
import { buildNotebookChartModel, buildNotebookDayDetail, buildNotebookChartScale, createStatsNotebookCharts } from '../src/lib/stats-notebook-charts.js';

const asOfDate = '2026-10-04';
const days = [
  { dateKey: '2026-09-27', worked: true, revenue: 114000, count: 80 },
  { dateKey: '2026-09-28', worked: true, revenue: 120000, count: 84 },
  { dateKey: '2026-09-29', worked: true, revenue: 126000, count: 88 },
  { dateKey: '2026-09-30', worked: true, revenue: 132000, count: 92 },
  { dateKey: '2026-10-01', worked: false, off: true, revenue: 0 },
  { dateKey: '2026-10-02', worked: true, revenue: 164000, count: 114 },
  { dateKey: '2026-10-03', worked: true, revenue: 0, count: 0 },
];
const reportFor = (rows = days, extra = {}) => buildStatsReport({ days: rows, currentPeriod: {year: 2026, month: 10}, asOfDate, goal: 4200000, ...extra });

test('current cumulative axis includes settlement end but never draws future actuals', () => {
  const future = [...days, {dateKey: '2026-10-10', worked: true, revenue: 999000}];
  const report = reportFor(future);
  const model = buildNotebookChartModel({report, days: future, asOfDate});
  assert.equal(model.range.end, '2026-10-25');
  assert.equal(model.cutoff, asOfDate);
  assert.equal(model.points.at(-1).dateKey, asOfDate);
  assert.equal(model.totalRevenue, 656000);
  assert.equal(model.totalRevenue, report.summary.revenue);
  assert.equal(model.target, 4200000);
});

test('missing and off dates differ from genuine zero-revenue work and never dilute work average', () => {
  const model = buildNotebookChartModel({report: reportFor(), days, asOfDate});
  assert.equal(model.windowDays.find(row => row.dateKey === '2026-10-01').status, 'off');
  assert.equal(model.windowDays.find(row => row.dateKey === '2026-10-04').status, 'missing');
  assert.equal(model.windowDays.find(row => row.dateKey === '2026-10-03').status, 'work');
  assert.equal(model.averageRevenue, 656000 / 6);
  assert.equal(model.bestDay.dateKey, '2026-10-02');
  assert.equal(model.windowDays.length, 8);
});

test('planned but unworked record is missing and zero-revenue automatic work remains selectable', () => {
  const rows = [{dateKey:'2026-10-02',worked:false,planned:true,revenue:0},{dateKey:'2026-10-03',worked:true,revenue:0}];
  const model = buildNotebookChartModel({report:reportFor(rows),days:rows,asOfDate,selectedDate:'2026-10-03'});
  assert.equal(model.windowDays.find(row=>row.dateKey==='2026-10-02').status,'missing');
  assert.equal(model.selectedDay.status,'work');
  assert.equal(model.averageRevenue,0);
  assert.equal(model.bestDay.revenue,0);
});

test('previous and longer ranges keep the pure report period rather than prototype rolling dates', () => {
  const previousDays = [{dateKey:'2026-09-25',worked:true,revenue:300000}];
  for (const mode of ['lastSettlement','last3','last12','custom']) {
    const report=reportFor(previousDays,{mode,customRange:{start:'2026-08-07',end:'2026-09-11'}});
    const model=buildNotebookChartModel({report,days:previousDays,asOfDate});
    assert.deepEqual(model.range, {start:report.range.start,end:report.range.end});
    assert.equal(model.totalRevenue,report.summary.revenue);
    assert.equal(model.target,null);
  }
});

test('eight-day navigation clamps to range boundaries and selected dates stay inside the window', () => {
  const report=reportFor();
  const earliest=buildNotebookChartModel({report,days,asOfDate,windowEnd:'2026-09-01',selectedDate:'2026-10-02'});
  assert.equal(earliest.windowStart,'2026-09-26');
  assert.equal(earliest.windowEnd,'2026-09-26');
  assert.equal(earliest.hasPrevious,false);
  assert.equal(earliest.hasNext,true);
  assert.equal(earliest.selectedDate,'2026-09-26');
  const last=buildNotebookChartModel({report,days,asOfDate,windowEnd:'2027-01-01'});
  assert.equal(last.windowEnd,asOfDate);
  assert.equal(last.hasNext,false);
  assert.equal(last.hasPrevious,true);
});

test('canonical historical route revenue is copied exactly without current-price multiplication', () => {
  const day={dateKey:'2026-10-02',status:'work',revenue:168500,source:{freshRevenue:1000,backupRevenue:3500}};
  const detail=buildNotebookDayDetail(day,{routes:[{route:'310C',count:70,revenue:98000,unit:9999},{route:'310D',count:44,revenue:66000,unit:9999}],deliveryRevenue:164000});
  assert.deepEqual(detail.routes,[{route:'310C',count:70,revenue:98000},{route:'310D',count:44,revenue:66000}]);
  assert.equal(detail.revenue,168500);
  assert.equal(detail.deliveryRevenue+detail.freshRevenue+detail.backupRevenue,detail.revenue);
  assert.equal(day.revenue,168500);
});

test('fractional bundled aggregates and genuine negative amounts are preserved in view data', () => {
  const detail=buildNotebookDayDetail({dateKey:'2026-10-02',status:'work',revenue:1000},{routes:[{route:'310C',count:1.5,revenue:500},{route:'310D',count:1.5,revenue:500}]});
  assert.equal(detail.routes[0].count,1.5);
  const rows=[{dateKey:'2026-10-02',worked:true,revenue:-1000}];
  const model=buildNotebookChartModel({report:reportFor(rows),days:rows,asOfDate});
  assert.equal(model.totalRevenue,-1000);
  assert.equal(model.dailyMinimum,-1000);
});

test('empty and wholly future custom periods produce no false workday or average', () => {
  const report=reportFor([],{mode:'custom',customRange:{start:'2026-10-10',end:'2026-10-20'}});
  const model=buildNotebookChartModel({report,days:[],asOfDate});
  assert.equal(model.points.length,0);
  assert.equal(model.windowDays.length,0);
  assert.equal(model.averageRevenue,null);
  assert.equal(model.selectedDay,null);
  assert.equal(model.totalRevenue,0);
});

test('a current period with only missing/off dates has no invented actual revenue line', () => {
  const rows=[{dateKey:'2026-10-01',off:true,worked:false,revenue:0}];
  const model=buildNotebookChartModel({report:reportFor(rows),days:rows,asOfDate});
  assert.equal(model.points.length,0);
  assert.equal(model.windowDays.length,8);
  assert.equal(model.averageRevenue,null);
  assert.equal(model.target,4200000);
});

test('inapplicable goals never enter the legend, summary or graph domain', () => {
  const report=reportFor();
  report.goal.applicable=false;
  const model=buildNotebookChartModel({report,days,asOfDate});
  assert.equal(model.target,null);
  assert.equal(model.goalApplicable,false);
  assert.equal(model.maxRevenue,656000);
});

test('financial axes use rounded steps and encompass actual and target amounts', () => {
  const scale=buildNotebookChartScale({max:4200000});
  assert.deepEqual(scale.ticks,[0,2000000,4000000,6000000]);
  assert.equal(scale.step,2000000);
  const smaller=buildNotebookChartScale({max:656000});
  assert.deepEqual(smaller.ticks,[0,250000,500000,750000]);
  const negative=buildNotebookChartScale({min:-120000,max:656000});
  assert.ok(negative.min<=-120000);
  assert.ok(negative.max>=656000);
  assert.ok(negative.ticks.includes(0));
});

test('a hidden-document animation preference still delegates unseen graphs to the shared queue', () => {
  const queued=[];
  const root={clientWidth:390,innerHTML:'',classList:{add(){}},querySelector(){return null;},querySelectorAll(){return [];}};
  const view=createStatsNotebookCharts({goalRoot:root,shouldAnimate:()=>false,whenVisible:(...args)=>queued.push(args)});
  view.render({report:reportFor(),days,asOfDate});
  assert.equal(queued.length,1);
  assert.equal(queued[0][1],'notebook-goal');
  view.render({report:reportFor(),days,asOfDate});
  assert.equal(queued.length,2,'same unseen data still has a pending callback');
  assert.doesNotMatch(root.innerHTML,/457\.8만|305\.2만|152\.6만/);
  assert.match(root.innerHTML,/200만/);
  view.destroy();
});
