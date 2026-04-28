// OpenCV.js를 이용한 표 자동 분할.
// 알고리즘:
//   1) 그레이스케일 + 적응형 이진화
//   2) 모폴로지로 가로선/세로선만 추출
//   3) 가로+세로 그리드에서 contour 검출 → 각 contour의 boundingRect = 셀
//   4) y좌표로 행 그룹핑, 각 행 내부에서 x좌표 정렬 → row/col 인덱스 부여

const OPENCV_CDN = "https://docs.opencv.org/4.x/opencv.js";
let cvPromise = null;

export function loadOpenCv() {
  if (cvPromise) return cvPromise;
  cvPromise = new Promise((resolve, reject) => {
    if (window.cv && window.cv.Mat) return resolve(window.cv);
    const script = document.createElement("script");
    script.src = OPENCV_CDN;
    script.async = true;
    script.onload = () => {
      // OpenCV.js는 WASM을 비동기 초기화. cv.Mat 가 준비되면 그때 resolve.
      const ready = () => resolve(window.cv);
      if (window.cv && window.cv.Mat) ready();
      else window.cv["onRuntimeInitialized"] = ready;
    };
    script.onerror = () => reject(new Error("OpenCV.js 로드 실패"));
    document.head.appendChild(script);
  });
  return cvPromise;
}

function inputToCanvas(input) {
  if (input instanceof HTMLCanvasElement) return Promise.resolve(input);
  if (input instanceof HTMLImageElement) {
    const c = document.createElement("canvas");
    c.width = input.naturalWidth || input.width;
    c.height = input.naturalHeight || input.height;
    c.getContext("2d").drawImage(input, 0, 0);
    return Promise.resolve(c);
  }
  if (input instanceof Blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(input);
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        resolve(c);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(url);
        reject(e);
      };
      img.src = url;
    });
  }
  return Promise.reject(new Error("지원하지 않는 이미지 입력 타입"));
}

/**
 * 이미지에서 표 셀들을 분할.
 * @param {Blob | HTMLCanvasElement | HTMLImageElement} input
 * @returns {Promise<Array<{ row: number, col: number, x: number, y: number, w: number, h: number, canvas: HTMLCanvasElement }>>}
 */
export async function segmentTable(input) {
  const cv = await loadOpenCv();
  const sourceCanvas = await inputToCanvas(input);

  const src = cv.imread(sourceCanvas);
  const gray = new cv.Mat();
  const binary = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  cv.adaptiveThreshold(
    gray,
    binary,
    255,
    cv.ADAPTIVE_THRESH_GAUSSIAN_C,
    cv.THRESH_BINARY_INV,
    15,
    10,
  );

  // 가로선/세로선 추출용 커널 크기는 이미지 크기에 비례
  const horizSize = Math.max(20, Math.floor(src.cols / 30));
  const vertSize = Math.max(20, Math.floor(src.rows / 30));
  const horizKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(horizSize, 1));
  const vertKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(1, vertSize));

  const horizLines = new cv.Mat();
  const vertLines = new cv.Mat();
  cv.morphologyEx(binary, horizLines, cv.MORPH_OPEN, horizKernel);
  cv.morphologyEx(binary, vertLines, cv.MORPH_OPEN, vertKernel);

  const grid = new cv.Mat();
  cv.add(horizLines, vertLines, grid);

  // 셀 윤곽 검출
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  cv.findContours(grid, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

  const totalArea = src.cols * src.rows;
  const minArea = totalArea / 5000;   // 너무 작은 잡음 셀 제거
  const maxArea = totalArea * 0.5;    // 표 전체를 잡은 큰 사각형 제외

  const rects = [];
  for (let i = 0; i < contours.size(); i += 1) {
    const c = contours.get(i);
    const r = cv.boundingRect(c);
    const area = r.width * r.height;
    if (area < minArea || area > maxArea) continue;
    if (r.width < 12 || r.height < 12) continue;
    rects.push({ x: r.x, y: r.y, w: r.width, h: r.height });
  }

  // 행 단위 그룹핑 (y좌표 가까우면 같은 행)
  rects.sort((a, b) => a.y - b.y);
  const rowTolerance = Math.max(8, Math.round(src.rows / 80));
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

  // 각 행 내부 x정렬 + canvas 크롭
  const cells = [];
  rows.forEach((row, rowIdx) => {
    row.sort((a, b) => a.x - b.x);
    row.forEach((rect, colIdx) => {
      const cellCanvas = document.createElement("canvas");
      cellCanvas.width = rect.w;
      cellCanvas.height = rect.h;
      cellCanvas.getContext("2d").drawImage(
        sourceCanvas,
        rect.x, rect.y, rect.w, rect.h,
        0, 0, rect.w, rect.h,
      );
      cells.push({
        row: rowIdx,
        col: colIdx,
        x: rect.x, y: rect.y, w: rect.w, h: rect.h,
        canvas: cellCanvas,
      });
    });
  });

  // 메모리 정리
  src.delete(); gray.delete(); binary.delete();
  horizKernel.delete(); vertKernel.delete();
  horizLines.delete(); vertLines.delete(); grid.delete();
  contours.delete(); hierarchy.delete();

  return cells;
}
