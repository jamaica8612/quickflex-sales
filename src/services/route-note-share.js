const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIN_DAYS = 1;
const MAX_DAYS = 30;

function shareId(value) {
  if (!UUID.test(String(value || ""))) throw new RangeError("공유 링크 ID가 올바르지 않습니다.");
  return String(value).toLowerCase();
}

export function normalizeRouteNoteShareDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    throw new RangeError(`공유 기간은 ${MIN_DAYS}~${MAX_DAYS}일로 선택해 주세요.`);
  }
  return days;
}

function resultOrThrow(result, fallback) {
  if (result?.error) throw new Error(result.error.message || fallback);
  return result?.data;
}
function oneRow(value, fallback) {
  const rows = Array.isArray(value) ? value : [value];
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") throw new Error(fallback);
  return rows[0];
}

/** Authenticated owner controls only. Tokens are returned once by the create RPC. */
export function createRouteNoteShareService({ getContext } = {}) {
  if (typeof getContext !== "function") throw new Error("공유 링크 연결 정보를 찾을 수 없습니다.");
  async function context() {
    const captured = await getContext();
    const userId = String(captured?.user?.id || "").toLowerCase();
    const profileId = String(captured?.profile?.id || "").toLowerCase();
    if (!captured?.client?.rpc || !UUID.test(userId) || userId !== profileId || captured.profile?.status !== "approved") {
      throw new Error("승인된 로그인 상태를 확인해 주세요.");
    }
    return { client: captured.client, userId, epoch: captured.epoch };
  }
  async function stillCurrent(captured) {
    const current = await context();
    if (current.client !== captured.client || current.userId !== captured.userId || current.epoch !== captured.epoch) {
      throw new Error("계정이 바뀌어 공유 링크 작업을 취소했습니다.");
    }
    return current.client;
  }
  async function rpc(name, params, fallback) {
    const captured = await context();
    await stillCurrent(captured);
    const result = await captured.client.rpc(name, params);
    await stillCurrent(captured);
    return resultOrThrow(result, fallback);
  }
  return {
    async create(zoneId, expiresInDays = 7) {
      const data = oneRow(await rpc("quickflex_create_route_note_share", {
        p_zone_id: shareId(zoneId), p_expires_in_days: normalizeRouteNoteShareDays(expiresInDays),
      }, "공유 링크를 만들지 못했습니다."), "공유 링크 응답을 확인할 수 없습니다.");
      if (!data?.id || !/^[0-9a-f]{64}$/i.test(String(data.token || ""))) throw new Error("공유 링크 응답을 확인할 수 없습니다.");
      return { ...data, id: shareId(data.id), token: String(data.token).toLowerCase() };
    },
    async list(zoneId) {
      const rows = await rpc("quickflex_list_route_note_shares", {}, "공유 링크 목록을 불러오지 못했습니다.");
      const target = shareId(zoneId);
      return (Array.isArray(rows) ? rows : []).filter((row) => String(row?.zone_id || "").toLowerCase() === target);
    },
    async update(id, { expiresInDays, revoke = false } = {}) {
      const params = { p_share_id: shareId(id), p_revoke: Boolean(revoke) };
      if (!revoke && expiresInDays != null) params.p_expires_in_days = normalizeRouteNoteShareDays(expiresInDays);
      const data = oneRow(await rpc("quickflex_update_route_note_share", params, "공유 링크를 변경하지 못했습니다."), "공유 링크 응답을 확인할 수 없습니다.");
      return { ...data, id: shareId(data.id) };
    },
  };
}

export function buildRouteNoteShareUrl(token, baseUrl = globalThis.location?.href) {
  const cleanToken = String(token || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(cleanToken)) throw new RangeError("공유 토큰이 올바르지 않습니다.");
  const url = new URL("route-share.html", baseUrl);
  url.hash = new URLSearchParams({ token: cleanToken }).toString();
  return url.href;
}
