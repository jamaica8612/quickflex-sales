import { createNoahService, NoahStaleAccountError } from "../services/noah.js";
import { loadNoahHistory, saveNoahHistory, purgeNoahHistory } from "../lib/noah-history.js";
import { validNoahLinks } from "../lib/noah-links.js";
import { NOAH_NOTICE, noahBrief, noahChips, noahWelcome } from "../lib/noah-brief.js";

const MAX_HISTORY = 12;
const REQUEST_TIMEOUT_MS = 85000;
const AVATAR = new URL("../../assets/noah/noah-avatar-v1.webp", import.meta.url).href;
const SOURCE_LABELS = Object.freeze({
  profile: "내 정보", sales_days: "날짜별 매출", sales_manual_items: "수기 구역 매출",
  sales_automatic_work: "완료한 배송 작업", sales_overrides: "매출 수정 내역",
  expenses: "지출 내역", expense_adjustments: "환불·재입금", finance_summary: "매출·지출 요약",
  route_rates: "구역 단가", daily_inspections: "일상 점검", note_zones: "회사 구역",
  note_tips: "구역 팁", note_favorites: "즐겨찾기한 구역",
});

function element(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}
function dateLabel(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(time) : "만료 시간 확인 필요";
}
function proposalData(raw) {
  if (!raw || typeof raw.id !== "string" || !raw.id || raw.status !== "pending" || !Array.isArray(raw.changes)) return null;
  return {
    id: raw.id, status: "pending", title: String(raw.title || "변경 제안"), expiresAt: raw.expiresAt,
    changes: raw.changes.slice(0, 12).map((change) => ({ label: String(change?.label ?? "변경 항목"), before: String(change?.before ?? "없음"), after: String(change?.after ?? "없음") })),
  };
}
function sourceLabels(sources) {
  return [...new Set((Array.isArray(sources) ? sources : []).map((name) => SOURCE_LABELS[name]).filter(Boolean))];
}

