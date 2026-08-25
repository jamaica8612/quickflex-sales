export function bindStatsEvents(ctx) {
  const {
    el,
    state,
    moveStatsMonth,
    renderStats,
    showChartTooltip,
    toDateKey,
  } = ctx;

  const activateStatsTab = (tab, { focus = false } = {}) => {
    if (tab.dataset.tab === "admin" && state.profile?.role !== "admin") return;
    state.statsDetailDate = "";
    el.statsTabs.forEach((target) => {
      const selected = target === tab;
      target.classList.toggle("active", selected);
      target.setAttribute("aria-selected", String(selected));
      target.tabIndex = selected ? 0 : -1;
    });
    el.statsPanels.forEach((panel) => {
      const selected = panel.dataset.panel === tab.dataset.tab;
      panel.classList.toggle("active", selected);
      panel.hidden = !selected;
    });
    renderStats();
    if (focus) tab.focus();
  };
  el.statsTabs.forEach((tab) => {
    tab.addEventListener("click", () => activateStatsTab(tab));
    tab.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      const tabs = [...el.statsTabs].filter((target) => !target.hidden && target.getAttribute("aria-hidden") !== "true");
      const currentIndex = tabs.indexOf(tab);
      if (currentIndex < 0 || !tabs.length) return;
      event.preventDefault();
      const nextIndex = event.key === "Home"
        ? 0
        : event.key === "End"
          ? tabs.length - 1
          : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
      activateStatsTab(tabs[nextIndex], { focus: true });
    });
  });
  el.statsPrevMonth.addEventListener("click", () => { if (state.statsRangeMode !== "thisMonth") return; moveStatsMonth(-1); });
  el.statsNextMonth.addEventListener("click", () => { if (state.statsRangeMode !== "thisMonth") return; moveStatsMonth(1); });
  if (el.statsRangeTabs) {
    el.statsRangeTabs.querySelectorAll("button[data-range]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.range;
        state.statsRangeMode = next;
        if (next === "thisMonth") {
          const now = new Date();
          const m = now.getDate() <= 25 ? now.getMonth() + 1 : now.getMonth() + 2;
          const d = new Date(now.getFullYear(), m - 1, 1);
          state.statsYear = d.getFullYear();
          state.statsMonth = d.getMonth() + 1;
        }
        if (next === "custom") {
          if (!state.statsRangeCustom.from || !state.statsRangeCustom.to) {
            const today = new Date();
            const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());
            state.statsRangeCustom = { from: toDateKey(monthAgo), to: toDateKey(today) };
            if (el.statsRangeFrom) el.statsRangeFrom.value = state.statsRangeCustom.from;
            if (el.statsRangeTo) el.statsRangeTo.value = state.statsRangeCustom.to;
          }
        }
        renderStats();
      });
    });
  }
  if (el.statsRangeApply) {
    el.statsRangeApply.addEventListener("click", () => {
      state.statsRangeCustom = { from: el.statsRangeFrom.value || "", to: el.statsRangeTo.value || "" };
      state.statsRangeMode = "custom";
      renderStats();
    });
  }
  if (el.statsChartToggle) {
    el.statsChartToggle.querySelectorAll("button[data-metric]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = btn.dataset.metric === "count" ? "count" : "revenue";
        if (state.statsChartMetric === next) return;
        state.statsChartMetric = next;
        renderStats();
      });
    });
  }
  if (el.statsChart) {
    const handler = (e) => {
      const ev = e.touches ? e.touches[0] : e;
      showChartTooltip(ev.clientX);
    };
    el.statsChart.addEventListener("click", handler);
    el.statsChart.addEventListener("touchstart", handler, { passive: true });
    document.addEventListener("click", (e) => {
      if (!el.statsChartTooltip || el.statsChartTooltip.hidden) return;
      if (e.target === el.statsChart) return;
      el.statsChartTooltip.hidden = true;
    });
  }
}
