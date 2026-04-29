import type { OcrHarnessInput, OcrHarnessResult, ScheduleMap } from "./types.ts";

const VISION_ENDPOINT = "https://vision.googleapis.com/v1/images:annotate";
const ROUTE_PATTERN = /\d{3}[A-Z]/g;
const OFF_PATTERN = /휴무|OFF|^[\-X·]+$/i;

type Vertex = { x?: number; y?: number };
type BoundingBox = { vertices?: Vertex[]; normalizedVertices?: Vertex[] };
type VisionSymbol = { text?: string };
type VisionWord = { symbols?: VisionSymbol[]; boundingBox?: BoundingBox };
type VisionParagraph = { words?: VisionWord[] };
type VisionBlock = { paragraphs?: VisionParagraph[] };
type VisionPage = { blocks?: VisionBlock[] };
type VisionResponse = {
  responses?: Array<{
    fullTextAnnotation?: { text?: string; pages?: VisionPage[] };
    textAnnotations?: Array<{ description?: string; boundingPoly?: BoundingBox }>;
    error?: { message?: string };
  }>;
};

type OcrWord = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
};

type OcrRow = {
  words: OcrWord[];
  cy: number;
  top: number;
  bottom: number;
  text: string;
};

type HeaderDate = {
  day: number;
  x: number;
  month?: number;
  explicit: boolean;
};

