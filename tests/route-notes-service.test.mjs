import assert from "node:assert/strict";
import test from "node:test";
import { createRouteNotesService } from "../src/services/route-notes.js";
import { normalizeRouteNoteTip, normalizeRouteNoteZone } from "../src/lib/route-notes.js";

const USER = "11111111-1111-4111-8111-111111111111";
const OTHER_USER = "22222222-2222-4222-8222-222222222222";
const COMPANY = "33333333-3333-4333-8333-333333333333";
const ZONE = "44444444-4444-4444-8444-444444444444";
const TIP = "55555555-5555-4555-8555-555555555555";
const PHOTO = "66666666-6666-4666-8666-666666666666";
const ZONE_PHOTO = "77777777-7777-4777-8777-777777777777";

function query(response, calls, table) {
  const chain = { table, calls, operation: null };
  for (const method of ["select", "eq", "in", "order", "update", "insert", "delete", "upsert"]) {
    chain[method] = (...args) => { calls.push([table, method, ...args]); if (["update", "insert", "delete", "upsert"].includes(method)) chain.operation = method; return chain; };
  }
  chain.single = async () => response;
  chain.maybeSingle = async () => response;
  chain.then = (resolve, reject) => Promise.resolve(response).then(resolve, reject);
  return chain;
}

function context(client, userId = USER) {
  return { client, user: { id: userId }, profile: { id: userId, status: "approved" } };
}

function provider(responses, calls, storage) {
  const captured = context(clientFor(responses, calls, storage));
  return () => captured;
}

function clientFor(responses = {}, calls = [], storage = {}) {
  return {
    from(table) { return query(responses[table] || { data: [], error: null }, calls, table); },
    storage: { from: () => ({
      createSignedUrl: async (path, seconds) => {
        calls.push(["storage", "createSignedUrl", path, seconds]);
        return storage.signed?.(path, seconds) || { data: { signedUrl: `signed:${path}` }, error: null };
      },
      upload: async (path, file, options) => {
        calls.push(["storage", "upload", path, file.type, options]);
        return storage.upload?.(path, file, options) || { error: null };
      },
      remove: async (paths) => {
        calls.push(["storage", "remove", ...paths]);
        return storage.remove?.(paths) || { error: null };
      },
    }) },
  };
}

function baseResponses() {
  return {
    quickflex_note_memberships: { data: [{ company_id: COMPANY, user_id: USER, role: "editor" }], error: null },
    quickflex_note_companies: { data: { id: COMPANY, name: "팀" }, error: null },
    quickflex_note_zones: { data: [], error: null },
    quickflex_note_favorites: { data: [], error: null },
  };
}

test("load scopes every company query to the single matching membership", async () => {
  const calls = [];
  const service = createRouteNotesService({ getContext: provider(baseResponses(), calls) });
  const loaded = await service.load();
  assert.equal(loaded.company.id, COMPANY);
  assert.equal(loaded.membership.user_id, USER);
  assert.ok(calls.some(([table, method, key, value]) => table === "quickflex_note_zones" && method === "eq" && key === "company_id" && value === COMPANY));
  assert.ok(calls.some(([table, method, key, value]) => table === "quickflex_note_favorites" && method === "eq" && key === "user_id" && value === USER));
});

test("multiple memberships fail closed instead of selecting another company", async () => {
  const responses = baseResponses();
  responses.quickflex_note_memberships = { data: [
    { company_id: COMPANY, user_id: USER, role: "editor" },
    { company_id: "77777777-7777-4777-8777-777777777777", user_id: USER, role: "member" },
  ], error: null };
  const service = createRouteNotesService({ getContext: provider(responses) });
  await assert.rejects(() => service.load(), /choose one company/i);
});

test("optimistic zone update reports a clear conflict when its revision no longer matches", async () => {
  const responses = baseResponses();
  responses.quickflex_note_zones = { data: null, error: null };
  const service = createRouteNotesService({ getContext: provider(responses) });
  await assert.rejects(() => service.saveZone({ id: ZONE, name: "A", memo: "", polygon: null, expectedUpdatedAt: "old" }), (error) => {
    assert.equal(error.code, "CONFLICT"); return true;
  });
});

