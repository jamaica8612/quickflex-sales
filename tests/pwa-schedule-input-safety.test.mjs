import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import * as routes from '../src/lib/route.js';
import {DEFAULT_ROUTE_BUNDLES,DEFAULT_ROUTE_MASTER} from '../src/config.js';
const main=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
function extract(name){
 const start=main.search(new RegExp('(?:async )?function '+name+'\\('));
 assert.ok(start>=0);
 const tail=main.slice(start+1);const end=tail.search(/\n(?:async )?function /);
 return end<0?main.slice(start):main.slice(start,start+1+end);
}
function load(names,extra={}){const c=vm.createContext({...routes,...extra});vm.runInContext(names.map(extract).join('\n'),c);return c;}
const correctionNames=['routeCandidateSet','routeDistance','correctRoute','correctRouteList','activeRouteBundles','completeRouteBundles'];
const correctionContext=()=>load(correctionNames,{DEFAULT_ROUTE_BUNDLES,DEFAULT_ROUTE_MASTER,fixedRoutes:()=>[],state:{routeBundles:[],rates:[]}});
test('dormant correction engine preserves valid unlisted routes through fuzzy candidates',()=>{
 const c=correctionContext();
 assert.equal(c.correctRoute('303E',new Set(['303A','303B'])),'303E');
 assert.equal(c.correctRoute('305A',new Set(['304A'])),'305A');
 assert.equal(c.correctRoute('3168',new Set(['316B'])),'316B');
});
test('dormant correction engine handles mixed valid and OCR-confused tokens',()=>{
 const c=correctionContext();
 assert.deepEqual(Array.from(c.correctRouteList(['316A','3O3C'])),['316A','303C']);
});
test('OCR review preserves recognized routes and orders edited chips without mutating the draft',()=>{
 const cards={innerHTML:''};
 const c=load([...correctionNames,'escapeAttr','setOcrDraft','renderDraftCards'],{
  DEFAULT_ROUTE_BUNDLES,DEFAULT_ROUTE_MASTER,fixedRoutes:()=>[],state:{routeBundles:[],rates:[]},
  el:{scheduleDraftCards:cards,scheduleDraftSection:{classList:{toggle(){}}}},
  ocrDraftMap:null,formatLongShort:date=>date,draftWorkRoutes:()=>[],
 });
 const date='2026-09-29';
 const recognized=Object.freeze(['319A','319B','319D']);
 const chipRoutes=()=>[...cards.innerHTML.matchAll(/data-route="([^"]+)"/g)].map(match=>match[1]);
 c.setOcrDraft({[date]:recognized},{preserveUnresolved:true});
 assert.deepEqual(chipRoutes(),['319A','319B','319D']);
 assert.deepEqual(Array.from(c.ocrDraftMap[date]),['319A','319B','319D']);
 assert.deepEqual(recognized,['319A','319B','319D']);
 for(const [draft,displayed] of [
  [['319A','319B','319D','319C','318B'],['319A','319B','319C','319D','318B']],
  [['319A','319D','319C','318B'],['319A','319C','319D','318B']],
 ]){
  c.ocrDraftMap[date]=Object.freeze([...draft]);
  c.renderDraftCards();
  assert.deepEqual(chipRoutes(),displayed);
  assert.deepEqual(Array.from(c.ocrDraftMap[date]),draft);
 }
 c.setOcrDraft({[date]:[], '2026-09-30':null},{preserveUnresolved:true});
 assert.deepEqual(chipRoutes(),[]);
 assert.match(cards.innerHTML,/구역 확인이 필요합니다/);
 assert.match(cards.innerHTML,/aria-pressed="true"/);
});
test('CSV compact groups and JSON compact arrays preserve every explicit route',async()=>{
 const saved=[];
 const c=load(['routesFromCell','extractScheduleJson','parseScheduleCsv'],{
  splitLine:s=>s.split(','),driverName:()=> '테스트',parseHeaderDate:s=>s==='9/16'?'2026-09-16':'',
  applySchedule:m=>saved.push(JSON.parse(JSON.stringify(m))),toast:()=>assert.fail('unexpected error')});
 await c.parseScheduleCsv('이름,9/16\n테스트,316AB 313C');
 await c.parseScheduleCsv('{"2026-09-16":["316AB313C"]}');
 assert.deepEqual(saved,[{'2026-09-16':['316A','316B','313C']},{'2026-09-16':['316A','316B','313C']}]);
 assert.equal(c.routesFromCell('휴무'),null);
});
test('admin bulk draft expands compact stored routes',()=>{
 const c=load(['parseBundleDraft']);
 assert.deepEqual(JSON.parse(JSON.stringify(c.parseBundleDraft('보정=316AB313C')))[0].routes,['316A','316B','313C']);
});
test('failed nonempty OCR never silently becomes configured fixed routes',()=>{
 const c=load(['setOcrDraft'],{correctRouteList:()=>assert.fail('OCR must not invoke the correction engine'),draftWorkRoutes:()=>['425B'],renderDraftCards:()=>{},
  el:{scheduleDraftSection:{classList:{toggle(){}}}},ocrDraftMap:null});
 c.setOcrDraft({'2026-09-16':['???'],'2026-09-17':[],'2026-09-18':null});
 assert.deepEqual(JSON.parse(JSON.stringify(c.ocrDraftMap)),{'2026-09-16':[],'2026-09-17':['425B'],'2026-09-18':null});
});
test('unresolved workday stops whole schedule before any record write',async()=>{
 let warning='';
 const c=load(['applySchedule'],{toast:m=>warning=m,getRecord:()=>assert.fail('must not write or read records')});
 assert.equal(await c.applySchedule({'2026-09-16':[],'2026-09-17':['316A']}),false);
 assert.match(warning,/구역이 확인되지 않은 1일/);
});
