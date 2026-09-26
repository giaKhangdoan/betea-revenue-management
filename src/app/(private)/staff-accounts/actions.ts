"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";

export type StaffAccountActionState = { error?: string; warning?: string; message?: string } | undefined;

const createSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email({ error: "Nhập email hợp lệ." })),
  displayName: z.string().trim().min(1, "Nhập tên hiển thị.").max(100, "Tên không quá 100 ký tự."),
  password: z.string().min(12, "Mật khẩu cần có ít nhất 12 ký tự.").max(128, "Mật khẩu không quá 128 ký tự."),
});

const updateSchema = z.object({
  membershipId: z.uuid("Tài khoản không hợp lệ."),
  email: z.string().trim().toLowerCase().pipe(z.email({ error: "Nhập email hợp lệ." })),
  displayName: z.string().trim().min(1, "Nhập tên hiển thị.").max(100, "Tên không quá 100 ký tự."),
});

const passwordSchema = z.object({
  membershipId: z.uuid("Tài khoản không hợp lệ."),
  password: z.string().min(12, "Mật khẩu cần có ít nhất 12 ký tự.").max(128, "Mật khẩu không quá 128 ký tự."),
});

const membershipSchema = z.uuid("Tài khoản không hợp lệ.");

function formObject(formData: FormData) {
  return Object.fromEntries(formData.entries());
}

export async function createStaffAccountAction(
  _state: StaffAccountActionState,
  formData: FormData,
): Promise<StaffAccountActionState> {
  const parsed = createSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Kiểm tra lại thông tin." };

  const owner = await requireAdmin();
  if (!owner) return { error: "Bạn không có quyền quản lý tài khoản nhân viên." };
  const admin = createAdminClient();
  if (!admin) return { error: "Thiếu cấu hình khóa Supabase Auth Admin ở môi trường máy chủ." };

  const { data: existing, error: lookupError } = await owner.supabase
    .from("store_memberships")
    .select("id")
    .eq("owner_id", owner.ownerId)
    .eq("active", true)
    .maybeSingle();
  if (lookupError) return { error: "Chưa kiểm tra được tài khoản đang hoạt động. Hãy thử lại." };
  if (existing) return { error: "Đã có tài khoản nhân viên hoạt động. Hãy khóa tài khoản đó trước khi tạo tài khoản mới." };

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: parsed.data.email,
    password: parsed.data.password,
    email_confirm: true,
  });
  const userId = authData.user?.id;
  if (authError || !userId) return { error: "Chưa tạo được tài khoản. Kiểm tra email hoặc cấu hình Supabase Auth." };

  const { error: membershipError } = await owner.supabase.rpc("owner_create_staff_membership", {
    p_user_id: userId,
    p_email: parsed.data.email,
    p_display_name: parsed.data.displayName,
  });

  if (membershipError) {
    const { error: cleanupError } = await admin.auth.admin.deleteUser(userId);
    if (cleanupError) {
      return { error: "Chưa lưu được quyền nhân viên và chưa dọn được tài khoản Auth tạm. Hãy xóa tài khoản vừa tạo trong Supabase Auth trước khi thử lại." };
    }
    return { error: "Chưa lưu được quyền nhân viên. Tài khoản đăng nhập tạm đã được dọn dẹp." };
  }

  revalidatePath("/staff-accounts");
  return { message: "Đã tạo tài khoản nhân viên. Hãy cấp email và mật khẩu ban đầu cho nhân viên." };
}

