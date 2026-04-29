// 셀 단위 OCR 핸들러.
// 브라우저가 표를 분할해 보낸 셀 이미지 배열을 Google Cloud Vision API의 images:annotate 엔드포인트에 batch 호출한다.
// 휴무 색상 판정은 클라이언트가 처리하므로 여기서는 받은 셀만 OCR한다.
//
// 환경변수:
//   GOOGLE_CLOUD_VISION_API_KEY (1순위) 또는 CLOUD_VISION_API_KEY (호환)
//
// Cloud Vision은 단일 images:annotate 호출에 여러 image request를 배열로 받을 수 있다 (권장 최대 16개).
// 16개씩 청크로 잘라 Promise.all 로 병렬 호출한다.

import type { CellOcrInput, CellOcrResult, CellOcrResponse } from "./types.ts";

const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
const BATCH_SIZE = 16;

function getVisionKey(): string {
  const key =
    (Deno.env.get("GOOGLE_CLOUD_VISION_API_KEY") || "").trim() ||
    (Deno.env.get("CLOUD_VISION_API_KEY") || "").trim();
  if (!key) {
    throw new Error("Server secret GOOGLE_CLOUD_VISION_API_KEY is not configured.");
  }
  return key;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

type AnnotateResponse = {
  responses?: Array<{
    fullTextAnnotation?: { text?: string };
    textAnnotations?: Array<{ description?: string; confidence?: number }>;
    error?: { message?: string };
  }>;
};

async function callVisionBatch(apiKey: string, group: CellOcrInput[]): Promise<CellOcrResult[]> {
  const body = {
    requests: group.map((cell) => ({
      image: { content: cell.base64 },
      features: [{ type: "TEXT_DETECTION", maxResults: 1 }],
      imageContext: { languageHints: ["ko", "en"] },
    })),
  };

  const response = await fetch(`${VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Cloud Vision 호출 실패 (${response.status}): ${errorText.slice(0, 300)}`);
  }

  const json = await response.json() as AnnotateResponse;
  const responses = Array.isArray(json.responses) ? json.responses : [];
  return group.map((cell, i) => {
    const r = responses[i] || {};
    if (r.error?.message) {
      return { id: cell.id, text: "", confidence: -1 };
    }
    const text = (r.fullTextAnnotation?.text || r.textAnnotations?.[0]?.description || "").trim();
    const conf = typeof r.textAnnotations?.[0]?.confidence === "number"
      ? Number(r.textAnnotations[0].confidence)
      : -1;
    return { id: cell.id, text, confidence: conf };
  });
}

export async function handleCellsOcr(cells: CellOcrInput[]): Promise<CellOcrResponse> {
  const apiKey = getVisionKey();
  const valid = cells.filter((c) => c && typeof c.id === "string" && typeof c.base64 === "string" && c.base64.length > 0);
  if (!valid.length) return { provider: "cloud-vision", results: [] };

  const groups = chunk(valid, BATCH_SIZE);
  const settled = await Promise.all(groups.map((g) => callVisionBatch(apiKey, g)));
  return { provider: "cloud-vision", results: settled.flat() };
}
