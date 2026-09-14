import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const startup = readFileSync(new URL('../src/startup.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
function node() {
  const attrs = new Map();
  return { attrs, hidden:false, textContent:'', setAttribute:(k,v)=>attrs.set(k,v), removeAttribute:k=>attrs.delete(k),
    addEventListener(k,fn){this[k]=fn;}, querySelector:()=>null };
}
function harness(reduced=false) {
  let now=0, id=0, reloads=0; const timers=new Map();
  const nodes=Object.fromEntries(['startupSplash','startupStatus','startupRetry','app'].map(k=>[k,node()]));
  const root=node(); root.attrs.set('data-startup',''); nodes.app.attrs.set('inert',''); nodes.app.attrs.set('aria-hidden','true');
  const sandbox={document:{documentElement:root,getElementById:id=>nodes[id]},performance:{now:()=>now},
    setTimeout(fn,ms){timers.set(++id,{fn,at:now+ms});return id;},clearTimeout(id){timers.delete(id);},
    window:{matchMedia:()=>({matches:reduced}),requestAnimationFrame:fn=>fn(),location:{reload(){reloads++;}}}};
  vm.runInNewContext(startup,sandbox);
  function tick(ms) {const end=now+ms;while(true){const next=[...timers.entries()].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();}now=end;}
  return {root,nodes,tick,api:sandbox.window.FlexNoteStartup,reloads:()=>reloads};
}
test('unresolved session never exposes app; timeout gives retry without unlocking it',()=>{
  const h=harness(); h.tick(14999);assert.equal(h.nodes.startupRetry.hidden,true);assert.ok(h.nodes.app.attrs.has('inert'));
  h.tick(1);assert.equal(h.nodes.startupRetry.hidden,false);assert.ok(h.root.attrs.has('data-startup'));
  h.nodes.startupRetry.click();assert.equal(h.reloads(),1);
});
test('ready route removes input and accessibility gate, and only completes motion once',()=>{
  const h=harness();h.api.finish();h.api.finish();h.tick(759);assert.ok(h.root.attrs.has('data-startup'));
  h.tick(1);assert.equal(h.root.attrs.has('data-startup'),false);assert.equal(h.nodes.app.attrs.has('inert'),false);
  assert.equal(h.nodes.app.attrs.has('aria-hidden'),false);assert.ok(h.nodes.startupSplash.attrs.has('inert'));
  h.tick(160);assert.equal(h.nodes.startupSplash.hidden,true);h.tick(20000);assert.equal(h.nodes.startupRetry.hidden,true);
});
test('slow successful restore finishes immediately, without an extra intro delay',()=>{
  const h=harness();h.tick(4000);h.api.finish();h.tick(0);assert.equal(h.root.attrs.has('data-startup'),false);
});
test('reduced motion skips the intro delay',()=>{
  const h=harness(true);h.api.finish();h.tick(0);assert.equal(h.nodes.startupSplash.hidden,true);
});
test('late success recovers from timeout; a later error cannot cover the finished app',()=>{
  const h=harness();h.tick(15000);h.api.finish();h.tick(160);assert.equal(h.nodes.startupSplash.hidden,true);assert.equal(h.api.fail(),false);
});
test('explicit failure shows an honest retry state and preserves the auth gate',()=>{
  const h=harness();assert.equal(h.api.fail(),true);assert.match(h.nodes.startupStatus.textContent,/인터넷 연결/);
  assert.ok(h.nodes.app.attrs.has('inert'));assert.equal(h.nodes.startupSplash.attrs.get('aria-busy'),'false');
});
function declaration(name){const at=main.indexOf(`function ${name}(`);assert.ok(at>=0);const start=main.lastIndexOf('async ',at)===at-6?at-6:at;let n=0;const brace=main.indexOf('{',main.indexOf(')',at));for(let i=brace;i<main.length;i++){if(main[i]==='{')n++;if(main[i]==='}'&&!--n)return main.slice(start,i+1);}throw new Error(name);}
function bootHarness(status='approved'){
  const events=[];let release;let current=true;
  const sandbox={state:{profile:{status}},accountBootTask:null,events,
    captureAccountContext:()=>({epoch:1,userId:'fixture'}),isAccountContextCurrent:()=>current,
    loadProfile:async()=>true,loadFromDb:()=>new Promise(resolve=>{release=resolve;}),
    showAuth:v=>events.push(`auth:${v}`),showPending:v=>events.push(`pending:${v}`),applyProfileUi(){},
    renderAll:()=>events.push('render'),trackApprovedSessionStart(){},maybeOfferRateUpdate:async()=>{},
    window:{FlexNoteStartup:{finish:()=>events.push('finish')}}};
  vm.runInNewContext(`${declaration('bootSignedInUser')};globalThis.boot=bootSignedInUser;`,sandbox);
  return {events,boot:sandbox.boot,release:()=>release(true),stale:()=>{current=false;}};
}
test('approved account stays behind splash until profile and records render',async()=>{
  const h=bootHarness();const task=h.boot();await new Promise(setImmediate);assert.equal(h.events.includes('finish'),false);
  h.release();await task;assert.ok(h.events.indexOf('render')<h.events.indexOf('finish'));assert.ok(h.events.indexOf('auth:false')<h.events.indexOf('finish'));
});
test('pending account opens approval screen before dismissing splash',async()=>{
  const h=bootHarness('pending');await h.boot();assert.deepEqual(h.events,['auth:false','pending:true','finish']);
});
test('stale account result cannot dismiss splash',async()=>{
  const h=bootHarness();const task=h.boot();await new Promise(setImmediate);h.stale();h.release();await task;assert.equal(h.events.includes('finish'),false);
});
test('initial HTML hides and inerts app before any auth script executes',()=>{
  assert.match(html,/<html[^>]*data-startup/);assert.match(html,/<div class="app"[^>]*inert aria-hidden="true"/);
  assert.ok(html.indexOf('id="startupSplash"')<html.indexOf('id="app"'));
  assert.ok(html.indexOf('src/startup.js')<html.indexOf('supabase-js'));
  assert.match(html,/startup-tagline">배송의 모든 기록/);
});
