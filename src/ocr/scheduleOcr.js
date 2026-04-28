// 스케줄 OCR 진입점.
// 외부에서는 detectSchedule(blob, ownerName, year, month) 만 호출.

import { segmentTable } from "./segmenter.js";
import { recognizeMany, warmup as warmupOcr } from "./ocrService.js";
import { parseScheduleFromCells } from "./parser.js";

/**
 * @param {Blob | HTMLCanvasElement | HTMLImageElement} input
 * @param {string} ownerName
 * @param {number} year
 * @param {number} month
 * @param {(stage: string, info?: object) => void} [onProgress]
 * @returns {Promise<{ schedule: Object<string, string[]|null>, debug: object }>}
 */
export async function detectSchedule(input, ownerName, year, month, onProgress) {
  const progress = typeof onProgress === "function" ? onProgress : () => {};

  progress("loading-engines");
  await warmupOcr();

  progress("segmenting");
  const cells = await segmentTable(input);
  if (!cells.length) throw new Error("표를 인식하지 못했습니다. 이미지에 격자선이 명확히 보이는지 확인해 주세요.");

  progress("recognizing", { total: cells.length });
  const results = await recognizeMany(cells.map((c) => c.canvas));
  cells.forEach((c, i) => {
    c.text = results[i]?.text ?? "";
    c.confidence = results[i]?.confidence ?? -1;
  });

  progress("parsing");
  const { schedule, debug } = parseScheduleFromCells(cells, ownerName, year, month);

  progress("done", { detectedDays: Object.keys(schedule).length });
  return { schedule, debug };
}
