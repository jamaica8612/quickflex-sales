import assert from "node:assert/strict";
import test from "node:test";
import { createNoahController } from "../src/ui/noah.js";

class FakeElement {
  constructor(doc, tag) {
    this.ownerDocument = doc; this.tagName = tag; this.children = []; this.handlers = new Map();
    this.attributes = {}; this.dataset = {}; this.value = ""; this.disabled = false; this.parentNode = null;
    this.className = ""; this._text = ""; this.scrollHeight = 0; this.scrollTop = 0;
  }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((item) => item.textContent).join(""); }
  setAttribute(key, value) { this.attributes[key] = String(value); }
  append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
  replaceChildren(...nodes) { for (const node of this.children) node.parentNode = null; this.children = []; this._text = ""; this.append(...nodes); }
  insertBefore(node, next) { node.parentNode = this; this.children.splice(this.children.indexOf(next), 0, node); }
  remove() { if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1); this.parentNode = null; }
  addEventListener(type, callback) { const list = this.handlers.get(type) || []; list.push(callback); this.handlers.set(type, list); }
  removeEventListener(type, callback) { this.handlers.set(type, (this.handlers.get(type) || []).filter((item) => item !== callback)); }
  click() { for (const handler of this.handlers.get("click") || []) handler({ preventDefault() {} }); }
  querySelector(query) { return query === '[type="submit"]' ? this.children.find((item) => item.type === "submit") : null; }
  querySelectorAll() { return this.children; }
}
function setup(invoke, onChanged) {
  const doc = { createElement(tag) { return new FakeElement(doc, tag); } };
  const thread = doc.createElement("ol");
  const form = doc.createElement("form");
  const submit = doc.createElement("button"); submit.type = "submit"; form.append(submit);
  const input = doc.createElement("input");
  const status = doc.createElement("p");
  const suggestions = doc.createElement("div");
  const client = { functions: { invoke } };
  let account = { client, userId: "user-a", epoch: 1, approved: true, noticeAcknowledgedAt: "2026-09-24T00:00:00Z" };
  const changed = [];
  const controller = createNoahController({ thread, form, input, suggestions, status, getContext: () => account, onChanged: () => { changed.push(true); return onChanged?.(); } });
  return { thread, form, input, status, submit, changed, controller, setAccount: (next) => { account = next; }, client };
}
function pending() { let resolve; let reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function walk(node) { return [node, ...node.children.flatMap(walk)]; }
function proposal(id = "p-1") {
  return { id, status: "pending", title: "목표 변경", changes: [{ label: "하루 목표", before: "10", after: "12" }], expiresAt: "2099-01-01T00:00:00Z" };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("chat sends bounded memory history and renders plain text", async () => {
  const calls = [];
  const view = setup(async (_name, options) => {
    calls.push(options.body);
    return { data: { answer: "<script>안전한 텍스트</script>", model: "gpt-6-luna", proposals: [], sources: [] } };
  });
  for (let index = 0; index < 8; index++) await view.controller.ask(`질문 ${index}`);
  assert.equal(calls[0].history.length, 0);
  assert.equal(calls[7].history.length, 12);
  assert.deepEqual(calls[7].history[0], { role: "user", content: "질문 1" });
  assert.ok(view.thread.textContent.includes("<script>안전한 텍스트</script>"));
  assert.equal(walk(view.thread).some((node) => node.tagName === "script"), false);
  view.controller.destroy();
});

test("reset aborts pending chat and drops an old account response", async () => {
  const deferred = pending();
  const view = setup(() => deferred.promise);
  const request = view.controller.ask("계정 A 질문");
  await tick();
  view.setAccount({ client: view.client, userId: "user-b", epoch: 2, approved: true });
  view.controller.reset();
  deferred.resolve({ data: { answer: "계정 A 답변", proposals: [], sources: [] } });
  await request;
  assert.equal(view.thread.textContent.includes("계정 A"), false);
  assert.equal(view.thread.children.length, 1);
  view.controller.destroy();
});

test("proposal requires a real click and blocks double confirmation", async () => {
  const confirm = pending();
  const calls = [];
  const view = setup(async (_name, options) => {
    calls.push(options.body);
    if (options.body.operation === "chat") return { data: { answer: "변경 전 확인해 주세요", proposals: [proposal()], sources: [] } };
    return confirm.promise;
  });
  await view.controller.ask("목표 바꿔줘");
  assert.equal(calls.length, 1);
  const button = walk(view.thread).find((node) => node.textContent === "확인 후 적용");
  button.click(); button.click();
  await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1], { operation: "confirm", proposalId: "p-1" });
  confirm.resolve({ data: { proposal: { ...proposal(), status: "confirmed" }, message: "완료" } });
  await tick();
  assert.equal(view.changed.length, 1);
  assert.equal(button.disabled, true);
  view.controller.destroy();
});

