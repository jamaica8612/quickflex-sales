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
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: input.mimeType, data: input.imageBase64 } },
              { text: prompt },
            ],
          }],
          generationConfig: { temperature: 0 },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(errorText || `Gemini request failed (${response.status})`);
    }

    const payload = await response.json();
    const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!rawText) {
      throw new Error("Gemini returned an empty text response.");
    }

    return rawText;
  }
}
