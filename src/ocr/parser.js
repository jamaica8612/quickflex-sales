// OCR된 셀 그리드를 스케줄 맵({ "YYYY-MM-DD": [routes] | null })으로 변환.
// 전략:
//   1) 헤더 행 = 숫자 셀이 가장 많은 행. 컬럼 → 날짜 매핑.
//   2) ownerName 텍스트가 들어있는 행 = 본인 행.
//   3) 본인 행 셀들을 헤더 컬럼과 매칭 → routes 배열 또는 null(휴무).

const ROUTE_PATTERN = /\d{3}[A-Z]/g;
const OFF_PATTERN = /휴무|OFF|^[\-X·]+$/i;

function normalizeText(s) {
  return String(s || "")
    .replace(/[\s ​]+/g, "")
    .toUpperCase();
}

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * @param {Array<{row:number,col:number,text:string}>} cells - text가 채워진 셀 배열
 * @param {string} ownerName
 * @param {number} year
 * @param {number} month
 * @returns {{ schedule: Object<string, string[]|null>, debug: object }}
 */
export function parseScheduleFromCells(cells, ownerName, year, month) {
  // 행별 그룹핑
  const rowMap = new Map();
  cells.forEach((c) => {
    if (!rowMap.has(c.row)) rowMap.set(c.row, []);
    rowMap.get(c.row).push(c);
  });

  // 1) 헤더 행 찾기 (1~31 범위 숫자 셀이 가장 많은 행)
  let headerRowIdx = -1;
  let headerScore = 0;
  for (const [idx, list] of rowMap) {
    const score = list.filter((c) => {
      const n = parseInt(String(c.text || "").trim(), 10);
      return Number.isFinite(n) && n >= 1 && n <= 31;
    }).length;
    if (score > headerScore) {
      headerScore = score;
      headerRowIdx = idx;
    }
  }
  if (headerRowIdx < 0 || headerScore < 5) {
    throw new Error("스케줄 헤더(날짜 행)를 찾지 못했습니다. 표가 명확히 보이는 이미지를 사용해 주세요.");
  }

  // 컬럼 → 날짜 매핑
  const colToDate = new Map();
  for (const c of rowMap.get(headerRowIdx)) {
    const day = parseInt(String(c.text || "").trim(), 10);
    if (Number.isFinite(day) && day >= 1 && day <= 31) {
      colToDate.set(c.col, dateKey(year, month, day));
    }
  }

  // 2) ownerName 행 찾기 (텍스트 부분 일치)
  const ownerNorm = normalizeText(ownerName);
  let ownerRowIdx = -1;
  for (const [idx, list] of rowMap) {
    if (idx === headerRowIdx) continue;
    const joined = list.map((c) => normalizeText(c.text)).join("");
    if (joined.includes(ownerNorm)) {
      ownerRowIdx = idx;
      break;
    }
  }
  if (ownerRowIdx < 0) {
    throw new Error(`스케줄에서 '${ownerName}' 행을 찾지 못했습니다. 이름이 정확히 일치하는지 확인해 주세요.`);
  }

  // 3) 본인 행 → 스케줄 맵
  const schedule = {};
  for (const c of rowMap.get(ownerRowIdx)) {
    const date = colToDate.get(c.col);
    if (!date) continue;
    const text = String(c.text || "").trim();
    const norm = text.toUpperCase();
    if (!norm || OFF_PATTERN.test(norm)) {
      schedule[date] = null;
      continue;
    }
    const matches = norm.match(ROUTE_PATTERN);
    if (matches && matches.length) {
      // 중복 제거하면서 순서 유지
      const seen = new Set();
      schedule[date] = matches.filter((r) => (seen.has(r) ? false : seen.add(r)));
    } else {
      schedule[date] = null;
    }
  }

  return {
    schedule,
    debug: {
      headerRowIdx,
      ownerRowIdx,
      detectedDays: colToDate.size,
      cellCount: cells.length,
    },
  };
}
