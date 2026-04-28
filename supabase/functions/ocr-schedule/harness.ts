import { GeminiScheduleProvider } from "./providers/gemini.ts";
import { CloudVisionProvider } from "./providers/cloud-vision.ts";
import type { ScheduleOcrProvider } from "./types.ts";

export function createOcrProvider(): ScheduleOcrProvider {
  const provider = (Deno.env.get("OCR_PROVIDER") || "gemini").trim().toLowerCase();

  switch (provider) {
    case "gemini":
      return new GeminiScheduleProvider(Deno.env.get("GEMINI_API_KEY") || "");
    case "cloud-vision":
    case "vision":
    case "google-vision":
      return new CloudVisionProvider(
        Deno.env.get("CLOUD_VISION_API_KEY") || "",
        Deno.env.get("GEMINI_API_KEY") || "",
      );
    default:
      throw new Error(`지원하지 않는 OCR_PROVIDER 입니다: ${provider}`);
  }
}
