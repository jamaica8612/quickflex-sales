import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createNoahController } from "../src/ui/noah.js";
import { noahStepDone, noahStepText, noahThinkingSummary } from "../src/lib/noah-thinking.js";

test("thinking steps read as present while running and past once done", () => {
  assert.equal(noahStepText("매출 기록을 확인하고 있어요."), "매출 기록을 확인하고 있어요");
  assert.equal(noahStepDone("질문을 살펴보고 있어요."), "질문을 살펴봤어요");
  assert.equal(noahStepDone("구역 팁을 찾고 있어요."), "구역 팁을 찾았어요");
  assert.equal(noahStepDone("확인한 자료로 답을 정리하고 있어요."), "확인한 자료로 답을 정리했어요");
});

test("thinking summary names what Noah checked and how long it took", () => {
  assert.equal(noahThinkingSummary(["질문을 살펴보고 있어요", "매출 기록을 확인하고 있어요", "구역 팁을 찾고 있어요"], 2140), "매출 기록·구역 팁 확인함 · 2.1초");
  assert.equal(noahThinkingSummary(["질문을 살펴보고 있어요"], 900), "생각 완료 · 0.9초");
  assert.equal(noahThinkingSummary([], Number.NaN), "생각 완료");
});

class FakeElement {
  constructor(doc, tag) {
    this.ownerDocument = doc; this.tagName = tag; this.children = []; this.handlers = new Map();
    this.attributes = {}; this.dataset = {}; this.value = ""; this.disabled = false; this.parentNode = null;
    this.className = ""; this._text = ""; this.scrollHeight = 0; this.scrollTop = 0; this.hidden = false;
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((item) => item.textContent).join(""); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  append(...nodes) { for (const node of nodes) { node.parentNode?.children.splice(node.parentNode.children.indexOf(node), 1); node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this._text = ""; this.append(...nodes); }
  insertBefore(node, next) { node.parentNode = this; this.children.splice(this.children.indexOf(next), 0, node); }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  addEventListener(type, callback) { const list = this.handlers.get(type) || []; list.push(callback); this.handlers.set(type, list); }
  removeEventListener() {}
  querySelector(query) { return query === '[type="submit"]' ? this.children.find((item) => item.type === "submit") : null; }
}
const walk = (node) => [node, ...node.children.flatMap(walk)];
const find = (root, className) => walk(root).filter((node) => String(node.className).split(" ").includes(className));

test("progress events build a thinking bubble that folds into the answer", async () => {
  const doc = { createElement(tag) { return new FakeElement(doc, tag); } };
  const thread = doc.createElement("ol");
  const form = doc.createElement("form");
  const submit = doc.createElement("button"); submit.type = "submit"; form.append(submit);
  const suggestions = doc.createElement("div");
  const encoder = new TextEncoder();
  let push;
  const events = [];
  const body = new ReadableStream({ start(controller) { push = (event, data) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); events.push(controller); } });
  const fetcher = async () => ({ ok: true, headers: { get: () => "text/event-stream" }, body });
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) }, functions: { invoke: async () => ({ data: { answer: "fallback" } }) } };
  const account = { client, userId: "u", epoch: 1, approved: true, noticeAcknowledgedAt: "2026-09-24T00:00:00Z", supabaseUrl: "https://example.invalid", anonKey: "k" };
  const controller = createNoahController({ thread, form, input: doc.createElement("input"), suggestions, status: doc.createElement("p"), getContext: () => account, fetcher });
  const asked = controller.ask("이번 주 매출 요약해줘");
  const tick = () => new Promise((resolve) => setTimeout(resolve, 5));
  await tick();
  push("progress", { message: "질문을 살펴보고 있어요." });
  push("progress", { message: "매출 기록을 확인하고 있어요." });
  push("progress", { message: "매출 기록을 확인하고 있어요." });
  await tick();
  const [thinking] = find(thread, "noah-thinking");
  assert.ok(thinking, "thinking bubble is shown while waiting");
  assert.equal(suggestions.hidden, true);
  const steps = find(thread, "noah-steps")[0].children;
  assert.deepEqual(steps.map((node) => [node.className, node.textContent]), [["done", "질문을 살펴봤어요"], ["now", "매출 기록을 확인하고 있어요"]]);
  push("progress", { message: "관련 기록을 확인했어요." });
  push("delta", { text: "이번 주 " });
  await tick();
  assert.equal(find(thread, "noah-think").length, 0);
  assert.match(find(thread, "noah-think-done")[0].textContent, /^매출 기록 확인함 · \d+\.\d초/);
  push("done", { answer: "이번 주 매출은 720,000원이에요.", proposals: [], sources: [], links: [] });
  events[0].close();
  await asked;
  const answer = thread.children.at(-1);
  assert.equal(answer.className, "noah-msg from-noah");
  assert.equal(answer.children.at(-1).textContent, "이번 주 매출은 720,000원이에요.");
  assert.equal(suggestions.hidden, false);
  controller.destroy();
});

test("Noah composer, header button, and keyboard handling ship together", () => {
  const worker = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles/noah.css", import.meta.url), "utf8");
  const base = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.ok(worker.includes('"./src/lib/noah-thinking.js"'));
  assert.ok(worker.includes('"./src/ui/noah-keyboard.js"'));
  assert.match(css, /\[data-keyboard="open"\] \.bottom-nav \{ display: none; \}/);
  assert.match(css, /\.noah-status\[data-pending="true"\]/);
  assert.match(base, /height: var\(--noah-vh, 100dvh\)/);
  assert.match(base, /\.noah-msg\.from-me p \{[^}]*background: var\(--gold\)/);
});