function getVisionKey(): string {
  const key =
    (Deno.env.get("GOOGLE_CLOUD_VISION_API_KEY") || "").trim() ||
    (Deno.env.get("CLOUD_VISION_API_KEY") || "").trim();
  if (!key) throw new Error("Server secret GOOGLE_CLOUD_VISION_API_KEY is not configured.");
  return key;
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function dateKeyForHeader(year: number, inputMonth: number, headerDate: HeaderDate): string {
  const month = headerDate.month || inputMonth;
  let resolvedYear = year;
  if (inputMonth === 1 && month === 12) resolvedYear -= 1;
  if (inputMonth === 12 && month === 1) resolvedYear += 1;
  return dateKey(resolvedYear, month, headerDate.day);
}

function normalizeText(value: string): string {
  return String(value || "").replace(/[\s\u00a0]/g, "").toUpperCase();
}

function normalizeRouteText(value: string): string {
  return normalizeText(value).replace(/[^0-9A-Z]/g, "");
}

function uniqueRoutes(text: string): string[] {
  const matches = normalizeRouteText(text).match(ROUTE_PATTERN) || [];
  const seen = new Set<string>();
  return matches.filter((route) => (seen.has(route) ? false : (seen.add(route), true)));
}

function boxFromVertices(box?: BoundingBox): { x: number; y: number; w: number; h: number } | null {
  const vertices = box?.vertices || box?.normalizedVertices || [];
  if (!vertices.length) return null;
  const xs = vertices.map((v) => Number(v.x)).filter(Number.isFinite);
  const ys = vertices.map((v) => Number(v.y)).filter(Number.isFinite);
  if (!xs.length || !ys.length) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  return { x: minX, y: minY, w, h };
}

function wordText(word: VisionWord): string {
  return (word.symbols || []).map((s) => s.text || "").join("").trim();
}

function pushWord(words: OcrWord[], text: string, box?: BoundingBox) {
  const clean = String(text || "").trim();
  const rect = boxFromVertices(box);
  if (!clean || !rect) return;
  words.push({
    text: clean,
    x: rect.x,
    y: rect.y,
    w: rect.w,
    h: rect.h,
    cx: rect.x + rect.w / 2,
    cy: rect.y + rect.h / 2,
  });
}

function wordsFromVision(payload: VisionResponse): { rawText: string; words: OcrWord[] } {
  const response = payload.responses?.[0] || {};
  if (response.error?.message) throw new Error(`Cloud Vision 오류: ${response.error.message}`);

  const words: OcrWord[] = [];
  for (const page of response.fullTextAnnotation?.pages || []) {
    for (const block of page.blocks || []) {
      for (const paragraph of block.paragraphs || []) {
        for (const word of paragraph.words || []) {
          pushWord(words, wordText(word), word.boundingBox);
        }
      }
    }
  }

  if (!words.length) {
    for (const annotation of (response.textAnnotations || []).slice(1)) {
      pushWord(words, annotation.description || "", annotation.boundingPoly);
    }
  }

  const rawText = response.fullTextAnnotation?.text || response.textAnnotations?.[0]?.description || "";
  if (!rawText.trim() || !words.length) {
    throw new Error("Cloud Vision이 스케줄 텍스트를 읽지 못했습니다. 더 선명한 원본 이미지를 사용해 주세요.");
  }
  return { rawText, words };
}

async function runVision(input: OcrHarnessInput): Promise<{ rawText: string; words: OcrWord[] }> {
  const apiKey = getVisionKey();
  const response = await fetch(`${VISION_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [{
        image: { content: input.imageBase64 },
        features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
        imageContext: { languageHints: ["ko", "en"] },
      }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`Cloud Vision 호출 실패 (${response.status}): ${errorText.slice(0, 300)}`);
  }

  return wordsFromVision(await response.json() as VisionResponse);
}

function median(values: number[]): number {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 14;
  return sorted[Math.floor(sorted.length / 2)];
}

function buildRows(words: OcrWord[]): OcrRow[] {
  const tolerance = Math.max(10, median(words.map((w) => w.h)) * 0.8);
  const rows: OcrRow[] = [];
  for (const word of [...words].sort((a, b) => a.cy - b.cy || a.x - b.x)) {
    let row = rows.find((candidate) => Math.abs(candidate.cy - word.cy) <= tolerance);
    if (!row) {
      row = { words: [], cy: word.cy, top: word.y, bottom: word.y + word.h, text: "" };
      rows.push(row);
    }
    row.words.push(word);
    row.cy = row.words.reduce((sum, w) => sum + w.cy, 0) / row.words.length;
    row.top = Math.min(...row.words.map((w) => w.y));
    row.bottom = Math.max(...row.words.map((w) => w.y + w.h));
  }
  return rows
    .map((row) => {
      row.words.sort((a, b) => a.x - b.x);
      row.text = row.words.map((w) => w.text).join(" ");
      return row;
    })
    .sort((a, b) => a.cy - b.cy);
}

function parseHeaderDate(text: string): HeaderDate | null {
  const clean = normalizeText(text);
  if (/\d{3}[A-Z]/.test(clean)) return null;
  const full = clean.match(/(\d{1,2})[./-](\d{1,2})/);
  if (full) {
    const month = Number(full[1]);
    const day = Number(full[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) return { month, day, x: 0, explicit: true };
    return null;
  }
  const single = clean.match(/^(\d{1,2})(?:[월화수목금토일])?$/);
  if (!single) return null;
  const day = Number(single[1]);
  return day >= 1 && day <= 31 ? { day, x: 0, explicit: false } : null;
}

function dedupeHeaderDates(dates: HeaderDate[]): HeaderDate[] {
  const deduped: HeaderDate[] = [];
  for (const date of dates.sort((a, b) => a.x - b.x)) {
    const prev = deduped[deduped.length - 1];
    if (prev && prev.day === date.day && prev.month === date.month && Math.abs(prev.x - date.x) < 12) continue;
    deduped.push(date);
  }
  return deduped;
}

function findHeaderRow(rows: OcrRow[]): { row: OcrRow; dates: HeaderDate[] } {
  let best: { row: OcrRow; dates: HeaderDate[]; score: number } | null = null;
  for (const row of rows) {
    const dates = row.words
      .map((word) => {
        const parsed = parseHeaderDate(word.text);
        return parsed ? { ...parsed, x: word.cx } : null;
      })
      .filter((item): item is HeaderDate => item !== null);
    const explicitDates = dates.filter((date) => date.explicit);
    const usableDates = explicitDates.length >= 3 ? explicitDates : dates;
    const deduped = dedupeHeaderDates(usableDates);
    const uniqueDays = new Set(deduped.map((d) => `${d.month || ""}-${d.day}`));
    const spread = deduped.length > 1 ? Math.max(...deduped.map((d) => d.x)) - Math.min(...deduped.map((d) => d.x)) : 0;
    const explicitBonus = explicitDates.length >= 3 ? 1000 : 0;
    const score = explicitBonus + uniqueDays.size * 100 + spread / 10 - row.cy / 10;
    if (uniqueDays.size >= 3 && (!best || score > best.score)) {
      best = { row, dates: deduped, score };
    }
  }
  if (!best) throw new Error("스케줄 날짜 행을 찾지 못했습니다. 날짜 숫자가 보이는 원본 이미지를 사용해 주세요.");

  return { row: best.row, dates: best.dates };
}

function findOwnerRow(rows: OcrRow[], headerRow: OcrRow, ownerName: string): OcrRow {
  const ownerNorm = normalizeText(ownerName);
  const candidates = rows.filter((row) => row !== headerRow);
  const exact = candidates.find((row) => normalizeText(row.text).includes(ownerNorm));
  if (exact) return exact;

  const ownerParts = ownerNorm.split("").filter(Boolean);
  let best: { row: OcrRow; score: number } | null = null;
  for (const row of candidates) {
    const text = normalizeText(row.text);
    const score = ownerParts.reduce((sum, ch) => sum + (text.includes(ch) ? 1 : 0), 0);
    if (score >= Math.max(2, ownerParts.length - 1) && (!best || score > best.score)) {
      best = { row, score };
    }
  }
  if (!best) throw new Error(`스케줄에서 '${ownerName}' 행을 찾지 못했습니다. 이름이 표에 보이는 그대로 입력됐는지 확인해 주세요.`);
  return best.row;
}

function columnBounds(dates: HeaderDate[], index: number): { left: number; right: number } {
  const current = dates[index];
  const prev = dates[index - 1];
  const next = dates[index + 1];
  const left = prev ? (prev.x + current.x) / 2 : current.x - Math.max(18, next ? (next.x - current.x) / 2 : 40);
  const right = next ? (current.x + next.x) / 2 : current.x + Math.max(18, prev ? (current.x - prev.x) / 2 : 40);
  return { left, right };
}

function buildSchedule(
  ownerRow: OcrRow,
  dates: HeaderDate[],
  year: number,
  month: number,
): { schedule: ScheduleMap; columns: Array<{ date: string; left: number; right: number }> } {
  const schedule: ScheduleMap = {};
  const columns: Array<{ date: string; left: number; right: number }> = [];
  dates.forEach((date, index) => {
    const { left, right } = columnBounds(dates, index);
    const text = ownerRow.words
      .filter((word) => word.cx >= left && word.cx < right)
      .map((word) => word.text)
      .join(" ");
    const key = dateKeyForHeader(year, month, date);
    columns.push({ date: key, left, right });
    if (!text.trim() || OFF_PATTERN.test(normalizeText(text))) {
      schedule[key] = null;
      return;
    }
    const routes = uniqueRoutes(text);
    schedule[key] = routes;
  });
  return { schedule, columns };
}

export async function extractVisionSchedule(input: OcrHarnessInput): Promise<OcrHarnessResult> {
  const { rawText, words } = await runVision(input);
  const rows = buildRows(words);
  const { row: headerRow, dates } = findHeaderRow(rows);
  const ownerRow = findOwnerRow(rows, headerRow, input.ownerName);
  const { schedule, columns } = buildSchedule(ownerRow, dates, input.year, input.month);

  return {
    schedule,
    rawText,
    provider: "cloud-vision",
    model: "document-text-detection",
    debug: {
      columns,
      ownerRow: { top: ownerRow.top, bottom: ownerRow.bottom, cy: ownerRow.cy },
    },
  };
}
