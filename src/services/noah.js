const FUNCTION_NAME = "noah";
const MAX_QUESTION = 2000;
const MAX_HISTORY = 12;
const MAX_EVENT_BYTES = 32_000;
const MAX_STREAM_BYTES = 1_000_000;
const MAX_ANSWER = 12_000;

export class NoahStaleAccountError extends Error {
  constructor() { super("계정이 바뀌어 노아 요청을 취소했습니다."); this.name = "NoahStaleAccountError"; }
}
class NoahStreamFailure extends Error {}
class NoahServerEventError extends Error {}

function sameAccount(a, b) {
  return a?.client === b?.client && a?.userId === b?.userId && a?.epoch === b?.epoch && a?.approved === b?.approved;
}
function validContext(value) {
  if (!value?.client?.functions?.invoke || !value.userId || value.approved !== true) throw new Error("승인된 로그인과 서버 연결을 확인해 주세요.");
  return value;
}
function boundedHistory(history, message) {
  const selected = [];
  const entries = (Array.isArray(history) ? history : []).slice(-MAX_HISTORY);
  for (let index = entries.length - 1; index >= 0; index--) {
    const item = entries[index];
    if (!["user", "assistant"].includes(item?.role) || typeof item.content !== "string") continue;
    const candidate = { role: item.role, content: item.content.slice(0, 8000) };
    if (new TextEncoder().encode(JSON.stringify({ operation: "chat", message, history: [candidate, ...selected] })).byteLength > 30_000) break;
    if (message.length + candidate.content.length + selected.reduce((sum, entry) => sum + entry.content.length, 0) > 24_000) break;
    selected.unshift(candidate);
  }
  return selected;
}
async function readableError(error) {
  const status = Number(error?.context?.status || error?.status || 0);
  let payload;
  try {
    payload = await error?.context?.json?.();
  } catch { /* An unreadable body is a connection error. */ }
  if (typeof payload?.error === "string" && payload.error.trim()) return new Error(payload.error.slice(0, 240));
  if (status === 404) return new Error("연결이 잠깐 끊겼어요. 잠시 후 다시 물어봐 주세요.");
  if (status === 401 || status === 403) return new Error("로그인 권한을 확인해 주세요.");
  if (status === 409) return new Error("안내를 확인한 뒤 다시 질문해 주세요.");
  if (status === 429) return new Error("요청이 많아요. 잠시 후 다시 시도해 주세요.");
  if (status === 503) return new Error("노아가 잠시 연결되지 않았어요. 조금 뒤 다시 시도해 주세요.");
  return new Error("연결이 잠깐 끊겼어요. 잠시 후 다시 물어봐 주세요.");
}
async function responseError(response) {
  let payload;
  try { payload = await response.json(); } catch { /* Ignore malformed response. */ }
  return readableError({ status: response.status, context: { status: response.status, json: async () => payload } });
}
function parseEvent(block) {
  let event = "message";
  const data = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  let payload;
  try { payload = JSON.parse(data.join("\n")); } catch { throw new NoahStreamFailure("응답 형식을 읽지 못했어요."); }
  return { event: event === "message" ? payload?.type : event, payload };
}

