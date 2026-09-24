export function bindAccountDeletion({ button, state, captureAccountContext, isAccountContextCurrent,
  ensurePendingSavesFlushed, toast, clearNoahHistory = () => {}, confirm = (message) => window.confirm(message) }) {
  let busy = false;
  button.addEventListener("click", async () => {
    if (busy) return;
    const context = captureAccountContext();
    const db = state.db;
    const isCurrent = () => db === state.db && isAccountContextCurrent(context);
    if (!db || !isCurrent()) return toast("로그인한 뒤 다시 요청해 주세요.", "error");
    if (!confirm("계정과 연결된 데이터의 삭제를 요청할까요?\n\n지금 기록을 지우거나 로그아웃하지 않습니다. 운영자가 요청을 확인한 뒤 최종 삭제하며, 완료 여부를 안내합니다. 필요한 기록은 먼저 내보내 주세요.")) return;
    busy = true;
    const label = button.textContent;
    button.disabled = true;
    button.textContent = "요청 접수 중…";
    button.setAttribute("aria-busy", "true");
    try {
      await clearNoahHistory(context.userId);
      await ensurePendingSavesFlushed();
      if (!isCurrent()) return;
      const { data, error } = await db.rpc("quickflex_request_account_deletion", { p_expected_user_id: context.userId });
      if (!isCurrent()) return;
      if (error || typeof data !== "string" || !Number.isFinite(Date.parse(data))) {
        throw new Error("deletion_request_not_confirmed");
      }
      if (state.profile?.id === context.userId) state.profile.deletion_requested_at = data;
      toast("탈퇴 요청이 접수됐습니다. 아직 삭제된 기록은 없으며, 운영자가 최종 처리 후 안내합니다.", "success");
    } catch (error) {
      if (isCurrent() && !error?.quickflexHandled) {
        toast("탈퇴 요청 접수를 확인하지 못했습니다. 기록은 지우지 않았습니다. 다시 시도하거나 계정 삭제 안내에서 문의해 주세요.", "error");
      }
    } finally {
      busy = false;
      button.disabled = false;
      button.textContent = label;
      button.removeAttribute("aria-busy");
    }
  });
}
