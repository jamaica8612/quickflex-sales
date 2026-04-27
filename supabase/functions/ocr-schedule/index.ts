import { createOcrProvider } from "./harness.ts";
import type { OcrRequest } from "./types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "POST 요청만 지원합니다." }, 405);
  }

  try {
    const body = await request.json() as OcrRequest;
    const imageBase64 = String(body.imageBase64 || "").trim();
    const mimeType = String(body.mimeType || "image/jpeg").trim();
    const ownerName = String(body.ownerName || "김관현").trim();
    const year = Number(body.year) || new Date().getFullYear();
    const month = Number(body.month) || new Date().getMonth() + 1;
    const kind = body.kind === "settlement" ? "settlement" : "schedule";

    if (!imageBase64) {
      return jsonResponse({ error: "imageBase64 값이 필요합니다." }, 400);
    }

    const provider = createOcrProvider();
    const input = {
      imageBase64,
      mimeType,
      ownerName,
      year,
      month,
    };
    const result = kind === "settlement"
      ? await provider.extractSettlement(input)
      : await provider.extractSchedule(input);

    return jsonResponse(result);
  } catch (error) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "알 수 없는 OCR 서버 오류입니다.",
      },
      500,
    );
  }
});
