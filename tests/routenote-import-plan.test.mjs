import assert from 'node:assert/strict';
import test from 'node:test';
import { createImportPlan, createImportSql } from '../scripts/routenote-import-plan.mjs';

const zone='20000000-0000-4000-8000-000000000001',tip='30000000-0000-4000-8000-000000000001';
const author='10000000-0000-4000-8000-000000000001',targetAuthor='10000000-0000-4000-8000-000000000002';
function snapshot() {
 return { source_project:'dewusorjwzhsdhrsrvbg',target_project:'xrrdokcjhjqdfvwtbenl',exported_at:'2026-09-21T00:00:00Z',author_mapping:[{source_id:author,source_name:'원본 기사',target_id:targetAuthor}],storage:[],tables:{
  rn_route_zones:[{id:zone,name:'예시 구역',memo:"기사's 메모",polygon:{type:'Polygon',coordinates:[[[127,37],[128,37],[128,38],[127,37]]]},created_by:author,is_deleted:false}],
  rn_route_tips:[{id:tip,zone_id:zone,title:'예시 팁',marker_type:'note',memo:'입구 메모',created_by:author,is_deleted:false}],
  rn_route_tip_photos:[],rn_route_zone_photos:[],rn_route_paths:[],rn_route_path_points:[],
 }};
}
test('legacy import retains authors, private originals, stable identities, and safe SQL text',()=>{
 const raw=snapshot(),plan=createImportPlan(raw);
 assert.equal(plan.tips[0].created_by,targetAuthor);assert.equal(plan.tips[0].author_name,'원본 기사');
 assert.deepEqual(plan.zones[0].source_record,{});assert.deepEqual(plan.archive[0].source_record,raw.tables.rn_route_zones[0]);
 const sql=createImportSql(plan);assert.match(sql,/기사''s 메모/);assert.match(sql,/on conflict\(id\) do nothing/);assert.match(sql,/Import content mismatch/);assert.match(sql,/Import archive mismatch/);
});
test('unmapped authors stay unowned and unassigned tips have a deterministic preservation zone',()=>{
 const raw=snapshot();raw.author_mapping[0].target_id=null;raw.tables.rn_route_tips[0].zone_id=null;
 const one=createImportPlan(raw),two=createImportPlan(raw);
 assert.equal(one.tips[0].created_by,null);assert.equal(one.tips[0].author_name,'원본 기사');
 assert.equal(one.zones.length,2);assert.equal(one.zones[1].name,'미지정 구역');assert.equal(one.tips[0].zone_id,two.tips[0].zone_id);
});
test('migration stops for missing parents, malformed boundaries, and foreign photo destinations',()=>{
 const orphan=snapshot();orphan.tables.rn_route_zones=[];assert.throws(()=>createImportPlan(orphan),/missing\/deleted zone/);
 const geometry=snapshot();geometry.tables.rn_route_zones[0].polygon.coordinates[0][0]=[null,37];assert.throws(()=>createImportPlan(geometry));
 const photo=snapshot();photo.tables.rn_route_tip_photos=[{id:'40000000-0000-4000-8000-000000000001',tip_id:tip,storage_path:'https://example.invalid/image.jpg'}];assert.throws(()=>createImportPlan(photo),/Unexpected source media URL/);
});