export function createNoahService({ getContext, fetcher = globalThis.fetch } = {}) {
  if (typeof getContext !== "function") throw new TypeError("노아 계정 연결 정보가 필요합니다.");
  async function invoke(body, signal) {
    const captured = validContext(await getContext());
    if (signal?.aborted) throw signal.reason || new Error("요청이 취소되었습니다.");
    const result = await captured.client.functions.invoke(FUNCTION_NAME, { body, signal });
    if (!sameAccount(captured, await getContext())) throw new NoahStaleAccountError();
    if (signal?.aborted) throw signal.reason || new Error("요청이 취소되었습니다.");
    if (result?.error) throw await readableError(result.error);
    if (!result?.data || typeof result.data !== "object") throw new Error("노아 응답을 확인할 수 없어요. 다시 시도해 주세요.");
    return result.data;
  }
  async function stream(body, signal, callbacks) {
    const captured = validContext(await getContext());
    const url = String(captured.supabaseUrl || "").replace(/\/+$/, "");
    const key = String(captured.anonKey || "");
    if (!/^https:\/\//.test(url) || !key || typeof fetcher !== "function") return null;
    const session = await captured.client.auth?.getSession?.();
    const token = session?.data?.session?.access_token;
    if (!token) throw new Error("로그인 상태를 확인해 주세요.");
    if (!sameAccount(captured, await getContext())) throw new NoahStaleAccountError();
    let response;
    try {
      response = await fetcher(`${url}/functions/v1/${FUNCTION_NAME}`, {
        method: "POST", signal,
        headers: { Authorization: `Bearer ${token}`, apikey: key, "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ ...body, stream: true }),
      });
    } catch (error) {
      if (signal?.aborted || !sameAccount(captured, await getContext())) throw new NoahStaleAccountError();
      throw new NoahStreamFailure(error?.message || "연결을 확인해 주세요.");
    }
    if (!sameAccount(captured, await getContext()) || signal?.aborted) throw new NoahStaleAccountError();
    if (!response.ok) throw await responseError(response);
    if (!response.headers?.get("content-type")?.includes("text/event-stream")) {
      try { return await response.json(); } catch { throw new NoahStreamFailure("응답 형식을 읽지 못했어요."); }
    }
    const reader = response.body?.getReader();
    if (!reader) throw new NoahStreamFailure("응답 연결이 끊겼어요.");
    const decoder = new TextDecoder();
    let buffer = "";
    let total = 0;
    let deltaLength = 0;
    let done = null;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        if (signal?.aborted || !sameAccount(captured, await getContext())) throw new NoahStaleAccountError();
        total += part.value?.byteLength || 0;
        if (total > MAX_STREAM_BYTES) throw new NoahStreamFailure("응답이 너무 길어요.");
        buffer += decoder.decode(part.value, { stream: true }).replace(/\r\n/g, "\n");
        if (buffer.length > MAX_EVENT_BYTES * 2) throw new NoahStreamFailure("응답 조각이 너무 길어요.");
        let boundary;
        while ((boundary = buffer.indexOf("\n\n")) >= 0) {
          const block = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (block.length > MAX_EVENT_BYTES) throw new NoahStreamFailure("응답 조각이 너무 길어요.");
          const parsed = parseEvent(block);
          if (!parsed) continue;
          const { event, payload } = parsed;
          if (event === "progress" && typeof payload?.message === "string") callbacks.onProgress?.(payload.message.slice(0, 240));
          if (event === "delta" && typeof payload?.text === "string") {
            deltaLength += payload.text.length;
            if (deltaLength > MAX_ANSWER) throw new NoahStreamFailure("답변이 너무 길어요.");
            callbacks.onDelta?.(payload.text);
          }
          if (event === "error") throw Object.assign(new NoahServerEventError(String(payload?.error || "노아 응답을 받지 못했어요.").slice(0, 240)), { code: payload?.code });
          if (event === "done") {
            if (typeof payload?.answer !== "string" || !payload.answer.trim() || payload.answer.length > MAX_ANSWER) throw new NoahStreamFailure("답변을 확인할 수 없어요.");
            done = payload;
            break;
          }
        }
        if (done) break;
      }
    } catch (error) {
      try { await reader.cancel(); } catch { /* Ignore cancellation failure. */ }
      if (error instanceof NoahStaleAccountError || signal?.aborted) throw new NoahStaleAccountError();
      if (error instanceof NoahStreamFailure || error instanceof NoahServerEventError) throw error;
      throw new NoahStreamFailure(error?.message || "응답 연결이 끊겼어요.");
    } finally { reader.releaseLock(); }
    if (!sameAccount(captured, await getContext()) || signal?.aborted) throw new NoahStaleAccountError();
    if (!done) throw new NoahStreamFailure("응답 연결이 끊겼어요.");
    return done;
  }
  return {
    async chat(message, history = [], signal, callbacks = {}) {
      const question = String(message || "").slice(0, MAX_QUESTION);
      const body = { operation: "chat", message: question, history: boundedHistory(history, question) };
      try {
        const result = await stream(body, signal, callbacks);
        if (result) return result;
      } catch (error) {
        if (!(error instanceof NoahStreamFailure)) throw error;
        callbacks.onReset?.();
      }
      return invoke(body, signal);
    },
    decide(operation, proposalId, signal) {
      if (operation !== "confirm" && operation !== "cancel") throw new RangeError("지원하지 않는 제안 작업입니다.");
      if (!proposalId) throw new RangeError("제안 ID가 없습니다.");
      return invoke({ operation, proposalId }, signal);
    },
    async acknowledgeNotice(signal) {
      const captured = validContext(await getContext());
      const result = await captured.client.rpc("quickflex_noah_acknowledge_notice", {}, { signal });
      if (!sameAccount(captured, await getContext()) || signal?.aborted) throw new NoahStaleAccountError();
      if (result?.error) throw await readableError(result.error);
      const value = result?.data;
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("안내 확인 결과를 받지 못했어요. 다시 시도해 주세요.");
      return value;
    },
    async feedback({ rating, sources, hasProposal, responseMs, model }, signal) {
      if (rating !== 1 && rating !== -1) throw new RangeError("평가가 올바르지 않습니다.");
      const captured = validContext(await getContext());
      const result = await captured.client.rpc("quickflex_noah_submit_feedback", {
        p_rating: rating, p_sources: (Array.isArray(sources) ? sources : []).filter((item) => typeof item === "string").slice(0, 20),
        p_has_proposal: Boolean(hasProposal), p_response_ms: Number.isFinite(responseMs) ? Math.max(0, Math.round(responseMs)) : null,
        p_model: typeof model === "string" ? model.slice(0, 80) : null,
      }, { signal });
      if (!sameAccount(captured, await getContext()) || signal?.aborted) throw new NoahStaleAccountError();
      if (result?.error) throw await readableError(result.error);
      return result?.data;
    },
  };
}
