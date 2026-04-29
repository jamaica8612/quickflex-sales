// Tesseract.js OCR provider.
// CDN에서 lazy-load하여 worker를 한 번만 생성·재사용.
// 작은 셀에서 정확도 향상을 위해 자동 업스케일 + page-segmentation 모드 7(단일 라인) 사용.

const TESSERACT_CDN = "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js";
const LANGS = "kor+eng";
const TARGET_CELL_HEIGHT = 80; // 작은 셀은 이 픽셀까지 업스케일

let scriptPromise = null;
let workerPromise = null;
// 작은 셀 업스케일용 재사용 캔버스 (셀마다 createElement 하지 않는다).
let upscaleCanvas = null;
let upscaleCtx = null;

function loadScript(url) {
  if (window.Tesseract) return Promise.resolve();
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Tesseract.js 스크립트 로드 실패"));
    document.head.appendChild(script);
  });
  return scriptPromise;
}

async function getWorker() {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    await loadScript(TESSERACT_CDN);
    const worker = await window.Tesseract.createWorker(LANGS, 1, {
      logger: () => {}, // 진행률 로그 끔
    });
    // 단일 라인(셀 텍스트) 인식 모드. 표 셀에 적합.
    await worker.setParameters({
      tessedit_pageseg_mode: window.Tesseract.PSM?.SINGLE_LINE ?? "7",
      preserve_interword_spaces: "1",
    });
    return worker;
  })();
  return workerPromise;
}

function preprocessForOcr(input) {
  // input을 canvas로 정규화 + 작은 이미지는 업스케일.
  // segmenter가 넘기는 cellCanvas는 이미 캔버스이므로 대부분 첫 분기로 빠진다.
  let canvas;
  if (input instanceof HTMLCanvasElement) {
    canvas = input;
  } else {
    return input; // Blob/Image/ImageData는 Tesseract가 자체 처리 (드물게 사용)
  }
  if (canvas.height >= TARGET_CELL_HEIGHT) return canvas;
  const scale = TARGET_CELL_HEIGHT / canvas.height;
  const w = Math.max(1, Math.round(canvas.width * scale));
  const h = Math.max(1, Math.round(canvas.height * scale));
  if (!upscaleCanvas) {
    upscaleCanvas = document.createElement("canvas");
    upscaleCtx = upscaleCanvas.getContext("2d");
  }
  upscaleCanvas.width = w;
  upscaleCanvas.height = h;
  upscaleCtx.imageSmoothingQuality = "high";
  upscaleCtx.drawImage(canvas, 0, 0, w, h);
  return upscaleCanvas;
}

export async function tesseractRecognize(input) {
  const worker = await getWorker();
  const target = preprocessForOcr(input);
  const { data } = await worker.recognize(target);
  return {
    text: (data.text || "").replace(/\s+$/g, "").trim(),
    confidence: typeof data.confidence === "number" ? data.confidence : -1,
  };
}

export async function tesseractRecognizeMany(inputs) {
  // worker 1개를 직렬로 사용 (Tesseract.js 특성상 동일 worker 동시 호출 불가)
  const results = [];
  for (const input of inputs) {
    results.push(await tesseractRecognize(input));
  }
  return results;
}

export async function tesseractWarmup() {
  await getWorker();
}
