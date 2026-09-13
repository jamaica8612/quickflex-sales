import { bindAccountDeletion } from "./account-deletion.js";

export function bindSettingsEvents(ctx) {
  const {
    el,
    state,
    applyRateUpdateOffer,
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
    renderMonth,
    saveGoalAmount,
    saveInspectionSignature,
    saveProfile,
    saveWorkPreferences,
    setCalendarRoutesPreference,
    shouldShowCalendarRoutes,
    TABLES,
    toast,
  } = ctx;
  const deleteMutableUserData = async (userId) => {
    for (const table of [TABLES.items, TABLES.days, TABLES.rates, TABLES.inspections, TABLES.inspectionSignatures]) {
      const { error } = await state.db.from(table).delete().eq("user_id", userId);
      if (error) throw error;
    }
  };

  document.querySelectorAll('input[name="calendarRoutes"]').forEach((radio) => {
    radio.checked = shouldShowCalendarRoutes() === (radio.value === "show");
    radio.addEventListener("change", () => {
      setCalendarRoutesPreference(radio.value === "show");
      renderAll();
    });
  });
  el.saveProfile.addEventListener("click", () => saveProfile().catch((error) => toast(`프로필 저장 실패: ${error.message}`, "error")));
  document.querySelectorAll("[data-save-profile]").forEach((button) => button.addEventListener("click", () => saveProfile().catch((error) => toast(`설정 저장 실패: ${error.message}`, "error"))));
  document.querySelectorAll('input[name="workShift"], input[name="freshbagMode"]').forEach((radio) => {
    radio.addEventListener("change", () => saveWorkPreferences().catch((error) => {
      if (!error?.quickflexHandled) toast(`근무 설정 저장 실패: ${error.message}`, "error");
    }));
  });
  el.clearProfileSignature.addEventListener("click", () => ctx.clearProfileSignature());
  el.openProfileSignature.addEventListener("click", () => ctx.openSignatureEditor());
  el.closeProfileSignature.addEventListener("click", () => ctx.closeSignatureEditor());
  el.saveProfileSignature.addEventListener("click", async () => {
    if (el.saveProfileSignature.disabled) return;
    el.saveProfileSignature.disabled = true;
    el.clearProfileSignature.disabled = true;
    el.closeProfileSignature.disabled = true;
    el.profileSignatureOverlay.setAttribute("aria-busy", "true");
    el.profileSignatureStatus.textContent = "저장 중…";
    let saved = false;
    try {
      saved = await saveInspectionSignature();
    } catch (error) {
      el.profileSignatureStatus.textContent = `저장하지 못했습니다. ${error.message}`;
    } finally {
      el.saveProfileSignature.disabled = false;
      el.clearProfileSignature.disabled = false;
      el.closeProfileSignature.disabled = false;
      el.profileSignatureOverlay.removeAttribute("aria-busy");
    }
    if (saved) ctx.closeSignatureEditor();
  });
  el.applyRateUpdate?.addEventListener("click", () => applyRateUpdateOffer().catch((error) => toast(`단가 업데이트 실패: ${error.message}`, "error")));
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
  el.refreshApp?.addEventListener("click", async () => {
    if (el.refreshApp.disabled) return;
    el.refreshApp.disabled = true;
    try {
      await ensurePendingSavesFlushed();
      const registration = await navigator.serviceWorker?.getRegistration();
      await registration?.update();
      toast("최신 화면을 불러옵니다.", "success");
      window.setTimeout(() => window.location.reload(), 150);
    } catch (error) {
      el.refreshApp.disabled = false;
      if (error?.quickflexHandled) return;
      toast(`새로고침 실패: ${error.message}`, "error");
    }
  });
  el.resetData.addEventListener("click", async () => {
    if (!window.confirm("내 수동 기록, 단가, 점검 기록을 삭제할까요?\n\n앱이 마감한 자동 기록은 삭제되지 않고 그대로 유지됩니다.")) return;
    const userId = currentUserId();
    try {
      await deleteMutableUserData(userId);
      state.rates = [];
      state.entries = {};
      state.inspections = {};
      state.inspectionSignature = "";
      ctx.clearProfileSignature();
      await loadFromDb();
      renderAll();
      toast("수동 입력 데이터를 초기화했습니다. 앱 자동 기록은 유지됩니다.", "success");
    } catch (error) {
      toast(`초기화 실패: ${error.message}`, "error");
    }
  });
  bindAccountDeletion({ ...ctx, button: el.requestAccountDelete });
  el.openDbSettings.addEventListener("click", openSheet);
  el.dbOverlay.addEventListener("click", closeSheet);
  el.closeDbSheet?.addEventListener("click", closeSheet);
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
      if (error?.quickflexHandled) return;
      toast(`동기화 실패: ${error.message}`, "error");
    }
  });
}
