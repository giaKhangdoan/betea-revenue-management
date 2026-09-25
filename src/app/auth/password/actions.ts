"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { getOwnerAccess } from "@/lib/auth/owner-access";
import { createClient } from "@/lib/supabase/server";

export type PasswordActionState = { error?: string; message?: string } | undefined;

const resetSchema = z.object({
  email: z.email({ error: "Nhập email hợp lệ." }).trim().toLowerCase(),
});

const passwordSchema = z.object({
  password: z.string().min(12, "Mật khẩu cần có ít nhất 12 ký tự."),
  confirmPassword: z.string(),
}).refine((value) => value.password === value.confirmPassword, {
  path: ["confirmPassword"],
  error: "Hai mật khẩu chưa trùng nhau.",
});

export async function requestPasswordResetAction(
  _state: PasswordActionState,
  formData: FormData,
): Promise<PasswordActionState> {
  const parsed = resetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Kiểm tra lại email." };
  }

  const supabase = await createClient();
  const baseUrl = process.env.APP_BASE_URL?.trim();
  if (supabase && baseUrl) {
    await supabase.auth.resetPasswordForEmail(parsed.data.email, {
      redirectTo: `${baseUrl.replace(/\/$/, "")}/auth/callback?next=%2Fauth%2Fset-password`,
    });
  }

  return {
    message: "Nếu email thuộc tài khoản Betea, hướng dẫn đặt lại mật khẩu sẽ được gửi đến hộp thư đó.",
  };
}

export async function setPasswordAction(
  _state: PasswordActionState,
  formData: FormData,
): Promise<PasswordActionState> {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Kiểm tra lại mật khẩu." };
  }

  const access = await getOwnerAccess();
  if (access.status !== "owner") {
    return { error: "Phiên đặt lại mật khẩu không hợp lệ. Hãy xin một liên kết mới." };
  }

  const supabase = await createClient();
  if (!supabase) return { error: "Kết nối Supabase chưa được cấu hình." };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { error: "Chưa thể cập nhật mật khẩu. Hãy kiểm tra liên kết và thử lại." };

  redirect("/");
}

