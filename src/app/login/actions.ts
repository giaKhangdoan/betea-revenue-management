"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAppAccess } from "@/lib/auth/app-access";

export type LoginState = { error?: string } | undefined;

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email({ error: "Nhập email hợp lệ." })),
  password: z.string().min(1, "Nhập mật khẩu."),
});

export async function loginAction(_state: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Kiểm tra lại thông tin." };

  const supabase = await createClient();
  if (!supabase) return { error: "Kết nối Supabase chưa được cấu hình." };

  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: "Email hoặc mật khẩu chưa đúng. Vui lòng thử lại." };

  const access = await getAppAccess();
  if (access.status === "owner") redirect("/");
  if (access.status === "staff") redirect("/staff/dashboard");
  redirect("/setup");
}
