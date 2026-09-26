export function bindAdminEvents(ctx) {
  const {
    el,
    state,
    addAdminBundleFromInputs,
    deleteAdminBundleCard,
    importAdminBundles,
    saveAdminBundleCard,
    saveAdminProfile,
    renderAdminProfiles,
    renderAdminBundles,
    renderAdminUsageSummary,
    toast,
  } = ctx;

  document.getElementById("memberSettings")?.addEventListener("toggle", (event) => {
    if (event.currentTarget.open && state.profile?.role === "admin") renderAdminProfiles().catch((error) => toast(error.message, "error"));
  });
  document.getElementById("bundleSettings")?.addEventListener("toggle", (event) => {
    if (event.currentTarget.open && state.profile?.role === "admin") renderAdminBundles().catch((error) => toast(error.message, "error"));
  });
  document.getElementById("usageSettings")?.addEventListener("toggle", (event) => {
    if (event.currentTarget.open && state.profile?.role === "admin") renderAdminUsageSummary();
  });
  el.saveAdminBundle.addEventListener("click", () => addAdminBundleFromInputs().catch((error) => toast(`묶음 저장 실패: ${error.message}`, "error")));
  el.importAdminBundles.addEventListener("click", () => importAdminBundles().catch((error) => toast(`초안 저장 실패: ${error.message}`, "error")));
  el.adminProfiles.addEventListener("click", (event) => {
    const button = event.target.closest('[data-action="save-admin"]');
    if (button) {
      saveAdminProfile(button.closest(".admin-card")).catch((error) => toast(`저장 실패: ${error.message}`, "error"));
      return;
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
