import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// DOM unit contract: exercise the shipped page against an Edge-shaped response.
// This does not substitute for browser layout / Naver SDK QA.
const code=readFileSync(new URL('../route-share.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
class Element {
 constructor(tag){this.tag=tag;this.children=[];this.attrs={};this.listeners={};this.text='';}
 append(child){this.children.push(child);}
 replaceChildren(...children){this.children=children;this.text='';}
 setAttribute(name,value){this.attrs[name]=value;}
 addEventListener(name,handler){this.listeners[name]=handler;}
 contains(target){return this===target||this.children.some(c=>c.contains?.(target));}
 focus(){}
 set textContent(text){this.text=String(text);this.children=[];}
 get textContent(){return this.text+this.children.map(c=>c.textContent||'').join('');}
 set innerHTML(value){throw new Error('Untrusted shared content must not use innerHTML');}
}
function find(root,predicate){return [root,...root.children.flatMap(c=>find(c,predicate))].filter(predicate);}
async function page({days=7,coords=true,fetchImpl}={}){
 let now=Date.UTC(2026,8,21),timerId=0;const timers=new Map(),requests=[],maps=[],events={},root=new Element('main');
 const payload={expires_at:new Date(now+days*86400000).toISOString(),company:{id:'company',name:'회사'},zone:{id:'zone',name:'303AB',memo:'원본 메모',polygon:null},tips:[{id:'tip',zone_id:'zone',title:'진입 안내',memo:'<img src=x onerror=alert(1)>',author_name:'예시 기사',lat:coords?35.1:null,lng:coords?129.1:null}],tip_photos:[{tip_id:'tip',url:'https://example.invalid/signed/tip.jpg'}],zone_photos:[{zone_id:'zone',url:'https://example.invalid/signed/zone.jpg'}]};
 class ClockDate extends Date {static now(){return now;}}
 const location={hash:'#token='+'a'.repeat(64)};
 const document={getElementById:id=>id==='routeSharePage'?root:find(root,e=>e.attrs.id===id)[0],createElement:tag=>new Element(tag),addEventListener:(name,fn)=>{events[name]=fn;},visibilityState:'visible'};
 const context={document,location,window:{addEventListener:(name,fn)=>{events[name]=fn;}},Date:ClockDate,URL,URLSearchParams,Intl,AbortSignal,AbortController,PUBLIC_SUPABASE_CONFIG:{url:'https://example.invalid',anonKey:'public-fixture'},ROUTE_NOTES_CONFIG:{mapClientId:'fixture'},hasPolygon:p=>Boolean(p),createRouteNoteMap:async()=>{const adapter={render:value=>maps.push(value),destroy:()=>maps.push('destroy')};return adapter;},setTimeout:(fn,delay)=>{const id=++timerId;timers.set(id,{fn,delay});return id;},clearTimeout:id=>timers.delete(id),fetch:async(url,options)=>{requests.push({url,options});return fetchImpl?fetchImpl(requests.length,payload):{ok:true,status:200,json:async()=>payload};}};
 await runInNewContext(code,context);await Promise.resolve();
 return {root,payload,requests,maps,events,timers,location,setTime:value=>{now=value;},now:()=>now};
}
test('shared page renders the server single-zone contract, author, safe text, photos and map without login',async()=>{
 const p=await page();
 assert.match(p.root.textContent,/303AB/);assert.match(p.root.textContent,/작성자 · 예시 기사/);assert.match(p.root.textContent,/<img src=x/);
 assert.equal(find(p.root,e=>e.tag==='img').length,2);assert.equal(p.maps[0].zone.id,'zone');assert.equal(p.maps[0].tips.length,1);
 assert.equal(p.requests[0].options.cache,'no-store');assert.equal(p.requests[0].options.method,'POST');assert.ok(!p.requests[0].url.includes('a'.repeat(64)));
});
test('a 30-day share is not prematurely removed at the browser timer limit and clears at actual expiry',async()=>{
 const p=await page({days:30}),first=[...p.timers.values()][0],start=p.now();
 assert.ok(first.delay<30*86400000);p.setTime(start+first.delay);first.fn();
 assert.match(p.root.textContent,/303AB/);
 p.setTime(Date.parse(p.payload.expires_at)+1);[...p.timers.values()].at(-1).fn();
 assert.match(p.root.textContent,/공유 기간이 끝났습니다/);assert.doesNotMatch(p.root.textContent,/예시 기사|원본 메모/);assert.ok(p.maps.includes('destroy'));
});
test('location-free tips do not create a misleading map and failed refresh removes previous content',async()=>{
 const p=await page({coords:false,fetchImpl:(number,payload)=>number===1?{ok:true,status:200,json:async()=>payload}:{ok:false,status:404,json:async()=>({error:'closed'})}});
 assert.equal(p.maps.length,0);
 await p.events.hashchange();
 assert.doesNotMatch(p.root.textContent,/원본 메모|예시 기사/);assert.match(p.root.textContent,/열 수 없습니다/);
});
test('expiry is rechecked when returning to a previously open shared page',async()=>{
 const p=await page();p.setTime(Date.parse(p.payload.expires_at)+1);p.events.visibilitychange();
 assert.match(p.root.textContent,/공유 기간이 끝났습니다/);assert.equal(find(p.root,e=>e.tag==='img').length,0);
});
test('changing a share link clears previous content and ignores a slower old response',async()=>{
 let resume;
 const p=await page({fetchImpl:(number,payload)=>{
  const response=name=>({ok:true,status:200,json:async()=>({...payload,zone:{...payload.zone,name}})});
  if(number===2)return new Promise(resolve=>{resume=()=>resolve(response('이전 링크'));});
  return response(number===1?'303AB':'현재 링크');
 }});
 p.location.hash='#token='+'b'.repeat(64);const older=p.events.hashchange();await Promise.resolve();
 assert.doesNotMatch(p.root.textContent,/원본 메모|예시 기사/);
 p.location.hash='#token='+'c'.repeat(64);await p.events.hashchange();resume();await older;
 assert.match(p.root.textContent,/현재 링크/);assert.doesNotMatch(p.root.textContent,/이전 링크/);
});
