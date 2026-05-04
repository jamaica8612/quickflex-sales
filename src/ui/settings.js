export function bindSettingsEvents(ctx) {
  const {
    el,
    state,
    applyTheme,
    closeSheet,
    connectDb,
    currentUserId,
    driverName,
    ensurePendingSavesFlushed,
    loadFromDb,
    logout,
    openSheet,
    renderAll,
    saveGoalAmount,
    saveProfile,
    TABLES,
    toast,
  } = ctx;

  el.saveProfile.addEventListener("click", () => saveProfile().catch((error) => toast(`프로필 저장 실패: ${error.message}`, "error")));
  el.goalAmountInput.addEventListener("input", () => {
    const pos = el.goalAmountInput.selectionStart;
    const prevLen = el.goalAmountInput.value.length;
    const raw = parseInt(el.goalAmountInput.value.replace(/,/g, ""), 10) || 0;
    el.goalAmountInput.value = raw > 0 ? raw.toLocaleString("ko-KR") : "";
    const diff = el.goalAmountInput.value.length - prevLen;
    el.goalAmountInput.setSelectionRange(pos + diff, pos + diff);
  });
  el.saveAppSettings.addEventListener("click", () => saveGoalAmount().catch((error) => toast(`목표 저장 실패: ${error.message}`, "error")));
  document.querySelectorAll("[data-theme-set]").forEach((btn) => {
    btn.addEventListener("click", () => applyTheme(btn.dataset.themeSet));
  });
  el.resetData.addEventListener("click", async () => {
    if (!window.confirm("내 단가와 기록을 모두 삭제할까요?")) return;
    const userId = currentUserId();
    try {
      await state.db.from(TABLES.items).delete().eq("user_id", userId);
      await state.db.from(TABLES.days).delete().eq("user_id", userId);
      await state.db.from(TABLES.rates).delete().eq("user_id", userId);
      state.rates = [];
      state.entries = {};
      renderAll();
      toast("내 데이터를 초기화했습니다.", "success");
    } catch (error) {
      toast(`초기화 실패: ${error.message}`, "error");
    }
  });
  el.requestAccountDelete.addEventListener("click", async () => {
    if (!window.confirm("탈퇴 요청을 남기고 내 기록과 단가 데이터를 삭제할까요?\n\n계정 완전 삭제는 관리자가 확인 후 처리합니다.")) return;
    const userId = currentUserId();
    try {
      await state.db.from(TABLES.items).delete().eq("user_id", userId);
      await state.db.from(TABLES.days).delete().eq("user_id", userId);
      await state.db.from(TABLES.rates).delete().eq("user_id", userId);
      await state.db.from(TABLES.profiles).update({
        display_name: `[탈퇴요청] ${driverName()}`,
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
      toast("탈퇴 요청을 남겼습니다.", "success");
      await logout();
    } catch (error) {
      toast(`탈퇴 요청 실패: ${error.message}`, "error");
    }
  });
  el.openDbSettings.addEventListener("click", openSheet);
  el.dbOverlay.addEventListener("click", closeSheet);
  el.saveDbConfig.addEventListener("click", async () => {
    try {
      await connectDb(el.supabaseUrl.value, el.supabaseAnonKey.value, true);
      closeSheet();
    } catch (error) {
      toast(`DB 연결 실패: ${error.message}`, "error");
    }
  });
  el.syncNow.addEventListener("click", async () => {
    try {
      await ensurePendingSavesFlushed();
      await loadFromDb();
      renderAll();
      toast("동기화 완료", "success");
    } catch (error) {
      toast(`동기화 실패: ${error.message}`, "error");
    }
  });
}
