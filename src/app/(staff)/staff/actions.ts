"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { currentBusinessDate, parseVnd } from "@/lib/finance/format";
import { requireStaff } from "@/lib/auth/require-staff";

export type StaffEntryActionState = { error?: string; success?: string } | undefined;

const dateSchema = z.iso.date().refine((date) => date >= "2026-09-01", "Sổ bắt đầu từ 01/09/2026.");
const shiftCodes = ["06-10", "10-14", "14-18", "18-22"] as const;
const channels = ["grab", "shopee"] as const;
const electricityTimeSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "Giờ phải theo định dạng 24 giờ HH:mm.");
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

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function parseCount(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function parseElectricityKwh(value: string): number | null | undefined {
  if (value === "") return null;
  const normalized = value.replace(",", ".");
  if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed <= 99_999_999_999.999 ? parsed : undefined;
}

function parseJsonField<TSchema extends z.ZodType>(value: string, schema: TSchema) {
  try {
    return schema.safeParse(JSON.parse(value));
  } catch {
    return schema.safeParse(undefined);
  }
}

function revalidateStaff(date: string) {
  revalidatePath("/staff/dashboard");
  revalidatePath(`/staff/entry/${date}`);
  revalidatePath(`/ledger/${date}`);
  revalidatePath("/ledger");
  revalidatePath("/");
  revalidatePath("/reports");
}

export async function saveStaffElectricityPeriodAction(
  _state: StaffEntryActionState,
  formData: FormData,
): Promise<StaffEntryActionState> {
  const date = dateSchema.safeParse(textValue(formData, "business_date"));
  const period = textValue(formData, "period");
  const status = textValue(formData, "status");
  if (!date.success || !["morning", "evening"].includes(period)) return { error: "Ngày hoặc kỳ ghi điện không hợp lệ." };

  const staff = await requireStaff();
  if (!staff) return { error: "Tài khoản nhân viên không còn quyền truy cập hoặc phiên đã hết hạn." };
  if (date.data !== currentBusinessDate()) return { error: "Nhân viên chỉ được cập nhật nhật ký điện của ngày hiện tại." };

  const meterFieldsChanged = textValue(formData, "meter_fields_changed") === "true";
  const recordedAtText = meterFieldsChanged ? textValue(formData, "recorded_at") : "";
  const meterText = meterFieldsChanged ? textValue(formData, "meter_kwh") : "";
  const unavailableReason = meterFieldsChanged ? textValue(formData, "unavailable_reason") : "";
  const note = textValue(formData, "note");
  const noteChanged = textValue(formData, "note_changed") === "true";
  const recordedAt = recordedAtText || null;
  const meterKwh = parseElectricityKwh(meterText);
  if (meterKwh === undefined) return { error: "Chỉ số công tơ phải là số không âm, tối đa 3 chữ số thập phân." };
  if (recordedAt && !electricityTimeSchema.safeParse(recordedAt).success) return { error: "Giờ ghi chỉ số chưa hợp lệ." };
  if (note.length > 500) return { error: "Ghi chú tối đa 500 ký tự." };
  if (status !== "" && status !== "recorded" && status !== "unable") return { error: "Tình trạng ghi điện không hợp lệ." };
  if (meterFieldsChanged && status === "recorded" && (!recordedAt || meterKwh === null)) return { error: "Trạng thái Đã ghi cần có giờ ghi và chỉ số công tơ." };
  if (meterFieldsChanged && status === "unable" && (unavailableReason.length < 2 || unavailableReason.length > 240)) return { error: "Hãy ghi lý do không ghi nhận được, từ 2 đến 240 ký tự." };
  if (meterFieldsChanged && status !== "recorded" && (recordedAt || meterKwh !== null)) return { error: "Chỉ nhập giờ và chỉ số khi chọn Đã ghi." };
  if (meterFieldsChanged && status !== "unable" && unavailableReason) return { error: "Chỉ nhập lý do khi chọn Không ghi nhận được." };

  const logsResult = parseJsonField(textValue(formData, "device_logs_json"), z.array(electricityDeviceLogSchema).max(50));
  const checklistResult = parseJsonField(textValue(formData, "checklist_json"), electricityChecklistSchema);
  if (!logsResult.success || !checklistResult.success) return { error: "Thông tin thiết bị hoặc checklist chưa đúng định dạng." };
  const logs = logsResult.data;
  if (new Set(logs.map((log) => log.device_id)).size !== logs.length) return { error: "Danh sách thiết bị bị trùng. Hãy tải lại trang rồi thử lại." };
  for (const log of logs) {
    if (log.operating_status === "running" && log.device_mode === "timed" && (!log.started_at || !log.ended_at)) {
      return { error: "Thiết bị theo dõi giờ cần có cả giờ bật và giờ tắt." };
    }
    if (log.device_mode === "continuous" && (log.started_at || log.ended_at || log.ends_next_day)) {
      return { error: "Thiết bị chạy liên tục không cần giờ bật/tắt." };
    }
    if (log.operating_status !== "running" && (log.started_at || log.ended_at || log.ends_next_day)) {
      return { error: "Chỉ nhập giờ bật/tắt khi thiết bị có hoạt động." };
    }
    if ((period === "morning" && log.remains_on_after_close !== null) || (period === "evening" && log.ran_from_previous_night !== null)) {
      return { error: "Thông tin thiết bị không khớp kỳ ghi điện." };
    }
  }

  const checklist = period === "evening" ? checklistResult.data : null;
  const { error } = await staff.supabase.rpc("staff_save_electricity_period", {
    p_business_date: date.data,
    p_period: period,
    p_status: meterFieldsChanged ? status || "unrecorded" : null,
    p_recorded_at: meterFieldsChanged && status === "recorded" ? recordedAt : null,
    p_meter_kwh: meterFieldsChanged && status === "recorded" ? meterKwh : null,
    p_unavailable_reason: meterFieldsChanged && status === "unable" ? unavailableReason : null,
    p_note: noteChanged ? note : null,
    p_device_logs: logs,
    p_checklist: checklist,
  });

  if (error) {
    if (error.message.includes("today") || error.message.includes("edit today")) return { error: "Nhân viên chỉ được cập nhật nhật ký điện của ngày hiện tại." };
    return { error: "Chưa lưu được nhật ký điện. Hãy kiểm tra dữ liệu và thử lại." };
  }
  revalidateStaff(date.data);
  return { success: `Đã lưu ghi nhận ${period === "morning" ? "ca sáng" : "ca tối"}.` };
}

export async function saveStaffEntryAction(
  _state: StaffEntryActionState,
  formData: FormData,
): Promise<StaffEntryActionState> {
  const date = dateSchema.safeParse(textValue(formData, "business_date"));
  const kind = textValue(formData, "kind");
  if (!date.success) return { error: "Ngày nhập không hợp lệ." };

  const staff = await requireStaff();
  if (!staff) return { error: "Tài khoản nhân viên không còn quyền truy cập hoặc phiên đã hết hạn." };

  let error: { message: string } | null = null;
  let success = "Đã lưu.";

  if (kind === "shift") {
    const shiftCode = textValue(formData, "shift_code");
    const amount = parseVnd(formData.get("amount_vnd"));
    if (!shiftCodes.includes(shiftCode as (typeof shiftCodes)[number]) || amount === null || Number.isNaN(amount) || amount < 0) {
      return { error: "Nhập ca và doanh thu là số nguyên không âm." };
    }
    ({ error } = await staff.supabase.rpc("staff_save_shift_revenue", {
      p_business_date: date.data,
      p_shift_code: shiftCode,
      p_amount_vnd: amount,
    }));
    success = "Đã lưu doanh thu ca.";
  } else if (kind === "shift_delete") {
    const shiftCode = textValue(formData, "shift_code");
    if (!shiftCodes.includes(shiftCode as (typeof shiftCodes)[number])) return { error: "Ca không hợp lệ." };
    ({ error } = await staff.supabase.rpc("staff_delete_shift_revenue", {
      p_business_date: date.data,
      p_shift_code: shiftCode,
    }));
    success = "Đã xóa mềm doanh thu ca. Chủ cửa hàng vẫn xem được lịch sử.";
  } else if (kind === "platform_revenue") {
    const channel = textValue(formData, "channel");
    const amountText = textValue(formData, "amount_vnd");
    const amount = amountText === "" ? 0 : parseVnd(formData.get("amount_vnd"));
    if (!channels.includes(channel as (typeof channels)[number]) || amount === null || Number.isNaN(amount) || amount < 0) {
      return { error: "Nhập doanh thu giao hàng là số nguyên không âm; để trống nếu kênh không phát sinh." };
    }
    ({ error } = await staff.supabase.rpc("staff_save_platform_revenue", {
      p_business_date: date.data,
      p_channel: channel,
      p_amount_vnd: amount,
    }));
    success = "Đã lưu doanh thu giao hàng.";
  } else if (kind === "platform_orders") {
    const channel = textValue(formData, "channel");
    const mode = textValue(formData, "mode");
    const count = parseCount(textValue(formData, "count"));
    if (!channels.includes(channel as (typeof channels)[number]) || count === null || count < 0) return { error: "Số đơn phải là số nguyên không âm." };
    if (mode === "increment") {
      if (count < 1) return { error: "Số đơn cộng thêm phải lớn hơn 0." };
      ({ error } = await staff.supabase.rpc("staff_increment_platform_orders", {
        p_business_date: date.data,
        p_channel: channel,
        p_delta: count,
      }));
      success = `Đã cộng thêm ${count} đơn ${channel === "grab" ? "Grab" : "Shopee"}.`;
    } else if (mode === "set") {
      ({ error } = await staff.supabase.rpc("staff_set_platform_orders", {
        p_business_date: date.data,
        p_channel: channel,
        p_count: count,
      }));
      success = `Đã chốt số đơn ${channel === "grab" ? "Grab" : "Shopee"}.`;
    } else return { error: "Cách nhập số đơn không hợp lệ." };
  } else if (kind === "total_bills") {
    const count = parseCount(textValue(formData, "count"));
    if (count === null) return { error: "Tổng bill phải là số nguyên không âm." };
    ({ error } = await staff.supabase.rpc("staff_set_total_bill_count", {
      p_business_date: date.data,
      p_count: count,
    }));
    success = "Đã lưu tổng bill cuối ngày.";
  } else if (kind === "expense_add") {
    const amount = parseVnd(formData.get("amount_vnd"));
    const reason = textValue(formData, "reason");
    if (amount === null || Number.isNaN(amount) || amount <= 0 || reason.length < 2 || reason.length > 240) return { error: "Chi phí cần số tiền lớn hơn 0 và lý do từ 2 đến 240 ký tự." };
    ({ error } = await staff.supabase.rpc("staff_add_incidental_expense", {
      p_business_date: date.data,
      p_amount_vnd: amount,
      p_reason: reason,
    }));
    success = "Đã thêm chi phí phát sinh.";
  } else if (kind === "expense_update") {
    const expenseId = z.uuid().safeParse(textValue(formData, "expense_id"));
    const amount = parseVnd(formData.get("amount_vnd"));
    const reason = textValue(formData, "reason");
    if (!expenseId.success || amount === null || Number.isNaN(amount) || amount <= 0 || reason.length < 2 || reason.length > 240) return { error: "Thông tin chi phí chưa hợp lệ." };
    ({ error } = await staff.supabase.rpc("staff_update_incidental_expense", {
      p_expense_id: expenseId.data,
      p_amount_vnd: amount,
      p_reason: reason,
    }));
    success = "Đã cập nhật chi phí.";
  } else if (kind === "expense_delete") {
    const expenseId = z.uuid().safeParse(textValue(formData, "expense_id"));
    if (!expenseId.success) return { error: "Khoản chi không hợp lệ." };
    ({ error } = await staff.supabase.rpc("staff_delete_incidental_expense", { p_expense_id: expenseId.data }));
    success = "Đã xóa mềm chi phí phát sinh.";
  } else {
    return { error: "Thao tác nhập liệu không hợp lệ." };
  }

  if (error) {
    if (error.message.includes("today") || error.message.includes("edit today")) return { error: "Ngày này đã qua hoặc chưa đến giờ nhập. Nhân viên chỉ sửa được ngày hiện tại." };
    if (error.message.includes("already been reviewed")) return { error: "Khoản chi này đã được admin đối chiếu với phiếu mua nên không thể sửa hoặc xóa. Hãy nhờ admin kiểm tra." };
    if (error.message.includes("finalized purchase")) return { error: "Chưa lưu khoản chi vì khoản này giống phiếu mua cá nhân đã chốt. Báo admin kiểm tra và ghi nhận nếu đây là giao dịch khác." };
    return { error: "Chưa lưu được số liệu. Hãy kiểm tra quyền truy cập và thử lại." };
  }
  revalidateStaff(date.data);
  return { success };
}