test("uncertain confirmation keeps proposal ID and never displays fake success", async () => {
  const calls = [];
  let attempts = 0;
  const view = setup(async (_name, options) => {
    calls.push(options.body);
    if (options.body.operation === "chat") return { data: { answer: "확인이 필요해요", proposals: [proposal("retry-id")], sources: [] } };
    attempts++;
    return attempts === 1 ? { error: { message: "network" } } : { data: { proposal: { ...proposal("retry-id"), status: "confirmed" } } };
  });
  await view.controller.ask("바꿔줘");
  const button = walk(view.thread).find((node) => node.textContent === "확인 후 적용");
  button.click(); await tick();
  assert.equal(view.changed.length, 0);
  assert.equal(view.thread.textContent.includes("변경 완료"), false);
  assert.equal(button.disabled, false);
  button.click(); await tick();
  assert.equal(calls[1].proposalId, "retry-id");
  assert.equal(calls[2].proposalId, "retry-id");
  assert.equal(view.changed.length, 1);
  view.controller.destroy();
});

test("failed chat retries once without another user message", async () => {
  let attempts = 0;
  const view = setup(async () => {
    attempts++;
    return attempts === 1 ? { error: { message: "offline" } } : { data: { answer: "다시 답변", proposals: [], sources: [] } };
  });
  await view.controller.ask("한 번만 표시");
  const retry = walk(view.thread).find((node) => node.textContent === "다시 시도");
  retry.click(); await tick();
  assert.equal(attempts, 2);
  assert.equal(walk(view.thread).filter((node) => node.className === "noah-msg from-me").length, 1);
  assert.equal(view.thread.textContent.includes("다시 답변"), true);
  view.controller.destroy();
});

test("reset aborts an in-flight confirmation without showing success", async () => {
  const deferred = pending();
  let signal;
  const view = setup(async (_name, options) => {
    if (options.body.operation === "chat") return { data: { answer: "확인해 주세요", proposals: [proposal()], sources: [] } };
    signal = options.signal;
    return deferred.promise;
  });
  await view.controller.ask("변경 제안");
  walk(view.thread).find((node) => node.textContent === "확인 후 적용").click();
  await tick();
  view.controller.reset();
  assert.equal(signal.aborted, true);
  deferred.resolve({ data: { proposal: { ...proposal(), status: "confirmed" } } });
  await tick();
  assert.equal(view.changed.length, 0);
  assert.equal(view.thread.textContent.includes("변경 완료"), false);
  view.controller.destroy();
});

test("cancel uses the proposal ID and does not call onChanged", async () => {
  const calls = [];
  const view = setup(async (_name, options) => {
    calls.push(options.body);
    if (options.body.operation === "chat") return { data: { answer: "확인해 주세요", proposals: [proposal()], sources: [] } };
    return { data: { proposal: { ...proposal(), status: "cancelled" }, message: "취소했어요" } };
  });
  await view.controller.ask("변경 제안");
  walk(view.thread).find((node) => node.textContent === "취소").click();
  await tick();
  assert.deepEqual(calls[1], { operation: "cancel", proposalId: "p-1" });
  assert.equal(view.changed.length, 0);
  assert.equal(view.thread.textContent.includes("취소 완료"), true);
  view.controller.destroy();
});

