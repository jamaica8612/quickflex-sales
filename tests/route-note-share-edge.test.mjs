import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Exercise the actual handler without loading its network dependency or deploying an Edge Function.
const source = readFileSync(new URL('../supabase/functions/route-note-share/index.ts', import.meta.url), 'utf8');
const code = stripTypeScriptTypes(source.replace(/^import\s+\{\s*createClient\s*\}\s+from\s+[^;]+;\s*/m, ''));
const company='10000000-0000-4000-8000-000000000001',zone='20000000-0000-4000-8000-000000000001',tip='30000000-0000-4000-8000-000000000001',photo='40000000-0000-4000-8000-000000000001';
const token='a'.repeat(64);
function fixture(seconds=90) {
 return {expires_at:new Date(Date.now()+seconds*1000).toISOString(),company:{id:company,name:'예시 회사'},zone:{id:zone,name:'예시 구역'},tips:[{id:tip,title:'예시 팁',memo:'진입 안내',author_name:'예시 기사'}],tip_photos:[{id:photo,tip_id:tip,path:`${company}/${tip}/${photo}.jpg`}],zone_photos:[{id:photo,zone_id:zone,path:`zones/${company}/${zone}/${photo}.png`}]};
}
function server({shared=fixture(),rpcError=null,revokeAfterRead=false}={}) {
 const calls={rpc:0,signed:[]}; let handler;
 const client={rpc:async()=>{calls.rpc++;return {data:revokeAfterRead&&calls.rpc>1?null:shared,error:rpcError};},storage:{from:bucket=>({createSignedUrl:async(path,ttl)=>{calls.signed.push({bucket,path,ttl});return {data:{signedUrl:`https://example.invalid/${bucket}/${path}?signed=fixture`},error:null};}})}};
 runInNewContext(code,{Request,Response,URL,Date,Math,JSON,Promise,TextEncoder,Uint8Array,ReadableStream,createClient:()=>client,Deno:{env:{get:name=>({SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'operator-only-fixture-key'}[name])},serve:fn=>{handler=fn;}}});
 const request=(body={token},options={})=>handler(new Request('https://example.invalid/functions/v1/route-note-share',{method:'POST',headers:{Origin:'https://jamaica8612.github.io','Content-Type':'application/json'},body:JSON.stringify(body),...options}));
 return {calls,request};
}
test('public share handler limits methods, origins and malformed tokens without querying data',async()=>{
 const s=server();
 assert.equal((await s.request(null,{method:'GET',body:undefined})).status,405);
 assert.equal((await s.request({token:'bad'})).status,404);
 assert.equal((await s.request({token},{headers:{Origin:'https://untrusted.invalid','Content-Type':'application/json'}})).status,403);
 assert.equal(s.calls.rpc,0);assert.equal(s.calls.signed.length,0);
});
test('valid share signs only referenced photos with deadline-limited URLs and no-store response',async()=>{
 const s=server({shared:fixture(90)}),response=await s.request(),body=await response.json();
 assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
 assert.equal(s.calls.signed.length,2);assert.ok(s.calls.signed.every(c=>c.ttl>0&&c.ttl<=90));
 assert.ok(body.tip_photos[0].url);assert.ok(body.zone_photos[0].url);
 assert.ok(!JSON.stringify(body).includes('operator-only-fixture-key'));
});
test('expired, missing, and revoked shares return no route content',async()=>{
 for(const options of [{shared:fixture(-1)},{shared:null},{revokeAfterRead:true}]){
  const s=server(options),response=await s.request(),body=await response.json();
  assert.equal(response.status,404);assert.equal(body.zone,undefined);assert.equal(body.tip_photos,undefined);
 }
});
test('share handler refuses photo paths outside the exact company and route',async()=>{
 const shared=fixture();shared.zone_photos[0].path=`zones/${company}/90000000-0000-4000-8000-000000000001/${photo}.png`;
 const s=server({shared}),response=await s.request();
 assert.ok(response.status>=400);assert.ok(!s.calls.signed.some(c=>c.path===shared.zone_photos[0].path));
});
test('upstream failures do not expose database errors or credentials',async()=>{
 const s=server({rpcError:{message:'internal private table with secret'}}),response=await s.request(),body=await response.json();
 assert.equal(response.status,500);assert.ok(!JSON.stringify(body).includes('internal private'));assert.equal(s.calls.signed.length,0);
});
