export function bindStatsEvents(ctx) {
  const {
    el,
    state,
    moveStatsMonth,
    renderStats,
    statsRangeDayCount,
    maxStatsCustomRangeDays,
    syncStatsToCurrentPeriod,
    trackStatsControl,
    toDateKey,
    toast,
  } = ctx;

  const customToggle = document.getElementById("statsRangeCustomToggle");
  // Keep any extension-provided legacy tabs accessible without restoring the old tabbed UI.
  el.statsTabs?.forEach((tab) => {
    tab.setAttribute("aria-selected", String(tab.classList.contains("active")));
  });
  el.statsPanels?.forEach((panel) => {
    const selected = panel.classList.contains("active");
    panel.hidden = !selected;
  });

  const syncCustomRangeDisclosure = () => {
    const customSelected = state.statsRangeMode === "custom";
    if (customToggle) {
      customToggle.classList.toggle("active", customSelected);
      customToggle.setAttribute("aria-pressed", String(customSelected));
      customToggle.setAttribute("aria-expanded", String(customSelected));
    }
    if (el.statsRangeCustom) el.statsRangeCustom.hidden = !customSelected;
  };

  const selectStatsRange = (next) => {
    // 사용자가 이번 세션에서 직접 기간을 골랐다는 표시 — 이후에는 "지난 정산" 자동 기본값이
    // 이 선택을 다시 덮어쓰지 않는다.
    state.statsRangeModeUserSet = true;
    if (state.statsRangeMode === next) {
      if (next !== "custom") {
        if (syncStatsToCurrentPeriod?.()) state.statsDetailDate = "";
        renderStats();
      }
      syncCustomRangeDisclosure();
      return;
    }
    state.statsRangeMode = next;
    state.statsDetailDate = "";
    if (next !== "custom") {
      syncStatsToCurrentPeriod?.();
    }
    if (next === "custom" && (!state.statsRangeCustom.from || !state.statsRangeCustom.to)) {
      const today = new Date();
      const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
      state.statsRangeCustom = { from: toDateKey(monthAgo), to: toDateKey(today) };
      if (el.statsRangeFrom) el.statsRangeFrom.value = state.statsRangeCustom.from;
      if (el.statsRangeTo) el.statsRangeTo.value = state.statsRangeCustom.to;
    }
    renderStats();
    syncCustomRangeDisclosure();
    trackStatsControl?.("range_changed");
  };

  el.statsPrevMonth?.addEventListener("click", () => {
    if (state.statsRangeMode !== "thisMonth") return;
    moveStatsMonth(-1);
  });
  el.statsNextMonth?.addEventListener("click", () => {
    if (state.statsRangeMode !== "thisMonth") return;
    moveStatsMonth(1);
  });

  if (el.statsRangeTabs) {
    el.statsRangeTabs.querySelectorAll("button[data-range]").forEach((button) => {
      button.addEventListener("click", () => selectStatsRange(button.dataset.range));
    });
  }
  if (customToggle) customToggle.addEventListener("click", () => selectStatsRange("custom"));
  if (el.statsRangeApply) {
    el.statsRangeApply.addEventListener("click", () => {
      const from = el.statsRangeFrom.value || "";
      const to = el.statsRangeTo.value || "";
      if (!from || !to || from > to) {
        toast?.("조회 시작일과 종료일을 확인해 주세요.", "error");
        (from && to && from > to ? el.statsRangeTo : el.statsRangeFrom)?.focus();
        return;
      }
      const dayCount = statsRangeDayCount?.(from, to) || 0;
      if (dayCount > maxStatsCustomRangeDays) {
        toast?.(`직접 조회는 최대 ${maxStatsCustomRangeDays}일(약 3년)까지 가능합니다.`, "error");
        el.statsRangeTo?.focus();
        return;
      }
      state.statsRangeCustom = {
        from,
        to,
      };
      state.statsRangeMode = "custom";
      state.statsRangeModeUserSet = true;
      state.statsDetailDate = "";
      renderStats();
      syncCustomRangeDisclosure();
      trackStatsControl?.("custom_range_applied");
    });
  }

  window.addEventListener("resize", () => {
    if (el.statsChart?.getClientRects().length) renderStats();
  });

  syncCustomRangeDisclosure();
}
