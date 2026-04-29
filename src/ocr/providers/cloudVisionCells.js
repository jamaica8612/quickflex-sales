// Google Cloud Vision 기반 셀 OCR provider (서버 사이드).
// 브라우저는 셀 이미지(base64 JPEG)만 모아 Edge Function (ocr-schedule, mode=cells)으로 보낸다.
// API 키는 서버 환경변수(GOOGLE_CLOUD_VISION_API_KEY)에 보관되며 클라이언트에 노출되지 않는다.

const JPEG_QUALITY = 0.8;

/**
 * Canvas를 서버 셀 OCR 입력 형식으로 인코딩한다.
 * cellCanvas가 모듈 전역 재사용 객체일 수 있으므로 toDataURL 즉시 호출해 문자열을 즉시 추출한다.
 */
export function canvasToCellInput(id, canvas, quality = JPEG_QUALITY) {
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1] : dataUrl;
  return { id, base64, mimeType: "image/jpeg" };
}

/**
 * 셀 배치를 서버에 보내 텍스트를 받아 반환.
 *
 * @param {{id:string, base64:string, mimeType?:string}[]} cells
 * @param {(fnName:string, body:object) => Promise<object>} fetchEdge
 * @returns {Promise<{id:string, text:string, confidence?:number}[]>}
 */
export async function recognizeCells(cells, fetchEdge) {
  if (!Array.isArray(cells) || !cells.length) return [];
  if (typeof fetchEdge !== "function") throw new Error("fetchEdge 함수가 필요합니다.");
  const json = await fetchEdge("ocr-schedule", { mode: "cells", cells });
  return Array.isArray(json?.results) ? json.results : [];
}
