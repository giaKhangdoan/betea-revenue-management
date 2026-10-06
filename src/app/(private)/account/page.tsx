import { redirect } from "next/navigation";
import { OwnerEmailChangeForm } from "@/components/account/owner-email-change-form";
import { requireOwnerClient } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const owner = await requireOwnerClient();
  if (!owner) redirect("/login");

  return <>
    <div className="page-heading">
      <div>
        <p className="eyebrow">BẢO MẬT TÀI KHOẢN</p>
        <h1>Tài khoản</h1>
        <p>Quản lý email dùng để đăng nhập Betea.</p>
      </div>
    </div>
    <section className="surface account-settings-card" aria-labelledby="account-email-heading">
      <h2 id="account-email-heading">Đổi email đăng nhập</h2>
      <p>Email hiện tại: <strong>{owner.email ?? "Chưa xác định"}</strong></p>
      <OwnerEmailChangeForm />
      <p className="form-note">Mật khẩu hiện tại sẽ được giữ nguyên. Sau khi gửi yêu cầu, hãy xác nhận các email Supabase gửi tới hộp thư theo hướng dẫn; email mới chưa dùng để đăng nhập cho đến khi xác nhận hoàn tất.</p>
    </section>
  </>;
}
