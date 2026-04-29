// OpenCV.js를 이용한 표 자동 분할.
// 알고리즘:
//   1) 원본을 다운스케일한 분석용 캔버스에서만 OpenCV 처리
//   2) 그레이스케일 + 적응형 이진화
//   3) 모폴로지로 가로선/세로선 추출 → grid mask
//   4) findContours → 행/열 클러스터링 → 셀 좌표 매트릭스
//
// 메모리 규칙:
//   - cv.Mat은 모두 try/finally에서 delete().
//   - 분석 캔버스/셀 크롭 캔버스는 모듈 스코프 1개를 재사용 (createElement 반복 금지).

const OPENCV_CDN = "https://docs.opencv.org/4.x/opencv.js";
const MAX_ANALYSIS_WIDTH = 900; // 다운스케일 상한 — 모바일 메모리 보호. 작을수록 OpenCV 한 번 호출이 짧아진다.

const yieldUI = () => new Promise((resolve) => {
  const idle = window.requestIdleCallback;
  if (typeof idle === "function") idle(() => resolve(), { timeout: 50 });
  else setTimeout(resolve, 0);
});

let cvPromise = null;
let analysisCanvas = null;
let analysisCtx = null;
let cellCanvas = null;
let cellCtx = null;

export function loadOpenCv() {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    if (window.cv && window.cv.Mat) return resolve(window.cv);
    const script = document.createElement("script");
    script.src = OPENCV_CDN;
    script.async = true;
    script.onload = () => {
      const ready = () => resolve(window.cv);
      if (window.cv && window.cv.Mat) ready();
      else window.cv["onRuntimeInitialized"] = ready;
    };
    script.onerror = () => reject(new Error("OpenCV.js 로드 실패"));
    document.head.appendChild(script);
  });
  return cvPromise;
}

