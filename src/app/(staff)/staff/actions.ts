"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseVnd } from "@/lib/finance/format";
import { requireStaff } from "@/lib/auth/require-staff";

export type StaffEntryActionState = { error?: string; success?: string } | undefined;

const dateSchema = z.iso.date().refine((date) => date >= "2026-09-01", "Sổ bắt đầu từ 01/09/2026.");
const shiftCodes = ["06-10", "10-14", "14-18", "18-22"] as const;
const channels = ["grab", "shopee"] as const;

function textValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function parseCount(value: string) {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function revalidateStaff(date: string) {
  revalidatePath("/staff/dashboard");
  revalidatePath(`/staff/entry/${date}`);
  revalidatePath(`/ledger/${date}`);
  revalidatePath("/ledger");
  revalidatePath("/");
  revalidatePath("/reports");
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
    const amount = parseVnd(formData.get("amount_vnd"));
    if (!channels.includes(channel as (typeof channels)[number]) || amount === null || Number.isNaN(amount) || amount < 0) {
      return { error: "Nhập kênh và doanh thu giao hàng là số nguyên không âm." };
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
  } else if (kind === "meters") {
    const morningText = textValue(formData, "morning_kwh");
    const eveningText = textValue(formData, "evening_kwh");
    const morning = morningText === "" ? null : Number(morningText.replace(",", "."));
    const evening = eveningText === "" ? null : Number(eveningText.replace(",", "."));
    if ((morning !== null && (!Number.isFinite(morning) || morning < 0)) || (evening !== null && (!Number.isFinite(evening) || evening < 0))) {
      return { error: "Chỉ số điện phải là số không âm." };
    }
    ({ error } = await staff.supabase.rpc("staff_set_meter_readings", {
      p_business_date: date.data,
      p_morning_kwh: morning,
      p_evening_kwh: evening,
    }));
    success = "Đã lưu chỉ số điện.";
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
    return { error: "Chưa lưu được số liệu. Hãy kiểm tra quyền truy cập và thử lại." };
  }
  revalidateStaff(date.data);
  return { success };
}