export async function updateStaffAccountAction(
  _state: StaffAccountActionState,
  formData: FormData,
): Promise<StaffAccountActionState> {
  const parsed = updateSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Kiểm tra lại thông tin." };

  const owner = await requireAdmin();
  if (!owner) return { error: "Bạn không có quyền quản lý tài khoản nhân viên." };
  const { data: account, error: lookupError } = await owner.supabase
    .from("store_memberships")
    .select("id,user_id,email,display_name,active")
    .eq("owner_id", owner.ownerId)
    .eq("id", parsed.data.membershipId)
    .maybeSingle();
  if (lookupError || !account) return { error: "Không tìm thấy tài khoản nhân viên." };

  let admin: ReturnType<typeof createAdminClient> = null;
  if (account.email !== parsed.data.email) {
    admin = createAdminClient();
    if (!admin) return { error: "Thiếu cấu hình khóa Supabase Auth Admin ở môi trường máy chủ." };
    const { error } = await admin.auth.admin.updateUserById(account.user_id, {
      email: parsed.data.email,
      email_confirm: true,
    });
    if (error) return { error: "Chưa cập nhật được email đăng nhập." };
  }

  const { error } = await owner.supabase.rpc("owner_update_staff_membership", {
    p_membership_id: account.id,
    p_email: parsed.data.email,
    p_display_name: parsed.data.displayName,
    p_active: account.active,
  });
  if (error) {
    if (admin) {
      const { error: rollbackError } = await admin.auth.admin.updateUserById(account.user_id, {
        email: account.email,
        email_confirm: true,
      });
      if (rollbackError) {
        return { error: "Chưa lưu được thông tin nhân viên và email Auth chưa thể hoàn tác. Hãy kiểm tra lại email trong Supabase Auth." };
      }
    }
    return { error: "Chưa lưu được thông tin nhân viên. Email đăng nhập đã được hoàn tác nếu cần." };
  }

  revalidatePath("/staff-accounts");
  return { message: "Đã cập nhật tên và thông tin đăng nhập." };
}

