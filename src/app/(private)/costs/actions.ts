"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { parseVnd } from "@/lib/finance/format";
import type { EntryActionState } from "@/app/(private)/ledger/actions";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).refine((month) => month >= "2026-09", "Sổ bắt đầu từ tháng 09/2026.");
const adjustmentCategorySchema = z.enum(["rent", "wages", "water"]);

const adjustmentBaseColumn = {
  rent: "rent_vnd",
  wages: "wages_vnd",
  water: "water_bill_vnd",
} as const;

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
  const { data: existingAdjustments, error: adjustmentLookupError } = await owner.supabase.from("monthly_cost_adjustments")
    .select("category,amount_delta_vnd").eq("owner_id", owner.ownerId).eq("month_start", monthStart);
  if (adjustmentLookupError) return { error: "Chưa kiểm tra được các điều chỉnh tháng. Hãy thử lại." };
  for (const category of ["rent", "wages", "water"] as const) {
    const baseValue = category === "rent" ? values.rent_vnd ?? 10000000 : values[adjustmentBaseColumn[category]];
    const delta = (existingAdjustments ?? []).filter((item) => item.category === category).reduce((sum, item) => sum + Number(item.amount_delta_vnd), 0);
    if (!Number.isSafeInteger(delta) || (baseValue !== null && !Number.isSafeInteger(baseValue + delta))) {
      return { error: "Tổng chi phí sau điều chỉnh vượt giới hạn tính toán an toàn." };
    }
    if ((baseValue === null && delta < 0) || (baseValue !== null && baseValue + delta < 0)) {
      return { error: `Chi phí ${category === "rent" ? "thuê mặt bằng" : category === "wages" ? "lương" : "nước"} sau điều chỉnh không được âm.` };
    }
  }
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

export async function addMonthlyCostAdjustment(_state: EntryActionState, formData: FormData): Promise<EntryActionState> {
  const month = monthSchema.safeParse(formData.get("month"));
  const category = adjustmentCategorySchema.safeParse(formData.get("category"));
  const direction = formData.get("direction");
  const amount = parseVnd(formData.get("amount_vnd"));
  const note = formData.get("note");
  if (!month.success) return { error: "Chọn tháng hợp lệ từ tháng 09/2026." };
  if (!category.success) return { error: "Chọn loại chi phí cần điều chỉnh." };
  if (direction !== "increase" && direction !== "decrease") return { error: "Chọn tăng hoặc giảm." };
  if (amount === null || Number.isNaN(amount) || amount <= 0) return { error: "Số tiền điều chỉnh phải lớn hơn 0." };
  if (typeof note !== "string" || note.trim().length < 2 || note.trim().length > 240) return { error: "Ghi lý do điều chỉnh từ 2 đến 240 ký tự." };

  const owner = await requireOwnerClient();
  if (!owner) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };
  const monthStart = `${month.data}-01`;
  const [costResult, adjustmentResult] = await Promise.all([
    owner.supabase.from("monthly_costs").select("rent_vnd,wages_vnd,water_bill_vnd").eq("owner_id", owner.ownerId).eq("month_start", monthStart).maybeSingle(),
    owner.supabase.from("monthly_cost_adjustments").select("amount_delta_vnd").eq("owner_id", owner.ownerId).eq("month_start", monthStart).eq("category", category.data),
  ]);
  if (costResult.error || adjustmentResult.error) return { error: "Chưa kiểm tra được chi phí tháng. Hãy thử lại." };
  const column = adjustmentBaseColumn[category.data];
  const baseValue = category.data === "rent" ? costResult.data?.rent_vnd ?? 10000000 : costResult.data?.[column] ?? null;
  const existingDelta = (adjustmentResult.data ?? []).reduce((sum, item) => sum + Number(item.amount_delta_vnd), 0);
  const signedDelta = direction === "increase" ? amount : -amount;
  if (!Number.isSafeInteger(existingDelta + signedDelta)) return { error: "Tổng điều chỉnh vượt giới hạn tính toán an toàn." };
  if (signedDelta < 0 && baseValue === null) return { error: "Hãy nhập chi phí tháng trước khi ghi điều chỉnh giảm." };
  if (baseValue !== null && Number(baseValue) + existingDelta + signedDelta < 0) return { error: "Tổng điều chỉnh không thể làm chi phí sau điều chỉnh âm." };

  const { error } = await owner.supabase.from("monthly_cost_adjustments").insert({
    owner_id: owner.ownerId,
    month_start: monthStart,
    category: category.data,
    amount_delta_vnd: signedDelta,
    note: note.trim(),
  });
  if (error) return { error: "Chưa lưu được điều chỉnh. Hãy thử lại." };
  revalidatePath("/costs");
  revalidatePath("/");
  revalidatePath("/reports");
  return { success: "Đã lưu điều chỉnh tháng." };
}

export async function deleteMonthlyCostAdjustment(_state: EntryActionState, formData: FormData): Promise<EntryActionState> {
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) return { error: "Mã điều chỉnh không hợp lệ." };
  const owner = await requireOwnerClient();
  if (!owner) return { error: "Phiên đăng nhập hết hạn hoặc tài khoản chưa được cấp quyền." };
  const { data, error } = await owner.supabase.from("monthly_cost_adjustments").delete()
    .eq("owner_id", owner.ownerId).eq("id", id.data).select("id").maybeSingle();
  if (error || !data) return { error: "Chưa gỡ được điều chỉnh. Hãy tải lại trang và thử lại." };
  revalidatePath("/costs");
  revalidatePath("/");
  revalidatePath("/reports");
  return { success: "Đã gỡ điều chỉnh tháng." };
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
