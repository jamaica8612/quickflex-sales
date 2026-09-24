import { createNoahService, NoahStaleAccountError } from "../services/noah.js";

const MAX_HISTORY = 12;
const REQUEST_TIMEOUT_MS = 85000;
const WELCOME = "안녕하세요, 노아예요. 매출, 배송, 구역에 대해 무엇이든 물어보세요.";
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
    changes: raw.changes.map((change) => ({ label: String(change?.label ?? "변경 항목"), before: String(change?.before ?? "없음"), after: String(change?.after ?? "없음") })),
  };
}

export function createNoahController({ thread, form, input, suggestions, status, getContext, onChanged = () => {} } = {}) {
  if (!thread || !form || !input || typeof getContext !== "function") throw new TypeError("노아 화면 연결 정보가 필요합니다.");
  const doc = thread.ownerDocument;
  const service = createNoahService({ getContext });
  const submit = form.querySelector('[type="submit"]');
  const suggestionButtons = suggestions ? [...suggestions.querySelectorAll("[data-noah-ask]")] : [];
  const statusNode = status || element(doc, "p", "noah-status");
  if (!status && form.parentNode) form.parentNode.insertBefore(statusNode, form);
  statusNode.setAttribute("role", "status");
  statusNode.setAttribute("aria-live", "polite");
  const newChatButton = element(doc, "button", "noah-new-chat", "새 대화");
  newChatButton.type = "button";
  newChatButton.setAttribute("aria-label", "노아 대화 초기화");
  newChatButton.addEventListener("click", () => reset());
  if (form.parentNode) form.parentNode.insertBefore(newChatButton, statusNode.parentNode === form.parentNode ? statusNode : form);

  let generation = 0;
  let destroyed = false;
  let chatPending = false;
  let activeDecisions = 0;
  let history = [];
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
  function setStatus(message, pending = false) {
    statusNode.textContent = message;
    statusNode.dataset.pending = String(pending);
    if (submit) submit.disabled = pending;
    form.setAttribute("aria-busy", String(pending));
  }
  function appendMessage(text, from, className = "") {
    const item = element(doc, "li", `noah-msg from-${from}${className ? ` ${className}` : ""}`);
    if (from === "noah") {
      const avatar = element(doc, "span", "noah-avatar", "N");
      avatar.setAttribute("aria-hidden", "true");
      item.append(avatar);
    }
    item.append(element(doc, "p", "", text));
    thread.append(item);
    thread.scrollTop = thread.scrollHeight;
    return item;
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
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("응답 시간이 길어졌어요. 다시 시도해 주세요."));
      }, REQUEST_TIMEOUT_MS);
    });
    return Promise.race([work(), timeout]).finally(() => { clearTimeout(timer); requests.delete(controller); });
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
      row.append(values);
      changes.append(row);
    }
    const actions = element(doc, "div", "noah-proposal-actions");
    const confirm = button("확인 후 적용", () => decide(proposal.id, "confirm"), "noah-confirm");
    const cancel = button("취소", () => decide(proposal.id, "cancel"), "noah-cancel");
    actions.append(confirm, cancel);
    card.append(heading, state, changes, actions);
    thread.append(card);
    thread.scrollTop = thread.scrollHeight;
    proposals.set(proposal.id, { proposal, state, confirm, cancel, account: identity(), busy: false });
  }
  async function decide(id, operation) {
    const item = proposals.get(id);
    if (!item || item.busy || item.proposal.status !== "pending") return;
    if (!current(generation, item.account)) return;
    if (Date.parse(item.proposal.expiresAt) <= Date.now()) {
      item.state.textContent = "제안이 만료됐어요. 새로 요청해 주세요.";
      item.confirm.disabled = true;
      item.cancel.disabled = true;
      return;
    }
    const start = generation;
    const account = identity();
    item.busy = true;
    activeDecisions += 1;
    newChatButton.disabled = true;
    item.confirm.disabled = true;
    item.cancel.disabled = true;
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
        try { await onChanged(); } catch {
          if (current(start, account)) setStatus("변경은 완료됐지만 화면 새로고침에 실패했어요.");
        }
      }
      if (!current(start, account)) return;
      if (typeof result.message === "string" && result.message.trim()) appendMessage(result.message, "noah");
    } catch (error) {
      if (!current(start, account) || error instanceof NoahStaleAccountError) return;
      item.state.textContent = error?.message || "결과를 확인하지 못했어요. 같은 제안으로 다시 확인해 주세요.";
      // The server may have committed despite a lost response. Keep this ID for an idempotent retry.
      item.confirm.disabled = false;
      item.cancel.disabled = false;
    } finally {
      item.busy = false;
      if (current(start, account)) {
        activeDecisions = Math.max(0, activeDecisions - 1);
        newChatButton.disabled = activeDecisions > 0;
      }
    }
  }
  async function ask(question) {
    const text = String(question || "").trim().slice(0, 2000);
    if (!text || chatPending || destroyed) return;
    if (pendingRetry) {
      pendingRetry.button.disabled = true;
      pendingRetry.button.textContent = "새 질문으로 재시도 종료";
      pendingRetry = null;
    }
    const start = generation;
    const account = identity();
    const userMessage = appendMessage(text, "me");
    async function send() {
      if (!current(start, account) || chatPending) return;
      chatPending = true;
      setStatus("노아가 확인 중이에요…", true);
      const controller = new AbortController();
      const prior = history.slice(-MAX_HISTORY);
      try {
        const result = await withTimeout(() => service.chat(text, prior, controller.signal), controller);
        if (!current(start, account)) return;
        if (typeof result.answer !== "string" || !result.answer.trim()) throw new Error("답변을 확인할 수 없어요. 다시 시도해 주세요.");
        appendMessage(result.answer, "noah");
        history = [...prior, { role: "user", content: text }, { role: "assistant", content: result.answer }].slice(-MAX_HISTORY);
        const sourceLabels = [...new Set((Array.isArray(result.sources) ? result.sources : []).map((name) => SOURCE_LABELS[name]).filter(Boolean))];
        if (sourceLabels.length) appendMessage(`참고: ${sourceLabels.join(" · ")}`, "noah", "noah-sources");
        for (const raw of Array.isArray(result.proposals) ? result.proposals : []) {
          const proposal = proposalData(raw);
          if (proposal) renderProposal(proposal);
        }
        setStatus("");
      } catch (error) {
        if (!current(start, account) || error instanceof NoahStaleAccountError) return;
        const errorItem = appendMessage(error?.message || "연결을 확인하고 다시 시도해 주세요.", "noah", "noah-error");
        const retry = button("다시 시도", () => {
          if (pendingRetry?.button !== retry || chatPending || !current(start, account)) return;
          pendingRetry = null;
          retry.disabled = true;
          errorItem.remove();
          void send();
        }, "noah-retry");
        pendingRetry = { button: retry };
        errorItem.append(retry);
        setStatus("답변을 받지 못했어요. 같은 질문을 다시 시도할 수 있어요.");
      } finally {
        if (current(start, account)) {
          chatPending = false;
          if (submit) submit.disabled = false;
          form.setAttribute("aria-busy", "false");
        }
      }
    }
    await send();
    return userMessage;
  }
  function reset() {
    generation += 1;
    for (const controller of requests) controller.abort();
    requests.clear();
    history = [];
    pendingRetry = null;
    proposals.clear();
    chatPending = false;
    activeDecisions = 0;
    newChatButton.disabled = false;
    input.value = "";
    thread.replaceChildren();
    appendMessage(WELCOME, "noah");
    setStatus("");
  }
  function onSubmit(event) {
    event.preventDefault();
    const question = input.value;
    if (!String(question).trim() || chatPending) return;
    input.value = "";
    void ask(question);
  }
  const suggestionHandlers = suggestionButtons.map((node) => {
    const handler = () => { void ask(node.textContent); };
    node.addEventListener("click", handler);
    return [node, handler];
  });
  form.addEventListener("submit", onSubmit);
  reset();
  return {
    reset,
    ask,
    destroy() {
      if (destroyed) return;
      reset();
      destroyed = true;
      form.removeEventListener("submit", onSubmit);
      for (const [node, handler] of suggestionHandlers) node.removeEventListener("click", handler);
      newChatButton.remove();
      if (!status) statusNode.remove();
    },
  };
}
