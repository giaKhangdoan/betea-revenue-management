"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { calculateReconciliationDifferenceVnd } from "@/lib/finance/calculations";
import { addDays, currentBusinessDate, parseVnd } from "@/lib/finance/format";
import { loadFinalizedExpenseMatches, type FinalizedPurchaseExpenseMatch } from "@/lib/owner-advances/loaders";
import { electricityDeviceTimeError } from "@/lib/electricity/device-time-validation";

export type EntryActionState = {
  error?: string;
  success?: string;
  duplicateCandidates?: FinalizedPurchaseExpenseMatch[];
  duplicateReviewKey?: string;
} | undefined;

const dateSchema = z.iso.date().refine((date) => date >= "2026-09-01", "Sổ bắt đầu từ 01/09/2026.");
const revenueFields = [
  "shift_06_10_vnd", "shift_10_14_vnd", "shift_14_18_vnd", "shift_18_22_vnd", "grab_vnd", "shopee_vnd",
] as const;
const shiftRevenueFields = [
  "shift_06_10_vnd", "shift_10_14_vnd", "shift_14_18_vnd", "shift_18_22_vnd",
] as const;
const deliveryRevenueFields = ["grab_vnd", "shopee_vnd"] as const;
const electricityTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const electricityDeviceFields = ["operating_status", "started_at", "ended_at", "ends_next_day", "ran_from_previous_night", "remains_on_after_close", "note"] as const;
const electricityDeviceLogSchema = z.object({
  device_id: z.uuid(),
  device_mode: z.enum(["timed", "continuous"]),
  operating_status: z.enum(["unrecorded", "not_running", "running"]),
  started_at: electricityTimeSchema.nullable(),
  ended_at: electricityTimeSchema.nullable(),
  ends_next_day: z.boolean(),
  ran_from_previous_night: z.boolean().nullable(),
  remains_on_after_close: z.boolean().nullable(),
  note: z.string().max(240).nullable(),
  changed_fields: z.array(z.enum(electricityDeviceFields)).max(electricityDeviceFields.length).optional(),
});
const electricityChecklistSchema = z.object({
  turned_off_unneeded: z.boolean().nullable(),
  checked_cooler_doors: z.boolean().nullable(),
  meter_photo_confirmed: z.boolean().nullable(),
});

function parseElectricityKwh(value: unknown): number | null | undefined {
  if (typeof value !== "string") return value === null ? null : undefined;
  const raw = value.trim();
  if (!raw) return null;
  const normalized = raw.replace(",", ".");
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed <= 99_999_999_999.999 ? parsed : undefined;
}

function safeParseJson<TSchema extends z.ZodType>(raw: unknown, schema: TSchema) {
  if (typeof raw !== "string") return schema.safeParse(undefined);
  try { return schema.safeParse(JSON.parse(raw)); } catch { return schema.safeParse(undefined); }
}

