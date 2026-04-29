// OCR provider 추상화 레이어.
// 사용처에서는 활성 provider를 모르고 recognize() 만 호출.
// 새 provider 추가/교체는 PROVIDERS에 등록 + setOcrProvider() 만 호출.
//
// NOTE: 스케줄 OCR은 src/ocr/scheduleOcr.js가 직접 cloudVisionCells 모듈을 사용해
// 셀 배치를 Supabase Edge Function (mode="cells")으로 보낸다. 이 파일은 임시 단일 셀
// OCR이 필요한 경우(예: 디버그 도구)를 위해 남겨둔다.

import { tesseractRecognize, tesseractRecognizeMany, tesseractWarmup } from "./providers/tesseract.js";
import { googleVisionRecognize, googleVisionRecognizeMany, googleVisionWarmup } from "./providers/googleVision.js";

/**
 * @typedef {Object} OcrResult
 * @property {string} text       - 인식된 텍스트 (trim된 상태)
 * @property {number} confidence - 0~100 신뢰도. 미지원 provider는 -1
 */

/**
 * @typedef {Object} OcrProvider
 * @property {(input: any, options?: object) => Promise<OcrResult>} recognize
 * @property {(inputs: any[], options?: object) => Promise<OcrResult[]>} recognizeMany
 * @property {() => Promise<void>} warmup       - 엔진/모델 사전 로드 (옵션)
 */

const PROVIDERS = {
  tesseract: {
    recognize: tesseractRecognize,
    recognizeMany: tesseractRecognizeMany,
    warmup: tesseractWarmup,
  },
  "google-vision": {
    recognize: googleVisionRecognize,
    recognizeMany: googleVisionRecognizeMany,
    warmup: googleVisionWarmup,
  },
};

let activeName = "tesseract";

export function setOcrProvider(name) {
  if (!PROVIDERS[name]) throw new Error(`Unknown OCR provider: ${name}`);
  activeName = name;
}

export function getOcrProviderName() {
  return activeName;
}

function active() {
  const p = PROVIDERS[activeName];
  if (!p) throw new Error(`OCR provider not loaded: ${activeName}`);
  return p;
}

/** 단일 이미지/캔버스 OCR. input은 Blob | Canvas | Image | ImageData 중 하나. */
export function recognize(input, options) {
  return active().recognize(input, options);
}

/** 여러 셀 이미지 일괄 OCR. provider가 batch 최적화를 제공하면 활용. */
export function recognizeMany(inputs, options) {
  return active().recognizeMany(inputs, options);
}

/** 엔진/모델 사전 로드 (옵션). 첫 OCR 호출 전에 미리 호출하면 첫 인식 지연 감소. */
export function warmup() {
  return active().warmup();
}
