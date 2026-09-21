const JUSO_URL = "https://www.juso.go.kr/api/totalMap/selectKarbSbdList";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: CORS });
}

async function smallBody(request) {
  const reader = request.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 128) { await reader.cancel(); throw new RangeError("요청이 너무 큽니다."); }
    chunks.push(value);
  }
  return new TextDecoder().decode(Uint8Array.from(chunks.flatMap((chunk) => [...chunk])));
}

async function limitedBytes(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty upstream response");
  let size = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) { await reader.cancel(); throw new RangeError("Upstream response too large"); }
    chunks.push(value);
  }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export function createPostcodeHandler({ authorize, transform, fetchImpl = fetch }) {
  return async function handle(request) {
    if (request.method === "OPTIONS") return new Response("ok", { headers: CORS });
    if (request.method !== "POST") return json({ error: "POST 요청만 지원합니다." }, 405);
    try {
      if (!(await authorize(request))) return json({ error: "승인된 회사 회원만 조회할 수 있습니다." }, 403);
      const body = JSON.parse(await smallBody(request));
      const postcode = body?.postcode;
      if (typeof postcode !== "string" || !/^\d{5}$/.test(postcode)) return json({ error: "우편번호 5자리를 입력해 주세요." }, 400);
      const response = await fetchImpl(JUSO_URL, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ districtNo: postcode, pageable: { page: 0, size: 1, sort: [] } }),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return json({ error: "우편번호 경계 서비스를 사용할 수 없습니다." }, 502);
      if (Number(response.headers.get("content-length")) > 2_000_000) return json({ error: "우편번호 경계가 너무 큽니다." }, 502);
      const item = JSON.parse(new TextDecoder().decode(await limitedBytes(response, 2_000_000)))?.results?.content?.[0];
      if (!item?.geom) return json({ error: "해당 우편번호의 경계를 찾지 못했습니다." }, 404);
      if (String(item.sbdno) !== postcode) return json({ error: "우편번호 경계 응답이 일치하지 않습니다." }, 502);
      const geometry = transform(JSON.parse(item.geom));
      return json({ postcode, cityName: String(item.ctpvNm || ""), districtName: String(item.sigNm || ""), geometry });
    } catch (error) {
      if (error instanceof RangeError && error.message === "요청이 너무 큽니다.") return json({ error: "요청이 너무 큽니다." }, 413);
      return json({ error: "우편번호 경계를 조회하지 못했습니다." }, 502);
    }
  };
}
