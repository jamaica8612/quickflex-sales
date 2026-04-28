import { buildSchedulePrompt, buildSettlementPrompt } from "../prompt.ts";
import type { OcrHarnessInput, OcrHarnessResult, ScheduleOcrProvider, SettlementOcrResult } from "../types.ts";
import { extractJsonObject, normalizeScheduleMap, normalizeSettlementRows } from "../utils.ts";

/**
 * Hybrid OCR provider:
 * 1) Google Cloud Vision API로 이미지에서 텍스트 추출 (한국어 OCR 강력)
 * 2) Gemini로 추출된 텍스트를 구조화된 JSON으로 변환 (텍스트 추론 강력)
 *
 * 필요 환경변수:
 *   - CLOUD_VISION_API_KEY: Google Cloud Vision API 키
 *   - GEMINI_API_KEY: Gemini API 키 (텍스트 → JSON 구조화에 사용)
 *   - GEMINI_MODEL (선택): 기본 gemini-2.5-flash
 */
export class CloudVisionProvider implements ScheduleOcrProvider {
  readonly name = "cloud-vision";
  readonly model: string;
  private readonly visionApiKey: string;
  private readonly geminiApiKey: string;

  constructor(
    visionApiKey: string,
    geminiApiKey: string,
    model = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash",
  ) {
    if (!visionApiKey) {
      throw new Error("Server secret CLOUD_VISION_API_KEY is not configured.");
    }
    if (!geminiApiKey) {
      throw new Error("Server secret GEMINI_API_KEY is not configured.");
    }
    this.visionApiKey = visionApiKey;
    this.geminiApiKey = geminiApiKey;
    this.model = model;
  }

  async extractSchedule(input: OcrHarnessInput): Promise<OcrHarnessResult> {
    const ocrText = await this.runCloudVision(input);
    const rawText = await this.structureWithGemini(
      ocrText,
      buildSchedulePrompt(input.ownerName, input.year, input.month),
    );

    return {
      schedule: normalizeScheduleMap(extractJsonObject(rawText)),
      rawText,
      provider: this.name,
      model: this.model,
    };
  }

  async extractSettlement(input: OcrHarnessInput): Promise<SettlementOcrResult> {
    const ocrText = await this.runCloudVision(input);
    const rawText = await this.structureWithGemini(
      ocrText,
      buildSettlementPrompt(input.ownerName),
    );

    return {
      settlement: {
        rows: normalizeSettlementRows(extractJsonObject(rawText)),
      },
      rawText,
      provider: this.name,
      model: this.model,
    };
  }

  /** Cloud Vision DOCUMENT_TEXT_DETECTION: 이미지 → 텍스트 (구조 보존) */
  private async runCloudVision(input: OcrHarnessInput): Promise<string> {
    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${this.visionApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requests: [{
            image: { content: input.imageBase64 },
            features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
            imageContext: {
              languageHints: ["ko", "en"],
            },
          }],
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "");
      throw new Error(`Cloud Vision API 호출 실패: ${errorText || response.status}`);
    }

    const payload = await response.json();
    const apiError = payload?.responses?.[0]?.error;
    if (apiError) {
      throw new Error(`Cloud Vision 오류: ${apiError.message || JSON.stringify(apiError)}`);
    }
    const text = payload?.responses?.[0]?.fullTextAnnotation?.text
      || payload?.responses?.[0]?.textAnnotations?.[0]?.description
      || "";
    if (!text) {
      throw new Error("Cloud Vision이 텍스트를 추출하지 못했습니다. 이미지 화질을 확인해 주세요.");
    }
    return text;
  }

  /** Gemini 텍스트 모드: OCR 텍스트 → 구조화된 JSON */
  private async structureWithGemini(ocrText: string, basePrompt: string): Promise<string> {
    const fullPrompt = [
      basePrompt,
      "",
      "주의: 아래는 이미지에서 OCR로 추출된 텍스트입니다.",
      "줄바꿈과 공백이 원본 표의 위치 정보를 일부 반영하므로, 같은 줄/근접 위치 텍스트는 같은 행으로 해석하세요.",
      "",
      "=== 추출된 텍스트 ===",
      ocrText,
      "=== 끝 ===",
    ].join("\n");

    const body = JSON.stringify({
      contents: [{
        parts: [{ text: fullPrompt }],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    });

    let response: Response | null = null;
    let errorText = "";

    for (let attempt = 0; attempt < 3; attempt += 1) {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.geminiApiKey}`,
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
        throw new Error("처리 모델 사용량이 많아 잠시 처리하지 못했습니다. 1~2분 뒤 다시 시도해 주세요.");
      }
      throw new Error(errorText || `Gemini request failed (${status})`);
    }

    const payload = await response.json();
    const rawText = payload?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!rawText) {
      throw new Error("Gemini가 빈 응답을 반환했습니다.");
    }
    return rawText;
  }
}
