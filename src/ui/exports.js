import { downloadRecordsExport, ExportCancelledError, ExportSizeLimitError } from "../lib/export-records.js";

function formatWon(value) {
  return `${new Intl.NumberFormat("ko-KR").format(value)}원`;
}

function summarize({ sales = [], expenses = [] }, from, to) {
  const inRange = (value) => typeof value === "string" && value.slice(0, 10) >= from && value.slice(0, 10) <= to;
  const periodSales = sales.filter((item) => inRange(item.date));
  const periodExpenses = expenses.filter((item) => item.status !== "trashed" && inRange(item.actual_date || item.created_at));
  const knownSales = periodSales.filter((item) => item.revenue != null && item.revenue !== "");
  const confirmed = periodExpenses.filter((item) => item.status === "confirmed" && item.gross_amount != null && item.gross_amount !== "");
  const receiptCount = periodExpenses.reduce((sum, item) => sum + (item.receipts?.length || 0), 0);
  const reviewCount = periodExpenses.filter((item) => (
    item.status === "draft" || !item.actual_date || item.gross_amount == null || !item.category ||
    (item.usage_type !== "personal" && item.business_amount == null) || !item.receipts?.length
  )).length + periodSales.filter((item) => item.revenue == null || item.revenue === "").length;
  return {
    salesCount: periodSales.length,
    expenseCount: periodExpenses.length,
    receiptCount,
    reviewCount,
    salesTotal: knownSales.reduce((sum, item) => sum + Number(item.revenue), 0),
    expenseTotal: confirmed.reduce((sum, item) => sum + Number(item.gross_amount), 0),
  };
}

function progressLabel(progress) {
  if (progress.stage === "receipt") return `증빙 파일 ${progress.completed + 1}/${progress.total} 준비 중`;
  if (progress.stage === "workbook") return progress.completed ? "엑셀 파일 준비 완료" : "엑셀 파일 만드는 중";
  if (progress.stage === "archive") return progress.completed ? "압축 파일 준비 완료" : "증빙 파일 압축 중";
  if (progress.stage === "done") return "다운로드를 시작했습니다.";
  return "자료를 준비하고 있습니다.";
}

function getFocusable(root) {
  return [...root.querySelectorAll("button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])")];
}

