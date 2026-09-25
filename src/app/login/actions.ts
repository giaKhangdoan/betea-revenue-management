"use server";

import { z } from "zod";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { error?: string } | undefined;

const loginSchema = z.object({
  email: z.email({ error: "Nhập email hợp lệ." }).trim().toLowerCase(),
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

  redirect("/");
}
