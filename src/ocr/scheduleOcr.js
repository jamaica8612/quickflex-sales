// 스케줄 OCR 진입점.
// 외부에서는 detectSchedule(blob, ownerName, year, month, onProgress, fetchEdge) 만 호출.
//
// 흐름 (모바일 메모리 보호 + Cloud Vision 호출 횟수 절감):
//   1) segmentTable: 다운스케일 분석 캔버스에서 셀 좌표만 추출
//   2) ocrNames: 첫 열(col=0) 만 base64로 묶어 1회 서버 호출 → ownerName 매칭 행 식별
//   3) ocrSchedule: 헤더 행 + 매칭 행의 비-휴무 셀만 1회 서버 호출.
//      휴무 셀(분홍/빨강 평균 색상)은 클라이언트에서 직접 null로 마킹하여 OCR 비용을 발생시키지 않는다.

import { segmentTable } from "./segmenter.js";
import { recognizeCells, canvasToCellInput } from "./providers/cloudVisionCells.js";

const ROUTE_PATTERN = /\d{3}[A-Z]/g;
const OFF_PATTERN = /휴무|OFF|^[\-X·]+$/i;

const yieldUI = () => new Promise((resolve) => {
  const idle = window.requestIdleCallback;
  if (typeof idle === "function") idle(() => resolve(), { timeout: 50 });
  else setTimeout(resolve, 0);
});

function normalizeText(s) {
  return String(s || "").replace(/[\s ​]+/g, "").toUpperCase();
}

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function averageRgb(imageData) {
  const { data, width, height } = imageData;
  const x0 = Math.floor(width * 0.2);
  const x1 = Math.ceil(width * 0.8);
  const y0 = Math.floor(height * 0.2);
  const y1 = Math.ceil(height * 0.8);
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y += 4) {
    for (let x = x0; x < x1; x += 4) {
      const i = (y * width + x) * 4;
      r += data[i]; g += data[i + 1]; b += data[i + 2];
      n += 1;
    }
  }
  if (!n) return { r: 255, g: 255, b: 255 };
  return { r: r / n, g: g / n, b: b / n };
}

function isOffByColor({ r, g, b }) {
  if (r > 200 && r - g > 25 && r - b > 25) return true;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const s = max === 0 ? 0 : delta / max;
  if (s < 0.18) return false;
  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return h <= 18 || h >= 335;
}

function rowsByIndex(cells) {
  const map = new Map();
  cells.forEach((c) => {
    if (!map.has(c.row)) map.set(c.row, []);
    map.get(c.row).push(c);
  });
  for (const list of map.values()) list.sort((a, b) => a.col - b.col);
  return map;
}

function findHeaderRow(rowMap) {
  // 가장 셀 수가 많은 행 중 가장 위쪽 행을 헤더로 본다.
  let bestIdx = -1;
  let bestLen = 0;
  for (const [idx, list] of rowMap) {
    if (list.length > bestLen || (list.length === bestLen && idx < bestIdx)) {
      bestLen = list.length;
      bestIdx = idx;
    }
  }
  return bestIdx;
}

function parseHeaderDay(text) {
  const raw = String(text || "").trim();
  const dot = raw.match(/(\d{1,2})\s*[\.\/\-]\s*(\d{1,2})/);
  if (dot) return parseInt(dot[2], 10);
  const all = raw.match(/\d{1,2}/g);
  if (all && all.length) return parseInt(all[all.length - 1], 10);
  return NaN;
}

/**
 * @param {Blob | HTMLCanvasElement | HTMLImageElement} input
 * @param {string} ownerName
 * @param {number} year
 * @param {number} month
 * @param {(stage: string, info?: object) => void} [onProgress]
 * @param {(fnName: string, body: object) => Promise<object>} fetchEdge - Edge Function 호출자 (ocr-schedule mode=cells)
 * @returns {Promise<{ schedule: Object<string, string[]|null>, debug: object }>}
 */
