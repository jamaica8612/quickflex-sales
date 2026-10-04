import assert from 'node:assert/strict';
import test from 'node:test';
import { extractVisionSchedule } from '../supabase/functions/ocr-schedule/vision-schedule.ts';

function visionWord(text, x, y, width = Math.max(8, text.length * 9)) {
  return {
    symbols: [...text].map((symbol) => ({ text: symbol })),
    boundingBox: { vertices: [
      { x, y }, { x: x + width, y },
      { x: x + width, y: y + 16 }, { x, y: y + 16 },
    ] },
  };
}

async function extractWithWords(rows) {
  const originalFetch = globalThis.fetch;
  const originalDeno = globalThis.Deno;
  const words = rows.flatMap((row) => row.map(([text, x, y, width]) => visionWord(text, x, y, width)));
  globalThis.Deno = { env: { get: () => 'synthetic-test-key' } };
  globalThis.fetch = async () => Response.json({ responses: [{
    fullTextAnnotation: {
      text: 'synthetic schedule',
      pages: [{ blocks: [{ paragraphs: [{ words }] }] }],
    },
  }] });
  try {
    return await extractVisionSchedule({
      imageBase64: 'c3ludGhldGlj', mimeType: 'image/png', ownerName: '기사', year: 2026, month: 1,
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
  }
}

test('Vision rejoins route fragments only inside each selected driver date cell', async () => {
  const result = await extractWithWords([
    [['1', 90, 30], ['2', 190, 30], ['3', 290, 30], ['4', 390, 30], ['5', 490, 30]],
    [
      ['기사', 0, 100], ['319', 62, 100], ['ABCD', 92, 100],
      ['316', 162, 100], ['AB', 192, 100], ['313', 212, 100], ['C', 236, 100],
      ['ABC', 262, 100], ['junk', 292, 100], ['OFF', 362, 100], ['???', 462, 100],
    ],
    [['다른기사', 0, 150], ['999', 62, 150], ['Z', 92, 150]],
  ]);

  assert.deepEqual(result.schedule, {
    '2026-01-01': ['319A', '319B', '319C', '319D'],
    '2026-01-02': ['316A', '316B', '313C'],
    '2026-01-03': [],
    '2026-01-04': null,
    '2026-01-05': [],
  });
});