function ensureCanvases() {
  if (!analysisCanvas) {
    analysisCanvas = document.createElement("canvas");
    analysisCtx = analysisCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (!cellCanvas) {
    cellCanvas = document.createElement("canvas");
    cellCtx = cellCanvas.getContext("2d", { willReadFrequently: true });
  }
}

function loadImage(input) {
  if (input instanceof HTMLImageElement) return Promise.resolve(input);
  if (input instanceof HTMLCanvasElement) {
    // 캔버스를 이미지처럼 다루기 위해 width/height만 노출
    return Promise.resolve({ naturalWidth: input.width, naturalHeight: input.height, _drawSource: input });
  }
  if (input instanceof Blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(input);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }
  return Promise.reject(new Error("지원하지 않는 이미지 입력 타입"));
}

function drawDownscaled(image) {
  ensureCanvases();
  const sw = image.naturalWidth || image.width;
  const sh = image.naturalHeight || image.height;
  const scale = Math.min(1, MAX_ANALYSIS_WIDTH / sw);
  const dw = Math.max(1, Math.round(sw * scale));
  const dh = Math.max(1, Math.round(sh * scale));
  analysisCanvas.width = dw;
  analysisCanvas.height = dh;
  analysisCtx.imageSmoothingQuality = "high";
  analysisCtx.drawImage(image._drawSource || image, 0, 0, dw, dh);
  return { width: dw, height: dh, scale };
}

function buildCellGrid(rects, srcRows) {
  rects.sort((a, b) => a.y - b.y);
  const rowTolerance = Math.max(8, Math.round(srcRows / 80));
  const rows = [];
  let bucket = [];
  let lastY = -Infinity;
  for (const r of rects) {
    if (r.y - lastY > rowTolerance) {
      if (bucket.length) rows.push(bucket);
      bucket = [];
    }
    bucket.push(r);
    lastY = r.y;
  }
  if (bucket.length) rows.push(bucket);
  const cells = [];
  rows.forEach((row, rowIdx) => {
    row.sort((a, b) => a.x - b.x);
    row.forEach((rect, colIdx) => {
      cells.push({ row: rowIdx, col: colIdx, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    });
  });
  return cells;
}

/**
 * 이미지에서 표 셀 좌표만 분할 (픽셀 데이터는 보관하지 않음).
 * 크롭이 필요한 시점에 getCellCanvas / getCellImageData 헬퍼를 호출해 분석 캔버스에서 직접 가져온다.
 *
 * @param {Blob | HTMLCanvasElement | HTMLImageElement} input
 * @returns {Promise<{
 *   cells: Array<{ row:number, col:number, x:number, y:number, w:number, h:number }>,
 *   sourceCanvas: HTMLCanvasElement,
 *   getCellCanvas: (cell: {x:number,y:number,w:number,h:number}) => HTMLCanvasElement,
 *   getCellImageData: (cell: {x:number,y:number,w:number,h:number}) => ImageData,
 * }>}
 */
export async function segmentTable(input, onStep) {
  const step = typeof onStep === "function" ? onStep : () => {};
  step("opencv-loading");
  const cv = await loadOpenCv();
  step("image-decoding");
  const image = await loadImage(input);
  step("downscaling");
  const dim = drawDownscaled(image);
  console.log("[segmentTable] analysis canvas:", dim.width, "x", dim.height, "scale=", dim.scale.toFixed(3));
  await yieldUI();
  console.time("detectTable");

  let src, gray, binary, horizKernel, vertKernel, horizLines, vertLines, grid, contours, hierarchy;
  try {
    step("imread");
    src = cv.imread(analysisCanvas);
    await yieldUI();

    step("threshold");
    gray = new cv.Mat();
    binary = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.adaptiveThreshold(gray, binary, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, 15, 10);
    await yieldUI();

    step("morphology");
    const horizSize = Math.max(20, Math.floor(src.cols / 30));
    const vertSize = Math.max(20, Math.floor(src.rows / 30));
    horizKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(horizSize, 1));
    vertKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, vertSize));

    horizLines = new cv.Mat();
    vertLines = new cv.Mat();
    cv.morphologyEx(binary, horizLines, cv.MORPH_OPEN, horizKernel);
    await yieldUI();
    cv.morphologyEx(binary, vertLines, cv.MORPH_OPEN, vertKernel);
    await yieldUI();

    grid = new cv.Mat();
    cv.add(horizLines, vertLines, grid);
    await yieldUI();

    step("contours");
    contours = new cv.MatVector();
    hierarchy = new cv.Mat();
    cv.findContours(grid, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
    await yieldUI();

    const totalArea = src.cols * src.rows;
    const minArea = totalArea / 5000;
    const maxArea = totalArea * 0.5;

    const rects = [];
    for (let i = 0; i < contours.size(); i += 1) {
      const c = contours.get(i);
      const r = cv.boundingRect(c);
      const area = r.width * r.height;
      if (area < minArea || area > maxArea) continue;
      if (r.width < 12 || r.height < 12) continue;
      rects.push({ x: r.x, y: r.y, w: r.width, h: r.height });
    }

    step("grid");
    const cells = buildCellGrid(rects, src.rows);
    console.log("[segmentTable] cells:", cells.length, "rects:", rects.length);
    return {
      cells,
      sourceCanvas: analysisCanvas,
      getCellCanvas: cropToCellCanvas,
      getCellImageData: cellImageData,
    };
  } finally {
    src?.delete();
    gray?.delete();
    binary?.delete();
    horizKernel?.delete();
    vertKernel?.delete();
    horizLines?.delete();
    vertLines?.delete();
    grid?.delete();
    contours?.delete();
    hierarchy?.delete();
    console.timeEnd("detectTable");
  }
}

// 셀 좌표를 받아 모듈 스코프의 cellCanvas에 크롭. 다음 호출 시 덮어쓰므로 호출자는 즉시 사용해야 한다.
function cropToCellCanvas(cell) {
  ensureCanvases();
  cellCanvas.width = cell.w;
  cellCanvas.height = cell.h;
  cellCtx.drawImage(
    analysisCanvas,
    cell.x, cell.y, cell.w, cell.h,
    0, 0, cell.w, cell.h,
  );
  return cellCanvas;
}

function cellImageData(cell) {
  ensureCanvases();
  // analysisCanvas에서 직접 가져온다 (cellCanvas를 거치지 않음 → 메모리 1회 적게 사용)
  return analysisCtx.getImageData(cell.x, cell.y, cell.w, cell.h);
}
