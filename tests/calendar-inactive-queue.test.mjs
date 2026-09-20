import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source=readFileSync(new URL('../supabase/functions/calendar-sync/index.ts',import.meta.url),'utf8');
const code=source.slice(source.indexOf('async function processJob('),source.indexOf('async function runQueuedJobs('));
for (const status of ['connected','disconnected','needs_reconnect',null]) test(`calendar ${status} connection only defers while connected`,async()=>{
  let calls=0,google=0;
  const chain={update(){return this;},select(){return this;},eq(){return this;},or(){return this;},async maybeSingle(){return{data:calls++===0?null:(status?{connection_status:status}:null),error:null};}};
  const context=vm.createContext({privilegedDb:()=>({from:()=>chain}),disableCalendarForInactiveUser:async()=>false,refreshAccessToken:()=>{google++;throw Error('must not call Google');},Date});
  vm.runInContext(stripTypeScriptTypes(code)+'\nglobalThis.process = processJob;',context);
  const result=await context.process({user_id:'owner'});
  assert.equal(result.deferred,status==='connected');assert.equal(result.disabled,status!=='connected');assert.equal(google,0);
});
