import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/require-admin";
import { StaffAccountManager, type StaffAccount } from "@/components/admin/staff-account-manager";

export const dynamic = "force-dynamic";

export default async function StaffAccountsPage() {
  const owner = await requireAdmin();
  if (!owner) redirect("/login");

  const { data, error } = await owner.supabase
    .from("store_memberships")
    .select("id,email,display_name,active,created_at")
    .eq("owner_id", owner.ownerId)
    .order("created_at", { ascending: false });

  const accounts = (data ?? []) as StaffAccount[];
  const hasActiveAccount = accounts.some((account) => account.active);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">QUYỀN TRUY CẬP</p>
          <h1>Tài khoản nhân viên</h1>
          <p>Tạo một tài khoản dùng chung, cấp mật khẩu cho nhân viên và khóa quyền khi cần.</p>
        </div>
      </div>
      {error ? <p className="form-error" role="alert">Chưa tải được danh sách tài khoản. Hãy thử tải lại trang.</p> : null}
      <StaffAccountManager accounts={accounts} hasActiveAccount={hasActiveAccount} authAdminConfigured={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim())} />
    </>
  );
}
