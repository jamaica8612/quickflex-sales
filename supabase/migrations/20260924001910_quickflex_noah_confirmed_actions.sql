-- Noah's proposals and quota are private. Only narrow authenticated RPCs are exposed.
create schema if not exists quickflex_noah_private;
revoke all on schema quickflex_noah_private from public, anon, authenticated;
grant usage on schema quickflex_noah_private to authenticated;

create table if not exists quickflex_noah_private.proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (action in ('add_expense','update_expense','delete_expense','set_monthly_goal','set_route_rate')),
  payload jsonb not null,
  before_value jsonb,
  title text not null,
  changes jsonb not null,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '10 minutes'),
  completed_at timestamptz
);
create index if not exists quickflex_noah_proposals_owner_idx on quickflex_noah_private.proposals(user_id, created_at desc);
alter table quickflex_noah_private.proposals enable row level security;
revoke all on quickflex_noah_private.proposals from public, anon, authenticated;

create table if not exists quickflex_noah_private.minute_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null,
  usage_minute timestamp not null,
  requests integer not null check (requests between 1 and 10),
  primary key (user_id, usage_minute)
);
create index if not exists quickflex_noah_usage_day_idx on quickflex_noah_private.minute_usage(user_id,usage_day);
alter table quickflex_noah_private.minute_usage enable row level security;
revoke all on quickflex_noah_private.minute_usage from public, anon, authenticated;

create or replace function quickflex_noah_private.quickflex_noah_consume_quota()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := (select auth.uid());
  kst timestamp := clock_timestamp() at time zone 'Asia/Seoul';
  minute_key timestamp;
  day_key date;
  daily_count integer;
  minute_count integer;
begin
  if owner is null or not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode='42501';
  end if;
  minute_key := date_trunc('minute',kst);
  day_key := kst::date;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('noah-quota:' || owner::text,0));
  select coalesce(sum(requests),0)::integer into daily_count
    from quickflex_noah_private.minute_usage where user_id=owner and usage_day=day_key;
  select coalesce(requests,0) into minute_count
    from quickflex_noah_private.minute_usage where user_id=owner and usage_minute=minute_key;
  minute_count := coalesce(minute_count,0);
  if daily_count >= 100 or minute_count >= 10 then
    return jsonb_build_object('allowed',false,'remainingDaily',greatest(0,100-daily_count),
      'remainingMinute',greatest(0,10-minute_count),
      'retryAfterSeconds',case when daily_count>=100 then extract(epoch from ((day_key+1)::timestamp-kst))::integer
                              else 60-extract(second from kst)::integer end);
  end if;
  insert into quickflex_noah_private.minute_usage(user_id,usage_day,usage_minute,requests)
    values(owner,day_key,minute_key,1)
    on conflict (user_id,usage_minute) do update set requests=quickflex_noah_private.minute_usage.requests+1;
  return jsonb_build_object('allowed',true,'remainingDaily',99-daily_count,'remainingMinute',9-minute_count);
end $$;

create or replace function quickflex_noah_private.change_label(p_key text)
returns text language sql immutable security invoker set search_path='' as $$
  select case p_key
    when 'actual_date' then '거래일' when 'gross_amount' then '총액'
    when 'category' then '분류' when 'merchant' then '가맹점'
    when 'payment_method' then '결제수단' when 'evidence_type' then '증빙 종류'
    when 'memo' then '메모' when 'supply_amount' then '공급가액'
    when 'vat_amount' then '부가세' when 'business_amount' then '업무 사용액'
    when 'usage_type' then '사용 용도' when 'goal_amount' then '월 매출 목표'
    when 'current_unit' then '기본 단가' when 'status' then '상태'
    else p_key end
$$;