export async function saveDailyRecord(_state: EntryActionState, formData: FormData): Promise<EntryActionState> {
  const businessDate = formData.get("business_date");
  const status = formData.get("business_status");
  const note = formData.get("note");
  const reconciliationStatus = formData.get("reconciliation_status");
  const bluebookTotal = parseVnd(formData.get("bluebook_total_vnd"));
  const reconciliationNote = formData.get("reconciliation_note");
  const parseChecklist = (value: FormDataEntryValue | null) => value === "yes" ? true : value === "no" ? false : value === "" || value === null ? null : "invalid";
  const cleaningDone = parseChecklist(formData.get("cleaning_done"));
  const arrangementDone = parseChecklist(formData.get("arrangement_done"));
  const parsedDate = dateSchema.safeParse(businessDate);
  if (!parsedDate.success) return { error: parsedDate.error.issues[0]?.message ?? "Ngày không hợp lệ." };
  if (status !== "open" && status !== "closed" && status !== "no_business") {
    return { error: "Chọn trạng thái ngày hợp lệ." };
  }
  if (reconciliationStatus !== "unreconciled" && reconciliationStatus !== "pending" && reconciliationStatus !== "matched" && reconciliationStatus !== "discrepancy") {
    return { error: "Chọn trạng thái đối soát hợp lệ." };
  }
  if (Number.isNaN(bluebookTotal)) return { error: "Tổng Bluebook phải là số nguyên không âm." };
  if (note !== null && (typeof note !== "string" || note.length > 1000)) return { error: "Ghi chú tối đa 1.000 ký tự." };
  if (reconciliationNote !== null && (typeof reconciliationNote !== "string" || reconciliationNote.length > 240)) return { error: "Ghi chú chênh lệch tối đa 240 ký tự." };
  if (cleaningDone === "invalid" || arrangementDone === "invalid") return { error: "Chọn trạng thái vệ sinh và sắp xếp hợp lệ." };

  const values = Object.fromEntries(revenueFields.map((field) => [field, parseVnd(formData.get(field))])) as Record<typeof revenueFields[number], number | null>;
  if (revenueFields.some((field) => Number.isNaN(values[field]))) return { error: "Số tiền cần là số nguyên không âm. Ví dụ: 1.250.000." };
  if (status !== "no_business") {
    for (const field of deliveryRevenueFields) values[field] ??= 0;
  }
  if (status === "closed" && shiftRevenueFields.some((field) => values[field] === null)) {
    return { error: "Muốn chốt ngày, hãy nhập đủ bốn ca. Grab/Shopee không phát sinh có thể để trống." };
  }
  if (status === "no_business") {
    for (const field of revenueFields) values[field] = 0;
  }
  const isReconciled = reconciliationStatus === "matched" || reconciliationStatus === "discrepancy";
  if (reconciliationStatus === "discrepancy" && (typeof reconciliationNote !== "string" || reconciliationNote.trim().length < 2)) {
    return { error: "Khi đánh dấu lệch, hãy ghi lý do để tiện đối chiếu lại." };
  }
  if (isReconciled && bluebookTotal === null) return { error: "Nhập tổng Bluebook trước khi đánh dấu khớp hoặc lệch." };
  if (isReconciled && status !== "no_business" && shiftRevenueFields.some((field) => values[field] === null)) {
    return { error: "Nhập đủ bốn ca trước khi đối chiếu với Bluebook. Grab/Shopee để trống được tính 0." };
  }
  const websiteDailyTotal = status === "no_business" ? 0 : revenueFields.reduce((sum, field) => sum + (values[field] ?? 0), 0);
  const reconciliationDifference = isReconciled && bluebookTotal !== null
    ? calculateReconciliationDifferenceVnd(bluebookTotal, websiteDailyTotal)
    : null;
  if (reconciliationStatus === "matched" && reconciliationDifference !== 0) {
    return { error: "Tổng Bluebook chưa khớp với website. Chọn “Lệch” để lưu chênh lệch tự tính." };
  }
  if (reconciliationStatus === "discrepancy" && reconciliationDifference === 0) {
    return { error: "Tổng Bluebook bằng website. Chọn “Khớp” để lưu kết quả." };
  }

  const owner = await requireOwnerClient();
  if (!owner) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };
  const { error } = await owner.supabase.rpc("save_owner_daily_record", {
    p_business_date: parsedDate.data,
    p_business_status: status,
    p_shift_06_10_vnd: values.shift_06_10_vnd,
    p_shift_10_14_vnd: values.shift_10_14_vnd,
    p_shift_14_18_vnd: values.shift_14_18_vnd,
    p_shift_18_22_vnd: values.shift_18_22_vnd,
    p_grab_vnd: values.grab_vnd,
    p_shopee_vnd: values.shopee_vnd,
    p_electricity_morning_kwh: null,
    p_electricity_evening_kwh: null,
    p_cleaning_done: cleaningDone,
    p_arrangement_done: arrangementDone,
    p_note: typeof note === "string" && note.trim() ? note.trim() : null,
    p_reconciliation_status: reconciliationStatus,
    p_bluebook_total_vnd: isReconciled ? bluebookTotal : null,
    p_reconciliation_difference_vnd: reconciliationDifference,
    p_reconciliation_note: typeof reconciliationNote === "string" && reconciliationNote.trim() ? reconciliationNote.trim() : null,
    p_electricity_reset_reason: null,
  });

  if (error) return { error: "Chưa lưu được ngày này. Hãy kiểm tra kết nối rồi thử lại." };
  revalidatePath("/");
  revalidatePath("/ledger");
  revalidatePath(`/ledger/${parsedDate.data}`);
  revalidatePath(`/ledger/${addDays(parsedDate.data, -1)}`);
  revalidatePath(`/ledger/${addDays(parsedDate.data, 1)}`);
  revalidatePath("/reports");
  return { success: "Đã lưu sổ ngày." };
}

