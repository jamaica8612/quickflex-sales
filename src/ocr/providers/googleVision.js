// Google Cloud Vision OCR provider (placeholder).
//
// 향후 구현 가이드:
//   1) Supabase Edge Function (예: ocr-vision)을 만들어 서버 비밀 키로 Vision API 호출
//      - DOCUMENT_TEXT_DETECTION + languageHints: ["ko", "en"]
//      - 클라이언트는 imageBase64 만 전달
//   2) 아래 함수에서 fetch(edgeUrl, { body: { imageBase64 } }) 호출 후
//      response.fullTextAnnotation.text 를 반환
//   3) recognizeMany는 셀이 많으면 단일 호출로 묶어 보내고 좌표로 분할 (성능 최적)
//      - Vision은 한 이미지 안의 여러 영역을 한 번에 처리 가능

function notImplemented(name) {
  return Promise.reject(
    new Error(
      `Google Vision provider 미구현: ${name}. setOcrProvider("tesseract")로 전환하거나 src/ocr/providers/googleVision.js를 채워주세요.`,
    ),
  );
}

export function googleVisionRecognize(_input) {
  return notImplemented("recognize");
}

export function googleVisionRecognizeMany(_inputs) {
  return notImplemented("recognizeMany");
}

export function googleVisionWarmup() {
  // 서버 사이드 provider라 별도 warmup 불필요
  return Promise.resolve();
}