create or replace function quickflex_noah_private.change_value(p_key text,p_value jsonb)
returns jsonb language sql immutable security invoker set search_path='' as $$
  select case
    when p_value is null or p_value='null'::jsonb then 'null'::jsonb
    when p_key=any(array['gross_amount','supply_amount','vat_amount','business_amount','goal_amount','current_unit'])
      then to_jsonb((p_value #>> '{}') || '원')
    when p_key='usage_type' then to_jsonb(case p_value #>> '{}'
      when 'business' then '업무용' when 'personal' then '개인용' when 'mixed' then '업무·개인 혼합' else p_value #>> '{}' end)
    when p_key='status' then to_jsonb(case p_value #>> '{}'
      when 'draft' then '작성 중' when 'confirmed' then '확정' when 'trashed' then '휴지통' else p_value #>> '{}' end)
    when p_key='category' then to_jsonb(case p_value #>> '{}'
      when 'fuel' then '주유·충전' when 'vehicle' then '차량 정비' when 'toll' then '통행료·주차'
      when 'insurance' then '보험' when 'lease' then '차량 임차' when 'supplies' then '배송 용품'
      when 'communication' then '통신' when 'other' then '기타' else p_value #>> '{}' end)
    when p_key='payment_method' then to_jsonb(case p_value #>> '{}'
      when 'card' then '카드' when 'cash' then '현금' when 'transfer' then '계좌이체'
      when 'other' then '기타' when 'unknown' then '미입력' else p_value #>> '{}' end)
    when p_key='evidence_type' then to_jsonb(case p_value #>> '{}'
      when 'card' then '카드 영수증' when 'cash_receipt' then '현금영수증'
      when 'tax_invoice' then '세금계산서' when 'receipt' then '일반 영수증'
      when 'other' then '기타' when 'unknown' then '미확인' else p_value #>> '{}' end)
    else p_value end
$$;

create or replace function quickflex_noah_private.quickflex_noah_prepare_write(p_action text,p_values jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := (select auth.uid());
  old_expense public.quickflex_expenses%rowtype;
  old_rate public.quickflex_route_rates%rowtype;
  old_goal integer;
  before_json jsonb;
  after_json jsonb;
  stored jsonb;
  proposal_id uuid;
  label text;
  changes_json jsonb;
  title_text text;
  allowed_keys text[];
  refund_total numeric;
begin
  if owner is null or not (select public.quickflex_is_approved()) then
    raise exception 'approved account required' using errcode='42501';
  end if;
  if p_action not in ('add_expense','update_expense','delete_expense','set_monthly_goal','set_route_rate')
    or jsonb_typeof(p_values) is distinct from 'object' then
    raise exception 'invalid Noah action' using errcode='22023';
  end if;
  if p_action in ('add_expense','update_expense') then
    allowed_keys := array['id','actual_date','gross_amount','category','merchant','payment_method','evidence_type','memo',
      'supply_amount','vat_amount','business_amount','usage_type'];
  elsif p_action='delete_expense' then allowed_keys := array['id'];
  elsif p_action='set_monthly_goal' then allowed_keys := array['goal_amount'];
  else allowed_keys := array['route','current_unit']; end if;
  if exists(select 1 from jsonb_object_keys(p_values) key where not (key=any(allowed_keys))) then
    raise exception 'unknown Noah field' using errcode='22023';
  end if;

  if p_action in ('update_expense','delete_expense') then
    if coalesce(p_values->>'id','') !~ '^[0-9a-fA-F-]{36}$' then raise exception 'expense id required' using errcode='22023'; end if;
    select * into old_expense from public.quickflex_expenses
      where id=(p_values->>'id')::uuid and user_id=owner and status<>'trashed';
    if not found then raise exception 'owned expense not found' using errcode='P0002'; end if;
    before_json := to_jsonb(old_expense);
  end if;
  if p_action in ('add_expense','update_expense') then
    if p_action='add_expense' and p_values ? 'id' then raise exception 'new expense cannot have id' using errcode='22023'; end if;
    after_json := (case when p_action='update_expense' then
      jsonb_build_object('actual_date',old_expense.actual_date,'gross_amount',old_expense.gross_amount,
        'category',old_expense.category,'merchant',old_expense.merchant,'payment_method',old_expense.payment_method,
        'evidence_type',old_expense.evidence_type,'memo',old_expense.memo,'supply_amount',old_expense.supply_amount,
        'vat_amount',old_expense.vat_amount,'business_amount',old_expense.business_amount,'usage_type',old_expense.usage_type)
      else jsonb_build_object('usage_type','business') end) || (p_values-'id');
    if (p_action='add_expense' or old_expense.status='confirmed')
      and (after_json->>'actual_date' is null or after_json->>'gross_amount' is null) then
      raise exception 'confirmed expense needs date and positive gross' using errcode='22023';
    end if;
    if after_json->>'gross_amount' is not null and (
      jsonb_typeof(after_json->'gross_amount') is distinct from 'number'
      or (after_json->>'gross_amount')::numeric <= 0
      or (after_json->>'gross_amount')::numeric <> trunc((after_json->>'gross_amount')::numeric)
      or (after_json->>'gross_amount')::numeric > 99999999999999) then
      raise exception 'invalid expense gross amount' using errcode='22023';
    end if;
    if after_json->>'actual_date' is not null
      and after_json->>'actual_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'invalid expense date' using errcode='22023';
    end if;
    if after_json->>'actual_date' is not null then perform (after_json->>'actual_date')::date; end if;
    if exists(select 1 from jsonb_each(after_json) field
      where field.key=any(array['supply_amount','vat_amount','business_amount'])
        and field.value<>'null'::jsonb and jsonb_typeof(field.value) is distinct from 'number') then
      raise exception 'expense amounts must be numeric' using errcode='22023';
    end if;
    if exists(select 1 from jsonb_each(after_json) field
      where field.key=any(array['category','merchant','payment_method','evidence_type','memo','usage_type'])
        and field.value<>'null'::jsonb and jsonb_typeof(field.value) is distinct from 'string') then
      raise exception 'expense text field is invalid' using errcode='22023';
    end if;
    if (after_json->>'supply_amount')::numeric < 0 or (after_json->>'vat_amount')::numeric < 0
      or (after_json->>'business_amount')::numeric < 0
      or (after_json->>'business_amount')::numeric > (after_json->>'gross_amount')::numeric
      or (after_json->>'supply_amount')::numeric <> trunc((after_json->>'supply_amount')::numeric)
      or (after_json->>'vat_amount')::numeric <> trunc((after_json->>'vat_amount')::numeric)
      or (after_json->>'business_amount')::numeric <> trunc((after_json->>'business_amount')::numeric)
      or length(coalesce(after_json->>'category','')) > 100
      or length(coalesce(after_json->>'merchant','')) > 200
      or length(coalesce(after_json->>'payment_method','')) > 64
      or length(coalesce(after_json->>'evidence_type','')) > 64
      or length(coalesce(after_json->>'memo','')) > 2000 then
      raise exception 'invalid expense field' using errcode='22023';
    end if;
    if after_json->>'usage_type' not in ('business','personal','mixed') then raise exception 'invalid usage type' using errcode='22023'; end if;
    if p_action='update_expense' then
      select coalesce(sum(amount),0) into refund_total from public.quickflex_expense_adjustments
      where expense_id=old_expense.id and user_id=owner and kind='refund';
      if refund_total>(after_json->>'gross_amount')::numeric then
        raise exception 'gross amount cannot be less than refunds' using errcode='22023';
      end if;
    end if;
    stored := after_json || jsonb_build_object('status',
      case when p_action='add_expense' then 'confirmed' else old_expense.status end)
      || case when p_action='update_expense' then jsonb_build_object('id',old_expense.id) else '{}'::jsonb end;
    title_text := case when p_action='add_expense' then
      coalesce(after_json->>'actual_date','날짜 미입력') || ' · ' ||
      left(coalesce(nullif(after_json->>'merchant',''),'가맹점 미입력'),40) || ' · ' ||
      (after_json->>'gross_amount') || '원 지출 추가'
      else coalesce(old_expense.actual_date::text,'날짜 미입력') || ' · ' ||
      left(coalesce(nullif(old_expense.merchant,''),'가맹점 미입력'),40) || ' · ' ||
      coalesce(old_expense.gross_amount::text || '원','금액 미입력') || ' 지출 수정 (' || left(old_expense.id::text,8) || ')' end;
  elsif p_action='delete_expense' then
    stored := jsonb_build_object('id',old_expense.id);
    after_json := jsonb_build_object('status','trashed');
    title_text := coalesce(old_expense.actual_date::text,'날짜 미입력') || ' · ' ||
      left(coalesce(nullif(old_expense.merchant,''),'가맹점 미입력'),40) || ' · ' ||
      coalesce(old_expense.gross_amount::text || '원','금액 미입력') || ' 지출 삭제 (' || left(old_expense.id::text,8) || ')';
  elsif p_action='set_monthly_goal' then
    if jsonb_typeof(p_values->'goal_amount') is distinct from 'number'
      or (p_values->>'goal_amount')::numeric <> trunc((p_values->>'goal_amount')::numeric)
      or (p_values->>'goal_amount')::numeric not between 0 and 100000000 then
      raise exception 'invalid monthly goal' using errcode='22023';
    end if;
    select goal_amount into old_goal from public.quickflex_profiles where id=owner;
    before_json := jsonb_build_object('goal_amount',old_goal);
    after_json := jsonb_build_object('goal_amount',(p_values->>'goal_amount')::integer);
    stored := after_json;
    title_text := '월 매출 목표 설정';
  else
    if coalesce(p_values->>'route','') !~ '^[0-9]{3}[A-Z]$'
      or jsonb_typeof(p_values->'current_unit') is distinct from 'number'
      or (p_values->>'current_unit')::numeric <> trunc((p_values->>'current_unit')::numeric)
      or (p_values->>'current_unit')::numeric not between 0 and 100000 then
      raise exception 'invalid route rate' using errcode='22023';
    end if;
    select * into old_rate from public.quickflex_route_rates
      where user_id=owner::text and route=p_values->>'route';
    before_json := case when found then jsonb_build_object('current_unit',old_rate.current_unit) else null end;
    after_json := jsonb_build_object('current_unit',(p_values->>'current_unit')::integer);
    stored := p_values;
    title_text := (p_values->>'route') || ' 기본 단가 설정';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('label',quickflex_noah_private.change_label(k),
      'before',quickflex_noah_private.change_value(k,before_json->k),
      'after',quickflex_noah_private.change_value(k,after_json->k)) order by k),'[]'::jsonb)
    into changes_json from jsonb_object_keys(after_json) k
    where before_json->k is distinct from after_json->k;
  if p_action='delete_expense' then
    changes_json := jsonb_build_array(jsonb_build_object('label','상태',
      'before',quickflex_noah_private.change_value('status',to_jsonb(old_expense.status)),
      'after',quickflex_noah_private.change_value('status','"trashed"'::jsonb)));
  end if;
  if changes_json='[]'::jsonb then raise exception 'no changes requested' using errcode='22023'; end if;
  insert into quickflex_noah_private.proposals(user_id,action,payload,before_value,title,changes)
    values(owner,p_action,stored,before_json,title_text,changes_json) returning id into proposal_id;
  return (select jsonb_build_object('id',id,'status',status,'title',title,'changes',changes,'expiresAt',expires_at)
    from quickflex_noah_private.proposals where id=proposal_id);
end $$;

create or replace function quickflex_noah_private.quickflex_noah_confirm_write(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := (select auth.uid());
  proposal quickflex_noah_private.proposals%rowtype;
  expense_row public.quickflex_expenses%rowtype;
  rate_row public.quickflex_route_rates%rowtype;
  profile_row public.quickflex_profiles%rowtype;
  result_json jsonb;
  saved uuid;
begin
  if owner is null or not (select public.quickflex_is_approved()) then raise exception 'approved account required' using errcode='42501'; end if;
  select * into proposal from quickflex_noah_private.proposals
    where id=p_proposal_id and user_id=owner for update;
  if not found then raise exception 'proposal not found' using errcode='P0002'; end if;
  if proposal.status='confirmed' then
    return jsonb_build_object('id',proposal.id,'status',proposal.status,'title',proposal.title,'changes',proposal.changes,
      'expiresAt',proposal.expires_at,'result',proposal.result);
  end if;
  if proposal.status<>'pending' or proposal.expires_at<=clock_timestamp() then
    raise exception 'proposal is cancelled or expired' using errcode='55000';
  end if;
  if proposal.action in ('update_expense','delete_expense') then
    select * into expense_row from public.quickflex_expenses
      where id=(proposal.payload->>'id')::uuid and user_id=owner for update;
    if not found or to_jsonb(expense_row) is distinct from proposal.before_value then
      raise exception 'expense changed since proposal' using errcode='40001';
    end if;
    if proposal.action='update_expense' and (
      select coalesce(sum(amount),0) from public.quickflex_expense_adjustments
      where expense_id=expense_row.id and user_id=owner and kind='refund'
    ) > (proposal.payload->>'gross_amount')::numeric then
      raise exception 'gross amount cannot be less than existing refunds' using errcode='22023';
    end if;
  elsif proposal.action='set_monthly_goal' then
    select * into profile_row from public.quickflex_profiles where id=owner for update;
    if not found or profile_row.goal_amount is distinct from (proposal.before_value->>'goal_amount')::integer then
      raise exception 'goal changed since proposal' using errcode='40001';
    end if;
  elsif proposal.action='set_route_rate' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('noah-rate:'||owner::text||':'||(proposal.payload->>'route'),0));
    select * into rate_row from public.quickflex_route_rates
      where user_id=owner::text and route=proposal.payload->>'route' for update;
    if (case when found then jsonb_build_object('current_unit',rate_row.current_unit) else null end)
      is distinct from proposal.before_value then
      raise exception 'route rate changed since proposal' using errcode='40001';
    end if;
  end if;
  if proposal.action in ('add_expense','update_expense') then
    saved := public.quickflex_save_expense(
      (proposal.payload->>'id')::uuid,(proposal.payload->>'actual_date')::date,
      (proposal.payload->>'gross_amount')::numeric,proposal.payload->>'category',proposal.payload->>'merchant',
      proposal.payload->>'payment_method',proposal.payload->>'evidence_type',proposal.payload->>'memo',
      (proposal.payload->>'supply_amount')::numeric,(proposal.payload->>'vat_amount')::numeric,
      (proposal.payload->>'business_amount')::numeric,proposal.payload->>'usage_type',proposal.payload->>'status',proposal.id::text);
    result_json := jsonb_build_object('expenseId',saved);
  elsif proposal.action='delete_expense' then
    saved := public.quickflex_set_expense_status((proposal.payload->>'id')::uuid,'trashed');
    result_json := jsonb_build_object('expenseId',saved);
  elsif proposal.action='set_monthly_goal' then
    update public.quickflex_profiles set goal_amount=(proposal.payload->>'goal_amount')::integer
      where id=owner;
    result_json := jsonb_build_object('goalAmount',(proposal.payload->>'goal_amount')::integer);
  else
    insert into public.quickflex_route_rates(user_id,route,current_unit)
      values(owner::text,proposal.payload->>'route',(proposal.payload->>'current_unit')::integer)
      on conflict (user_id,route) do update set current_unit=excluded.current_unit,updated_at=clock_timestamp();
    result_json := jsonb_build_object('route',proposal.payload->>'route','currentUnit',(proposal.payload->>'current_unit')::integer);
  end if;
  update quickflex_noah_private.proposals set status='confirmed',completed_at=clock_timestamp(),result=result_json
    where id=proposal.id;
  return jsonb_build_object('id',proposal.id,'status','confirmed','title',proposal.title,'changes',proposal.changes,
    'expiresAt',proposal.expires_at,'result',result_json);
end $$;

create or replace function quickflex_noah_private.quickflex_noah_cancel_write(p_proposal_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare owner uuid := (select auth.uid()); proposal quickflex_noah_private.proposals%rowtype;
begin
  if owner is null then raise exception 'authenticated account required' using errcode='42501'; end if;
  select * into proposal from quickflex_noah_private.proposals
    where id=p_proposal_id and user_id=owner for update;
  if not found then raise exception 'proposal not found' using errcode='P0002'; end if;
  if proposal.status='confirmed' then raise exception 'confirmed proposal cannot be cancelled' using errcode='55000'; end if;
  if proposal.status='pending' then
    update quickflex_noah_private.proposals set status='cancelled',completed_at=clock_timestamp() where id=proposal.id;
  end if;
  return jsonb_build_object('id',proposal.id,'status','cancelled','title',proposal.title,'changes',proposal.changes,
    'expiresAt',proposal.expires_at);
end $$;

-- Public Data API entrypoints retain caller rights; privileged work stays in an unexposed schema.
create or replace function public.quickflex_noah_consume_quota()
returns jsonb language sql security invoker set search_path='' as $$
  select quickflex_noah_private.quickflex_noah_consume_quota()
$$;
create or replace function public.quickflex_noah_prepare_write(p_action text,p_values jsonb)
returns jsonb language sql security invoker set search_path='' as $$
  select quickflex_noah_private.quickflex_noah_prepare_write(p_action,p_values)
$$;
create or replace function public.quickflex_noah_confirm_write(p_proposal_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select quickflex_noah_private.quickflex_noah_confirm_write(p_proposal_id)
$$;
create or replace function public.quickflex_noah_cancel_write(p_proposal_id uuid)
returns jsonb language sql security invoker set search_path='' as $$
  select quickflex_noah_private.quickflex_noah_cancel_write(p_proposal_id)
$$;

revoke all on function quickflex_noah_private.quickflex_noah_consume_quota() from public,anon,authenticated;
revoke all on function quickflex_noah_private.change_label(text) from public,anon,authenticated;
revoke all on function quickflex_noah_private.change_value(text,jsonb) from public,anon,authenticated;
revoke all on function quickflex_noah_private.quickflex_noah_prepare_write(text,jsonb) from public,anon,authenticated;
revoke all on function quickflex_noah_private.quickflex_noah_confirm_write(uuid) from public,anon,authenticated;
revoke all on function quickflex_noah_private.quickflex_noah_cancel_write(uuid) from public,anon,authenticated;
grant execute on function quickflex_noah_private.quickflex_noah_consume_quota(),
  quickflex_noah_private.change_label(text),quickflex_noah_private.change_value(text,jsonb),
  quickflex_noah_private.quickflex_noah_prepare_write(text,jsonb),
  quickflex_noah_private.quickflex_noah_confirm_write(uuid),
  quickflex_noah_private.quickflex_noah_cancel_write(uuid) to authenticated;
revoke all on function public.quickflex_noah_consume_quota() from public,anon,authenticated;
revoke all on function public.quickflex_noah_prepare_write(text,jsonb) from public,anon,authenticated;
revoke all on function public.quickflex_noah_confirm_write(uuid) from public,anon,authenticated;
revoke all on function public.quickflex_noah_cancel_write(uuid) from public,anon,authenticated;
grant execute on function public.quickflex_noah_consume_quota(),public.quickflex_noah_prepare_write(text,jsonb),
  public.quickflex_noah_confirm_write(uuid),public.quickflex_noah_cancel_write(uuid) to authenticated;