export async function saveOwnerElectricityPeriod(_state: EntryActionState, formData: FormData): Promise<EntryActionState> {
  const parsedDate = dateSchema.safeParse(formData.get("business_date"));
  const period = formData.get("period");
  const statusValue = formData.get("status");
  if (!parsedDate.success || (period !== "morning" && period !== "evening")) return { error: "Ngày hoặc kỳ ghi điện không hợp lệ." };
  if (statusValue !== "" && statusValue !== "recorded" && statusValue !== "unable") return { error: "Tình trạng ghi điện không hợp lệ." };
  const status = statusValue as "" | "recorded" | "unable";

  const owner = await requireOwnerClient();
  if (!owner) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };

  const meterFieldsChanged = formData.get("meter_fields_changed") === "true";
  const recordedAtValue = meterFieldsChanged ? formData.get("recorded_at") : "";
  const recordedAtText = typeof recordedAtValue === "string" ? recordedAtValue.trim() : "";
  const meterKwh = meterFieldsChanged ? parseElectricityKwh(formData.get("meter_kwh")) : null;
  const unavailableValue = meterFieldsChanged ? formData.get("unavailable_reason") : "";
  const unavailableReason = typeof unavailableValue === "string" ? unavailableValue.trim() : "";
  const noteValue = formData.get("note");
  const note = typeof noteValue === "string" ? noteValue.trim() : "";
  const noteChanged = formData.get("note_changed") === "true";
  const resetValue = formData.get("reset_reason");
  const resetReason = typeof resetValue === "string" ? resetValue.trim() : "";
  const resetReasonChanged = formData.get("reset_reason_changed") === "true";
  const editValue = formData.get("edit_reason");
  const editReason = typeof editValue === "string" ? editValue.trim() : "";

  if (meterFieldsChanged && meterKwh === undefined) return { error: "Chỉ số công tơ cần là số không âm, tối đa 3 chữ số thập phân." };
  if (meterFieldsChanged && recordedAtText && !electricityTimeSchema.safeParse(recordedAtText).success) return { error: "Giờ ghi chỉ số chưa hợp lệ." };
  if (note.length > 500) return { error: "Ghi chú tối đa 500 ký tự." };
  if (resetReason && (resetReason.length < 2 || resetReason.length > 240)) return { error: "Lý do reset công tơ cần dài từ 2 đến 240 ký tự." };
  if (meterFieldsChanged && status === "recorded" && (!recordedAtText || meterKwh === null)) return { error: "Trạng thái Đã ghi cần có giờ ghi và chỉ số công tơ." };
  if (meterFieldsChanged && status === "unable" && (unavailableReason.length < 2 || unavailableReason.length > 240)) return { error: "Hãy nhập lý do không ghi nhận được, từ 2 đến 240 ký tự." };
  if (meterFieldsChanged && status !== "recorded" && (recordedAtText || meterKwh !== null)) return { error: "Chỉ nhập giờ và chỉ số khi chọn Đã ghi." };
  if (meterFieldsChanged && status !== "unable" && unavailableReason) return { error: "Chỉ nhập lý do khi chọn Không ghi nhận được." };
  if (parsedDate.data < currentBusinessDate() && (editReason.length < 5 || editReason.length > 500)) {
    return { error: "Sửa nhật ký điện ngày cũ cần ghi lý do từ 5 đến 500 ký tự." };
  }

  const deviceLogsResult = safeParseJson(formData.get("device_logs_json"), z.array(electricityDeviceLogSchema).max(50));
  const checklistResult = safeParseJson(formData.get("checklist_json"), electricityChecklistSchema);
  if (!deviceLogsResult.success || !checklistResult.success) return { error: "Thông tin thiết bị hoặc checklist chưa đúng định dạng." };
  const deviceLogs = deviceLogsResult.data;
  if (new Set(deviceLogs.map((log) => log.device_id)).size !== deviceLogs.length) return { error: "Danh sách thiết bị bị trùng. Tải lại trang rồi thử lại." };
  for (const log of deviceLogs) {
    if (log.device_mode === "continuous" && (log.started_at || log.ended_at || log.ends_next_day)) {
      return { error: "Thiết bị chạy liên tục không cần giờ bật/tắt." };
    }
    if (log.operating_status !== "running" && (log.started_at || log.ended_at || log.ends_next_day)) {
      return { error: "Chỉ nhập giờ bật/tắt khi thiết bị có hoạt động." };
    }
    if (log.ends_next_day && period !== "evening") return { error: "Giờ tắt sang ngày hôm sau chỉ áp dụng cho ca tối." };
    if ((period === "morning" && log.remains_on_after_close !== null) || (period === "evening" && log.ran_from_previous_night !== null)) {
      return { error: "Thông tin thiết bị không khớp kỳ ghi điện." };
    }
    if (!log.changed_fields || log.changed_fields.some((field) => field !== "note")) {
      const timeError = electricityDeviceTimeError({
        period,
        mode: log.device_mode,
        status: log.operating_status,
        startedAt: log.started_at,
        endedAt: log.ended_at,
        endsNextDay: log.ends_next_day,
        ranFromPreviousNight: log.ran_from_previous_night,
        remainsOnAfterClose: log.remains_on_after_close,
      });
      if (timeError) return { error: timeError };
    }
  }

  const { error } = await owner.supabase.rpc("owner_save_electricity_period", {
    p_business_date: parsedDate.data,
    p_period: period,
    p_status: meterFieldsChanged ? status || "unrecorded" : null,
    p_recorded_at: meterFieldsChanged && status === "recorded" ? recordedAtText : null,
    p_meter_kwh: meterFieldsChanged && status === "recorded" ? meterKwh : null,
    p_unavailable_reason: meterFieldsChanged && status === "unable" ? unavailableReason : null,
    p_note: noteChanged ? note : null,
    p_device_logs: deviceLogs,
    p_checklist: period === "evening" ? checklistResult.data : null,
    p_reset_reason: resetReasonChanged ? resetReason : null,
    p_edit_reason: parsedDate.data < currentBusinessDate() ? editReason : null,
  });

  if (error) {
    if (error.message.includes("historical electricity")) return { error: "Sửa nhật ký điện ngày cũ cần ghi lý do từ 5 đến 500 ký tự." };
    if (error.message.includes("reset reason") || error.message.includes("meter decreases")) return { error: "Chỉ số thấp hơn lần ghi trước. Hãy nhập lý do thay hoặc reset công tơ." };
    if (error.message.includes("later meter value decrease")) return { error: "Thay đổi này làm chỉ số ở kỳ sau bị giảm. Hãy kiểm tra và sửa kỳ sau trước." };
    if (error.message.includes("settings changed")) return { error: "Danh sách thiết bị vừa thay đổi. Tải lại trang rồi thử lại." };
    return { error: "Chưa lưu được nhật ký điện. Hãy kiểm tra dữ liệu và thử lại." };
  }

  revalidatePath("/");
  revalidatePath("/ledger");
  revalidatePath(`/ledger/${parsedDate.data}`);
  revalidatePath(`/ledger/${addDays(parsedDate.data, -1)}`);
  revalidatePath(`/ledger/${addDays(parsedDate.data, 1)}`);
  revalidatePath("/costs");
  revalidatePath("/reports");
  return { success: `Đã lưu ghi nhận ${period === "morning" ? "ca sáng" : "ca tối"}.` };
}

