// The caller supplies a Supabase client carrying the verified user's JWT and the public key.
// All reads are an allowlist and retain an explicit owner predicate in addition to RLS.
export const NOAH_READ_RESOURCES = Object.freeze({
  profile: "내 프로필, 월 매출 목표와 근무 설정",
  sales_days: "날짜별 수기 매출 헤더와 신선백/백업 단가. 자동 작업과 중복될 수 있는 보조 값",
  sales_manual_items: "날짜별 예정 근무표 구역 및 수기 매출 항목과 당시 단가. 배송수 0인 행도 유효한 예정 구역이며 완료 증거는 아님",
  sales_automatic_work: "완료된 자동 작업과 그 구역별 배송수/당시 단가. 같은 날짜의 팀 작업은 하나의 읽기 모델로 합쳐짐",
  sales_overrides: "날짜별 자동 매출 수정. 적용 시 그 날짜의 수기/자동 구역 행 전체를 대체하는 표시 값",
  expenses: "내 지출(확정/초안/휴지통), 금액, 분류, 가맹점과 메모. 영수증 원본 제외",
  expense_adjustments: "내 지출 환불·재입금 조정 내역. 환불은 원지출과 따로 집계",
  route_rates: "내 구역별 현재 기본 단가. 과거 매출의 단가 스냅샷과 다름",
  daily_inspections: "내 일상 점검 날짜·결과·조치. 서명 원본 제외",
  note_zones: "권한 있는 회사의 구역 이름과 설명",
  note_tips: "권한 있는 회사의 구역 팁과 작성자",
  note_favorites: "내가 즐겨찾기한 회사 구역",
});

