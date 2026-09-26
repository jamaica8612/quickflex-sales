import * as motion from "../lib/motion.js";

const saveMorph = motion.createAnimationGroup();
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Save-button morph: shrink the pill to a 48px circle with a spinner while
// the real save is in flight (never less than 150ms so it doesn't flash),
// draw a checkmark on success and hold briefly before growing back, or snap
// back at once and shake on failure. The button's layout width is measured
// once and fixed — only `clip-path` animates the visible shape, so nothing
// here ever springs `width` itself. Business logic (saveCurrentRecordAndGoHome)
// is untouched; this only wraps its call.
async function handleSaveRecordClick(ctx) {
  const { el, saveCurrentRecordAndGoHome } = ctx;
  const button = el.saveRecord;
  if (!button || button.dataset.moBusy === "true") return;
  const { saveRecordLabel: label, saveRecordSpin: spin, saveRecordCheck: check, saveRecordCheckPath: checkPath, saveRecordStatus: status } = el;
  const animated = motion.shouldAnimate();
  const rect = button.getBoundingClientRect();
  const fullWidth = rect.width;
  const inset = Math.max(0, (fullWidth - rect.height) / 2);

  button.dataset.moBusy = "true";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.classList.add("is-busy");
  if (status) status.textContent = "저장 중…";

  if (animated && inset > 0) {
    button.style.width = `${fullWidth}px`;
    if (label) label.style.opacity = "0";
    if (spin) spin.style.opacity = "1";
    button.style.clipPath = "inset(0 0 0 0 round 999px)";
    saveMorph.run("clip", 0, inset, {
      ...motion.SPRING,
      onUpdate: (v) => { button.style.clipPath = `inset(0 ${v}px 0 ${v}px round 999px)`; },
    });
  }

  const startedAt = Date.now();
  let ok = false;
  try {
    ok = await saveCurrentRecordAndGoHome();
  } finally {
    if (spin) spin.style.opacity = "0";
  }
  if (animated && inset > 0) {
    const elapsed = Date.now() - startedAt;
    if (elapsed < 150) await wait(150 - elapsed);
  }

  if (ok) {
    if (animated && inset > 0) {
      if (checkPath) {
        checkPath.style.strokeDashoffset = "22";
        if (check) check.style.opacity = "1";
        saveMorph.run("check", 22, 0, {
          stiffness: 700, damping: 1,
          onUpdate: (v) => { checkPath.style.strokeDashoffset = String(v); },
        });
      }
      await wait(500);
      if (check) check.style.opacity = "0";
      saveMorph.run("clip", inset, 0, {
        ...motion.SPRING,
        onUpdate: (v) => {
          button.style.clipPath = `inset(0 ${v}px 0 ${v}px round 999px)`;
          if (label && v < inset * 0.2) label.style.opacity = "1";
        },
        onDone: () => {
          button.style.clipPath = "";
          button.style.width = "";
          if (label) label.style.opacity = "";
          if (checkPath) checkPath.style.strokeDashoffset = "22";
        },
      });
    }
  } else {
    saveMorph.cancelAll();
    button.style.clipPath = "";
    button.style.width = "";
    if (label) label.style.opacity = "";
    if (check) check.style.opacity = "0";
    if (checkPath) checkPath.style.strokeDashoffset = "22";
    motion.shake(button);
  }
  button.classList.remove("is-busy");
  button.dataset.moBusy = "false";
  button.disabled = false;
  button.removeAttribute("aria-busy");
  if (status) status.textContent = "";
}

export function bindRecordEvents(ctx) {
  const {
    el,
    state,
    confirmOffWithExistingCounts,
    currentRecordDraft,
    defaultEntryRows,
    ensurePendingSavesFlushed,
    hasAutomaticEntries,
    hasEnteredCounts,
    isBackupDriver,
    refreshTotals,
    renderAll,
    renderEntryForm,
    renderMonth,
    saveCurrentRecordAndGoHome,
    scheduleSave,
    syncFormToRecord,
    toast,
    upsertRate,
    normalizeRoute,
    isKnownRateRoute,
    renderRates,
  } = ctx;

  el.offToggle.addEventListener("change", () => {
    const record = currentRecordDraft();
    if (el.offToggle.checked && hasEnteredCounts(record) && !confirmOffWithExistingCounts(state.selectedDate)) {
      el.offToggle.checked = false;
      return;
    }
    record.off = el.offToggle.checked;
    if (record.off) record.rows = [];
    else record.rows = defaultEntryRows();
    renderEntryForm();
    refreshTotals();
  });
  el.addRoute.addEventListener("click", () => {
    const record = currentRecordDraft();
    record.off = false;
    const firstRate = isBackupDriver() ? state.rates[0] || state.defaultRates[0] : null;
    const automatic = hasAutomaticEntries(record);
    const baseUnit = Number(firstRate?.unit || 0);
    const backupUnit = isBackupDriver() ? Number(record.backupUnit || 0) : 0;
    record.rows.push(automatic
      ? { route: firstRate?.route || "", count: "", unit: baseUnit + backupUnit, source: "override", readOnly: true, draft: false }
      : { route: firstRate?.route || "", count: "", unit: baseUnit, draft: !firstRate });
    renderEntryForm();
  });
  [el.freshCount, el.freshUnit, el.backupUnit].forEach((input) => input.addEventListener("input", () => {
    refreshTotals();
  }));
  [el.freshSoloCount, el.freshLinkedCount].forEach((input) => input.addEventListener("input", () => {
    syncFormToRecord();
    refreshTotals();
  }));
  document.querySelectorAll('input[name="freshbagMode"]').forEach((radio) => {
    radio.addEventListener("change", () => {
      if (state.profile) state.profile.freshbag_mode = radio.value;
      renderEntryForm();
    });
  });
  el.saveRecord.addEventListener("click", () => handleSaveRecordClick(ctx));
  el.modeBtns.forEach((button) => button.addEventListener("click", () => {
    state.mode = button.dataset.mode;
    el.modeBtns.forEach((target) => {
      const selected = target === button;
      target.classList.toggle("active", selected);
      target.setAttribute("aria-pressed", String(selected));
    });
    renderMonth();
  }));
  el.saveRate.addEventListener("click", async () => {
    const route = normalizeRoute(el.rateRoute.value);
    if (route && isBackupDriver() && !isKnownRateRoute(route)) {
      const ok = window.confirm(`새 업무 구역 ${route}를 추가할까요? 추가하면 달력과 기록하기 화면에서 계속 사용할 수 있습니다.`);
      if (!ok) return;
    }
    if (!upsertRate(el.rateRoute.value, el.rateUnit.value)) {
      motion.shake(el.rateUnit);
      return toast("구역과 단가를 확인해 주세요.", "error");
    }
    el.rateRoute.value = "";
    el.rateUnit.value = "";
    renderRates();
    renderAll();
    scheduleSave({ rates: true, immediate: true });
    try {
      await ensurePendingSavesFlushed();
      toast("내 단가를 저장했습니다.", "success");
    } catch (error) {
      if (error?.quickflexHandled) return;
      toast(`단가 저장 실패: ${error.message}`, "error");
    }
  });
}
