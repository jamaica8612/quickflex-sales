import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import {
  buildRecordsExport,
  downloadRecordsExport,
  ExportCancelledError,
  ExportSizeLimitError,
  exportInternals,
} from "../src/lib/export-records.js";
import { summarize } from "../src/ui/exports.js";

const sales = [{
  date: "2026-09-03",
  revenue: 100,
  deliveryRevenue: 50,
  freshRevenue: 30,
  backupRevenue: 40,
  count: 3,
  source: "override",
  routeDetails: [{ route: "310C01", revenue: 9999 }],
}];

function expenseFixture() {
  return [
    {
      id: "expense-1",
      actual_date: "2026-09-04",
      gross_amount: "1100",
      supply_amount: null,
      vat_amount: null,
      business_amount: null,
      merchant: "=SUM(1,2)",
      category: "fuel",
      payment_method: "card",
      evidence_type: "card",
      usage_type: "business",
      status: "confirmed",
      memo: "+private formula",
      created_at: "2026-09-04T10:00:00Z",
      receipts: [
        { id: "receipt-ok", original_name: "주유 영수증.jpg", content_type: "image/jpeg", byte_size: 4, object_path: "private/user/secret-a" },
        { id: "receipt-fail", original_name: "실패.pdf", content_type: "application/pdf", byte_size: 5, object_path: "private/user/secret-b" },
      ],
      adjustments: [
        { id: "refund-1", kind: "refund", amount: "100", actual_date: "2026-09-05", memo: "부분 취소" },
        { id: "reimbursement-1", kind: "reimbursement", amount: "50", actual_date: "2026-09-06", memo: "보전" },
      ],
    },
    {
      id: "draft-1",
      actual_date: null,
      gross_amount: "999",
      business_amount: null,
      merchant: "미정",
      category: "",
      usage_type: "mixed",
      evidence_type: "unknown",
      status: "draft",
      memo: "@draft",
      created_at: "2026-09-08T02:00:00Z",
      receipts: [],
      adjustments: [],
    },
  ];
}

test("creates a real typed workbook from canonical daily sales without re-aggregation", async () => {
  const result = await buildRecordsExport({
    sales,
    expenses: expenseFixture(),
    from: "2026-09-01",
    to: "2026-09-30",
    now: new Date("2026-09-13T00:00:00Z"),
  });
  assert.ok(result.xlsxBytes.byteLength > 1_000);

  const roundTrip = new ExcelJS.Workbook();
  await roundTrip.xlsx.load(result.xlsxBytes);
  assert.deepEqual(roundTrip.worksheets.map((sheet) => sheet.name), [
    "summary", "sales_daily", "expenses", "refunds", "evidence_index", "needs_review",
  ]);
  assert.equal(roundTrip.getWorksheet("summary").getCell("B7").value, 100);
  assert.equal(roundTrip.getWorksheet("summary").getCell("B8").value, 1100);
  assert.equal(roundTrip.getWorksheet("summary").getCell("B9").value, 0);
  assert.equal(roundTrip.getWorksheet("summary").getCell("B10").value, 1);
  assert.equal(roundTrip.getWorksheet("sales_daily").getCell("E2").value, 100);
  assert.ok(roundTrip.getWorksheet("sales_daily").getCell("A2").value instanceof Date);
  assert.equal(roundTrip.getWorksheet("sales_daily").getCell("A2").value.toISOString(), "2026-09-03T00:00:00.000Z");
  assert.equal(roundTrip.getWorksheet("expenses").getCell("B2").value.toISOString(), "2026-09-04T00:00:00.000Z");
  assert.equal(roundTrip.getWorksheet("expenses").getCell("C2").value, "'=SUM(1,2)");
  assert.equal(roundTrip.getWorksheet("expenses").getCell("D2").value, "주유 · 충전");
  assert.equal(roundTrip.getWorksheet("expenses").getCell("J2").value, "카드");
  assert.equal(roundTrip.getWorksheet("expenses").getCell("K2").value, "카드 영수증");
  assert.equal(roundTrip.getWorksheet("expenses").getCell("I2").value, "업무용");
  assert.equal(roundTrip.getWorksheet("expenses").getCell("L2").value, "확정");
  assert.equal(roundTrip.getWorksheet("refunds").getCell("C2").value, "환불");
  assert.equal(roundTrip.getWorksheet("expenses").getCell("M2").value, "'+private formula");
  assert.equal(roundTrip.getWorksheet("expenses").getCell("E3").value, 999);
  assert.equal(roundTrip.getWorksheet("expenses").getCell("H3").value, null);
  assert.equal(roundTrip.getWorksheet("sales_daily").views[0].state, "frozen");
  assert.ok(roundTrip.getWorksheet("expenses").autoFilter);
  assert.notEqual(roundTrip.getWorksheet("summary").getCell("B10").numFmt, '#,##0"원"');
});

test("limits adjustment rows and totals to their own selected-period date", async () => {
  const expenses = expenseFixture();
  expenses[0].adjustments.push({ id: "later-refund", kind: "refund", amount: "900", actual_date: "2026-10-01", memo: "다음 달 취소" });
  const result = await buildRecordsExport({ sales, expenses, from: "2026-09-01", to: "2026-09-30" });
  const refunds = result.workbook.getWorksheet("refunds");
  assert.equal(refunds.rowCount, 3, "the October refund is not presented as a September adjustment");
  assert.equal(result.workbook.getWorksheet("summary").getCell("B11").value, 100);
});