export const NOAH_WRITE_ACTIONS = Object.freeze({
  add_expense: "확정 지출 추가: actual_date, gross_amount 필수. 선택: category, merchant, memo, payment_method, evidence_type, supply_amount, vat_amount, business_amount, usage_type",
  update_expense: "내 지출 수정: id 필수, 바꿀 지출 필드만 전달. 환불 누계 미만으로 총액 감소 불가",
  delete_expense: "내 지출을 휴지통으로 이동: id 필수",
  set_monthly_goal: "내 월 매출 목표 설정: goal_amount (원, 0~100000000)",
  set_route_rate: "내 구역 기본 단가 설정: route (예: 318A), current_unit (원, 0~100000)",
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 50;
const READ_CONFIG = Object.freeze({
  profile: { table: "quickflex_profiles", owner: "id", columns: "id,display_name,driver_type,work_shift,goal_amount,fixed_routes,freshbag_mode,status", order: "id" },
  sales_days: { table: "quickflex_day_records", owner: "user_id", columns: "id,work_date,is_off,fresh_count,return_count,cancel_count,fresh_unit,backup_unit,driver_type,fresh_solo_count,fresh_linked_count,freshbag_mode,updated_at", date: "work_date", order: "work_date" },
  sales_manual_items: { table: "quickflex_day_route_items", owner: "user_id", columns: "id,work_date,route,delivery_count,household_count,unit_snapshot,sort_order", date: "work_date", search: "route", order: "work_date", tie: "id" },
  sales_automatic_work: { table: "quickflex_sales_work_results", owner: "user_id", columns: "work_id,work_date,work_shift,total_items", date: "work_date", order: "work_date" },
  sales_overrides: { table: "quickflex_sales_overrides", owner: "user_id", columns: "work_date,revision,reason,routes,total_items,updated_at", date: "work_date", order: "work_date" },
  expenses: { table: "quickflex_expenses", owner: "user_id", columns: "id,actual_date,gross_amount,category,merchant,payment_method,evidence_type,memo,supply_amount,vat_amount,business_amount,usage_type,status,created_at,updated_at", date: "actual_date", search: "merchant", id: "id", order: "actual_date", tie: "id" },
  expense_adjustments: { table: "quickflex_expense_adjustments", owner: "user_id", columns: "id,expense_id,kind,amount,actual_date,memo,created_at", date: "actual_date", id: "id", order: "actual_date", tie: "id" },
  route_rates: { table: "quickflex_route_rates", owner: "user_id", columns: "route,current_unit,updated_at", search: "route", order: "route" },
  daily_inspections: { table: "quickflex_daily_inspections", owner: "user_id", columns: "id,inspection_date,status,results,defect_notes,action_notes,source,created_at", date: "inspection_date", order: "inspection_date" },
  note_zones: { table: "quickflex_note_zones", columns: "id,company_id,name,memo,created_by,updated_at", search: "name", id: "id", order: "name", tie: "id" },
  note_tips: { table: "quickflex_note_tips", columns: "id,company_id,zone_id,title,marker_type,memo,lat,lng,author_name,created_at", search: "title", id: "id", order: "created_at", tie: "id" },
  note_favorites: { table: "quickflex_note_favorites", owner: "user_id", columns: "company_id,zone_id,created_at", order: "created_at", tie: "zone_id" },
});

const SEMANTICS = Object.freeze({
  sales_days: "날짜별 보조 헤더입니다. 자동 작업의 배송수/매출과 수기 항목을 그대로 합산하지 마세요. 매출은 확정된 구역 스냅샷 기준으로 계산합니다.",
  sales_manual_items: "근무표와 수기 구역 항목입니다. 배송수 0인 행도 예정 구역이며 완료 여부를 증명하지 않습니다. 완료 작업 구역과 수량은 sales_automatic_work에서 확인하세요. 적용된 날짜별 매출 수정이 있으면 표시 구역 행을 대체합니다.",
  sales_automatic_work: "완료된 작업과 구역 단가 스냅샷입니다. team:날짜 work_id는 여러 팀 입력을 합친 단일 작업이므로 원본 팀 입력과 중복 합산하지 마세요. 자동 unit_snapshot에는 백업 단가가 이미 포함되며 다시 더하지 않습니다. 날짜별 매출 수정이 있으면 그 수정 행을 우선합니다.",
  sales_overrides: "이 날짜의 표시 구역 행 전체를 대체합니다. 원본 수기/자동 행에 수정 행을 추가 합산하면 중복됩니다.",
  expenses: "지출의 gross_amount는 원금입니다. status=confirmed만 확정 지출입니다. 환불과 재입금은 expense_adjustments에서 별도로 확인하세요.",
  expense_adjustments: "refund는 원지출에서 빼고 reimbursement는 별도 유입으로 취급합니다. 원지출과 이 조정을 각각 지출로 더하지 마세요.",
  route_rates: "현재 기본 단가입니다. 과거 매출 계산에는 해당 항목의 unit_snapshot을 사용하세요.",
});

function assertClient(client, userId) {
  if (!client?.from || !client?.rpc || !UUID.test(String(userId))) throw new TypeError("Verified Supabase client and user ID required");
}
function validDate(value) {
  if (!DATE.test(String(value))) return false;
  const parsed=new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0,10)===value;
}
function checkArgs(args = {}) {
  if (!args || typeof args !== "object" || Array.isArray(args)) throw new TypeError("Invalid read request");
  const offset = args.offset == null ? 0 : Number(args.offset);
  const limit = args.limit == null ? 20 : Number(args.limit);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 10000 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new RangeError("Invalid page");
  for (const key of ["from", "to"]) {
    if (args[key] != null && !validDate(args[key])) throw new RangeError(`Invalid ${key} date`);
  }
  if (args.from && args.to && args.from > args.to) throw new RangeError("Date range is reversed");
  if (args.search != null && (typeof args.search !== "string" || args.search.length > 80)) throw new RangeError("Invalid search");
  if (args.id != null && (!UUID.test(String(args.id)))) throw new RangeError("Invalid ID");
  return { offset, limit };
}
function unwrap(result) {
  if (result?.error) {
    const messages = {
      '40001': '제안 후 원래 기록이 바뀌었어요. 최신 기록으로 새 제안을 요청해 주세요.',
      '55000': '제안이 만료되었거나 이미 처리됐어요. 최신 기록으로 다시 요청해 주세요.',
      'P0002': '본인 기록에서 해당 대상을 찾지 못했어요. 대상을 다시 확인해 주세요.',
      '42501': '승인된 계정과 본인 기록만 사용할 수 있어요. 다시 로그인해 주세요.',
      '22023': '변경할 날짜, 금액과 입력값을 다시 확인해 주세요.',
    };
    const message = messages[result.error.code];
    if (message) throw Object.assign(new Error(message), { status: result.error.code === '42501' ? 403 : 409 });
    throw result.error;
  }
  return result?.data;
}

export function createNoahDataTools({ client, userId }) {
  assertClient(client, userId);
  async function read(args = {}) {
    const resource = String(args.resource || "");
    if (!Object.hasOwn(READ_CONFIG,resource)) throw new RangeError("Unknown read resource");
    const cfg = READ_CONFIG[resource];
    const { offset, limit } = checkArgs(args);
    if ((args.from || args.to) && !cfg.date) throw new RangeError("This resource does not support date filters");
    if (args.search && !cfg.search) throw new RangeError("This resource does not support search");
    if (args.id && !cfg.id) throw new RangeError("This resource does not support ID filter");
    if (resource === "sales_automatic_work") {
      let query = client.from("quickflex_sales_work_results")
        .select("work_id,work_date,work_shift,total_households,total_items,fresh_count,return_count,cancel_count,finalized_at")
        .eq("user_id",userId).order("work_date",{ascending:false}).order("work_id",{ascending:true});
      if (args.from) query = query.gte("work_date",args.from);
      if (args.to) query = query.lte("work_date",args.to);
      const work = unwrap(await query.range(offset,offset+limit));
      const rows = work || [];
      let routesTruncated = false;
      if (rows.length) {
        const routeResult = await client.from("quickflex_sales_work_routes")
          .select("work_id,route,delivery_count,household_count,unit_snapshot,sort_order")
          .eq("user_id",userId).in("work_id",rows.map((row)=>row.work_id))
          .order("sort_order",{ascending:true}).range(0,999);
        const routePage = unwrap(routeResult) || [];
        // PostgREST commonly caps a response at 1000 rows. Treat an exact cap as incomplete.
        routesTruncated = routePage.length>=1000;
        const routes = routePage;
        for (const row of rows) row.routes = routes.filter((route)=>route.work_id===row.work_id);
      }
      return { resource,count:Math.min(rows.length,limit),offset,limit,hasMore:rows.length>limit,routesTruncated,
        rows:rows.slice(0,limit),semantics:SEMANTICS[resource]+(routesTruncated?" 구역 행이 잘려 이 페이지로 매출 합계를 계산할 수 없습니다.":"") };
    }
    let query = client.from(cfg.table).select(cfg.columns).order(cfg.order,{ascending:false});
    if (cfg.tie) query = query.order(cfg.tie,{ascending:false});
    if (cfg.owner) query = query.eq(cfg.owner,userId);
    if (resource.startsWith("note_")) {
      const memberships = unwrap(await client.from("quickflex_note_memberships")
        .select("company_id").eq("user_id",userId).range(0,100));
      const companies = [...new Set((memberships||[]).map((row)=>row.company_id))];
      if (!companies.length) return { resource,count:0,offset,limit,hasMore:false,rows:[],
        semantics:"권한 있는 회사의 자료가 없습니다." };
      query = query.in("company_id",companies);
    }
    if (cfg.date && args.from) query = query.gte(cfg.date,args.from);
    if (cfg.date && args.to) query = query.lte(cfg.date,args.to);
    if (cfg.search && args.search) query = query.ilike(cfg.search,`%${args.search.replace(/[%,()]/g,"")}%`);
    if (cfg.id && args.id) query = query.eq(cfg.id,args.id);
    const rows = unwrap(await query.range(offset,offset+limit)) || [];
    return { resource,count:Math.min(rows.length,limit),offset,limit,hasMore:rows.length>limit,
      rows:rows.slice(0,limit),semantics:SEMANTICS[resource] || "인증된 본인 또는 권한 있는 회사의 자료만 포함합니다." };
  }
  async function prepareWrite(args = {}) {
    const action = String(args.action || "");
    if (!Object.hasOwn(NOAH_WRITE_ACTIONS,action) || !args.values || typeof args.values !== "object" || Array.isArray(args.values)) throw new RangeError("Invalid write proposal");
    return unwrap(await client.rpc("quickflex_noah_prepare_write",{p_action:action,p_values:args.values}));
  }
  async function confirmWrite({ proposalId } = {}) {
    if (!UUID.test(String(proposalId))) throw new RangeError("Invalid proposal ID");
    return unwrap(await client.rpc("quickflex_noah_confirm_write",{p_proposal_id:proposalId}));
  }
  async function cancelWrite({ proposalId } = {}) {
    if (!UUID.test(String(proposalId))) throw new RangeError("Invalid proposal ID");
    return unwrap(await client.rpc("quickflex_noah_cancel_write",{p_proposal_id:proposalId}));
  }
  async function consumeQuota() {
    const quota=unwrap(await client.rpc("quickflex_noah_consume_quota"));
    if (!quota?.allowed) {
      const error=new Error("노아 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.");
      error.code="NOAH_QUOTA_EXCEEDED";
      error.status=429;
      error.quota=quota;
      throw error;
    }
    return quota;
  }
  return { read, prepareWrite, confirmWrite, cancelWrite, consumeQuota };
}