export function createNoahController({ thread, form, input, suggestions, status, getContext,
  getBriefingContext = () => ({}), onNoticeAcknowledged = () => {}, onNavigate = () => {}, onChanged = () => {}, fetcher } = {}) {
  if (!thread || !form || !input || typeof getContext !== "function") throw new TypeError("노아 화면 연결 정보가 필요합니다.");
  const doc = thread.ownerDocument;
  const service = createNoahService({ getContext, ...(fetcher ? { fetcher } : {}) });
  const submit = form.querySelector('[type="submit"]');
  const statusNode = status || element(doc, "p", "noah-status");
  if (!status && form.parentNode) form.parentNode.insertBefore(statusNode, form);
  statusNode.setAttribute("role", "status");
  statusNode.setAttribute("aria-live", "polite");
  const clearButton = element(doc, "button", "noah-new-chat", "대화 지우기");
  clearButton.type = "button";
  clearButton.setAttribute("aria-label", "이 기기의 노아 대화 지우기");
  if (form.parentNode) form.parentNode.insertBefore(clearButton, statusNode.parentNode === form.parentNode ? statusNode : form);
  const briefNode = element(doc, "section", "noah-brief");
  briefNode.setAttribute("aria-label", "오늘의 노아 브리핑");
  if (thread.parentNode) thread.parentNode.insertBefore(briefNode, thread);

  let generation = 0;
  let destroyed = false;
  let chatPending = false;
  let activeDecisions = 0;
  let items = [];
  let activeUserId = null;
  let loaded = false;
  let loading = null;
  let acknowledgedHere = null;
  let freshlyAcknowledged = false;
  let pendingRetry = null;
  const requests = new Set();
  const proposals = new Map();

  function identity() {
    const context = getContext();
    return { client: context?.client, userId: context?.userId, epoch: context?.epoch, approved: context?.approved };
  }
  function current(start, account) {
    const now = identity();
    return !destroyed && generation === start && now.client === account.client && now.userId === account.userId && now.epoch === account.epoch && now.approved === account.approved;
  }
  function hasNotice() { return Boolean(getContext()?.noticeAcknowledgedAt || acknowledgedHere); }
  function setStatus(message, pending = false) {
    statusNode.textContent = message;
    statusNode.dataset.pending = String(pending);
    if (submit) submit.disabled = pending || !hasNotice();
    form.setAttribute("aria-busy", String(pending));
  }
  function avatar(large = false) {
    const wrap = element(doc, "span", `noah-avatar${large ? " noah-avatar-large" : ""}`);
    wrap.setAttribute("aria-hidden", "true");
    const picture = element(doc, "img");
    picture.src = AVATAR;
    picture.alt = "";
    picture.width = large ? 64 : 38;
    picture.height = large ? 64 : 38;
    wrap.append(picture);
    return wrap;
  }
  function appendMessage(text, from, className = "", largeAvatar = false) {
    const item = element(doc, "li", `noah-msg from-${from}${className ? ` ${className}` : ""}`);
    if (from === "noah") item.append(avatar(largeAvatar));
    const body = element(doc, "p", "", text);
    item.append(body);
    thread.append(item);
    thread.scrollTop = thread.scrollHeight;
    return { item, body };
  }
  function button(label, action, className = "") {
    const node = element(doc, "button", className, label);
    node.type = "button";
    node.addEventListener("click", action);
    return node;
  }
  function withTimeout(work, controller) {
    requests.add(controller);
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("응답 시간이 길어졌어요. 다시 시도해 주세요.")); }, REQUEST_TIMEOUT_MS);
    });
    return Promise.race([work(), timeout]).finally(() => { clearTimeout(timer); requests.delete(controller); });
  }
  function renderBrief() {
    briefNode.replaceChildren();
    const context = getBriefingContext() || {};
    const brief = noahBrief(context);
    if (brief) {
      briefNode.append(element(doc, "strong", "noah-brief-title", brief.title));
      if (brief.caption) briefNode.append(element(doc, "p", "noah-brief-caption", brief.caption));
      const list = element(doc, "ul", "noah-brief-facts");
      for (const row of brief.rows) {
        const fact = element(doc, "li");
        fact.append(button(row.label, () => { void ask(row.question); }, "noah-brief-ask"));
        list.append(fact);
      }
      briefNode.append(list);
    }
    if (suggestions) {
      suggestions.replaceChildren();
      for (const question of noahChips(context)) suggestions.append(button(question, () => { void ask(question); }, "noah-chip"));
    }
  }
  function renderLinks(host, links) {
    const safe = validNoahLinks(links);
    if (!safe.length) return;
    const row = element(doc, "div", "noah-links");
    row.setAttribute("aria-label", "관련 화면 이동");
    for (const link of safe) row.append(button(link.label, () => {
      if (getContext()?.userId === activeUserId) onNavigate({ kind: link.kind, target: link.target });
    }, "noah-link"));
    host.append(row);
  }
  function renderFeedback(host, result, account, start) {
    if (!getContext()?.client?.rpc) return;
    const bar = element(doc, "div", "noah-feedback");
    bar.append(element(doc, "span", "", "답변이 도움이 됐나요?"));
    let busy = false;
    const up = button("👍", () => vote(1), "noah-feedback-up");
    const down = button("👎", () => vote(-1), "noah-feedback-down");
    up.setAttribute("aria-label", "노아 답변이 도움이 됐어요");
    down.setAttribute("aria-label", "노아 답변이 도움이 안 됐어요");
    bar.append(up, down);
    host.append(bar);
    async function vote(rating) {
      if (busy || up.disabled || !current(start, account)) return;
      busy = true; up.disabled = true; down.disabled = true;
      const controller = new AbortController();
      try {
        await withTimeout(() => service.feedback({ rating, sources: result.sources, hasProposal: Boolean(result.proposals?.length),
          responseMs: result.elapsedMs, model: result.model }, controller.signal), controller);
        if (current(start, account)) bar.replaceChildren(element(doc, "span", "", "의견을 남겼어요. 고맙습니다."));
      } catch (error) {
        if (!current(start, account) || error instanceof NoahStaleAccountError) return;
        busy = false; up.disabled = false; down.disabled = false;
        setStatus("의견을 보내지 못했어요. 다시 눌러 주세요.");
      }
    }
  }
  function renderStored() {
    thread.replaceChildren();
    if (!hasNotice()) return renderNotice();
    if (!items.length) {
      const brief = getBriefingContext() || {};
      appendMessage(noahWelcome(freshlyAcknowledged ? { ...brief, phase: "firstUse" } : brief), "noah", "noah-welcome", true);
      freshlyAcknowledged = false;
      return;
    }
    for (const entry of items) {
      const view = appendMessage(entry.body, entry.role === "user" ? "me" : "noah");
      if (entry.role === "assistant") {
        renderLinks(view.item, entry.links);
        if (entry.proposalMarker) view.item.append(element(doc, "small", "noah-past-proposal", "이전 변경 제안 · 다시 요청해 주세요."));
      }
    }
  }
  function renderNotice() {
    thread.replaceChildren();
    const card = element(doc, "li", "noah-notice");
    card.append(avatar(true), element(doc, "strong", "", "노아를 시작하기 전에"), element(doc, "p", "", NOAH_NOTICE));
    const accept = button("확인하고 시작", async () => {
      if (accept.disabled) return;
      const start = generation;
      const account = identity();
      accept.disabled = true;
      setStatus("안내 확인을 저장하고 있어요…", true);
      const controller = new AbortController();
      try {
        const timestamp = await withTimeout(() => service.acknowledgeNotice(controller.signal), controller);
        if (!current(start, account)) return;
        acknowledgedHere = timestamp;
        freshlyAcknowledged = true;
        await onNoticeAcknowledged(timestamp);
        if (!current(start, account)) return;
        renderStored();
        setStatus("");
      } catch (error) {
        if (!current(start, account) || error instanceof NoahStaleAccountError) return;
        accept.disabled = false;
        setStatus(error?.message || "안내 확인을 저장하지 못했어요. 다시 시도해 주세요.");
      }
    }, "noah-notice-accept");
    card.append(accept);
    thread.append(card);
    setStatus("");
  }
  async function open() {
    if (destroyed) return;
    const account = identity();
    if (activeUserId && activeUserId !== account.userId) {
      for (const controller of requests) controller.abort();
      requests.clear();
      generation += 1;
      items = []; proposals.clear(); pendingRetry = null; chatPending = false;
      acknowledgedHere = null; loaded = false;
      // A switched account must not keep the prior account's local transcript.
      void purgeNoahHistory(activeUserId);
    }
    activeUserId = account.userId || null;
    renderBrief();
    if (!activeUserId || account.approved !== true) {
      items = []; loaded = true; thread.replaceChildren(); setStatus(""); return;
    }
    if (loaded) {
      if (!items.length && !chatPending && proposals.size === 0) renderStored();
      setStatus(""); return;
    }
    const start = generation;
    if (!loading) loading = loadNoahHistory(activeUserId).catch(() => []);
    const restored = await loading;
    if (!current(start, account)) return;
    items = restored;
    loaded = true;
    loading = null;
    renderStored();
    setStatus("");
  }
  function renderProposal(proposal) {
    if (proposals.has(proposal.id)) return;
    const card = element(doc, "li", "noah-proposal");
    const heading = element(doc, "strong", "noah-proposal-title", proposal.title);
    const state = element(doc, "p", "noah-proposal-state", `확인 전 · ${dateLabel(proposal.expiresAt)}까지`);
    const changes = element(doc, "dl", "noah-proposal-changes");
    for (const change of proposal.changes) {
      const row = element(doc, "div", "noah-proposal-change");
      row.append(element(doc, "dt", "", change.label));
      const values = element(doc, "dd");
      values.append(element(doc, "span", "noah-before", `이전: ${change.before}`));
      values.append(element(doc, "span", "noah-after", `변경: ${change.after}`));
      row.append(values); changes.append(row);
    }
    const actions = element(doc, "div", "noah-proposal-actions");
    const confirm = button("확인 후 적용", () => { void decide(proposal.id, "confirm"); }, "noah-confirm");
    const cancel = button("취소", () => { void decide(proposal.id, "cancel"); }, "noah-cancel");
    actions.append(confirm, cancel); card.append(heading, state, changes, actions);
    thread.append(card); thread.scrollTop = thread.scrollHeight;
    proposals.set(proposal.id, { proposal, state, confirm, cancel, account: identity(), busy: false });
  }
  async function decide(id, operation) {
    const item = proposals.get(id);
    if (!item || item.busy || item.proposal.status !== "pending") return;
    if (!current(generation, item.account)) return;
    if (Date.parse(item.proposal.expiresAt) <= Date.now()) {
      item.state.textContent = "제안이 만료됐어요. 새로 요청해 주세요.";
      item.confirm.disabled = true; item.cancel.disabled = true; return;
    }
    const start = generation;
    const account = identity();
    item.busy = true; activeDecisions += 1;
    clearButton.disabled = true; item.confirm.disabled = true; item.cancel.disabled = true;
    item.state.textContent = "서버에서 처리 결과를 확인하는 중…";
    const controller = new AbortController();
    try {
      const result = await withTimeout(() => service.decide(operation, id, controller.signal), controller);
      if (!current(start, account)) return;
      const returned = result?.proposal;
      if (returned?.id !== id || !["confirmed", "cancelled"].includes(returned.status)) throw new Error("처리 결과를 확인할 수 없어요. 같은 제안으로 다시 확인해 주세요.");
      item.proposal.status = returned.status;
      item.state.textContent = returned.status === "confirmed" ? "변경 완료" : "취소 완료";
      if (returned.status === "confirmed") {
        try { await onChanged(); } catch { if (current(start, account)) setStatus("변경은 완료됐지만 화면 새로고침에 실패했어요."); }
      }
      if (!current(start, account)) return;
      if (typeof result.message === "string" && result.message.trim()) appendMessage(result.message, "noah");
    } catch (error) {
      if (!current(start, account) || error instanceof NoahStaleAccountError) return;
      item.state.textContent = error?.message || "결과를 확인하지 못했어요. 같은 제안으로 다시 확인해 주세요.";
      // The server may have committed despite a lost response. Keep this ID for an idempotent retry.
      item.confirm.disabled = false; item.cancel.disabled = false;
    } finally {
      item.busy = false;
      if (current(start, account)) { activeDecisions = Math.max(0, activeDecisions - 1); clearButton.disabled = activeDecisions > 0; }
    }
  }
  async function ask(question) {
    const text = String(question || "").trim().slice(0, 2000);
    if (!text || chatPending || destroyed) return;
    if (!loaded) await open();
    if (!loaded || !hasNotice()) { setStatus("안내를 확인한 뒤 질문할 수 있어요."); return; }
    if (pendingRetry) { pendingRetry.button.disabled = true; pendingRetry = null; }
    const start = generation;
    const account = identity();
    const prior = items.slice(-MAX_HISTORY).map(({ role, body }) => ({ role, content: body }));
    const userMessage = appendMessage(text, "me");
    items = [...items, { role: "user", body: text, timestamp: Date.now(), links: [], sources: [], proposalMarker: false }].slice(-20);
    void saveNoahHistory(account.userId, items);
    async function send() {
      if (!current(start, account) || chatPending) return;
      chatPending = true;
      setStatus("노아가 확인 중이에요…", true);
      const controller = new AbortController();
      let preview = null;
      const clearPreview = () => { preview?.item.remove(); preview = null; };
      try {
        const result = await withTimeout(() => service.chat(text, prior, controller.signal, {
          onProgress(message) { if (current(start, account)) setStatus(message, true); },
          onDelta(delta) {
            if (!current(start, account)) return;
            if (!preview) preview = appendMessage("", "noah", "noah-streaming");
            preview.body.textContent += delta;
          },
          onReset() { if (current(start, account)) { clearPreview(); setStatus("답변을 다시 확인하고 있어요…", true); } },
        }), controller);
        if (!current(start, account)) return;
        if (typeof result.answer !== "string" || !result.answer.trim() || result.answer.length > 12000) throw new Error("답변을 확인할 수 없어요. 다시 시도해 주세요.");
        const answerView = preview || appendMessage(result.answer, "noah");
        answerView.item.className = "noah-msg from-noah";
        answerView.body.textContent = result.answer;
        renderLinks(answerView.item, result.links);
        renderFeedback(answerView.item, result, account, start);
        const validProposals = (Array.isArray(result.proposals) ? result.proposals : []).map(proposalData).filter(Boolean);
        items = [...items, { role: "assistant", body: result.answer, timestamp: Date.now(), links: validNoahLinks(result.links),
          sources: (Array.isArray(result.sources) ? result.sources : []).filter((value) => typeof value === "string").slice(0, 20), proposalMarker: validProposals.length > 0 }].slice(-20);
        void saveNoahHistory(account.userId, items);
        for (const proposal of validProposals) renderProposal(proposal);
        setStatus("");
      } catch (error) {
        clearPreview();
        if (!current(start, account) || error instanceof NoahStaleAccountError) return;
        const errorItem = appendMessage(error?.message || "연결을 확인하고 다시 시도해 주세요.", "noah", "noah-error").item;
        const retry = button("다시 시도", () => {
          if (pendingRetry?.button !== retry || chatPending || !current(start, account)) return;
          pendingRetry = null; retry.disabled = true; errorItem.remove(); void send();
        }, "noah-retry");
        pendingRetry = { button: retry };
        errorItem.append(retry);
        setStatus("답변을 받지 못했어요. 같은 질문을 다시 시도할 수 있어요.");
      } finally {
        if (current(start, account)) { chatPending = false; if (submit) submit.disabled = false; form.setAttribute("aria-busy", "false"); }
      }
    }
    await send();
    return userMessage.item;
  }
  function reset() {
    const oldUserId = activeUserId;
    generation += 1;
    for (const controller of requests) controller.abort();
    requests.clear(); items = []; pendingRetry = null; proposals.clear();
    chatPending = false; activeDecisions = 0; clearButton.disabled = false;
    input.value = ""; loaded = false; loading = null; acknowledgedHere = null; freshlyAcknowledged = false;
    activeUserId = null; thread.replaceChildren(); setStatus("");
    if (oldUserId) void purgeNoahHistory(oldUserId);
    void open();
  }
  function clearAccount(userId = activeUserId) {
    if (!userId) return Promise.resolve();
    if (userId === activeUserId) reset();
    return purgeNoahHistory(userId);
  }
  function onSubmit(event) {
    event.preventDefault();
    const question = input.value;
    if (!String(question).trim() || chatPending) return;
    input.value = "";
    void ask(question);
  }
  clearButton.addEventListener("click", () => {
    if (activeDecisions > 0) return;
    const confirm = doc.defaultView?.confirm || globalThis.confirm;
    if (typeof confirm === "function" && !confirm("이 기기의 노아 대화를 지울까요?")) return;
    reset();
  });
  form.addEventListener("submit", onSubmit);
  void open();
  return {
    open, reset, clearAccount, ask,
    destroy() {
      if (destroyed) return;
      generation += 1; destroyed = true;
      for (const controller of requests) controller.abort();
      requests.clear();
      form.removeEventListener("submit", onSubmit);
      clearButton.remove(); briefNode.remove();
      if (!status) statusNode.remove();
    },
  };
}
