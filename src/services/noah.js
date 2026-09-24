const FUNCTION_NAME = "noah";

export class NoahStaleAccountError extends Error {
  constructor() { super("계정이 바뀌어 노아 요청을 취소했습니다."); this.name = "NoahStaleAccountError"; }
}

function sameAccount(a, b) {
  return a?.client === b?.client && a?.userId === b?.userId && a?.epoch === b?.epoch && a?.approved === b?.approved;
}

function validContext(value) {
  if (!value?.client?.functions?.invoke || !value.userId || value.approved !== true) {
    throw new Error("승인된 로그인과 서버 연결을 확인해 주세요.");
  }
  return value;
}

async function readableError(error) {
  const status = Number(error?.context?.status || error?.status || 0);
  if (status === 404) return new Error("노아 서버가 아직 연결되지 않았어요. 잠시 후 다시 시도해 주세요.");
  if (status === 401 || status === 403) return new Error("로그인 권한을 확인해 주세요.");
  if (status === 429) return new Error("요청이 많아요. 잠시 후 다시 시도해 주세요.");
  try {
    const payload = await error?.context?.json?.();
    if (typeof payload?.error === "string" && payload.error.trim()) return new Error(payload.error.slice(0, 240));
  } catch { /* A missing or unreadable response body is a connection error. */ }
  if (status === 503) return new Error("노아 AI 연결 설정을 확인해 주세요.");
  return new Error("서버 응답을 받지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
}

export function createNoahService({ getContext } = {}) {
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
  return {
    chat(message, history = [], signal) {
      return invoke({ operation: "chat", message, history }, signal);
    },
    decide(operation, proposalId, signal) {
      if (operation !== "confirm" && operation !== "cancel") throw new RangeError("지원하지 않는 제안 작업입니다.");
      if (!proposalId) throw new RangeError("제안 ID가 없습니다.");
      return invoke({ operation, proposalId }, signal);
    },
  };
}
