import type { OcrRequest } from "./types.ts";

export const MAX_BODY_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_BASE64 = 6 * 1024 * 1024;
export const MAX_CELLS = 64;
export const MAX_CELL_BASE64 = 512 * 1024;

export class OcrHttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export async function readOcrRequest(request: Request): Promise<OcrRequest> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new OcrHttpError(413, "이미지 요청이 너무 큽니다.");
  const reader = request.body?.getReader();
  if (!reader) throw new OcrHttpError(400, "OCR 요청 본문이 필요합니다.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new OcrHttpError(413, "이미지 요청이 너무 큽니다."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let body;
  try { body = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { throw new OcrHttpError(400, "올바른 JSON 요청이 필요합니다."); }
  if (!body || Array.isArray(body) || typeof body !== "object") throw new OcrHttpError(400, "올바른 OCR 요청이 필요합니다.");
  return body;
}

function validateImage(base64: unknown, mime: unknown, limit: number) {
  if (typeof base64 !== "string" || !base64.length || base64.length > limit) throw new OcrHttpError(400, "이미지 크기를 확인해 주세요.");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) throw new OcrHttpError(400, "올바른 base64 이미지가 필요합니다.");
  if (mime !== undefined && !["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp", "image/tiff"].includes(String(mime))) throw new OcrHttpError(400, "지원하지 않는 이미지 형식입니다.");
}

export function validateOcrRequest(body: OcrRequest): number {
  if (body.mode !== undefined && !["schedule", "cells", "vision-schedule"].includes(body.mode)) throw new OcrHttpError(400, "지원하지 않는 OCR 모드입니다.");
  if (body.kind !== undefined && !["schedule", "settlement"].includes(body.kind)) throw new OcrHttpError(400, "지원하지 않는 OCR 종류입니다.");
  if (body.mode === "cells") {
    if (!Array.isArray(body.cells) || body.cells.length < 1 || body.cells.length > MAX_CELLS) throw new OcrHttpError(400, `셀은 1~${MAX_CELLS}개까지 가능합니다.`);
    const ids = new Set<string>();
    for (const cell of body.cells) {
      if (!cell || typeof cell.id !== "string" || !cell.id.trim() || cell.id.length > 128 || ids.has(cell.id)) throw new OcrHttpError(400, "셀 식별자를 확인해 주세요.");
      ids.add(cell.id);
      validateImage(cell.base64, cell.mimeType, MAX_CELL_BASE64);
    }
    return body.cells.length;
  }
  validateImage(body.imageBase64, body.mimeType, MAX_IMAGE_BASE64);
  if (typeof body.ownerName !== "string" || !body.ownerName.trim() || body.ownerName.length > 100) throw new OcrHttpError(400, "기사 이름을 확인해 주세요.");
  if (!Number.isInteger(body.year) || Number(body.year) < 2000 || Number(body.year) > 2100 || !Number.isInteger(body.month) || Number(body.month) < 1 || Number(body.month) > 12) throw new OcrHttpError(400, "정산 연도와 월을 확인해 주세요.");
  return 1;
}

// Uses the authenticated user's client, so the RPC cannot consume another owner's quota.
export async function authorizeOcr(request: Request, createClient: (token: string) => any) {
  const token = request.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new OcrHttpError(401, "로그인이 필요합니다.");
  const client = createClient(token);
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) throw new OcrHttpError(401, "로그인 세션을 확인할 수 없습니다.");
  const { data: profile, error: profileError } = await client.from("quickflex_profiles").select("status").eq("id", data.user.id).maybeSingle();
  if (profileError) throw new OcrHttpError(503, "계정 승인 상태를 확인하지 못했습니다.");
  if (profile?.status !== "approved") throw new OcrHttpError(403, "승인된 계정만 OCR을 사용할 수 있습니다.");
  return client;
}

export async function consumeOcrQuota(client: any, units: number) {
  const { data, error } = await client.rpc("quickflex_consume_ocr_quota", { p_units: units });
  if (error) throw new OcrHttpError(error.code === "42501" ? 403 : 503, "OCR 사용 권한과 한도를 확인하지 못했습니다.");
  if (data !== true) throw new OcrHttpError(429, "오늘의 OCR 사용 한도에 도달했습니다. 내일 다시 시도해 주세요.");
}
