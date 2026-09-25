import { createNoahService, NoahStaleAccountError } from "../services/noah.js";
import { validNoahLinks } from "../lib/noah-links.js";
import { NOAH_NOTICE, NOAH_PRIVACY_URL, noahChips, noahWelcome } from "../lib/noah-brief.js";
import { noahStepDone, noahStepText, noahThinkingSummary } from "../lib/noah-thinking.js";
import { bindNoahKeyboard } from "./noah-keyboard.js";
import { bindNoahRefreshGuard } from "./noah-refresh-guard.js";

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
  const clearButton = element(doc, "button", "noah-new-chat", "새 대화");
  clearButton.type = "button";
  const view = form.closest?.(".view-noah") || null;
  const headerActions = view?.querySelector(".tab-head-actions");
  if (headerActions) headerActions.insertBefore(clearButton, headerActions.firstChild);
  else if (form.parentNode) form.parentNode.insertBefore(clearButton, statusNode.parentNode === form.parentNode ? statusNode : form);
  const unbindKeyboard = bindNoahKeyboard({ view, input, win: doc.defaultView });
  const unbindRefreshGuard = bindNoahRefreshGuard({ app: view?.closest?.(".app") || null, win: doc.defaultView });

  let generation = 0;
  let destroyed = false;
  let chatPending = false;
  let activeDecisions = 0;
  let items = [];
  let activeUserId = null;
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
    if (suggestions) suggestions.hidden = pending;
  }
  function avatar(large = false) {
    const wrap = element(doc, "span", `noah-avatar${large ? " noah-avatar-large" : ""}`);
    wrap.setAttribute("aria-hidden", "true");
    const picture = element(doc, "img");
    picture.src = AVATAR;
    picture.alt = "";
    picture.width = large ? 48 : 30;
    picture.height = large ? 48 : 30;
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
  // 답이 오기 전까지 노아 말풍선 자리에 실제 진행 단계를 보여줘요.
  function createThinking() {
    const item = element(doc, "li", "noah-msg from-noah noah-thinking");
    item.append(avatar());
    const box = element(doc, "div", "noah-think");
    const head = element(doc, "div", "noah-think-head");
    const dots = element(doc, "span", "noah-dots");
    dots.setAttribute("aria-hidden", "true");
    dots.append(element(doc, "i"), element(doc, "i"), element(doc, "i"));
    head.append(dots, element(doc, "span", "", "생각하는 중"));
    const list = element(doc, "ol", "noah-steps");
    box.append(head, list);
    item.append(box);
    thread.append(item);
    thread.scrollTop = thread.scrollHeight;
    return { item, box, list, steps: [], current: null, started: Date.now(), body: null };
  }
  function finishStep(view) {
    if (!view.current) return;
    view.current.node.className = "done";
    view.current.node.textContent = noahStepDone(view.current.text);
    view.current = null;
  }
  function addStep(view, message) {
    const text = noahStepText(message);
    if (!text || view.body) return;
    if (/했어요$/u.test(text)) { finishStep(view); return; }
    if (view.current?.text === text) return;
    finishStep(view);
    const node = element(doc, "li", "now", text);
    view.list.append(node);
    view.current = { node, text };
    view.steps.push(text);
    thread.scrollTop = thread.scrollHeight;
  }
  function settleThinking(view) {
    if (view.body) return view;
    finishStep(view);
    view.box.remove();
    const summary = noahThinkingSummary(view.steps, Date.now() - view.started);
    if (view.steps.length) {
      const details = element(doc, "details", "noah-think-done");
      details.append(element(doc, "summary", "", summary), view.list);
      view.item.append(details);
    } else {
      view.item.append(element(doc, "span", "noah-think-done", summary));
    }
    view.item.className = "noah-msg from-noah noah-streaming";
    view.body = element(doc, "p");
    view.item.append(view.body);
    return view;
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
  function renderChips(context = getBriefingContext() || {}) {
    if (!suggestions) return;
    suggestions.replaceChildren();
    for (const question of noahChips(context)) suggestions.append(button(question, () => { void ask(question); }, "noah-chip"));
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
  function renderStored() {
    thread.replaceChildren();
    if (!hasNotice()) return renderNotice();
    if (!items.length) {
      const brief = getBriefingContext() || {};
      const welcome = freshlyAcknowledged ? { ...brief, phase: "firstUse", closing: false } : brief;
      appendMessage(noahWelcome(welcome), "noah", "noah-welcome", true);
      if (freshlyAcknowledged) renderChips(welcome);
      freshlyAcknowledged = false;
      return;
    }
    for (const entry of items) {
      const view = appendMessage(entry.body, entry.role === "user" ? "me" : "noah");
      if (entry.role === "assistant") renderLinks(view.item, entry.links);
    }
  }
  function renderNotice() {
    thread.replaceChildren();
    const card = element(doc, "li", "noah-notice");
    const more = element(doc, "a", "noah-notice-more", "자세히 보기");
    more.href = NOAH_PRIVACY_URL;
    more.target = "_blank";
    more.rel = "noopener noreferrer";
    card.append(avatar(true), element(doc, "strong", "", "노아를 시작하기 전에"), element(doc, "p", "", NOAH_NOTICE), more);
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
  function open() {
    if (destroyed) return;
    const account = identity();
    if (activeUserId && activeUserId !== account.userId) {
      for (const controller of requests) controller.abort();
      requests.clear();
      generation += 1;
      items = []; proposals.clear(); pendingRetry = null; chatPending = false;
      acknowledgedHere = null;
    }
    activeUserId = account.userId || null;
    renderChips();
    if (!activeUserId || account.approved !== true) {
      items = []; thread.replaceChildren(); setStatus(""); return;
    }
    // The conversation lives only in this screen's memory; nothing is restored or saved.
    if (!items.length && !chatPending && proposals.size === 0) renderStored();
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
    if (activeUserId !== identity().userId) open();
    if (!hasNotice()) { setStatus("안내를 확인한 뒤 질문할 수 있어요."); return; }
    if (pendingRetry) { pendingRetry.button.disabled = true; pendingRetry = null; }
    const start = generation;
    const account = identity();
    const prior = items.slice(-MAX_HISTORY).map(({ role, body }) => ({ role, content: body }));
    const userMessage = appendMessage(text, "me");
    items = [...items, { role: "user", body: text, links: [] }].slice(-20);
    async function send() {
      if (!current(start, account) || chatPending) return;
      chatPending = true;
      setStatus("노아가 확인 중이에요…", true);
      const controller = new AbortController();
      let thinking = createThinking();
      const clearPreview = () => { if (thinking?.item.parentNode === thread) thinking.item.remove(); thinking = null; };
      try {
        const result = await withTimeout(() => service.chat(text, prior, controller.signal, {
          onProgress(message) {
            if (!current(start, account)) return;
            setStatus(message, true);
            if (thinking) addStep(thinking, message);
          },
          onDelta(delta) {
            if (!current(start, account)) return;
            if (!thinking) thinking = createThinking();
            settleThinking(thinking).body.textContent += delta;
            thread.scrollTop = thread.scrollHeight;
          },
          onReset() {
            if (!current(start, account)) return;
            clearPreview();
            thinking = createThinking();
            setStatus("답변을 다시 확인하고 있어요…", true);
          },
        }), controller);
        if (!current(start, account)) return;
        if (typeof result.answer !== "string" || !result.answer.trim() || result.answer.length > 12000) throw new Error("답변을 확인할 수 없어요. 다시 시도해 주세요.");
        const answerView = settleThinking(thinking || createThinking());
        answerView.item.className = "noah-msg from-noah";
        answerView.body.textContent = result.answer;
        renderLinks(answerView.item, result.links);
        const validProposals = (Array.isArray(result.proposals) ? result.proposals : []).map(proposalData).filter(Boolean);
        items = [...items, { role: "assistant", body: result.answer, links: validNoahLinks(result.links) }].slice(-20);
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
    generation += 1;
    for (const controller of requests) controller.abort();
    requests.clear(); items = []; pendingRetry = null; proposals.clear();
    chatPending = false; activeDecisions = 0; clearButton.disabled = false;
    input.value = ""; acknowledgedHere = null; freshlyAcknowledged = false;
    activeUserId = null; thread.replaceChildren(); setStatus("");
    open();
  }
  function clearAccount(userId = activeUserId) {
    if (userId && userId === activeUserId) reset();
    return Promise.resolve();
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
    reset();
  });
  form.addEventListener("submit", onSubmit);
  open();
  return {
    open, reset, clearAccount, ask,
    destroy() {
      if (destroyed) return;
      generation += 1; destroyed = true;
      for (const controller of requests) controller.abort();
      requests.clear();
      form.removeEventListener("submit", onSubmit);
      clearButton.remove();
      unbindKeyboard();
      unbindRefreshGuard();
      if (!status) statusNode.remove();
    },
  };
}