function localDateText(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function presetRange(kind, clock = new Date()) {
  const year = clock.getFullYear();
  const month = clock.getMonth();
  if (kind === "settlement") {
    const start = clock.getDate() >= 26 ? new Date(year, month, 26) : new Date(year, month - 1, 26);
    return { from: localDateText(start), to: localDateText(new Date(start.getFullYear(), start.getMonth() + 1, 25)) };
  }
  return { from: localDateText(new Date(year, month, 1)), to: localDateText(new Date(year, month + 1, 0)) };
}

export function createExportsController({ host, getExportInput, fetchReceipt, onDownload } = {}) {
  const root = typeof host === "string" ? document.querySelector(host) : host;
  if (!root) throw new Error("내보내기 화면을 표시할 위치가 없습니다.");
  if (typeof getExportInput !== "function") throw new TypeError("내보낼 자료를 불러오는 함수가 필요합니다.");

  root.innerHTML = `
    <div class="exports-overlay" data-exports-overlay hidden>
      <section class="exports-dialog" role="dialog" aria-modal="true" aria-labelledby="exportsTitle" aria-describedby="exportsHelp">
        <header class="exports-head">
          <div>
            <p>매출 · 매입/경비 자료</p>
            <h2 id="exportsTitle">자료 내보내기</h2>
          </div>
          <button class="exports-close" type="button" data-export-close aria-label="자료 내보내기 닫기">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
          </button>
        </header>
        <form class="exports-form" data-export-form>
          <p class="exports-help" id="exportsHelp">기간과 파일 구성을 확인한 뒤 세무사에게 전달할 자료를 내려받으세요.</p>
          <fieldset class="exports-period">
            <legend>기간</legend>
            <div class="exports-range-presets">
              <button type="button" data-export-range="month" aria-pressed="true">이번 달</button>
              <button type="button" data-export-range="settlement" aria-pressed="false">이번 정산 <small>26–25일</small></button>
              <button type="button" data-export-range="custom" aria-pressed="false">직접 설정</button>
            </div>
            <label>시작일<input name="from" type="date" required></label>
            <span aria-hidden="true">–</span>
            <label>종료일<input name="to" type="date" required></label>
          </fieldset>
          <fieldset class="exports-kind">
            <legend>파일 구성</legend>
            <label class="exports-choice">
              <input type="radio" name="kind" value="xlsx" checked>
              <span><strong>엑셀만</strong><small>매출·지출·환불·확인 필요 자료</small></span>
            </label>
            <label class="exports-choice">
              <input type="radio" name="kind" value="zip">
              <span><strong>증빙 포함</strong><small>엑셀과 비공개 영수증 이미지·PDF</small></span>
            </label>
          </fieldset>
          <button class="exports-preview-button" type="button" data-export-preview>건수와 합계 미리보기</button>
          <div class="exports-preview" data-export-preview-panel hidden></div>
          <p class="exports-status" data-export-status role="status" aria-live="polite"></p>
          <button class="exports-download" type="submit">다운로드</button>
        </form>
      </section>
    </div>`;

  const overlay = root.querySelector("[data-exports-overlay]");
  const dialog = root.querySelector(".exports-dialog");
  const form = root.querySelector("[data-export-form]");
  const status = root.querySelector("[data-export-status]");
  const previewPanel = root.querySelector("[data-export-preview-panel]");
  let returnFocus = null;
  let loadSequence = 0;

  function setFormBusy(value) {
    form.toggleAttribute("aria-busy", value);
    form.querySelectorAll("button, input").forEach((control) => { control.disabled = value; });
  }

  function selectRange(kind, values) {
    root.querySelectorAll("[data-export-range]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.exportRange === kind));
    });
    if (values) {
      form.elements.from.value = values.from;
      form.elements.to.value = values.to;
    }
    previewPanel.hidden = true;
    setStatus("");
  }

  function setStatus(message, tone = "") {
    status.textContent = message;
    status.dataset.tone = tone;
  }

  function range() {
    const data = new FormData(form);
    const from = String(data.get("from") || "");
    const to = String(data.get("to") || "");
    if (!from || !to || from > to) throw new Error("올바른 시작일과 종료일을 선택해 주세요.");
    return { from, to, includeReceipts: data.get("kind") === "zip" };
  }

  async function loadInput({ showPreview = false } = {}) {
    const currentRange = range();
    const sequence = ++loadSequence;
    setStatus("본인 자료를 불러오는 중입니다.");
    const input = await getExportInput({ from: currentRange.from, to: currentRange.to });
    if (sequence !== loadSequence) return null;
    if (!input || !Array.isArray(input.sales) || !Array.isArray(input.expenses)) {
      throw new Error("매출 또는 지출 자료를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (showPreview) {
      const data = summarize(input, currentRange.from, currentRange.to);
      previewPanel.innerHTML = `
        <dl>
          <div><dt>기록 매출</dt><dd>${formatWon(data.salesTotal)} <small>${data.salesCount}일</small></dd></div>
          <div><dt>확정 지출</dt><dd>${formatWon(data.expenseTotal)} <small>${data.expenseCount}건</small></dd></div>
          <div><dt>증빙</dt><dd>${data.receiptCount}개</dd></div>
          <div><dt>확인 필요</dt><dd>${data.reviewCount}건</dd></div>
        </dl>
        <p>초안과 미확정 금액은 합계에서 제외됩니다.</p>`;
      previewPanel.hidden = false;
      setStatus("미리보기를 갱신했습니다.");
    }
    return { input: { ...input, ...currentRange }, sequence };
  }

  function close() {
    loadSequence += 1;
    overlay.hidden = true;
    document.body.classList.remove("exports-open");
    setFormBusy(false);
    returnFocus?.focus?.();
    returnFocus = null;
  }

  function reset() {
    close();
    form.reset();
    previewPanel.hidden = true;
    previewPanel.replaceChildren();
    setStatus("");
  }

  function open({ from, to } = {}) {
    returnFocus = document.activeElement;
    if (from && to) selectRange("custom", { from, to });
    else selectRange("month", presetRange("month"));
    overlay.hidden = false;
    document.body.classList.add("exports-open");
    requestAnimationFrame(() => form.elements.from.focus());
  }

  root.querySelector("[data-export-close]").addEventListener("click", close);
  root.querySelectorAll("[data-export-range]").forEach((button) => button.addEventListener("click", () => {
    const kind = button.dataset.exportRange;
    selectRange(kind, kind === "custom" ? null : presetRange(kind));
    if (kind === "custom") form.elements.from.focus();
  }));
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = getFocusable(dialog);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  root.querySelector("[data-export-preview]").addEventListener("click", async () => {
    const previewToken = loadSequence + 1;
    try {
      await loadInput({ showPreview: true });
    } catch (error) {
      if (previewToken === loadSequence && !overlay.hidden) setStatus(error?.message || "미리보기를 만들지 못했습니다.", "error");
    }
  });
  form.addEventListener("change", (event) => {
    if (event.target === form.elements.from || event.target === form.elements.to) selectRange("custom");
    previewPanel.hidden = true;
    setStatus("");
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    setFormBusy(true);
    let runToken = loadSequence + 1;
    try {
      const loaded = await loadInput();
      if (!loaded) return;
      const { input, sequence } = loaded;
      runToken = sequence;
      const isCurrent = () => runToken === loadSequence && !overlay.hidden;
      const result = await downloadRecordsExport({
        ...input,
        fetchReceipt,
        shouldContinue: isCurrent,
        onProgress: (progress) => { if (isCurrent()) setStatus(progressLabel(progress)); },
      });
      if (!isCurrent()) return;
      if (result.warnings.length) {
        setStatus(`다운로드했습니다. 가져오지 못한 증빙 ${result.warnings.length}개는 엑셀에서 확인해 주세요.`, "warning");
      }
      onDownload?.(result);
    } catch (error) {
      if (error instanceof ExportCancelledError || (runToken != null && runToken !== loadSequence)) return;
      if (error instanceof ExportSizeLimitError) {
        setStatus(`${error.message} 추천 기간: ${error.suggestedRanges.map((item) => `${item.from}~${item.to}`).join(", ")}`, "error");
      } else {
        setStatus(error?.message || "자료를 내보내지 못했습니다.", "error");
      }
    } finally {
      if (runToken == null || runToken === loadSequence) {
        setFormBusy(false);
      }
    }
  });

  return { open, close, reset, element: overlay };
}
