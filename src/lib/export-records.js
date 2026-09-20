const DEFAULT_MAX_ARCHIVE_BYTES = 75 * 1024 * 1024;
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const ZIP_MIME = "application/zip";
const DANGEROUS_FORMULA_PREFIX = /^\s*[=+\-@]/;
const CATEGORY_LABELS = {
  fuel: "주유 · 충전", vehicle: "차량 정비", toll: "통행료 · 주차", insurance: "보험",
  lease: "차량 임차", supplies: "배송 용품", communication: "통신", other: "기타",
};
const PAYMENT_LABELS = { unknown: "미입력", card: "카드", cash: "현금", transfer: "계좌이체", other: "기타" };
const EVIDENCE_LABELS = {
  unknown: "미확인", card: "카드 영수증", cash_receipt: "현금영수증",
  tax_invoice: "세금계산서", receipt: "일반 영수증", other: "기타",
};
const USAGE_LABELS = { business: "업무용", personal: "개인용", mixed: "업무 · 개인 혼합" };
const STATUS_LABELS = { draft: "작성 중", confirmed: "확정", trashed: "휴지통" };
const ADJUSTMENT_LABELS = { refund: "환불", reimbursement: "비용 보전" };

export class ExportSizeLimitError extends Error {
  constructor({ estimatedBytes, maxBytes, suggestedRanges }) {
    super("증빙 파일이 한 번에 내보낼 수 있는 크기를 넘었습니다. 월별로 나누어 내려받아 주세요.");
    this.name = "ExportSizeLimitError";
    this.code = "archive_size_limit";
    this.estimatedBytes = estimatedBytes;
    this.maxBytes = maxBytes;
    this.suggestedRanges = suggestedRanges;
  }
}

export class ExportCancelledError extends Error {
  constructor() {
    super("자료 내보내기가 취소되었습니다.");
    this.name = "ExportCancelledError";
    this.code = "export_cancelled";
  }
}

function assertContinue(shouldContinue) {
  if (typeof shouldContinue === "function" && !shouldContinue()) throw new ExportCancelledError();
}