test("a member may add an authored tip but cannot change company zones", async () => {
  const responses = baseResponses();
  responses.quickflex_note_memberships = { data: [{ company_id: COMPANY, user_id: USER, role: "member" }], error: null };
  responses.quickflex_note_zones = { data: { id: ZONE, company_id: COMPANY, name: "A" }, error: null };
  responses.quickflex_note_tips = { data: { id: TIP, company_id: COMPANY, zone_id: ZONE, created_by: USER }, error: null };
  const service = createRouteNotesService({ getContext: provider(responses) });
  const saved = await service.saveTip({ zone_id: ZONE, title: "입구", marker_type: "entrance", memo: "", lat: 37.5, lng: 127.0 });
  assert.equal(saved.created_by, USER);
  await assert.rejects(() => service.saveZone({ name: "A", memo: "", polygon: null }), /admins and editors/i);
});

test("a stale account cannot receive the old company's loaded zones", async () => {
  const calls = [];
  const responses = baseResponses();
  responses.quickflex_note_zones = { data: [{ id: ZONE, company_id: COMPANY, name: "A" }], error: null };
  let current = context(clientFor(responses, calls));
  const client = current.client;
  const originalFrom = client.from.bind(client);
  client.from = (table) => {
    const built = originalFrom(table);
    const originalThen = built.then;
    built.then = (resolve, reject) => originalThen((result) => {
      if (table === "quickflex_note_zones") current = context(clientFor(baseResponses(), calls), OTHER_USER);
      return resolve(result);
    }, reject);
    return built;
  };
  const service = createRouteNotesService({ getContext: async () => current });
  await assert.rejects(() => service.load(), /account changed/i);
});

test("photo metadata failure removes only the new private upload", async () => {
  const calls = [];
  const responses = baseResponses();
  responses.quickflex_note_tips = { data: { id: TIP, company_id: COMPANY, zone_id: ZONE, created_by: USER }, error: null };
  responses.quickflex_note_photos = { data: null, error: { message: "metadata denied" } };
  const service = createRouteNotesService({
    getContext: provider(responses, calls),
    cryptoImpl: { randomUUID: () => PHOTO },
  });
  await assert.rejects(() => service.uploadTipPhoto(TIP, { name: "x.png", type: "image/png", size: 3 }), /metadata denied/i);
  assert.ok(calls.some(([kind, method, path]) => kind === "storage" && method === "remove" && path === `${COMPANY}/${TIP}/${PHOTO}.png`));
});

test("loadZone returns short-lived private signed URLs rather than public object URLs", async () => {
  const responses = baseResponses();
  responses.quickflex_note_zones = { data: { id: ZONE, company_id: COMPANY, name: "A" }, error: null };
  responses.quickflex_note_tips = { data: [{ id: TIP, company_id: COMPANY, zone_id: ZONE, title: "입구" }], error: null };
  responses.quickflex_note_photos = { data: [{ id: PHOTO, company_id: COMPANY, tip_id: TIP, path: `${COMPANY}/${TIP}/${PHOTO}.jpg` }], error: null };
  const calls = [];
  const service = createRouteNotesService({ getContext: provider(responses, calls) });
  const loaded = await service.loadZone(ZONE);
  assert.equal(loaded.tips[0].photos[0].url, `signed:${COMPANY}/${TIP}/${PHOTO}.jpg`);
  assert.ok(calls.some(([kind, method, _path, seconds]) => kind === "storage" && method === "createSignedUrl" && seconds === 300));
});

test("loadZone scopes and signs imported zone photos without treating legacy authors as tip owners", async () => {
  const responses = baseResponses();
  responses.quickflex_note_zones = { data: { id: ZONE, company_id: COMPANY, name: "A" }, error: null };
  responses.quickflex_note_tips = { data: [], error: null };
  responses.quickflex_note_zone_photos = { data: [{ id: ZONE_PHOTO, company_id: COMPANY, zone_id: ZONE,
    path: `zones/${COMPANY}/${ZONE}/${ZONE_PHOTO}.jpeg`, created_by: null }], error: null };
  const calls = [];
  const service = createRouteNotesService({ getContext: provider(responses, calls) });
  const loaded = await service.loadZone(ZONE);
  assert.equal(loaded.zonePhotos[0].url, `signed:zones/${COMPANY}/${ZONE}/${ZONE_PHOTO}.jpeg`);
  assert.equal(loaded.zonePhotos[0].created_by, null);
  assert.ok(calls.some(([table, method, key, value]) => table === "quickflex_note_zone_photos" && method === "eq" && key === "company_id" && value === COMPANY));
  assert.ok(calls.some(([table, method, key, value]) => table === "quickflex_note_zone_photos" && method === "eq" && key === "zone_id" && value === ZONE));
});