export async function resetStaffPasswordAction(
  _state: StaffAccountActionState,
  formData: FormData,
): Promise<StaffAccountActionState> {
  const parsed = passwordSchema.safeParse(formObject(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Kiểm tra lại mật khẩu." };

  const owner = await requireAdmin();
  if (!owner) return { error: "Bạn không có quyền quản lý tài khoản nhân viên." };
  const admin = createAdminClient();
  if (!admin) return { error: "Thiếu cấu hình khóa Supabase Auth Admin ở môi trường máy chủ." };

  const { data: account, error: lookupError } = await owner.supabase
    .from("store_memberships")
    .select("id,user_id")
    .eq("owner_id", owner.ownerId)
    .eq("id", parsed.data.membershipId)
    .maybeSingle();
  if (lookupError || !account) return { error: "Không tìm thấy tài khoản nhân viên." };

  const { error: beginError } = await owner.supabase.rpc("owner_begin_staff_password_reset", {
    p_membership_id: account.id,
  });
  if (beginError) return { error: "Chưa ghi được yêu cầu vào lịch sử, nên mật khẩu chưa thay đổi." };

  const { error: authError } = await admin.auth.admin.updateUserById(account.user_id, {
    password: parsed.data.password,
  });
  const { error: finishError } = await owner.supabase.rpc("owner_finish_staff_password_reset", {
    p_membership_id: account.id,
    p_succeeded: !authError,
  });
  revalidatePath("/staff-accounts");
  if (authError) {
    return {
      error: finishError
        ? "Chưa đổi được mật khẩu. Lịch sử đã ghi nhận yêu cầu nhưng chưa lưu được kết quả; hãy kiểm tra mục Lịch sử."
        : "Chưa đặt lại được mật khẩu. Lịch sử đã ghi nhận thao tác thất bại.",
    };
  }
  if (finishError) return { warning: "Mật khẩu đã đổi và các phiên cũ đã bị thu hồi. Lịch sử ghi nhận yêu cầu nhưng chưa lưu được kết quả hoàn tất." };
  return { message: "Đã đặt mật khẩu mới. Hãy cấp mật khẩu này trực tiếp cho nhân viên." };
}

export async function toggleStaffAccountAction(
  _state: StaffAccountActionState,
  formData: FormData,
): Promise<StaffAccountActionState> {
  const parsed = membershipSchema.safeParse(formData.get("membershipId"));
  if (!parsed.success) return { error: "Tài khoản không hợp lệ." };

  const owner = await requireAdmin();
  if (!owner) return { error: "Bạn không có quyền quản lý tài khoản nhân viên." };
  const admin = createAdminClient();
  if (!admin) return { error: "Thiếu cấu hình khóa Supabase Auth Admin ở môi trường máy chủ." };

  const { data: account, error: lookupError } = await owner.supabase
    .from("store_memberships")
    .select("id,user_id,email,display_name,active")
    .eq("owner_id", owner.ownerId)
    .eq("id", parsed.data)
    .maybeSingle();
  if (lookupError || !account) return { error: "Không tìm thấy tài khoản nhân viên." };
  const targetActive = !account.active;

  if (targetActive) {
    const passwordValue = formData.get("password");
    if (typeof passwordValue !== "string") return { error: "Nhập mật khẩu mới để mở lại tài khoản." };
    const password = passwordSchema.safeParse({ membershipId: account.id, password: passwordValue });
    if (!password.success) return { error: password.error.issues[0]?.message ?? "Nhập mật khẩu mới để mở lại tài khoản." };

    const { error: beginError } = await owner.supabase.rpc("owner_begin_staff_password_reset", {
      p_membership_id: account.id,
    });
    if (beginError) return { error: "Chưa ghi được thao tác vào lịch sử, nên tài khoản vẫn bị khóa." };

    const { error: membershipError } = await owner.supabase.rpc("owner_update_staff_membership", {
      p_membership_id: account.id,
      p_email: account.email,
      p_display_name: account.display_name,
      p_active: true,
    });
    if (membershipError) {
      await owner.supabase.rpc("owner_finish_staff_password_reset", {
        p_membership_id: account.id,
        p_succeeded: false,
      });
      return { error: "Chưa mở được quyền dữ liệu; tài khoản vẫn bị khóa và mật khẩu chưa đổi." };
    }

    const { error: authError } = await admin.auth.admin.updateUserById(account.user_id, {
      password: password.data.password,
      ban_duration: "none",
    });
    if (authError) {
      const { error: rollbackError } = await owner.supabase.rpc("owner_update_staff_membership", {
        p_membership_id: account.id,
        p_email: account.email,
        p_display_name: account.display_name,
        p_active: false,
      });
      await admin.auth.admin.updateUserById(account.user_id, { ban_duration: "876000h" });
      await owner.supabase.rpc("owner_finish_staff_password_reset", {
        p_membership_id: account.id,
        p_succeeded: false,
      });
      revalidatePath("/staff-accounts");
      return {
        error: rollbackError
          ? "Chưa mở được tài khoản. Supabase chưa xác nhận khóa lại quyền dữ liệu; hãy kiểm tra trạng thái tài khoản ngay."
          : "Chưa cập nhật được mật khẩu đăng nhập. Tài khoản đã được khóa lại.",
      };
    }

    const { error: finishError } = await owner.supabase.rpc("owner_finish_staff_password_reset", {
      p_membership_id: account.id,
      p_succeeded: true,
    });
    revalidatePath("/staff-accounts");
    if (finishError) return { warning: "Tài khoản đã mở lại và mật khẩu đã đổi; lịch sử ghi nhận yêu cầu nhưng chưa lưu được kết quả hoàn tất." };
    return { message: "Đã mở lại tài khoản với mật khẩu mới. Các phiên đăng nhập cũ đã bị thu hồi." };
  }

  const { error: membershipError } = await owner.supabase.rpc("owner_update_staff_membership", {
    p_membership_id: account.id,
    p_email: account.email,
    p_display_name: account.display_name,
    p_active: false,
  });
  if (membershipError) return { error: "Chưa khóa được quyền truy cập dữ liệu. Hãy thử lại." };

  const lockPassword = randomBytes(32).toString("base64url");
  const { error: authError } = await admin.auth.admin.updateUserById(account.user_id, {
    password: lockPassword,
    ban_duration: "876000h",
  });
  revalidatePath("/staff-accounts");
  if (authError) {
    const { error: banError } = await admin.auth.admin.updateUserById(account.user_id, { ban_duration: "876000h" });
    return {
      warning: banError
        ? "Quyền dữ liệu đã bị khóa ngay trong cơ sở dữ liệu, nhưng Supabase chưa khóa đăng nhập. Hãy kiểm tra Auth trước khi mở lại."
        : "Quyền dữ liệu đã bị khóa ngay; đăng nhập bị chặn nhưng thao tác thu hồi phiên hoặc mật khẩu bị lỗi. Khi mở lại sẽ bắt buộc đặt mật khẩu mới.",
    };
  }
  return { message: "Đã khóa tài khoản, thu hồi phiên cũ và chặn đăng nhập." };
}