function snapshot(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function report(onProgress, detail) {
  if (typeof onProgress === "function") onProgress(detail);
}

function safeText(value) {
  if (value == null) return "";
  const text = String(value);
  return DANGEROUS_FORMULA_PREFIX.test(text) ? `'${text}` : text;
}

function labeled(value, labels) {
  const key = value == null ? "" : String(value);
  return safeText(labels[key] || key);
}

function numberOrNull(value) {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function dateText(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

function excelDate(value) {
  const text = dateText(value);
  if (!text) return null;
  const [year, month, day] = text.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function inRange(value, from, to) {
  const date = dateText(value);
  return Boolean(date && date >= from && date <= to);
}

function expenseDate(expense) {
  return dateText(expense.actual_date) || dateText(expense.created_at);
}

function cleanFilePart(value, fallback) {
  const cleaned = String(value || "")
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/^\.+|\.+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
  return cleaned || fallback;
}

function extensionFor(receipt) {
  const original = String(receipt.original_name || "");
  const match = original.match(/(\.[a-zA-Z0-9]{1,8})$/);
  if (match) return match[1].toLowerCase();
  const mime = String(receipt.content_type || "").toLowerCase();
  if (mime === "application/pdf") return ".pdf";
  if (mime === "image/png") return ".png";
  if (mime === "image/webp") return ".webp";
  if (mime === "image/heic") return ".heic";
  return ".jpg";
}

function evidencePath(expense, receipt, index) {
  const expenseId = cleanFilePart(expense.id, "expense");
  const receiptId = cleanFilePart(receipt.id, `receipt-${index + 1}`);
  const base = cleanFilePart(String(receipt.original_name || "").replace(/\.[^.]+$/, ""), "receipt");
  return `receipts/${expenseId}/${receiptId}-${base}${extensionFor(receipt)}`;
}

function monthRanges(from, to) {
  const ranges = [];
  let [year, month] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  while (year < toYear || (year === toYear && month <= toMonth)) {
    const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const monthEnd = `${year}-${String(month).padStart(2, "0")}-${lastDay}`;
    ranges.push({ from: monthStart < from ? from : monthStart, to: monthEnd > to ? to : monthEnd });
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }
  return ranges;
}

function validateRange(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || "") || !/^\d{4}-\d{2}-\d{2}$/.test(to || "") || from > to) {
    throw new TypeError("올바른 시작일과 종료일을 입력해 주세요.");
  }
}

async function loadExcelJS() {
  if (globalThis.ExcelJS) return globalThis.ExcelJS;
  if (typeof process !== "undefined" && process.versions?.node) {
    const module = await import("exceljs");
    return module.default || module;
  }
  await loadBrowserScript(new URL("../vendor/exceljs.min.js", import.meta.url));
  if (!globalThis.ExcelJS) throw new Error("엑셀 생성 라이브러리를 불러오지 못했습니다.");
  return globalThis.ExcelJS;
}

async function loadFflate() {
  if (globalThis.fflate) return globalThis.fflate;
  if (typeof process !== "undefined" && process.versions?.node) return import("fflate");
  await loadBrowserScript(new URL("../vendor/fflate.min.js", import.meta.url));
  if (!globalThis.fflate) throw new Error("압축 라이브러리를 불러오지 못했습니다.");
  return globalThis.fflate;
}

function loadBrowserScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-export-lib="${url.href}"]`);
    if (existing?.dataset.loaded === "true") return resolve();
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = url.href;
    script.async = true;
    script.dataset.exportLib = url.href;
    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve();
    }, { once: true });
    script.addEventListener("error", () => reject(new Error(`${url.pathname} 로드 실패`)), { once: true });
    document.head.append(script);
  });
}

function worksheet(workbook, name, columns) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });
  sheet.columns = columns.map(({ header, key, width = 16 }) => ({ header, key, width }));
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF315B8A" } };
  header.alignment = { vertical: "middle" };
  return sheet;
}

function formatSheet(sheet, { dateColumns = [], moneyColumns = [] } = {}) {
  for (const column of dateColumns) sheet.getColumn(column).numFmt = "yyyy-mm-dd";
  for (const column of moneyColumns) sheet.getColumn(column).numFmt = '#,##0"원"';
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber > 1) row.alignment = { vertical: "top", wrapText: true };
  });
}

export function expenseReview(expense) {
  const required = [];
  const advisory = [];
  if (expense.status === "draft") required.push("초안");
  if (!dateText(expense.actual_date)) required.push("거래일 미확정");
  if (numberOrNull(expense.gross_amount) == null) required.push("총액 미확정");
  if (!expense.category) advisory.push("분류 확인 권장");
  if (expense.usage_type !== "personal" && numberOrNull(expense.business_amount) == null) advisory.push("업무 사용 금액 미입력");
  if (!Array.isArray(expense.receipts) || expense.receipts.length === 0) advisory.push("증빙 미첨부");
  if (!expense.evidence_type || expense.evidence_type === "unknown") advisory.push("증빙 종류 미입력");
  return { required, advisory };
}

function buildRows({ sales, expenses, includeReceipts, from, to }) {
  const salesRows = sales.map((sale) => ({
    date: excelDate(sale.date),
    deliveryRevenue: numberOrNull(sale.deliveryRevenue),
    backupRevenue: numberOrNull(sale.backupRevenue),
    freshRevenue: numberOrNull(sale.freshRevenue),
    revenue: numberOrNull(sale.revenue),
    count: numberOrNull(sale.count),
    source: safeText(sale.source),
    routeDetails: Array.isArray(sale.routeDetails)
      ? safeText(sale.routeDetails.map((item) => item.route || item.name || "").filter(Boolean).join(", "))
      : "",
  }));

  const inPeriodExpenses = expenses.filter((expense) => inRange(expenseDate(expense), from, to));
  const expenseRows = inPeriodExpenses.map((expense) => ({
    id: safeText(expense.id), date: excelDate(expense.actual_date), merchant: safeText(expense.merchant),
    category: labeled(expense.category, CATEGORY_LABELS), gross: numberOrNull(expense.gross_amount),
    supply: numberOrNull(expense.supply_amount), vat: numberOrNull(expense.vat_amount),
    business: numberOrNull(expense.business_amount), usage: labeled(expense.usage_type, USAGE_LABELS), _usageType: expense.usage_type,
    payment: labeled(expense.payment_method, PAYMENT_LABELS), evidence: labeled(expense.evidence_type, EVIDENCE_LABELS),
    status: labeled(expense.status, STATUS_LABELS), memo: safeText(expense.memo),
  }));

  const adjustmentRows = [];
  const evidenceRows = [];
  const needsReviewRows = [];
  expenses.forEach((expense) => {
    for (const adjustment of expense.adjustments || []) {
      if (!inRange(adjustment.actual_date, from, to)) continue;
      adjustmentRows.push({
        expenseId: safeText(expense.id), id: safeText(adjustment.id), kind: labeled(adjustment.kind, ADJUSTMENT_LABELS),
        date: excelDate(adjustment.actual_date), amount: numberOrNull(adjustment.amount), memo: safeText(adjustment.memo),
        _expenseStatus: expense.status,
      });
    }
    if (!inRange(expenseDate(expense), from, to)) return;
    (expense.receipts || []).forEach((receipt, index) => {
      evidenceRows.push({
        expenseId: safeText(expense.id), receiptId: safeText(receipt.id), fileName: safeText(receipt.original_name),
        contentType: safeText(receipt.content_type), byteSize: numberOrNull(receipt.byte_size),
        relativePath: evidencePath(expense, receipt, index),
        exportStatus: includeReceipts ? "대기" : "엑셀만 내보냄",
        failureReason: "", _expense: expense, _receipt: receipt,
      });
    });
    const review = expenseReview(expense);
    if (review.required.length || review.advisory.length) {
      needsReviewRows.push({
        type: "지출", id: safeText(expense.id), referenceDate: excelDate(expense.actual_date || expense.created_at),
        level: review.required.length ? "확인 필요" : "참고",
        reasons: safeText([...review.required, ...review.advisory].join(", ")), amount: numberOrNull(expense.gross_amount), memo: safeText(expense.memo),
      });
    }
  });
  sales.forEach((sale) => {
    if (numberOrNull(sale.revenue) == null) {
      needsReviewRows.push({ type: "매출", id: safeText(sale.id || sale.date), referenceDate: excelDate(sale.date), level: "확인 필요", reasons: "총매출 미확정", amount: null, memo: "" });
    }
  });
  return { salesRows, expenseRows, adjustmentRows, evidenceRows, needsReviewRows };
}

async function receiptBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (typeof Blob !== "undefined" && value instanceof Blob) return new Uint8Array(await value.arrayBuffer());
  if (typeof Response !== "undefined" && value instanceof Response) {
    if (!value.ok) throw new Error(`HTTP ${value.status}`);
    return new Uint8Array(await value.arrayBuffer());
  }
  throw new TypeError("영수증 응답이 파일 형식이 아닙니다.");
}

function totals(rows) {
  const knownSales = rows.salesRows.filter((row) => row.revenue != null);
  const confirmed = rows.expenseRows.filter((row) => row.status === STATUS_LABELS.confirmed);
  const confirmedAdjustments = rows.adjustmentRows.filter((row) => row._expenseStatus === "confirmed");
  return {
    sales: knownSales.reduce((sum, row) => sum + row.revenue, 0),
    confirmedGross: confirmed.filter((row) => row.gross != null).reduce((sum, row) => sum + row.gross, 0),
    confirmedBusiness: confirmed.filter((row) => row.business != null).reduce((sum, row) => sum + row.business, 0),
    unknownBusinessCount: confirmed.filter((row) => row._usageType !== "personal" && row.business == null).length,
    refunds: confirmedAdjustments.filter((row) => row.kind === ADJUSTMENT_LABELS.refund && row.amount != null).reduce((sum, row) => sum + row.amount, 0),
    reimbursements: confirmedAdjustments.filter((row) => row.kind === ADJUSTMENT_LABELS.reimbursement && row.amount != null).reduce((sum, row) => sum + row.amount, 0),
  };
}

function addWorkbookSheets(workbook, { rows, businessInfo, from, to, generatedAt }) {
  const amounts = totals(rows);
  const summary = worksheet(workbook, "summary", [
    { header: "항목", key: "label", width: 28 }, { header: "값", key: "value", width: 34 },
  ]);
  [
    ["상호/표시명", safeText(businessInfo.displayName || businessInfo.name)],
    ["사업자등록번호", safeText(businessInfo.registrationNumber)],
    ["기간 시작", excelDate(from)], ["기간 종료", excelDate(to)], ["생성 시각", generatedAt],
    ["기록 매출", amounts.sales], ["확정 지출 원총액", amounts.confirmedGross],
    ["확정 업무 사용 금액(입력분)", amounts.confirmedBusiness], ["업무 사용 금액 미입력 건수", amounts.unknownBusinessCount],
    ["기간 내 환불", amounts.refunds],
    ["기간 내 비용 보전", amounts.reimbursements], ["확인 필요 건수", rows.needsReviewRows.filter((row) => row.level === "확인 필요").length],
    ["집계 기준", "매출은 일별 정본의 총매출만 사용합니다. 초안과 미확정 금액은 합계에서 제외하며, 환불·비용 보전은 처리일이 선택 기간 안인 경우만 별도 표시합니다."],
  ].forEach(([label, value]) => summary.addRow({ label, value }));
  [7, 8, 9, 11, 12].forEach((row) => { summary.getCell(`B${row}`).numFmt = '#,##0"원"'; });
  summary.getCell("B4").numFmt = "yyyy-mm-dd";
  summary.getCell("B5").numFmt = "yyyy-mm-dd";
  summary.getCell("B6").numFmt = "yyyy-mm-dd hh:mm";

  const salesSheet = worksheet(workbook, "sales_daily", [
    { header: "날짜", key: "date", width: 13 }, { header: "배송 매출", key: "deliveryRevenue" },
    { header: "백업수당", key: "backupRevenue" }, { header: "프레시백", key: "freshRevenue" },
    { header: "총매출", key: "revenue" }, { header: "완료 수량", key: "count", width: 12 },
    { header: "적용 기준", key: "source", width: 18 }, { header: "구역 상세(참고)", key: "routeDetails", width: 30 },
  ]);
  salesSheet.addRows(rows.salesRows);
  formatSheet(salesSheet, { dateColumns: [1], moneyColumns: [2, 3, 4, 5] });

  const expenseSheet = worksheet(workbook, "expenses", [
    { header: "기록 ID", key: "id", width: 28 }, { header: "거래일", key: "date", width: 13 },
    { header: "거래처", key: "merchant", width: 24 }, { header: "분류", key: "category", width: 16 },
    { header: "총액", key: "gross" }, { header: "공급가액", key: "supply" }, { header: "부가세", key: "vat" },
    { header: "업무 금액", key: "business" }, { header: "사용 구분", key: "usage", width: 13 },
    { header: "결제수단", key: "payment", width: 14 }, { header: "증빙 종류", key: "evidence", width: 18 },
    { header: "상태", key: "status", width: 12 }, { header: "메모", key: "memo", width: 30 },
  ]);
  expenseSheet.addRows(rows.expenseRows);
  formatSheet(expenseSheet, { dateColumns: [2], moneyColumns: [5, 6, 7, 8] });

  const refundsSheet = worksheet(workbook, "refunds", [
    { header: "원지출 ID", key: "expenseId", width: 28 }, { header: "조정 ID", key: "id", width: 28 },
    { header: "구분", key: "kind", width: 16 }, { header: "처리일", key: "date", width: 13 },
    { header: "금액", key: "amount" }, { header: "메모", key: "memo", width: 30 },
  ]);
  refundsSheet.addRows(rows.adjustmentRows.map(({ _expenseStatus, ...row }) => row));
  formatSheet(refundsSheet, { dateColumns: [4], moneyColumns: [5] });

  const evidenceSheet = worksheet(workbook, "evidence_index", [
    { header: "지출 ID", key: "expenseId", width: 28 }, { header: "증빙 ID", key: "receiptId", width: 28 },
    { header: "파일명", key: "fileName", width: 28 }, { header: "첨부 종류", key: "contentType", width: 20 },
    { header: "크기(byte)", key: "byteSize", width: 14 }, { header: "상대 경로", key: "relativePath", width: 44 },
    { header: "내보내기 상태", key: "exportStatus", width: 18 }, { header: "실패 사유", key: "failureReason", width: 32 },
  ]);
  evidenceSheet.addRows(rows.evidenceRows.map(({ _expense, _receipt, ...row }) => row));
  formatSheet(evidenceSheet);

  const reviewSheet = worksheet(workbook, "needs_review", [
    { header: "자료 종류", key: "type", width: 12 }, { header: "기록 ID", key: "id", width: 28 },
    { header: "구분", key: "level", width: 12 }, { header: "기준일", key: "referenceDate", width: 13 }, { header: "확인 항목", key: "reasons", width: 40 },
    { header: "기록 금액", key: "amount", width: 16 }, { header: "메모", key: "memo", width: 30 },
  ]);
  reviewSheet.addRows(rows.needsReviewRows);
  formatSheet(reviewSheet, { dateColumns: [4], moneyColumns: [6] });
}

export async function buildRecordsExport({
  sales = [], expenses = [], from, to, includeReceipts = false, fetchReceipt,
  onProgress, shouldContinue, businessInfo = {}, maxArchiveBytes = DEFAULT_MAX_ARCHIVE_BYTES, now = new Date(),
} = {}) {
  assertContinue(shouldContinue);
  validateRange(from, to);
  if (!Array.isArray(sales) || !Array.isArray(expenses)) throw new TypeError("매출과 지출 자료가 필요합니다.");
  if (!Number.isFinite(maxArchiveBytes) || maxArchiveBytes <= 0) throw new TypeError("내보내기 크기 한도가 올바르지 않습니다.");

  const snapshotSales = snapshot(sales).filter((row) => inRange(row.date, from, to));
  const snapshotExpenses = snapshot(expenses).filter((row) => row.status !== "trashed" && (
    inRange(expenseDate(row), from, to) || (row.adjustments || []).some((adjustment) => inRange(adjustment.actual_date, from, to))
  ));
  const snapshotBusinessInfo = snapshot(businessInfo || {});
  const rows = buildRows({ sales: snapshotSales, expenses: snapshotExpenses, includeReceipts, from, to });
  const warnings = [];
  const evidenceFiles = {};

  if (includeReceipts) {
    if (typeof fetchReceipt !== "function") throw new TypeError("증빙 파일을 가져오는 함수가 필요합니다.");
    const knownBytes = rows.evidenceRows.reduce((sum, row) => sum + (row.byteSize || 0), 0);
    if (knownBytes > maxArchiveBytes) {
      throw new ExportSizeLimitError({ estimatedBytes: knownBytes, maxBytes: maxArchiveBytes, suggestedRanges: monthRanges(from, to) });
    }
    let loadedBytes = 0;
    for (let index = 0; index < rows.evidenceRows.length; index += 1) {
      assertContinue(shouldContinue);
      const row = rows.evidenceRows[index];
      report(onProgress, { stage: "receipt", completed: index, total: rows.evidenceRows.length, fileName: row.fileName });
      try {
        const bytes = await receiptBytes(await fetchReceipt(snapshot(row._receipt), snapshot(row._expense)));
        assertContinue(shouldContinue);
        if (loadedBytes + bytes.byteLength > maxArchiveBytes) {
          throw new ExportSizeLimitError({ estimatedBytes: loadedBytes + bytes.byteLength, maxBytes: maxArchiveBytes, suggestedRanges: monthRanges(from, to) });
        }
        loadedBytes += bytes.byteLength;
        evidenceFiles[row.relativePath] = bytes;
        row.exportStatus = "포함";
      } catch (error) {
        if (error instanceof ExportSizeLimitError) throw error;
        row.exportStatus = "가져오기 실패";
        row.failureReason = safeText(error?.message || "알 수 없는 오류");
        warnings.push({ code: "receipt_fetch_failed", expenseId: row.expenseId, receiptId: row.receiptId, message: row.failureReason });
      }
    }
  }

  report(onProgress, { stage: "workbook", completed: 0, total: 1 });
  assertContinue(shouldContinue);
  const ExcelJS = await loadExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QuickFlex";
  workbook.created = new Date(now);
  workbook.modified = new Date(now);
  addWorkbookSheets(workbook, { rows, businessInfo: snapshotBusinessInfo, from, to, generatedAt: new Date(now) });
  const buffer = await workbook.xlsx.writeBuffer({ useStyles: true, useSharedStrings: true });
  assertContinue(shouldContinue);
  const xlsxBytes = new Uint8Array(buffer);
  report(onProgress, { stage: "workbook", completed: 1, total: 1 });

  const stamp = new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const baseName = `quickflex_${from}_${to}_${stamp}`;
  const manifest = {
    from, to, generatedAt: new Date(now).toISOString(), salesCount: rows.salesRows.length,
    expenseCount: rows.expenseRows.length, adjustmentCount: rows.adjustmentRows.length,
    evidenceCount: rows.evidenceRows.length, includedEvidenceCount: Object.keys(evidenceFiles).length,
    failedEvidenceCount: warnings.filter((item) => item.code === "receipt_fetch_failed").length,
  };
  return { xlsxBytes, workbook, evidenceFiles, manifest, warnings, baseName };
}

export async function downloadRecordsExport(options = {}) {
  const built = await buildRecordsExport(options);
  assertContinue(options.shouldContinue);
  let bytes = built.xlsxBytes;
  let kind = "xlsx";
  let mimeType = XLSX_MIME;
  let fileName = `${built.baseName}.xlsx`;
  if (options.includeReceipts) {
    const fflate = await loadFflate();
    const archiveFiles = { [`${built.baseName}.xlsx`]: built.xlsxBytes, ...built.evidenceFiles };
    report(options.onProgress, { stage: "archive", completed: 0, total: 1 });
    assertContinue(options.shouldContinue);
    bytes = fflate.zipSync(archiveFiles, { level: 6 });
    assertContinue(options.shouldContinue);
    if (bytes.byteLength > (options.maxArchiveBytes || DEFAULT_MAX_ARCHIVE_BYTES) + built.xlsxBytes.byteLength) {
      throw new ExportSizeLimitError({ estimatedBytes: bytes.byteLength, maxBytes: options.maxArchiveBytes || DEFAULT_MAX_ARCHIVE_BYTES, suggestedRanges: monthRanges(options.from, options.to) });
    }
    kind = "zip";
    mimeType = ZIP_MIME;
    fileName = `${built.baseName}_evidence.zip`;
    report(options.onProgress, { stage: "archive", completed: 1, total: 1 });
  }
  assertContinue(options.shouldContinue);
  const blob = new Blob([bytes], { type: mimeType });
  assertContinue(options.shouldContinue);
  if (typeof document !== "undefined" && options.autoDownload !== false) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.hidden = true;
    assertContinue(options.shouldContinue);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
  report(options.onProgress, { stage: "done", completed: 1, total: 1 });
  return { fileName, blob, kind, manifest: built.manifest, warnings: built.warnings };
}

export const exportInternals = { safeText, numberOrNull, monthRanges, evidencePath, excelDate };
