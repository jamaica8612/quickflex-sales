import {
  EXPENSE_BUCKET,
  EXPENSE_SELECT,
  createExpenseRequestId,
  isExpenseUuid,
  normalizeExpenseAdjustment,
  normalizeExpenseRow,
  normalizeExpenseSaveInput,
} from "../lib/expenses.js";

const ALLOWED_RECEIPT_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"]);
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

function errorMessage(error, fallback) {
  return error?.message || fallback;
}

async function requireUserId(db) {
  const { data, error } = await db.auth.getUser();
  if (error || !isExpenseUuid(data?.user?.id)) throw new Error(errorMessage(error, "Signed-in user is required"));
  return data.user.id.toLowerCase();
}

async function sha256Hex(file, cryptoImpl) {
  if (typeof file?.arrayBuffer !== "function" || typeof cryptoImpl?.subtle?.digest !== "function") {
    throw new Error("This browser cannot safely fingerprint the receipt file");
  }
  const bytes = await cryptoImpl.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function validateReceiptFile(file) {
  if (!file || typeof file.name !== "string" || !ALLOWED_RECEIPT_TYPES.has(file.type)) {
    throw new RangeError("Receipt must be a JPEG, PNG, WebP, HEIC, or PDF file");
  }
  if (!Number.isInteger(file.size) || file.size < 1 || file.size > MAX_RECEIPT_BYTES) {
    throw new RangeError("Receipt file must be between 1 byte and 10 MB");
  }
}

async function removePrivateObject(bucket, objectPath) {
  try {
    const result = await bucket.remove([objectPath]);
    if (result?.error) throw new Error(errorMessage(result.error, "storage rejected cleanup"));
  } catch (error) {
    const cleanupError = new Error(`Receipt was saved safely, but a temporary private upload could not be removed. Retry cleanup before uploading again: ${errorMessage(error, "cleanup failed")}`);
    cleanupError.cleanupPath = objectPath;
    throw cleanupError;
  }
}

export function createExpenseService(db, options = {}) {
  if (!db?.from || !db?.rpc || !db?.storage || !db?.auth) throw new Error("Supabase client is unavailable");
  const cryptoImpl = options.cryptoImpl || globalThis.crypto;

  async function fetchOne(id, expectedUserId) {
    const { data, error } = await db.from("quickflex_expenses").select(EXPENSE_SELECT).eq("id", id).eq("user_id", expectedUserId).single();
    if (error) throw new Error(errorMessage(error, "Expense could not be loaded"));
    if (await requireUserId(db) !== expectedUserId) throw new Error("Account changed while loading the expense");
    return normalizeExpenseRow(data);
  }

  async function collectRows(buildQuery) {
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await buildQuery().range(offset, offset + 999);
      if (error) throw new Error(errorMessage(error, "Expenses could not be loaded"));
      rows.push(...(data || []));
      if ((data || []).length < 1000) return rows;
    }
  }

  return {
    async list({ from, to, includeDrafts = true, includeTrashed = false } = {}) {
      const userId = await requireUserId(db);
      const base = () => {
        let query = db.from("quickflex_expenses").select(EXPENSE_SELECT).eq("user_id", userId)
          .order("actual_date", { ascending: false }).order("created_at", { ascending: false });
        if (!includeTrashed) query = query.neq("status", "trashed");
        return query;
      };
      const dated = () => {
        let query = base().not("actual_date", "is", null);
        if (from) query = query.gte("actual_date", from);
        if (to) query = query.lte("actual_date", to);
        if (!includeDrafts) query = query.neq("status", "draft");
        return query;
      };
      const rows = await collectRows((from || to)
        ? dated
        : () => {
          const query = base();
          return includeDrafts ? query : query.neq("status", "draft");
        });
      if (includeDrafts && (from || to)) {
        rows.push(...await collectRows(() => base().eq("status", "draft").is("actual_date", null)));
      }
      if (await requireUserId(db) !== userId) throw new Error("Account changed while loading expenses");
      return [...new Map(rows.map((row) => [row.id, normalizeExpenseRow(row)])).values()]
        .sort((a, b) => String(b.actual_date || "").localeCompare(String(a.actual_date || "")) || String(b.created_at || "").localeCompare(String(a.created_at || "")));
    },

    async save(input) {
      const userId = await requireUserId(db);
      const expense = normalizeExpenseSaveInput(input, cryptoImpl);
      const { data, error } = await db.rpc("quickflex_save_expense", {
        p_id: expense.id, p_actual_date: expense.actual_date, p_gross_amount: expense.gross_amount,
        p_category: expense.category, p_merchant: expense.merchant, p_payment_method: expense.payment_method,
        p_evidence_type: expense.evidence_type, p_memo: expense.memo, p_supply_amount: expense.supply_amount,
        p_vat_amount: expense.vat_amount, p_business_amount: expense.business_amount, p_usage_type: expense.usage_type,
        p_status: expense.status, p_request_id: expense.request_id,
      });
      if (error || !isExpenseUuid(data)) throw new Error(errorMessage(error, "Expense could not be saved"));
      return fetchOne(data, userId);
    },

    async addReceipt(expenseId, file) {
      if (!isExpenseUuid(expenseId)) throw new RangeError("Invalid expense ID");
      validateReceiptFile(file);
      const userId = await requireUserId(db);
      const sha256 = await sha256Hex(file, cryptoImpl);
      const current = await fetchOne(expenseId, userId);
      const existing = current.receipts.find((receipt) => receipt.sha256 === sha256);
      if (existing) return current;

      const receiptId = createExpenseRequestId(cryptoImpl);
      const objectPath = `${userId}/${receiptId}`;
      const bucket = db.storage.from(EXPENSE_BUCKET);
      const uploaded = await bucket.upload(objectPath, file, { contentType: file.type, upsert: false });
      if (uploaded?.error) throw new Error(`Receipt upload failed: ${errorMessage(uploaded.error, "storage rejected the file")}`);

      try {
        const { error } = await db.rpc("quickflex_add_expense_receipt", {
          p_expense_id: expenseId, p_object_path: objectPath, p_original_name: file.name,
          p_content_type: file.type, p_byte_size: file.size, p_sha256: sha256,
        });
        if (error) throw new Error(errorMessage(error, "Receipt metadata could not be saved"));
      } catch (error) {
        // The binary is private, but remove it when its immutable metadata did not commit.
        try {
          await removePrivateObject(bucket, objectPath);
        } catch (cleanupError) {
          throw cleanupError;
        }
        throw error;
      }
      const saved = await fetchOne(expenseId, userId);
      const accepted = saved.receipts.find((receipt) => receipt.sha256 === sha256);
      if (!accepted) {
        try {
          await removePrivateObject(bucket, objectPath);
        } catch (cleanupError) {
          throw cleanupError;
        }
        throw new Error("Receipt metadata did not persist. Upload it again.");
      }
      if (accepted.object_path !== objectPath) {
        await removePrivateObject(bucket, objectPath);
      }
      return saved;
    },

    async receiptUrl(receipt) {
      if (!receipt?.object_path || !isExpenseUuid(receipt.id)) throw new RangeError("Invalid receipt metadata");
      const { data, error } = await db.storage.from(EXPENSE_BUCKET).createSignedUrl(receipt.object_path, 60);
      if (error || !data?.signedUrl) throw new Error(errorMessage(error, "Receipt preview URL could not be created"));
      return data.signedUrl;
    },

    async cleanupOrphan(objectPath) {
      if (typeof objectPath !== "string" || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(objectPath)) {
        throw new RangeError("Invalid private receipt object path");
      }
      const userId = await requireUserId(db);
      if (!objectPath.toLowerCase().startsWith(`${userId}/`)) throw new Error("Receipt cleanup is limited to the current account");
      await removePrivateObject(db.storage.from(EXPENSE_BUCKET), objectPath);
      if (await requireUserId(db) !== userId) throw new Error("Account changed while cleaning up a receipt");
      return true;
    },

    async adjust(expenseId, input) {
      if (!isExpenseUuid(expenseId)) throw new RangeError("Invalid expense ID");
      const userId = await requireUserId(db);
      const adjustment = normalizeExpenseAdjustment(input, cryptoImpl);
      const { error } = await db.rpc("quickflex_add_expense_adjustment", {
        p_expense_id: expenseId, p_kind: adjustment.kind, p_amount: adjustment.amount,
        p_actual_date: adjustment.actual_date, p_memo: adjustment.memo, p_request_id: adjustment.request_id,
      });
      if (error) throw new Error(errorMessage(error, "Expense adjustment could not be saved"));
      return fetchOne(expenseId, userId);
    },

    async setStatus(id, status) {
      if (!isExpenseUuid(id) || !["trashed", "restore"].includes(status)) throw new RangeError("Invalid expense status action");
      const userId = await requireUserId(db);
      const { error } = await db.rpc("quickflex_set_expense_status", { p_expense_id: id, p_status: status });
      if (error) throw new Error(errorMessage(error, "Expense status could not be changed"));
      return fetchOne(id, userId);
    },
  };
}
