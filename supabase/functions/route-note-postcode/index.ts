import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import proj4 from "https://esm.sh/proj4@2.19.10";
import { createPostcodeHandler } from "./handler.js";
import { transformPostcodeGeometry } from "./geometry.js";

const EPSG_5179 = "+proj=tmerc +lat_0=38 +lon_0=127.5 +k=0.9996 +x_0=1000000 +y_0=2000000 +ellps=GRS80 +units=m +no_defs";
proj4.defs("EPSG:5179", EPSG_5179);

const transform = (geometry: unknown) => transformPostcodeGeometry(geometry,
  (point: [number, number]) => proj4("EPSG:5179", "EPSG:4326", point));

async function authorize(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return false;
  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anonKey) throw new Error("Supabase configuration is missing");
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) return false;
  const { data: profile, error: profileError } = await client.from("quickflex_profiles")
    .select("id,status").eq("id", user.id).maybeSingle();
  if (profileError || profile?.status !== "approved") return false;
  const { data: memberships, error: membershipError } = await client.from("quickflex_note_memberships")
    .select("company_id,role").eq("user_id", user.id);
  return !membershipError && memberships?.length === 1 && ["admin", "editor", "member"].includes(memberships[0].role);
}

Deno.serve(createPostcodeHandler({ authorize, transform }));
