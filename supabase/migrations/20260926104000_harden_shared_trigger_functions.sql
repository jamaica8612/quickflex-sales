-- 보안 점검(Supabase advisors) 경고 정리. 같은 프로젝트를 쓰는 다른 앱(growing, RouteNote)의 함수도 포함한다.
-- 사용자 확인: 2026-09-26 "응 그것도 진행해".
--
-- 1) 트리거 전용 SECURITY DEFINER 함수는 API(/rest/v1/rpc)로 부를 이유가 없다. 트리거 실행은 EXECUTE 권한을
--    검사하지 않으므로 public·anon·authenticated의 EXECUTE를 회수해도 가입·해시·이력 트리거는 그대로 동작한다
--    (2026-09-26 롤백 실험으로 확인).
-- 2) search_path가 고정되지 않은 함수에 search_path = public을 고정한다. growing 검색 함수는 호출자 search_path를
--    pg_catalog로 좁힌 롤백 실험에서도 vector 연산자를 찾았다.
-- 손대지 않는 것:
--   - rn_is_admin(uuid)의 EXECUTE: rn_* 표의 RLS 정책(대상 public)이 부르므로 회수하면 비로그인 조회가 깨진다.
--   - vector·pg_net 확장 위치: vector를 옮기면 growing 검색 함수가, pg_net은 SET SCHEMA를 지원하지 않는다.
--   - 로그인 사용자용 SECURITY DEFINER RPC: 앱 API로 설계된 것이며 각 함수가 내부에서 계정·승인을 검사한다.
--   - 유출 비밀번호 차단: Supabase Pro 요금제 기능이라 무료 요금제에서는 켤 수 없다.
begin;

revoke execute on function public.growing_hash_kakao_channel_admin_key() from public, anon, authenticated;
revoke execute on function public.growing_hash_kakao_skill_secret() from public, anon, authenticated;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rn_handle_new_user() from public, anon, authenticated;
revoke execute on function public.rn_log_route_tip_history() from public, anon, authenticated;

alter function public.set_updated_at() set search_path = public;
alter function public.rn_is_admin(uuid) set search_path = public;
alter function public.rn_handle_new_user() set search_path = public;
alter function public.rn_log_route_tip_history() set search_path = public;
alter function public.search_counsel_logs(public.vector, integer, double precision) set search_path = public;
alter function public.search_assistant_notes(public.vector, integer, double precision) set search_path = public;

commit;
