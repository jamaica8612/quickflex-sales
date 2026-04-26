import { buildSchedulePrompt } from "../prompt.ts";
import type { OcrHarnessInput, OcrHarnessResult, ScheduleOcrProvider } from "../types.ts";
import { extractJsonObject, normalizeScheduleMap } from "../utils.ts";

export class GeminiScheduleProvider implements ScheduleOcrProvider {
  readonly name = "gemini";
  readonly model: string;
  private readonly apiKey: string;

  constructor(apiKey: string, model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash") {
    if (!apiKey) {
      throw new Error("서버 환경변수 GEMINI_API_KEY가 설정되지 않았습니다.");
    }
    this.apiKey = apiKey;
    this.model = model;
  }

  async extractSchedule(input: OcrHarnessInput): Promise<OcrHarnessResult> {
    const prompt = buildSchedulePrompt(input.ownerName, input.year, input.month);
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
      throw new Error(errorText || `Gemini 요청 실패 (${response.status})`);
    }

    const payload = await response.json();
    const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!rawText) {
      throw new Error("Gemini 응답 텍스트가 비어 있습니다.");
    }

    return {
      schedule: normalizeScheduleMap(extractJsonObject(rawText)),
      rawText,
      provider: this.name,
      model: this.model,
    };
  }
}
