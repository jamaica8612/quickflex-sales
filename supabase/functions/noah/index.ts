import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { createNoahDataTools, NOAH_READ_RESOURCES, NOAH_WRITE_ACTIONS } from "./data-tools.js";
import { createNoahHandler, createOpenAIResponder } from "./handler.js";
import { readFinanceSummary } from "./finance.js";
import { readNoahWorkDateContext } from "./work-date-context.js";

const apiKey = Deno.env.get("OPENAI_API_KEY") || "";
const resources = { ...NOAH_READ_RESOURCES,
  finance_summary: "기간 정산의 정확한 매출·배송 수량·신선백·백업 수당·확정 지출·환불·순수익·목표 요약. from/to 필수, 최대 366일. 합계 질문은 이 자원을 우선 사용. 월 정산은 전월 26일부터 해당 월 25일까지." };

async function authorize(request: Request) {
  const token = request.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return null;
  const databaseDeadline = AbortSignal.timeout(75_000);
  const client = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${token}` }, fetch: (input, init = {}) => fetch(input, {
      ...init, signal: AbortSignal.any([databaseDeadline, request.signal, ...(init.signal ? [init.signal] : [])]),
    }) },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile, error: profileError } = await client.from("quickflex_profiles")
    .select("id,status,work_shift").eq("id", user.id).maybeSingle();
  if (profileError) throw Object.assign(new Error("근무조 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요."), { status: 503 });
  if (profile?.status !== "approved") return null;
  const dataTools: Omit<ReturnType<typeof createNoahDataTools>, "read"> & {
    read: (args?: Record<string, unknown>) => Promise<unknown>;
  } = createNoahDataTools({ client, userId: user.id });
  const read = dataTools.read;
  dataTools.read = async (args = {}) => {
    if (args.resource !== "finance_summary") return read(args);
    try {
      return await readFinanceSummary({ client, userId: user.id, from: args.from, to: args.to });
    } catch {
      throw new Error("정산 자료를 완전히 확인하지 못했어요. 시작일과 종료일(최대 366일)을 확인하거나 잠시 후 다시 조회해 주세요. 불완전한 합계는 제공하지 않습니다.");
    }
  };
  return { userId: user.id, dataTools,
    getWorkDateContext: (now: Date) => readNoahWorkDateContext({ client, userId: user.id,
      workShift: profile.work_shift, now }) };
}

Deno.serve(createNoahHandler({ authorize, respond: createOpenAIResponder(apiKey), configured: () => Boolean(apiKey),
  resources, actions: NOAH_WRITE_ACTIONS }));