test("a proposal from a previous account cannot be confirmed after account switch", async () => {
  const calls = [];
  const view = setup(async (_name, options) => {
    calls.push(options.body);
    return { data: { answer: "확인해 주세요", proposals: [proposal()], sources: [] } };
  });
  await view.controller.ask("변경 제안");
  view.setAccount({ client: view.client, userId: "user-b", epoch: 2, approved: true });
  walk(view.thread).find((node) => node.textContent === "확인 후 적용").click();
  await tick();
  assert.equal(calls.length, 1);
  view.controller.destroy();
});

test("account reset during onChanged cannot append the old result", async () => {
  const refresh = pending();
  const view = setup(async (_name, options) => options.body.operation === "chat"
    ? { data: { answer: "확인해 주세요", proposals: [proposal()], sources: [] } }
    : { data: { proposal: { ...proposal(), status: "confirmed" }, message: "이전 계정 변경 완료" } }, () => refresh.promise);
  await view.controller.ask("변경 제안");
  walk(view.thread).find((node) => node.textContent === "확인 후 적용").click();
  await tick();
  view.setAccount({ client: view.client, userId: "user-b", epoch: 2, approved: true });
  view.controller.reset();
  refresh.resolve();
  await tick();
  assert.equal(view.thread.textContent.includes("이전 계정 변경 완료"), false);
  assert.equal(view.thread.children.length, 1);
  view.controller.destroy();
});

test("refresh rejection after reset leaves the new account status clear", async () => {
  const refresh = pending();
  const view = setup(async (_name, options) => options.body.operation === "chat"
    ? { data: { answer: "확인해 주세요", proposals: [proposal()], sources: [] } }
    : { data: { proposal: { ...proposal(), status: "confirmed" }, message: "완료" } }, () => refresh.promise);
  await view.controller.ask("변경 제안");
  walk(view.thread).find((node) => node.textContent === "확인 후 적용").click();
  await tick();
  view.controller.reset();
  refresh.reject(new Error("refresh failed"));
  await tick();
  assert.equal(view.status.textContent, "");
  view.controller.destroy();
});

test("retry is single-flight and later questions cannot overwrite history", async () => {
  const retried = pending();
  const calls = [];
  const view = setup(async (_name, options) => {
    calls.push(options.body);
    if (calls.length === 1) return { error: { message: "offline" } };
    if (calls.length === 2) return retried.promise;
    return { data: { answer: "다음 답변", proposals: [], sources: [] } };
  });
  await view.controller.ask("첫 질문");
  const retry = walk(view.thread).find((node) => node.textContent === "다시 시도");
  retry.click(); retry.click();
  await view.controller.ask("동시 질문");
  await tick();
  assert.equal(calls.length, 2);
  retried.resolve({ data: { answer: "첫 답변", proposals: [], sources: [] } });
  await tick();
  await view.controller.ask("다음 질문");
  assert.deepEqual(calls[2].history, [{ role: "user", content: "첫 질문" }, { role: "assistant", content: "첫 답변" }]);
  view.controller.destroy();
});

test("an old failed question cannot retry after a later successful question", async () => {
  const calls = [];
  const view = setup(async (_name, options) => {
    calls.push(options.body);
    return calls.length === 1 ? { error: { message: "offline" } } : { data: { answer: "새 답변", proposals: [], sources: [] } };
  });
  await view.controller.ask("실패 질문");
  const retry = walk(view.thread).find((node) => node.textContent === "다시 시도");
  await view.controller.ask("새 질문");
  assert.equal(retry.disabled, true);
  retry.click(); await tick();
  assert.equal(calls.length, 2);
  view.controller.destroy();
});

test("unknown raw resource keys are hidden from the answer UI", async () => {
  const view = setup(async () => ({ data: { answer: "요약", proposals: [], sources: ["profile", "sales_days", "finance_summary", "private_table"] } }));
  await view.controller.ask("요약해 줘");
  assert.match(view.thread.textContent, /요약/);
  assert.equal(view.thread.textContent.includes("private_table"), false);
  view.controller.destroy();
});