export async function saveOwnerElectricityDeviceAction(_state: EntryActionState, formData: FormData): Promise<EntryActionState> {
  const date = dateSchema.safeParse(formData.get("business_date"));
  const rawId = formData.get("device_id");
  const deviceId = rawId === "" ? null : z.uuid().safeParse(rawId);
  const nameValue = formData.get("name");
  const mode = formData.get("mode");
  const orderValue = formData.get("sort_order");
  const activeValue = formData.get("active");
  if (!date.success || (deviceId !== null && !deviceId.success)) return { error: "Ngày hoặc thiết bị không hợp lệ." };
  if (typeof nameValue !== "string" || nameValue.trim().length < 2 || nameValue.trim().length > 80) {
    return { error: "Tên thiết bị cần dài từ 2 đến 80 ký tự." };
  }
  if (mode !== "timed" && mode !== "continuous") return { error: "Chọn cách theo dõi thiết bị hợp lệ." };
  if (typeof orderValue !== "string" || !/^\d{1,9}$/.test(orderValue.trim())) return { error: "Thứ tự hiển thị cần là số nguyên không âm." };
  const sortOrder = Number(orderValue);
  if (!Number.isSafeInteger(sortOrder) || sortOrder > 2_147_483_647) return { error: "Thứ tự hiển thị vượt giới hạn." };
  if (activeValue !== "true" && activeValue !== "false") return { error: "Chọn trạng thái theo dõi hợp lệ." };

  const owner = await requireOwnerClient();
  if (!owner) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };
  const { error } = await owner.supabase.rpc("owner_save_electricity_device", {
    p_device_id: deviceId === null ? null : deviceId.data,
    p_name: nameValue.trim(),
    p_mode: mode,
    p_sort_order: sortOrder,
    p_active: activeValue === "true",
  });
  if (error) {
    if (error.code === "23505") return { error: "Tên thiết bị này đã có trong danh mục. Hãy dùng tên khác." };
    if (error.message.includes("Invalid electricity device settings")) return { error: "Thông tin thiết bị không hợp lệ. Kiểm tra tên, cách theo dõi và thứ tự." };
    return { error: "Chưa lưu được thiết bị. Tải lại danh mục rồi thử lại." };
  }

  revalidatePath("/ledger");
  revalidatePath(`/ledger/${date.data}`);
  revalidatePath("/staff/entry");
  return { success: activeValue === "true" ? "Đã lưu thiết bị đang theo dõi." : "Đã lưu trữ thiết bị. Nhật ký cũ vẫn được giữ." };
}

