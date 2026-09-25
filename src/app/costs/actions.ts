"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { parseVnd } from "@/lib/finance/format";
import type { EntryActionState } from "@/app/ledger/actions";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine((month) => month >= "2026-09", "Sổ bắt đầu từ tháng 09/2026.");

export async function saveMonthlyCosts(_state: EntryActionState, formData: FormData): Promise<EntryActionState> {
  const month = monthSchema.safeParse(formData.get("month"));
  if (!month.success) return { error: "Chọn tháng hợp lệ từ tháng 09/2026." };
  const values = {
    cogs_vnd: parseVnd(formData.get("cogs_vnd")),
    rent_vnd: parseVnd(formData.get("rent_vnd")),
    wages_vnd: parseVnd(formData.get("wages_vnd")),
    water_bill_vnd: parseVnd(formData.get("water_bill_vnd")),
    electricity_bill_vnd: parseVnd(formData.get("electricity_bill_vnd")),
  };
  if (Object.values(values).some((value) => Number.isNaN(value))) return { error: "Số tiền phải là số nguyên không âm. Ví dụ: 10.000.000." };
  const note = formData.get("note");
  if (typeof note !== "string" || note.length > 1000) return { error: "Ghi chú tối đa 1.000 ký tự." };

  const owner = await requireOwnerClient();
  if (!owner) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };
  const monthStart = `${month.data}-01`;
  const { error } = await owner.supabase.from("monthly_costs").upsert({
    owner_id: owner.ownerId,
    month_start: monthStart,
    ...values,
    rent_vnd: values.rent_vnd ?? 10000000,
    note: note.trim() || null,
  }, { onConflict: "owner_id,month_start" });
  if (error) return { error: "Chưa lưu được chi phí tháng. Hãy kiểm tra kết nối rồi thử lại." };
  revalidatePath("/costs");
  revalidatePath("/");
  revalidatePath("/reports");
  return { success: "Đã lưu chi phí tháng." };
}

export async function saveMonthTargets(_state: EntryActionState, formData: FormData): Promise<EntryActionState> {
  const month = monthSchema.safeParse(formData.get("month"));
  if (!month.success) return { error: "Chọn tháng mục tiêu hợp lệ." };
  const values = {
    revenue_target_vnd: parseVnd(formData.get("month_revenue_target_vnd")),
    profit_target_vnd: parseVnd(formData.get("month_profit_target_vnd")),
  };
  if (Object.values(values).some((value) => Number.isNaN(value))) return { error: "Mục tiêu phải là số nguyên không âm." };
  const owner = await requireOwnerClient();
  if (!owner) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };
  const { error } = await owner.supabase.from("monthly_targets").upsert({
    owner_id: owner.ownerId,
    month_start: `${month.data}-01`,
    ...values,
  }, { onConflict: "owner_id,month_start" });
  if (error) return { error: "Chưa lưu được mục tiêu tháng." };
  revalidatePath("/costs");
  revalidatePath("/");
  revalidatePath("/reports");
  return { success: "Đã lưu mục tiêu tháng." };
}

export async function saveWeekTarget(_state: EntryActionState, formData: FormData): Promise<EntryActionState> {
  const date = z.iso.date().safeParse(formData.get("week_start"));
  if (!date.success || new Date(`${date.data}T12:00:00Z`).getUTCDay() !== 1) return { error: "Tuần phải bắt đầu vào Thứ 2." };
  const amount = parseVnd(formData.get("revenue_target_vnd"));
  if (Number.isNaN(amount)) return { error: "Mục tiêu tuần phải là số nguyên không âm." };
  const owner = await requireOwnerClient();
  if (!owner) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };
  const { error } = await owner.supabase.from("weekly_targets").upsert({
    owner_id: owner.ownerId,
    week_start: date.data,
    revenue_target_vnd: amount,
  }, { onConflict: "owner_id,week_start" });
  if (error) return { error: "Chưa lưu được mục tiêu tuần." };
  revalidatePath("/costs");
  revalidatePath("/");
  revalidatePath("/reports");
  return { success: "Đã lưu mục tiêu tuần." };
}
