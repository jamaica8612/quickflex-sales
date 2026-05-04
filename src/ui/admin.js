export function bindAdminEvents(ctx) {
  const {
    el,
    state,
    addAdminBundleFromInputs,
    deleteAdminBundleCard,
    deleteAdminProfile,
    importAdminBundles,
    moveAdminMonth,
    renderAdminDashboard,
    saveAdminBundleCard,
    saveAdminProfile,
    toast,
  } = ctx;

  el.adminTabs.forEach((tab) => tab.addEventListener("click", () => {
    if (state.profile?.role !== "admin") return;
    state.adminTab = tab.dataset.adminTab;
    renderAdminDashboard();
  }));
  el.adminPrevMonth.addEventListener("click", () => moveAdminMonth(-1));
  el.adminNextMonth.addEventListener("click", () => moveAdminMonth(1));
  el.saveAdminBundle.addEventListener("click", () => addAdminBundleFromInputs().catch((error) => toast(`묶음 저장 실패: ${error.message}`, "error")));
  el.importAdminBundles.addEventListener("click", () => importAdminBundles().catch((error) => toast(`초안 저장 실패: ${error.message}`, "error")));
  el.adminProfiles.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="save-admin"]');
    if (button) {
      saveAdminProfile(button.closest(".admin-card")).catch((error) => toast(`저장 실패: ${error.message}`, "error"));
      return;
    }
    const deleteButton = event.target.closest('[data-action="delete-admin"]');
    if (deleteButton) {
      deleteAdminProfile(deleteButton.closest(".admin-card")).catch((error) => toast(`삭제 실패: ${error.message}`, "error"));
    }
  });
  el.adminBundleList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    const card = button.closest("[data-bundle-id]");
    if (!card) return;
    if (button.dataset.action === "save-bundle") {
      saveAdminBundleCard(card).catch((error) => toast(`묶음 저장 실패: ${error.message}`, "error"));
    }
    if (button.dataset.action === "delete-bundle") {
      deleteAdminBundleCard(card).catch((error) => toast(`묶음 삭제 실패: ${error.message}`, "error"));
    }
  });
}