export async function addDailyExpense(_state: EntryActionState, formData: FormData): Promise<EntryActionState> {
  const date = dateSchema.safeParse(formData.get("business_date"));
  const amount = parseVnd(formData.get("amount_vnd"));
  const reason = formData.get("reason");
  if (!date.success) return { error: "Ngày phát sinh không hợp lệ." };
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "Nhập số tiền lớn hơn 0." };
  if (typeof reason !== "string" || reason.trim().length < 2 || reason.trim().length > 240) {
    return { error: "Ghi lý do từ 2 đến 240 ký tự." };
  }

  const owner = await requireOwnerClient();
  if (!owner) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };

  if (formData.get("review_as_different_purchase") === "yes") {
    const voucherIds = z.array(z.uuid()).min(1).max(1000).safeParse(readJsonFormField(formData, "matched_voucher_ids"));
    const reviewReasonValue = formData.get("duplicate_review_reason");
    const reviewReason = typeof reviewReasonValue === "string" ? reviewReasonValue.trim() : "";
    const reviewKey = z.uuid().safeParse(formData.get("duplicate_review_key"));
    if (!voucherIds.success || reviewReason.length < 5 || reviewReason.length > 500 || !reviewKey.success) {
      return { error: "Kiểm tra lại danh sách phiếu và ghi lý do xác nhận giao dịch khác từ 5 đến 500 ký tự." };
    }
    const { error } = await owner.supabase.rpc("owner_add_daily_expense_after_duplicate_review", {
      p_business_date: date.data,
      p_amount_vnd: amount,
      p_reason: reason.trim(),
      p_matched_voucher_ids: voucherIds.data,
      p_review_reason: reviewReason,
      p_idempotency_key: reviewKey.data,
    });
    if (error) {
      const { candidates, error: lookupError } = await loadFinalizedExpenseMatches(owner.supabase, owner.ownerId, date.data, amount, reason.trim());
      if (lookupError) return { error: "Chưa tải đủ phiếu mua để xác nhận an toàn. Tải lại ngày rồi thử lại." };
      return {
        error: error.message.includes("changed")
          ? "Danh sách phiếu trùng đã thay đổi. Kiểm tra lại các phiếu hiện tại trước khi lưu."
          : "Chưa lưu được khoản chi đã đối chiếu. Chưa có thay đổi một phía nào được áp dụng.",
        duplicateCandidates: candidates,
        duplicateReviewKey: randomUUID(),
      };
    }
    revalidatePath("/");
    revalidatePath("/ledger");
    revalidatePath(`/ledger/${date.data}`);
    revalidatePath("/reports");
    revalidatePath("/advances");
    return { success: "Đã lưu chi phí tiền quán và ghi lý do giao dịch khác cho từng phiếu mua khớp. Khoản chi này đã khóa sửa/xóa để giữ lịch sử đối chiếu." };
  }

  const { candidates, error: lookupError } = await loadFinalizedExpenseMatches(owner.supabase, owner.ownerId, date.data, amount, reason.trim());
  if (lookupError) return { error: "Chưa tải đủ phiếu mua để kiểm tra trùng. Chưa lưu khoản chi; hãy tải lại và thử lại." };
  if (candidates.length) return {
    error: "Khoản chi có thể trùng với phiếu mua cá nhân đã chốt. Kiểm tra danh sách bên dưới trước khi lưu.",
    duplicateCandidates: candidates,
    duplicateReviewKey: randomUUID(),
  };

  const { error } = await owner.supabase.rpc("owner_add_daily_expense", {
    p_business_date: date.data,
    p_amount_vnd: amount,
    p_reason: reason.trim(),
  });
  if (error?.message.includes("finalized purchase")) {
    const { candidates: refreshedCandidates, error: refreshedError } = await loadFinalizedExpenseMatches(owner.supabase, owner.ownerId, date.data, amount, reason.trim());
    return refreshedError
      ? { error: "Khoản chi trùng với phiếu mua đã chốt. Chưa lưu khoản chi; hãy tải lại để admin kiểm tra." }
      : { error: "Phiếu mua vừa được chốt trong lúc nhập. Kiểm tra các phiếu khớp bên dưới.", duplicateCandidates: refreshedCandidates, duplicateReviewKey: randomUUID() };
  }
  if (error) return { error: "Chưa lưu được chi phí phát sinh. Hãy thử lại." };
  revalidatePath("/");
  revalidatePath("/ledger");
  revalidatePath(`/ledger/${date.data}`);
  revalidatePath("/reports");
  return { success: "Đã thêm chi phí phát sinh." };
}

function readJsonFormField(formData: FormData, name: string): unknown {
  const raw = formData.get(name);
  if (typeof raw !== "string") return undefined;
  try { return JSON.parse(raw) as unknown; } catch { return undefined; }
}

export async function restoreDeletedShift(_state: EntryActionState, formData: FormData): Promise<EntryActionState> {
  const deletionId = z.uuid().safeParse(formData.get("deletion_id"));
  const date = dateSchema.safeParse(formData.get("business_date"));
  if (!deletionId.success || !date.success) return { error: "Bản ghi ca đã xóa không hợp lệ." };
  const owner = await requireOwnerClient();
  if (!owner) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };
  const { error } = await owner.supabase.rpc("owner_restore_shift_revenue", { p_deletion_id: deletionId.data });
  if (error) return { error: error.message.includes("already has") ? "Ca này đã có doanh thu mới, không ghi đè để tránh mất số liệu." : "Chưa khôi phục được doanh thu ca. Hãy tải lại và thử lại." };
  revalidatePath(`/ledger/${date.data}`);
  revalidatePath(`/ledger?date=${date.data}`);
  revalidatePath("/");
  revalidatePath("/reports");
  return { success: "Đã khôi phục doanh thu ca." };
}
