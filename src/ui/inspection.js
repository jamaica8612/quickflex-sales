export function bindInspectionEvents(ctx) {
  const {
    el,
    openInspection,
    printInspectionMonth,
    saveInspectionMonthPdf,
    renderInspection,
    resetInspectionDraft,
    saveInspection,
    setAllInspectionResults,
    setInspectionNoOperation,
    showView,
    toast,
  } = ctx;

  el.openInspection.addEventListener("click", openInspection);
  el.backFromInspection.addEventListener("click", () => showView("home"));
  el.inspectionDate.addEventListener("change", () => renderInspection(el.inspectionDate.value));
  el.inspectionChecklist.addEventListener("click", (event) => {
    const button = event.target.closest("[data-inspection-item][data-result]");
    if (!button) return;
    const item = button.dataset.inspectionItem;
    ctx.state.inspectionDraft.defectNotes = el.inspectionDefectNotes.value;
    ctx.state.inspectionDraft.actionNotes = el.inspectionActionNotes.value;
    ctx.state.inspectionDraft.results[item] = button.dataset.result;
    renderInspection(ctx.state.inspectionDate, { preserveDraft: true });
  });
  el.inspectionAllGood.addEventListener("click", () => setAllInspectionResults("good"));
  el.inspectionReset.addEventListener("click", resetInspectionDraft);
  el.openSignatureSettings.addEventListener("click", () => {
    showView("settings");
    setTimeout(() => el.signatureSettingsSection?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  });
  el.saveInspection.addEventListener("click", () => saveInspection().catch((error) => toast(`점검 저장 실패: ${error.message}`, "error")));
  el.markNoOperation.addEventListener("click", () => setInspectionNoOperation().catch((error) => toast(`미운행 저장 실패: ${error.message}`, "error")));
  el.printInspectionMonth.addEventListener("click", () => printInspectionMonth().catch((error) => toast(`월간 출력 실패: ${error.message}`, "error")));
  el.saveInspectionMonthPdf.addEventListener("click", () => saveInspectionMonthPdf().catch((error) => toast(`PDF 저장 실패: ${error.message}`, "error")));
}