export async function detectSchedule(input, ownerName, year, month, onProgress, fetchEdge) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};
  if (typeof fetchEdge !== "function") {
    throw new Error("Cloud Vision 호출자(fetchEdge)가 전달되지 않았습니다.");
  }
  const ownerNorm = normalizeText(ownerName);
  if (!ownerNorm || ownerNorm.length < 2) {
    // 잘못된 이름으로 비싼 OCR을 호출하지 않는다.
    throw new Error("기사 이름을 정확히 입력한 뒤 다시 시도해 주세요.");
  }

  console.time("total");
  try {
    progress("segmenting");
    const segLabel = {
      "opencv-loading": "OpenCV 로드 중...",
      "image-decoding": "이미지 디코딩 중...",
      "downscaling": "이미지 다운스케일 중...",
      "imread": "픽셀 읽는 중...",
      "threshold": "이진화 중...",
      "morphology": "선 추출 중...",
      "contours": "셀 윤곽 검출 중...",
      "grid": "셀 격자 구성 중...",
    };
    const seg = await segmentTable(input, (s) => progress("segmenting", { label: segLabel[s] || s, sub: s }));
    if (!seg.cells.length) throw new Error("표를 인식하지 못했습니다. 이미지에 격자선이 명확히 보이는지 확인해 주세요.");
    await yieldUI();

    const rowMap = rowsByIndex(seg.cells);
    const headerRowIdx = findHeaderRow(rowMap);
    if (headerRowIdx < 0) throw new Error("스케줄 헤더(날짜 행)를 찾지 못했습니다.");

    // 1) 이름 열 OCR — col=0 인 셀(헤더 제외)을 모아 1회 호출
    progress("ocr-names");
    console.time("ocrNames");
    const nameCells = seg.cells.filter((c) => c.col === 0 && c.row !== headerRowIdx);
    const nameInputs = [];
    for (let i = 0; i < nameCells.length; i += 1) {
      const cell = nameCells[i];
      const canvas = seg.getCellCanvas(cell);
      nameInputs.push(canvasToCellInput(`name-${cell.row}`, canvas));
      if ((i & 7) === 7) await yieldUI();
    }
    const nameResults = await recognizeCells(nameInputs, fetchEdge);
    console.timeEnd("ocrNames");

    let ownerRowIdx = -1;
    for (const r of nameResults) {
      if (normalizeText(r.text).includes(ownerNorm)) {
        const m = String(r.id || "").match(/^name-(\d+)$/);
        if (m) { ownerRowIdx = parseInt(m[1], 10); break; }
      }
    }
    if (ownerRowIdx < 0) {
      throw new Error(`스케줄에서 '${ownerName}' 행을 찾지 못했습니다. 이름이 표에 보이는 그대로 정확히 일치하는지 확인해 주세요.`);
    }
    await yieldUI();

    // 2) 헤더 행 + 매칭 행의 비-휴무 셀을 모아 1회 호출
    progress("ocr-schedule");
    console.time("ocrSchedule");

    const scheduleInputs = [];
    const offByColor = new Set();   // dateKey 임시 식별 못 하므로 col 인덱스로 마킹
    const offCols = new Set();

    // 헤더 셀 (col >= 1) → header-<col>
    const headerCells = (rowMap.get(headerRowIdx) || []).filter((c) => c.col >= 1);
    for (let i = 0; i < headerCells.length; i += 1) {
      const cell = headerCells[i];
      const canvas = seg.getCellCanvas(cell);
      scheduleInputs.push(canvasToCellInput(`header-${cell.col}`, canvas));
      if ((i & 7) === 7) await yieldUI();
    }

    // 본인 행 (col >= 1, 휴무 색상 우선 → 비휴무만 OCR)
    const ownerCells = (rowMap.get(ownerRowIdx) || []).filter((c) => c.col >= 1);
    let offByColorCount = 0;
    for (let i = 0; i < ownerCells.length; i += 1) {
      const cell = ownerCells[i];
      const imageData = seg.getCellImageData(cell);
      if (isOffByColor(averageRgb(imageData))) {
        offCols.add(cell.col);
        offByColorCount += 1;
        continue;
      }
      const canvas = seg.getCellCanvas(cell);
      scheduleInputs.push(canvasToCellInput(`owner-${cell.col}`, canvas));
      if ((i & 7) === 7) await yieldUI();
    }

    const scheduleResults = await recognizeCells(scheduleInputs, fetchEdge);
    console.timeEnd("ocrSchedule");

    // 결과 매핑: header-<col> → 일자, owner-<col> → 라우트
    const colToDate = new Map();
    const colToOwnerText = new Map();
    for (const r of scheduleResults) {
      const m = String(r.id || "").match(/^(header|owner)-(\d+)$/);
      if (!m) continue;
      const col = parseInt(m[2], 10);
      if (m[1] === "header") {
        const day = parseHeaderDay(r.text);
        if (Number.isFinite(day) && day >= 1 && day <= 31) {
          colToDate.set(col, dateKey(year, month, day));
        }
      } else {
        colToOwnerText.set(col, r.text);
      }
    }

    const schedule = {};
    for (const cell of ownerCells) {
      const date = colToDate.get(cell.col);
      if (!date) continue;
      if (offCols.has(cell.col)) {
        schedule[date] = null;
        continue;
      }
      const norm = String(colToOwnerText.get(cell.col) || "").trim().toUpperCase();
      if (!norm || OFF_PATTERN.test(norm)) {
        schedule[date] = null;
        continue;
      }
      const matches = norm.match(ROUTE_PATTERN);
      if (matches && matches.length) {
        const seen = new Set();
        schedule[date] = matches.filter((r) => (seen.has(r) ? false : seen.add(r)));
      } else {
        schedule[date] = null;
      }
    }

    progress("done", { detectedDays: Object.keys(schedule).length });
    return {
      schedule,
      debug: {
        headerRowIdx,
        ownerRowIdx,
        detectedDays: colToDate.size,
        cellCount: seg.cells.length,
        offByColorCount,
        nameOcrCount: nameInputs.length,
        scheduleOcrCount: scheduleInputs.length,
      },
    };
  } finally {
    console.timeEnd("total");
  }
}
