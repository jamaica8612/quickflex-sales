export const EXPENSE_BUCKET = "quickflex-expense-receipts";

export const EXPENSE_SELECT = `
  id,user_id,actual_date,gross_amount,category,merchant,payment_method,evidence_type,memo,
  supply_amount,vat_amount,business_amount,usage_type,status,request_id,trashed_at,created_at,updated_at,
  receipts:quickflex_expense_receipts(id,expense_id,object_path,original_name,content_type,byte_size,sha256,created_at),
  adjustments:quickflex_expense_adjustments(id,expense_id,kind,amount,actual_date,memo,request_id,created_at)
`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USAGE_TYPES = new Set(["business", "personal", "mixed"]);
const SAVE_STATUSES = new Set(["draft", "confirmed"]);
const ADJUSTMENT_KINDS = new Set(["refund", "reimbursement"]);

export function isExpenseUuid(value) {
  return typeof value === "string" && UUID.test(value);
}

export function createExpenseRequestId(cryptoImpl = globalThis.crypto) {
  const value = cryptoImpl?.randomUUID?.();
  if (!isExpenseUuid(value)) throw new Error("Secure request ID generation is unavailable");
  return value.toLowerCase();
}

function nullableText(value, max, label) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized) return null;
  if (normalized.length > max) throw new RangeError(`${label} is too long`);
  return normalized;
}

function nullableWon(value, label) {
  if (value == null || value === "") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new RangeError(`${label} must be a non-negative whole won amount`);
  return number;
}

export function normalizeExpenseSaveInput(input = {}, cryptoImpl = globalThis.crypto) {
  const status = input.status || "draft";
  if (!SAVE_STATUSES.has(status)) throw new RangeError("Expense status must be draft or confirmed");
  const usageType = input.usage_type || "business";
  if (!USAGE_TYPES.has(usageType)) throw new RangeError("Invalid expense usage type");
  const grossAmount = nullableWon(input.gross_amount, "Gross amount");
  const businessAmount = nullableWon(input.business_amount, "Business amount");
  if (businessAmount != null && (grossAmount == null || businessAmount > grossAmount)) {
    throw new RangeError("Business amount cannot exceed gross amount");
  }
  const actualDate = nullableText(input.actual_date, 10, "Actual date");
  if (actualDate && !/^\d{4}-\d{2}-\d{2}$/.test(actualDate)) throw new RangeError("Actual date must be YYYY-MM-DD");
  if (status === "confirmed" && (!actualDate || grossAmount == null || grossAmount <= 0)) {
    throw new RangeError("Confirmed expenses need an actual date and positive gross amount");
  }
  if (input.id != null && !isExpenseUuid(input.id)) throw new RangeError("Invalid expense ID");
  const requestId = input.request_id || createExpenseRequestId(cryptoImpl);
  if (typeof requestId !== "string" || requestId.length < 8 || requestId.length > 128) throw new RangeError("Invalid expense request ID");
  return {
    id: input.id || null,
    actual_date: actualDate,
    gross_amount: grossAmount,
    category: nullableText(input.category, 100, "Category"),
    merchant: nullableText(input.merchant, 200, "Merchant"),
    payment_method: nullableText(input.payment_method, 64, "Payment method"),
    evidence_type: nullableText(input.evidence_type, 64, "Evidence type"),
    memo: nullableText(input.memo, 2000, "Memo"),
    supply_amount: nullableWon(input.supply_amount, "Supply amount"),
    vat_amount: nullableWon(input.vat_amount, "VAT amount"),
    business_amount: businessAmount,
    usage_type: usageType,
    status,
    request_id: requestId,
  };
}

export function normalizeExpenseAdjustment(input = {}, cryptoImpl = globalThis.crypto) {
  if (!ADJUSTMENT_KINDS.has(input.kind)) throw new RangeError("Adjustment kind must be refund or reimbursement");
  const amount = nullableWon(input.amount, "Adjustment amount");
  if (amount == null || amount <= 0) throw new RangeError("Adjustment amount must be positive");
  const actualDate = nullableText(input.actual_date, 10, "Adjustment date");
  if (!actualDate || !/^\d{4}-\d{2}-\d{2}$/.test(actualDate)) throw new RangeError("Adjustment date must be YYYY-MM-DD");
  const requestId = input.request_id || createExpenseRequestId(cryptoImpl);
  return { kind: input.kind, amount, actual_date: actualDate, memo: nullableText(input.memo, 2000, "Memo") || "", request_id: requestId };
}

export function normalizeExpenseRow(row = {}) {
  return { ...row, receipts: Array.isArray(row.receipts) ? row.receipts : [], adjustments: Array.isArray(row.adjustments) ? row.adjustments : [] };
}
