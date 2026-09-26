"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { calculateReconciliationDifferenceVnd } from "@/lib/finance/calculations";
import { addDays, parseVnd } from "@/lib/finance/format";
import { loadOwnerDailyRecords } from "@/lib/ledger/owner-daily-records";

export type EntryActionState = { error?: string; success?: string } | undefined;

const dateSchema = z.iso.date().refine((date) => date >= "2026-09-01", "Sổ bắt đầu từ 01/09/2026.");
const revenueFields = [
  "shift_06_10_vnd", "shift_10_14_vnd", "shift_14_18_vnd", "shift_18_22_vnd", "grab_vnd", "shopee_vnd",
] as const;

function parseMeterValue(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function saveDailyRecord(_state: EntryActionState, formData: FormData): Promise<EntryActionState> {
  const businessDate = formData.get("business_date");
  const status = formData.get("business_status");
  const note = formData.get("note");
  const reconciliationStatus = formData.get("reconciliation_status");
  const bluebookTotal = parseVnd(formData.get("bluebook_total_vnd"));
  const reconciliationNote = formData.get("reconciliation_note");
  const meterResetReasonValue = formData.get("electricity_reset_reason");
  const meterResetReason = typeof meterResetReasonValue === "string" ? meterResetReasonValue.trim() : "";
  const parseMeter = (value: FormDataEntryValue | null) => {
    if (typeof value !== "string" || value.trim() === "") return null;
    const result = Number(value.trim().replace(",", "."));
    return Number.isFinite(result) && result >= 0 && result <= 99999999999.999 ? result : Number.NaN;
  };
  const morningMeter = parseMeter(formData.get("electricity_morning_kwh"));
  const eveningMeter = parseMeter(formData.get("electricity_evening_kwh"));
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
  if (meterResetReason.length > 240 || (meterResetReason && meterResetReason.length < 2)) return { error: "Lý do reset công tơ cần dài từ 2 đến 240 ký tự." };
  if (Number.isNaN(morningMeter) || Number.isNaN(eveningMeter)) return { error: "Chỉ số điện cần là số không âm, tối đa 3 chữ số thập phân." };
  if (cleaningDone === "invalid" || arrangementDone === "invalid") return { error: "Chọn trạng thái vệ sinh và sắp xếp hợp lệ." };

  const values = Object.fromEntries(revenueFields.map((field) => [field, parseVnd(formData.get(field))])) as Record<typeof revenueFields[number], number | null>;
  if (revenueFields.some((field) => Number.isNaN(values[field]))) return { error: "Số tiền cần là số nguyên không âm. Ví dụ: 1.250.000." };
  if (status === "closed" && revenueFields.some((field) => values[field] === null)) {
    return { error: "Muốn chốt ngày, hãy nhập đủ bốn ca, Grab và Shopee. Nếu nghỉ, chọn ‘Không kinh doanh’." };
  }
  if (status === "no_business") {
    for (const field of revenueFields) values[field] = 0;
  }
  const isReconciled = reconciliationStatus === "matched" || reconciliationStatus === "discrepancy";
  if (reconciliationStatus === "discrepancy" && (typeof reconciliationNote !== "string" || reconciliationNote.trim().length < 2)) {
    return { error: "Khi đánh dấu lệch, hãy ghi lý do để tiện đối chiếu lại." };
  }
  if (isReconciled && bluebookTotal === null) return { error: "Nhập tổng Bluebook trước khi đánh dấu khớp hoặc lệch." };
  if (isReconciled && status !== "no_business" && revenueFields.some((field) => values[field] === null)) {
    return { error: "Nhập đủ bốn ca, Grab và Shopee trước khi đối chiếu với Bluebook." };
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
  const monthStart = `${parsedDate.data.slice(0, 7)}-01`;
  const monthLastDay = new Date(Date.UTC(Number(parsedDate.data.slice(0, 4)), Number(parsedDate.data.slice(5, 7)), 0)).getUTCDate();
  const monthEnd = `${parsedDate.data.slice(0, 7)}-${String(monthLastDay).padStart(2, "0")}`;
  const [previousMorningResult, previousEveningResult, monthRecordsResult] = await Promise.all([
    owner.supabase.from("daily_records").select("business_date,electricity_morning_kwh").eq("owner_id", owner.ownerId).lt("business_date", monthStart).not("electricity_morning_kwh", "is", null).order("business_date", { ascending: false }).limit(1),
    owner.supabase.from("daily_records").select("business_date,electricity_evening_kwh").eq("owner_id", owner.ownerId).lt("business_date", monthStart).not("electricity_evening_kwh", "is", null).order("business_date", { ascending: false }).limit(1),
    loadOwnerDailyRecords(owner.supabase, owner.ownerId, { start: monthStart, end: monthEnd }),
  ]);
  if (previousMorningResult.error || previousEveningResult.error || monthRecordsResult.error) {
    return { error: "Chưa kiểm tra được lịch sử công tơ. Hãy thử lưu lại sau." };
  }
  const previousPoints = [
    ...(previousMorningResult.data ?? []).map((row) => ({ date: row.business_date, slot: 0, value: Number(row.electricity_morning_kwh) })),
    ...(previousEveningResult.data ?? []).map((row) => ({ date: row.business_date, slot: 1, value: Number(row.electricity_evening_kwh) })),
  ].sort((left, right) => right.date.localeCompare(left.date) || right.slot - left.slot);
  const currentMonthRows: Array<Pick<typeof monthRecordsResult.data[number], "business_date" | "electricity_morning_kwh" | "electricity_evening_kwh" | "electricity_reset_reason">> = monthRecordsResult.data
    .filter((row) => row.business_date !== parsedDate.data);
  currentMonthRows.push({
    business_date: parsedDate.data,
    electricity_morning_kwh: morningMeter,
    electricity_evening_kwh: eveningMeter,
    electricity_reset_reason: meterResetReason || null,
  });
  currentMonthRows.sort((left, right) => left.business_date.localeCompare(right.business_date));
  const meterPoints: Array<{ date: string; slot: number; value: number; resetReason: string | null }> = [];
  const priorPoint = previousPoints[0];
  if (priorPoint) meterPoints.push({ date: priorPoint.date, slot: priorPoint.slot, value: priorPoint.value, resetReason: null });
  for (const row of currentMonthRows) {
    const morning = parseMeterValue(row.electricity_morning_kwh);
    const evening = parseMeterValue(row.electricity_evening_kwh);
    if (morning !== null) meterPoints.push({ date: row.business_date, slot: 0, value: morning, resetReason: row.electricity_reset_reason });
    if (evening !== null) meterPoints.push({ date: row.business_date, slot: 1, value: evening, resetReason: row.electricity_reset_reason });
  }
  meterPoints.sort((left, right) => left.date.localeCompare(right.date) || left.slot - right.slot);
  let previousMeter: number | null = null;
  let currentDateHasReset = false;
  for (const point of meterPoints) {
    if (previousMeter !== null && point.value < previousMeter) {
      if (point.date === parsedDate.data) currentDateHasReset = true;
      else if (!point.resetReason) return { error: `Chỉ số điện giảm tại ngày ${point.date}. Mở sổ ngày đó và ghi lý do reset trước khi lưu tiếp.` };
    }
    previousMeter = point.value;
  }
  if (currentDateHasReset && meterResetReason.length < 2) {
    return { error: "Chỉ số điện thấp hơn lần ghi trước. Hãy nhập lý do thay hoặc reset công tơ." };
  }
  if (!currentDateHasReset && meterResetReason) {
    return { error: "Chỉ nhập lý do khi chỉ số điện trong ngày thấp hơn lần ghi trước." };
  }
  const { error } = await owner.supabase.rpc("save_owner_daily_record", {
    p_business_date: parsedDate.data,
    p_business_status: status,
    p_shift_06_10_vnd: values.shift_06_10_vnd,
    p_shift_10_14_vnd: values.shift_10_14_vnd,
    p_shift_14_18_vnd: values.shift_14_18_vnd,
    p_shift_18_22_vnd: values.shift_18_22_vnd,
    p_grab_vnd: values.grab_vnd,
    p_shopee_vnd: values.shopee_vnd,
    p_electricity_morning_kwh: morningMeter,
    p_electricity_evening_kwh: eveningMeter,
    p_cleaning_done: cleaningDone,
    p_arrangement_done: arrangementDone,
    p_note: typeof note === "string" && note.trim() ? note.trim() : null,
    p_reconciliation_status: reconciliationStatus,
    p_bluebook_total_vnd: isReconciled ? bluebookTotal : null,
    p_reconciliation_difference_vnd: reconciliationDifference,
    p_reconciliation_note: typeof reconciliationNote === "string" && reconciliationNote.trim() ? reconciliationNote.trim() : null,
    p_electricity_reset_reason: currentDateHasReset ? meterResetReason : null,
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
  const { error } = await owner.supabase.rpc("owner_add_daily_expense", {
    p_business_date: date.data,
    p_amount_vnd: amount,
    p_reason: reason.trim(),
  });
  if (error) return { error: "Chưa lưu được chi phí phát sinh. Hãy thử lại." };
  revalidatePath("/");
  revalidatePath("/ledger");
  revalidatePath(`/ledger/${date.data}`);
  revalidatePath("/reports");
  return { success: "Đã thêm chi phí phát sinh." };
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
