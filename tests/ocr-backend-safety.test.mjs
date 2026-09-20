import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { parseScheduleRoutes, normalizeScheduleMap } from '../supabase/functions/ocr-schedule/utils.ts';
import { parseScheduleRoutes as browserRoutes } from '../src/lib/route.js';
import { extractVisionSchedule } from '../supabase/functions/ocr-schedule/vision-schedule.ts';
import { handleCellsOcr } from '../supabase/functions/ocr-schedule/cells.ts';
import * as requestUtils from '../supabase/functions/ocr-schedule/request.ts';
const { validateOcrRequest, readOcrRequest, MAX_BODY_BYTES } = requestUtils;
const good = { imageBase64: 'YWJj', ownerName: '기사', year: 2026, month: 1, mode: 'vision-schedule' };

test('OCR route bundles agree with browser and unread data remains unresolved', () => {
  for (const input of ['425BD', '316AB313C', '425B/425D', ['425BD', '313C'], '1234A', 'unread', '']) assert.deepEqual(parseScheduleRoutes(input), browserRoutes(input));
  assert.deepEqual(normalizeScheduleMap({ '2026-01-01': [], '2026-01-02': ['???'], '2026-01-03': null, '2026-01-04': ['425BD'] }), {
    '2026-01-01': [], '2026-01-02': [], '2026-01-03': null, '2026-01-04': ['425B', '425D'],
  });
});
function annotation(text, x, y) { return { description: text, boundingPoly: { vertices: [{x,y}, {x:x+30,y}, {x:x+30,y:y+16}, {x,y:y+16}] } }; }
async function vision(headers, values, input={}) {
  const before = globalThis.fetch;
  globalThis.Deno = { env: { get: () => 'mock-no-real-key' } };
  globalThis.fetch = async () => Response.json({ responses: [{ textAnnotations: [{ description: 'fixture' }, annotation('기사', 0, 100), ...headers.map((h,i) => annotation(h, 100+i*80, 30)), ...values.flatMap((v,i) => v ? [annotation(v,100+i*80,100)] : [])] }] });
  try { return (await extractVisionSchedule({...good, mimeType: 'image/png', ...input})).schedule; }
  finally { globalThis.fetch=before; }
}
test('Vision keeps all routes, blank and unread cells, and only explicit OFF', async () => {
  assert.deepEqual(await vision(['26','27','28','1','2'], ['425BD','','???','OFF','310A']), {'2025-12-26':['425B','425D'],'2025-12-27':[],'2025-12-28':[],'2026-01-01':null,'2026-01-02':['310A']});
});
test('Vision preserves explicit calendars and rejects invalid calendar/year bounds', async () => {
  assert.deepEqual(Object.keys(await vision(['1','25','26'],['310A','310B','310C'])),['2026-01-01','2026-01-25','2026-01-26']);
  assert.deepEqual(Object.keys(await vision(['2025-12-26','2026-01-01','2026-01-25'],['A','B','C'])),['2025-12-26','2026-01-01','2026-01-25']);
  await assert.rejects(() => vision(['2/28','2/29','3/1'],['A','B','C'],{month:3}),/헤더 날짜/);
  await assert.rejects(() => vision(['26','27','1'],['A','B','C'],{year:2000}),/헤더 날짜/);
});
test('request bounds reject forged payloads including unknown-length oversized streams', async () => {
  assert.equal(validateOcrRequest(good),1);
  for (const body of [{...good,year:1999},{...good,month:13},{...good,ownerName:''},{...good,imageBase64:'%%%='},{...good,mimeType:'text/html'},{mode:'cells',cells:Array.from({length:65},(_,id)=>({id:String(id),base64:'YWJj'}))},{mode:'cells',cells:[{id:'a',base64:'YWJj'},{id:'a',base64:'YWJj'}]}]) assert.throws(() => validateOcrRequest(body),{status:400});
  await assert.rejects(() => readOcrRequest(new Request('https://local',{method:'POST',body:'['})),{status:400});
  const stream = new ReadableStream({start(c){c.enqueue(new Uint8Array(MAX_BODY_BYTES+1));c.close();}});
  await assert.rejects(() => readOcrRequest(new Request('https://local',{method:'POST',body:stream,duplex:'half'})),{status:413});
});
function endpoint(options={}) {
  let handler, paid=0, quota=0;
  const client = {auth:{getUser:async()=>({data:{user:options.invalid?null:{id:'owner'}},error:null})},from:()=>({select:()=>({eq:(key,id)=>{assert.equal(id,'owner');return{maybeSingle:async()=>({data:{status:options.status||'approved'}})};}})}),rpc:async()=>{quota++;return{data:options.quota!==false,error:options.error};}};
  let source=readFileSync(new URL('../supabase/functions/ocr-schedule/index.ts',import.meta.url),'utf8');
  source=source.replace(/^import .*;\r?\n/gm,'');
  vm.runInNewContext(stripTypeScriptTypes(source),{...requestUtils,createClient:()=>client,Deno:{env:{get:()=>''},serve:(fn)=>{handler=fn;}},Request,Response,handleCellsOcr:async()=>{paid++;return{};},extractVisionSchedule:async()=>{paid++;return{};},createOcrProvider:()=>({extractSchedule:async()=>{paid++;return{};}})});
  return {call:async(body=good,auth=true)=>handler(new Request('https://local',{method:'POST',headers:auth?{authorization:'Bearer valid'}:{},body:JSON.stringify(body)})),counts:()=>({paid,quota})};
}
test('actual endpoint denies auth, approval, malformed inputs and depleted quota before paid OCR',async()=>{
  for(const [options,status,body,auth] of [[{},401,good,false],[{invalid:true},401,good,true],[{status:'pending'},403,good,true],[{status:'blocked'},403,good,true],[{},400,{...good,month:0},true],[{quota:false},429,good,true],[{error:{code:'oops'}},503,good,true]]){
    const api=endpoint(options);assert.equal((await api.call(body,auth)).status,status);assert.equal(api.counts().paid,0);
  }
  const api=endpoint();assert.equal((await api.call()).status,200);assert.deepEqual(api.counts(),{paid:1,quota:1});
});
test('cell OCR bounds batch concurrency and isolates a failed batch',async()=>{
  const original=globalThis.fetch;let active=0,max=0,calls=0;
  globalThis.Deno={env:{get:()=> 'mock'}};
  globalThis.fetch=async (_url,init)=>{const id=calls++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,3));active--;if(id===1)return new Response('failed',{status:500});return Response.json({responses:JSON.parse(init.body).requests.map(()=>({fullTextAnnotation:{text:'425BD'}}))});};
  try{const result=await handleCellsOcr(Array.from({length:64},(_,id)=>({id:String(id),base64:'YWJj'})));assert.equal(max,2);assert.equal(calls,4);assert.equal(result.results.length,64);assert.equal(result.results[16].text,'');assert.equal(result.results[32].text,'425BD');}finally{globalThis.fetch=original;}
});
