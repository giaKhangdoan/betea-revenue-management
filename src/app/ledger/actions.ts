"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { parseVnd } from "@/lib/finance/format";

export type EntryActionState = { error?: string; success?: string } | undefined;

const dateSchema = z.iso.date().refine((date) => date >= "2026-09-01", "Sổ bắt đầu từ 01/09/2026.");
const revenueFields = [
  "shift_06_10_vnd", "shift_10_14_vnd", "shift_14_18_vnd", "shift_18_22_vnd", "grab_vnd", "shopee_vnd",
] as const;

export async function saveDailyRecord(_state: EntryActionState, formData: FormData): Promise<EntryActionState> {
  const businessDate = formData.get("business_date");
  const status = formData.get("business_status");
  const note = formData.get("note");
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
  if (note !== null && (typeof note !== "string" || note.length > 1000)) return { error: "Ghi chú tối đa 1.000 ký tự." };
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

  const owner = await requireOwnerClient();
  if (!owner) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };
  const { error } = await owner.supabase.from("daily_records").upsert({
    owner_id: owner.ownerId,
    business_date: parsedDate.data,
    business_status: status,
    ...values,
    electricity_morning_kwh: morningMeter,
    electricity_evening_kwh: eveningMeter,
    cleaning_done: cleaningDone,
    arrangement_done: arrangementDone,
    note: typeof note === "string" && note.trim() ? note.trim() : null,
  }, { onConflict: "owner_id,business_date" });

  if (error) return { error: "Chưa lưu được ngày này. Hãy kiểm tra kết nối rồi thử lại." };
  revalidatePath("/");
  revalidatePath("/ledger");
  revalidatePath(`/ledger/${parsedDate.data}`);
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
  const { error: dayError } = await owner.supabase.from("daily_records").upsert({
    owner_id: owner.ownerId,
    business_date: date.data,
  }, { onConflict: "owner_id,business_date", ignoreDuplicates: true });
  if (dayError) return { error: "Chưa tạo được ngày để ghi chi phí." };

  const { error } = await owner.supabase.from("daily_expenses").insert({
    owner_id: owner.ownerId,
    business_date: date.data,
    amount_vnd: amount,
    reason: reason.trim(),
  });
  if (error) return { error: "Chưa lưu được chi phí phát sinh. Hãy thử lại." };
  revalidatePath("/");
  revalidatePath("/ledger");
  revalidatePath(`/ledger/${date.data}`);
  revalidatePath("/reports");
  return { success: "Đã thêm chi phí phát sinh." };
}
