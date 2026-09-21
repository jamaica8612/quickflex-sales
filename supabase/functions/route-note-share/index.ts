import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const TIP_BUCKET = "quickflex-route-notes-photos";
const ZONE_BUCKET = "quickflex-route-note-zone-photos";

function allowedOrigin(origin: string) {
  const configured = String(Deno.env.get("ROUTE_NOTE_SHARE_ALLOWED_ORIGINS") || "")
    .split(",").map((value) => value.trim()).filter(Boolean);
  if (configured.includes(origin) || origin === "https://jamaica8612.github.io") return true;
  try {
    const url = new URL(origin);
    return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

function headers(request: Request) {
  const origin = request.headers.get("origin") || "";
  const result: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    Vary: "Origin",
  };
  if (origin && allowedOrigin(origin)) {
    result["Access-Control-Allow-Origin"] = origin;
    result["Access-Control-Allow-Headers"] = "content-type, apikey";
    result["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return result;
}

function response(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers(request) });
}

function serverClient() {
  const url = String(Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const key = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (!url || !key) throw new Error("Route-note share service is not configured.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type SharedPhoto = { id: string; path: string; created_at: string; tip_id?: string; zone_id?: string; url?: string };
type SharedRoute = {
  expires_at: string;
  company: { id: string; name: string };
  zone: Record<string, unknown>;
  tips: Array<Record<string, unknown>>;
  tip_photos: SharedPhoto[];
  zone_photos: SharedPhoto[];
};

function validToken(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

function validatePhotos(shared: SharedRoute) {
  if (!shared.company?.id || !shared.zone?.id || !Array.isArray(shared.tips)) throw new Error("Invalid shared route.");
  const tipIds = new Set(shared.tips.map((tip) => String(tip.id || "")));
  const tipPath = new RegExp(`^${UUID}/${UUID}/${UUID}\\.(jpg|jpeg|png|webp)$`);
  const zonePath = new RegExp(`^zones/${UUID}/${UUID}/${UUID}\\.(jpg|jpeg|png)$`);
  for (const photo of shared.tip_photos || []) {
    const parts = String(photo.path || "").split("/");
    if (!tipPath.test(String(photo.path || "")) || parts[0] !== shared.company.id || parts[1] !== String(photo.tip_id) || !tipIds.has(String(photo.tip_id))) throw new Error("Invalid shared route photo.");
  }
  for (const photo of shared.zone_photos || []) {
    const parts = String(photo.path || "").split("/");
    if (!zonePath.test(String(photo.path || "")) || parts[1] !== shared.company.id || parts[2] !== shared.zone.id || String(photo.zone_id) !== shared.zone.id) throw new Error("Invalid shared zone photo.");
  }
}

async function signedPhotos(client: ReturnType<typeof serverClient>, bucket: string, photos: SharedPhoto[], ttlSeconds: number) {
  return Promise.all(photos.map(async (photo) => {
    const { data, error } = await client.storage.from(bucket).createSignedUrl(photo.path, ttlSeconds);
    if (error || !data?.signedUrl) throw new Error("Unable to sign shared route-note photo.");
    return { ...photo, url: data.signedUrl };
  }));
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") || "";
  if (origin && !allowedOrigin(origin)) return response(request, { error: "Origin is not allowed." }, 403);
  if (request.method === "OPTIONS") {
    return response(request, { ok: true });
  }
  if (request.method !== "POST") return response(request, { error: "POST 요청만 지원합니다." }, 405);

  try {
    const body = await request.json();
    if (!validToken(body?.token)) return response(request, { error: "공유 링크를 확인할 수 없습니다." }, 404);

    const client = serverClient();
    const { data, error } = await client.rpc("quickflex_get_shared_route", { p_token: body.token });
    if (error) throw new Error("Unable to read shared route note.");
    if (!data) return response(request, { error: "공유 링크를 확인할 수 없습니다." }, 404);
    const shared = data as SharedRoute;
    const remainingSeconds = Math.floor((Date.parse(shared.expires_at) - Date.now()) / 1000);
    if (!Number.isFinite(remainingSeconds) || remainingSeconds < 1) return response(request, { error: "공유 링크를 확인할 수 없습니다." }, 404);
    const ttlSeconds = Math.min(300, remainingSeconds);
    validatePhotos(shared);
    const [tipPhotos, zonePhotos] = await Promise.all([
      signedPhotos(client, TIP_BUCKET, Array.isArray(shared.tip_photos) ? shared.tip_photos : [], ttlSeconds),
      signedPhotos(client, ZONE_BUCKET, Array.isArray(shared.zone_photos) ? shared.zone_photos : [], ttlSeconds),
    ]);
    const confirmation = await client.rpc("quickflex_get_shared_route", { p_token: body.token });
    if (confirmation.error) throw new Error("Unable to confirm shared route note.");
    if (!confirmation.data) return response(request, { error: "공유 링크를 확인할 수 없습니다." }, 404);
    return response(request, { ...shared, tip_photos: tipPhotos, zone_photos: zonePhotos });
  } catch {
    return response(request, { error: "공유 링크를 불러올 수 없습니다." }, 500);
  }
});
