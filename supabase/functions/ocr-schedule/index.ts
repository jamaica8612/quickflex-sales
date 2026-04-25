const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type OcrRequest = {
  imageBase64?: string;
  mimeType?: string;
  ownerName?: string;
  year?: number;
  month?: number;
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

function buildPrompt(ownerName: string, year: number, month: number) {
  return `${ownerName}의 쿠팡 퀵플렉스 스케줄을 읽어 JSON으로만 답하세요.

기준 정산월: ${year}년 ${month}월
형식:
{
  "YYYY-MM-DD": ["302C", "313B"],
  "YYYY-MM-DD": null
}

규칙:
- ${ownerName} 행만 추출
- 휴무는 null
- 구역은 숫자 3자리 + 영문 1자리 형식
- 다른 설명 없이 JSON만 반환`;
}

function extractJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      throw new Error("Gemini 응답에서 JSON을 찾지 못했습니다.");
    }
    return JSON.parse(match[0]);
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "POST 요청만 지원합니다." }, 405);
  }

  const geminiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiKey) {
    return jsonResponse({ error: "서버 환경변수 GEMINI_API_KEY가 설정되지 않았습니다." }, 500);
  }

  try {
    const body = await request.json() as OcrRequest;
    const imageBase64 = String(body.imageBase64 || "").trim();
    const mimeType = String(body.mimeType || "image/jpeg").trim();
    const ownerName = String(body.ownerName || "김관현").trim();
    const year = Number(body.year) || new Date().getFullYear();
    const month = Number(body.month) || new Date().getMonth() + 1;

    if (!imageBase64) {
      return jsonResponse({ error: "imageBase64 값이 필요합니다." }, 400);
    }

    const prompt = buildPrompt(ownerName, year, month);
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inline_data: { mime_type: mimeType, data: imageBase64 } },
              { text: prompt },
            ],
          }],
          generationConfig: { temperature: 0 },
        }),
      },
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text().catch(() => "");
      return jsonResponse({
        error: errorText || `Gemini 요청 실패 (${geminiResponse.status})`,
      }, 502);
    }

    const geminiJson = await geminiResponse.json();
    const rawText = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    if (!rawText) {
      return jsonResponse({ error: "Gemini 응답 텍스트가 비어 있습니다." }, 502);
    }

    const parsed = extractJson(rawText);
    const schedule: Record<string, string[] | null> = {};
    Object.entries(parsed || {}).forEach(([dateKey, routes]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
      schedule[dateKey] = Array.isArray(routes)
        ? routes.map((route) => String(route).trim().toUpperCase()).filter(Boolean)
        : null;
    });

    return jsonResponse({ schedule, rawText });
  } catch (error) {
    return jsonResponse({
      error: error instanceof Error ? error.message : "알 수 없는 OCR 서버 오류입니다.",
    }, 500);
  }
});
