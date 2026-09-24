import assert from "node:assert/strict";
import test from "node:test";
import { createNoahDataTools, NOAH_READ_RESOURCES, NOAH_WRITE_ACTIONS } from "../supabase/functions/noah/data-tools.js";

const owner="11111111-1111-4111-8111-111111111111";
const proposal="22222222-2222-4222-8222-222222222222";
function clientFixture(rowsByTable={}) {
  const calls=[];
  const client={
    from(table) {
      const call={table,filters:[]}; calls.push(call);
      const query={
        select(columns) { call.columns=columns; return query; },
        eq(column,value) { call.filters.push(["eq",column,value]); return query; },
        gte(column,value) { call.filters.push(["gte",column,value]); return query; },
        lte(column,value) { call.filters.push(["lte",column,value]); return query; },
        ilike(column,value) { call.filters.push(["ilike",column,value]); return query; },
        in(column,value) { call.filters.push(["in",column,value]); return query; },
        order(column,options) { call.order??=[];call.order.push([column,options]); return query; },
        range(from,to) { call.range=[from,to]; return Promise.resolve({data:rowsByTable[table]||[],error:null}); },
      }; return query;
    },
    rpc(name,args) { calls.push({rpc:name,args}); return Promise.resolve({data:name==="quickflex_noah_consume_quota"?{allowed:true,remainingDaily:99,remainingMinute:9}:{id:proposal,status:"pending"},error:null}); },
  };
  return {client,calls};
}

test("Noah read allowlist enforces explicit owner, fixed columns and pagination",async()=>{
  const {client,calls}=clientFixture({quickflex_expenses:[{id:proposal,merchant:"Fuel"}]});
  const tools=createNoahDataTools({client,userId:owner});
  const answer=await tools.read({resource:"expenses",from:"2026-09-01",to:"2026-09-24",search:"Fuel",offset:4,limit:5});
  assert.equal(answer.resource,"expenses");
  assert.equal(answer.count,1);
  assert.equal(answer.hasMore,false);
  assert.match(answer.semantics,/환불/);
  assert.deepEqual(calls[0].filters.slice(0,3),[["eq","user_id",owner],["gte","actual_date","2026-09-01"],["lte","actual_date","2026-09-24"]]);
  assert.deepEqual(calls[0].range,[4,9]);
  assert.doesNotMatch(calls[0].columns,/object_path|signature_data|request_id/);
  await assert.rejects(()=>tools.read({resource:"auth.users"}),RangeError);
  await assert.rejects(()=>tools.read({resource:"expenses",limit:500}),RangeError);
  await assert.rejects(()=>tools.read({resource:"route_rates",from:"2026-09-01"}),RangeError);
  await assert.rejects(()=>tools.read({resource:"expenses",from:"2026-02-30"}),RangeError);
  await assert.rejects(()=>tools.read({resource:"toString"}),RangeError);
});

test("automatic work embeds only owned work routes and declares merge semantics",async()=>{
  const {client,calls}=clientFixture({
    quickflex_sales_work_results:[{work_id:"team:2026-09-24",work_date:"2026-09-24"}],
    quickflex_sales_work_routes:[{work_id:"team:2026-09-24",route:"318A",delivery_count:3,unit_snapshot:900}],
  });
  const answer=await createNoahDataTools({client,userId:owner}).read({resource:"sales_automatic_work",limit:10});
  assert.equal(answer.rows[0].routes.length,1);
  assert.match(answer.semantics,/중복 합산/);
  assert.ok(calls.every((call)=>call.filters.some((filter)=>filter[0]==="eq"&&filter[1]==="user_id"&&filter[2]===owner)));
});

test("company reads require own membership and write methods use narrow RPC names",async()=>{
  const {client,calls}=clientFixture({quickflex_note_memberships:[{company_id:proposal}],quickflex_note_tips:[{id:proposal,title:"Entrance"}]});
  const tools=createNoahDataTools({client,userId:owner});
  const tips=await tools.read({resource:"note_tips",limit:5});
  assert.equal(tips.rows.length,1);
  assert.deepEqual(calls.find((call)=>call.table==="quickflex_note_tips").filters.find((filter)=>filter[0]==="in"),["in","company_id",[proposal]]);
  await tools.prepareWrite({action:"set_monthly_goal",values:{goal_amount:7000000}});
  await tools.confirmWrite({proposalId:proposal});
  await tools.cancelWrite({proposalId:proposal});
  await tools.consumeQuota();
  assert.deepEqual(calls.filter((call)=>call.rpc).map((call)=>call.rpc),[
    "quickflex_noah_prepare_write","quickflex_noah_confirm_write","quickflex_noah_cancel_write","quickflex_noah_consume_quota",
  ]);
  assert.ok("expenses" in NOAH_READ_RESOURCES);
  assert.ok("add_expense" in NOAH_WRITE_ACTIONS);
});

test("quota denial is an error with server retry metadata",async()=>{
  const {client}=clientFixture();
  client.rpc=async()=>({data:{allowed:false,remainingDaily:0,remainingMinute:0,retryAfterSeconds:3600},error:null});
  const tools=createNoahDataTools({client,userId:owner});
  await assert.rejects(()=>tools.consumeQuota(),(error)=>error.code==="NOAH_QUOTA_EXCEEDED"&&error.quota.retryAfterSeconds===3600);
});