test("missing or unapproved identity is rejected before any company query", async () => {
  for (const status of ["pending", "blocked"]) {
    const calls = [], current = context(clientFor(baseResponses(), calls));
    current.profile.status = status;
    await assert.rejects(createRouteNotesService({getContext:()=>current}).load());
    assert.equal(calls.length, 0);
  }
  await assert.rejects(createRouteNotesService({getContext:()=>({})}).load(), /matching signed-in/i);
});

test("account epoch change between parent lookup and mutation prevents the write", async () => {
  const calls = [], responses = baseResponses();
  responses.quickflex_note_zones={data:{id:ZONE,company_id:COMPANY},error:null};
  const current = {...context(clientFor(responses,calls)),epoch:1};
  const from=current.client.from.bind(current.client);
  current.client.from=(table)=>{ const chain=from(table); if(table==='quickflex_note_zones') {
    const single=chain.maybeSingle; chain.maybeSingle=async()=>{const result=await single();current.epoch++;return result;};
  } return chain; };
  const service=createRouteNotesService({getContext:()=>current});
  await assert.rejects(service.saveTip({zone_id:ZONE,title:'입구',marker_type:'entrance',lat:35,lng:129}),/account changed/i);
  assert.equal(calls.filter(([,operation])=>operation==='insert').length,0);
});

test("signed URL failure never deletes a photo whose metadata was saved", async () => {
  const calls=[], responses=baseResponses();
  responses.quickflex_note_tips={data:{id:TIP,company_id:COMPANY,created_by:USER},error:null};
  responses.quickflex_note_photos={data:{id:PHOTO,company_id:COMPANY,tip_id:TIP,path:`${COMPANY}/${TIP}/${PHOTO}.png`},error:null};
  const service=createRouteNotesService({getContext:provider(responses,calls,{signed:()=>({error:{message:'signing unavailable'}})}),cryptoImpl:{randomUUID:()=>PHOTO}});
  await assert.rejects(service.uploadTipPhoto(TIP,{name:'sample.png',type:'image/png',size:12}),/signing unavailable/);
  assert.equal(calls.filter(([type,operation])=>type==='storage'&&operation==='remove').length,0);
});

test("blank notes match NOT NULL schema and empty coordinates are not silently stored at zero", () => {
  assert.equal(normalizeRouteNoteZone({name:'303D'}).memo,'');
  const tip={zone_id:ZONE,title:'입구',marker_type:'entrance',lat:35,lng:129};
  assert.equal(normalizeRouteNoteTip(tip).memo,'');
  for(const lat of ['',null,false,Infinity]) assert.throws(()=>normalizeRouteNoteTip({...tip,lat}));
  assert.throws(()=>normalizeRouteNoteZone({name:'A'.repeat(81)}));
  assert.throws(()=>normalizeRouteNoteTip({...tip,title:'A'.repeat(121)}));
  const freeform=normalizeRouteNoteTip({...tip,marker_type:'note',lat:'',lng:''});
  assert.equal(freeform.lat,null);assert.equal(freeform.lng,null);
});

test("even a company admin cannot edit or delete another author's tip", async () => {
  const responses=baseResponses(), calls=[];
  responses.quickflex_note_memberships.data[0].role='admin';
  responses.quickflex_note_zones={data:{id:ZONE,company_id:COMPANY},error:null};
  responses.quickflex_note_tips={data:{id:TIP,company_id:COMPANY,zone_id:ZONE,created_by:OTHER_USER},error:null};
  const service=createRouteNotesService({getContext:provider(responses,calls)});
  await assert.rejects(service.saveTip({id:TIP,zone_id:ZONE,title:'변경',marker_type:'note',expectedUpdatedAt:'old'}),/작성자 본인/);
  await assert.rejects(service.deleteTip(TIP,'old'),/작성자 본인/);
  assert.equal(calls.filter(([,operation])=>['update','delete','insert'].includes(operation)).length,0);
});
