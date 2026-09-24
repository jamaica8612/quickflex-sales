import assert from "node:assert/strict";
import test from "node:test";
import { createNoahService, NoahStaleAccountError } from "../src/services/noah.js";
import * as noahCopy from "../src/lib/noah-brief.js";
const { NOAH_NOTICE, NOAH_PRIVACY_URL, noahChips, noahWelcome } = noahCopy;
import { validNoahLinks } from "../src/lib/noah-links.js";

const encoder = new TextEncoder();
function sse(chunks) {
  return new Response(new ReadableStream({
    start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); },
  }), { headers: { "content-type": "text/event-stream" } });
}
function fixture(fetcher, invoke = async () => ({ data: { answer: "fallback answer" } })) {
  const calls = [];
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "session-token" } } }) },
    functions: { invoke: async (...args) => { calls.push(args); return invoke(...args); } } };
  let account = { client, userId: "a", epoch: 1, approved: true, supabaseUrl: "https://example.test", anonKey: "public-key" };
  return { service: createNoahService({ getContext: () => account, fetcher }), calls, client,
    setAccount(value) { account = value; } };
}

test("SSE publishes progress and deltas, then returns only the final done payload", async () => {
  const seen = [];
  const view = fixture(async (url, options) => {
    assert.equal(url, "https://example.test/functions/v1/noah");
    assert.equal(options.headers.Authorization, "Bearer session-token");
    assert.equal(options.headers.apikey, "public-key");
    assert.equal(JSON.parse(options.body).stream, true);
    return sse(["event: progress\ndata: {\"message\":\"찾는 중\"}\n\n",
      "event: delta\ndata: {\"text\":\"첫\"}\n\n",
      "event: delta\ndata: {\"text\":\" 답\"}\n\n",
      "event: done\ndata: {\"answer\":\"첫 답\",\"links\":[],\"sources\":[],\"proposals\":[],\"model\":\"m\"}\n\n"]);
  });
  const result = await view.service.chat("질문", [], undefined, { onProgress: (v) => seen.push(v), onDelta: (v) => seen.push(v) });
  assert.equal(result.answer, "첫 답");
  assert.deepEqual(seen, ["찾는 중", "첫", " 답"]);
  assert.equal(view.calls.length, 0);
});

test("broken midstream response resets preview and invokes JSON fallback once", async () => {
  const seen = [];
  const view = fixture(async () => sse(["event: delta\ndata: {\"text\":\"partial\"}\n\n", "event: done\ndata: broken\n\n"]));
  const result = await view.service.chat("질문", [], undefined, { onDelta: (v) => seen.push(v), onReset: () => seen.push("reset") });
  assert.equal(result.answer, "fallback answer");
  assert.deepEqual(seen, ["partial", "reset"]);
  assert.equal(view.calls.length, 1);
  assert.equal(view.calls[0][1].body.stream, undefined);
});

test("server error event and notice rejection never cause duplicate fallback", async () => {
  const eventView = fixture(async () => sse(["event: error\ndata: {\"error\":\"오늘 한도에 도달했어요.\"}\n\n"]));
  await assert.rejects(eventView.service.chat("질문"), /오늘 한도/);
  assert.equal(eventView.calls.length, 0);
  const noticeView = fixture(async () => new Response(JSON.stringify({ error: "안내를 확인해 주세요." }), { status: 409,
    headers: { "content-type": "application/json" } }));
  await assert.rejects(noticeView.service.chat("질문"), /안내/);
  assert.equal(noticeView.calls.length, 0);
});

test("stale account rejects a pending stream without fallback", async () => {
  let finish;
  const view = fixture(() => new Promise((resolve) => { finish = resolve; }));
  const pending = view.service.chat("질문");
  await new Promise((resolve) => setImmediate(resolve));
  view.setAccount({ client: view.client, userId: "b", epoch: 2, approved: true });
  finish(sse(["event: done\ndata: {\"answer\":\"old\"}\n\n"]));
  await assert.rejects(pending, NoahStaleAccountError);
  assert.equal(view.calls.length, 0);
});

test("history request respects server count, character and byte bounds", async () => {
  const view = fixture(async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.ok(body.history.length <= 12);
    assert.ok(body.history.every((entry) => entry.content.length <= 8000));
    assert.ok(body.history.reduce((sum, entry) => sum + entry.content.length, body.message.length) <= 24000);
    assert.ok(encoder.encode(options.body).byteLength < 32768);
    return sse(["event: done\ndata: {\"answer\":\"ok\"}\n\n"]);
  });
  await view.service.chat("한".repeat(2000), Array.from({ length: 20 }, (_, index) => ({ role: index % 2 ? "assistant" : "user", content: "가".repeat(8000) })));
});

test("notice and welcome use known fields and never invent an unknown date or route", () => {
  assert.equal(NOAH_NOTICE, "노아는 질문에 필요한 기사님 기록만 찾아서 답해요. 대화는 저장하지 않고, 무언가를 바꿀 때는 꼭 확인을 받아요.");
  assert.doesNotMatch(NOAH_NOTICE, /OpenAI|이 폰에|보관/);
  assert.equal(NOAH_PRIVACY_URL, "./privacy.html#noah");
  assert.equal(noahWelcome({ phase: "beforeShift", workShift: "night", workDateLabel: "9/25", workDateCaption: "오늘 밤 9/25 마감", routes: ["302B"] }),
    "오늘 밤 9/25 근무 준비 중이시죠? 302B 팁이나 목표까지 남은 금액, 필요하면 바로 알려드릴게요.");
  assert.doesNotMatch(noahWelcome({ phase: "beforeShift", workShift: "day", workDateLabel: "9/25", routes: [] }), /오늘 밤/);
  assert.equal("noahBrief" in noahCopy, false);
  assert.equal(noahChips({ phase: "active" }).length, 3);
});

test("suggested questions vary, stay distinct and only name a route when one is known", () => {
  const seeded = (seed) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const seen = new Set();
  for (let seed = 1; seed <= 40; seed += 1) {
    const chips = noahChips({ phase: "beforeShift", routes: ["302B"] }, seeded(seed));
    assert.equal(chips.length, 3);
    assert.equal(new Set(chips).size, 3);
    chips.forEach((chip) => { assert.doesNotMatch(chip, /\{route\}/); seen.add(chip); });
  }
  assert.ok(seen.size >= 6, "a wider pool should appear across openings");
  assert.ok([...seen].some((chip) => chip.startsWith("302B ")));
  for (let seed = 1; seed <= 20; seed += 1) {
    const chips = noahChips({ phase: "active", routes: [] }, seeded(seed));
    assert.equal(chips.length, 3);
    chips.forEach((chip) => assert.doesNotMatch(chip, /\{route\}|302B/));
  }
  const closing = noahChips({ phase: "completed", closing: true }, seeded(7));
  assert.ok(closing.every((chip) => /정산|지출/.test(chip)));
});

test("links accept only known kinds and safe targets", () => {
  const links = validNoahLinks([{ kind: "day", target: { date: "2026-09-25" } },
    { kind: "route", target: { zoneId: "zone-1" } }, { kind: "settings", target: {} },
    { kind: "stats", target: { from: "2026-09-25", to: "2026-09-24" } },
    { kind: "evil", target: { url: "javascript:alert(1)" } }]);
  assert.deepEqual(links.map((link) => link.kind), ["day", "route", "settings"]);
});
