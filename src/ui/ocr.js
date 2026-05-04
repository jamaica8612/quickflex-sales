export function bindOcrEvents(ctx) {
  const {
    el,
    ocrDraftState,
    applySchedule,
    applySettlementRows,
    correctRouteList,
    draftWorkRoutes,
    parseScheduleCsv,
    parseSettlementCsv,
    previewImageFile,
    renderDraftCards,
    routeListFromText,
    runOcr,
    runSettlementOcr,
    setOcrDraft,
    toast,
  } = ctx;

  el.parseCsv.addEventListener("click", () => {
    const rows = parseSettlementCsv(el.csvInput.value);
    if (!rows.length) return;
    applySettlementRows(rows.map(([route, deliveryCount, amount]) => ({ route, deliveryCount, amount })))
      .catch((error) => toast(`정산표 단가 반영 실패: ${error.message}`, "error"));
  });
  el.scheduleImage.addEventListener("change", () => {
    const file = el.scheduleImage.files?.[0];
    if (!file) return;
    previewImageFile(file, el.schedulePreview, "스케줄표 미리보기");
  });
  el.runScheduleOcr.addEventListener("click", runOcr);
  el.settlementImage.addEventListener("change", () => {
    const file = el.settlementImage.files?.[0];
    if (!file) return;
    previewImageFile(file, el.settlementPreview, "정산표 미리보기");
    el.settlementStatus.textContent = "정산표 이미지가 선택됐습니다. OCR 실행을 누르면 Route별 단가 후보를 계산합니다.";
  });
  el.runSettlementOcr.addEventListener("click", runSettlementOcr);
  el.scheduleDraftCards.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    const ocrDraftMap = ocrDraftState.get();
    if (!button || !ocrDraftMap) return;
    const dateKey = button.dataset.date;
    if (button.dataset.action === "off") ocrDraftMap[dateKey] = ocrDraftMap[dateKey] === null ? draftWorkRoutes() : null;
    if (button.dataset.action === "remove") ocrDraftMap[dateKey] = (ocrDraftMap[dateKey] || []).filter((route) => route !== button.dataset.route);
    if (button.dataset.action === "add") {
      const input = el.scheduleDraftCards.querySelector(`.draft-add-input[data-date="${dateKey}"]`);
      const route = input?.value || "";
      if (!route.trim()) {
        input?.focus();
        return;
      }
      if (route) {
        const corrected = correctRouteList(route);
        ocrDraftMap[dateKey] = [...(ocrDraftMap[dateKey] || []), ...(corrected.length ? corrected : routeListFromText(route))];
        if (input) input.value = "";
      }
    }
    renderDraftCards();
  });
  el.parseSchedule.addEventListener("click", () => {
    const ocrDraftMap = ocrDraftState.get();
    if (!ocrDraftMap) return toast("반영할 스케줄이 없습니다.", "error");
    applySchedule(ocrDraftMap);
    setOcrDraft(null);
  });
  el.parseScheduleCsv.addEventListener("click", () => parseScheduleCsv(el.scheduleCsvInput.value));
}
