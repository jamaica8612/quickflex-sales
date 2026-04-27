import { buildSchedulePrompt, buildSettlementPrompt } from "../prompt.ts";
import type { OcrHarnessInput, OcrHarnessResult, ScheduleOcrProvider, SettlementOcrResult } from "../types.ts";
import { extractJsonObject, normalizeScheduleMap, normalizeSettlementRows } from "../utils.ts";

export class GeminiScheduleProvider implements ScheduleOcrProvider {
  readonly name = "gemini";
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash") {
    if (!apiKey) {
      throw new Error("Server secret GEMINI_API_KEY is not configured.");
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  async extractSchedule(input: OcrHarnessInput): Promise<OcrHarnessResult> {
    const rawText = await this.generate(input, buildSchedulePrompt(input.ownerName, input.year, input.month));

    return {
      schedule: normalizeScheduleMap(extractJsonObject(rawText)),
      rawText,
      provider: this.name,
      model: this.model,
    };
  }

  async extractSettlement(input: OcrHarnessInput): Promise<SettlementOcrResult> {
    const rawText = await this.generate(input, buildSettlementPrompt(input.ownerName));

    return {
      settlement: {
        rows: normalizeSettlementRows(extractJsonObject(rawText)),
      },
      rawText,
      provider: this.name,
      model: this.model,
    };
  }

  private async generate(input: OcrHarnessInput, prompt: string): Promise<string> {
    const body = JSON.stringify({
      contents: [{
        parts: [
          { inline_data: { mime_type: input.mimeType, data: input.imageBase64 } },
          { text: prompt },
        ],
      }],
      generationConfig: { temperature: 0 },
    });
    let response: Response | null = null;
    let errorText = "";

    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        },
      );
      if (response.ok) break;
      errorText = await response.text().catch(() => "");
      if (![429, 503].includes(response.status) || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
    }

    if (!response?.ok) {
      const status = response?.status || 500;
      if (status === 429 || status === 503 || /UNAVAILABLE|high demand|overloaded/i.test(errorText)) {
        throw new Error("OCR 모델 사용량이 많아 잠시 처리하지 못했습니다. 1~2분 뒤 다시 시도해 주세요.");
      }
      throw new Error(errorText || `Gemini request failed (${status})`);
    }

    const payload = await response.json();
    const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!rawText) {
      throw new Error("Gemini returned an empty text response.");
    }

    return rawText;
  }
}