test("includes a period refund for an older expense without counting its original gross", async () => {
  const expenses = [{
    id: "older-expense", actual_date: "2026-08-31", gross_amount: "2000", category: "fuel", usage_type: "business", status: "confirmed",
    receipts: [], adjustments: [{ id: "september-refund", kind: "refund", amount: "100", actual_date: "2026-09-01", memo: "9월 환불" }],
  }];
  const result = await buildRecordsExport({ sales: [], expenses, from: "2026-09-01", to: "2026-09-30" });
  assert.equal(result.workbook.getWorksheet("expenses").rowCount, 1);
  assert.equal(result.workbook.getWorksheet("refunds").rowCount, 2);
  assert.equal(result.workbook.getWorksheet("summary").getCell("B8").value, 0);
  assert.equal(result.workbook.getWorksheet("summary").getCell("B11").value, 100);
});

test("preview counts an in-period adjustment reference without counting its older gross", () => {
  const preview = summarize({ expenses: [{
    actual_date: "2026-08-31", gross_amount: 2000, status: "confirmed",
    adjustments: [{ kind: "refund", amount: 100, actual_date: "2026-09-01" }],
  }] }, "2026-09-01", "2026-09-30");
  assert.equal(preview.expenseCount, 0);
  assert.equal(preview.expenseTotal, 0);
  assert.equal(preview.adjustmentCount, 1);
  assert.equal(preview.refundTotal, 100);
});

test("ZIP contains the XLSX and only successfully fetched private receipt bytes", async () => {
  const expenses = expenseFixture();
  const result = await downloadRecordsExport({
    sales,
    expenses,
    from: "2026-09-01",
    to: "2026-09-30",
    includeReceipts: true,
    autoDownload: false,
    now: new Date("2026-09-13T00:00:00Z"),
    fetchReceipt: async (receipt) => {
      if (receipt.id === "receipt-fail") throw new Error("signed URL fetch failed");
      return new Uint8Array([1, 2, 3, 4]);
    },
  });

  assert.equal(result.kind, "zip");
  assert.equal(result.manifest.includedEvidenceCount, 1);
  assert.equal(result.manifest.failedEvidenceCount, 1);
  const files = unzipSync(new Uint8Array(await result.blob.arrayBuffer()));
  const names = Object.keys(files);
  const workbookName = names.find((name) => name.endsWith(".xlsx"));
  assert.ok(workbookName);
  assert.ok(names.some((name) => name.includes("receipt-ok-") && name.endsWith(".jpg")));
  assert.ok(!names.some((name) => name.includes("receipt-fail-") && name.endsWith(".pdf")));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(files[workbookName]);
  const evidence = workbook.getWorksheet("evidence_index");
  assert.equal(evidence.getCell("G2").value, "포함");
  assert.equal(evidence.getCell("G3").value, "가져오기 실패");
  assert.match(evidence.getCell("H3").value, /signed URL fetch failed/);
  assert.doesNotMatch(evidence.getCell("F2").value, /private|secret/);
});

test("takes one input snapshot and rejects oversized archives with monthly suggestions", async () => {
  const expenses = expenseFixture();
  const promise = buildRecordsExport({
    sales,
    expenses,
    from: "2026-09-01",
    to: "2026-09-30",
    includeReceipts: true,
    fetchReceipt: async (receipt) => {
      expenses[0].merchant = "changed while exporting";
      return receipt.id === "receipt-ok" ? new Uint8Array([1, 2, 3, 4]) : new Uint8Array([5]);
    },
  });
  const built = await promise;
  assert.equal(built.workbook.getWorksheet("expenses").getCell("C2").value, "'=SUM(1,2)");

  await assert.rejects(
    buildRecordsExport({
      sales,
      expenses: expenseFixture(),
      from: "2026-08-20",
      to: "2026-09-30",
      includeReceipts: true,
      maxArchiveBytes: 8,
      fetchReceipt: async () => new Uint8Array(),
    }),
    (error) => error instanceof ExportSizeLimitError && error.code === "archive_size_limit" && error.suggestedRanges.length === 2,
  );
});

test("sanitizes formula prefixes and archive path components", () => {
  assert.equal(exportInternals.safeText(" @SUM(A1:A2)"), "' @SUM(A1:A2)");
  assert.equal(exportInternals.evidencePath({ id: "../expense" }, { id: "r/1", original_name: "../a?.pdf", content_type: "application/pdf" }, 0), "receipts/_expense/r_1-_a_.pdf");
});

test("cancels after workbook creation before returning or triggering download", async () => {
  let checks = 0;
  await assert.rejects(
    downloadRecordsExport({
      sales,
      expenses: expenseFixture(),
      from: "2026-09-01",
      to: "2026-09-30",
      autoDownload: false,
      shouldContinue() {
        checks += 1;
        return checks < 4;
      },
    }),
    (error) => error instanceof ExportCancelledError && error.code === "export_cancelled",
  );
  assert.ok(checks >= 4);
});
