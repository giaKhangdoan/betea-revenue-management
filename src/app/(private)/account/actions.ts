"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOwnerClient } from "@/lib/auth/require-owner";

export type EmailChangeActionState = { error?: string; success?: string } | undefined;

const emailChangeSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email({ error: "Nhập email mới hợp lệ." })),
  confirmEmail: z.string().trim().toLowerCase().pipe(z.email({ error: "Nhập lại email mới hợp lệ." })),
}).refine((value) => value.email === value.confirmEmail, {
  path: ["confirmEmail"],
  error: "Hai địa chỉ email chưa trùng nhau.",
});

export async function changeOwnerEmailAction(
  _state: EmailChangeActionState,
  formData: FormData,
): Promise<EmailChangeActionState> {
  const owner = await requireOwnerClient();
  if (!owner) return { error: "Phiên chủ cửa hàng không hợp lệ. Hãy đăng nhập lại." };

  const parsed = emailChangeSchema.safeParse({
    email: formData.get("email"),
    confirmEmail: formData.get("confirmEmail"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Kiểm tra lại email." };
  }

  const { data: userData, error: userError } = await owner.supabase.auth.getUser();
  if (userError || !userData.user || userData.user.id !== owner.ownerId) {
    return { error: "Không xác minh được phiên admin. Hãy đăng nhập lại rồi thử lại." };
  }

  if (userData.user.email?.trim().toLowerCase() === parsed.data.email) {
    return { error: "Email mới đang trùng với email đăng nhập hiện tại." };
  }

  const { error } = await owner.supabase.auth.updateUser({ email: parsed.data.email });
  if (error) {
    if (/already|registered|exists/i.test(error.message)) {
      return { error: "Email này đã được dùng cho một tài khoản khác." };
    }
    return { error: "Chưa gửi được yêu cầu đổi email. Hãy thử lại sau." };
  }

  revalidatePath("/", "layout");
  return {
    success: "Supabase đã gửi yêu cầu xác nhận. Hãy kiểm tra hộp thư của email mới và làm theo hướng dẫn; có thể cần xác nhận thêm ở email hiện tại. Email đăng nhập chỉ đổi sau khi xác nhận xong.",
  };
}
