"use client";

import { useActionState } from "react";
import {
  createStaffAccountAction,
  resetStaffPasswordAction,
  toggleStaffAccountAction,
  updateStaffAccountAction,
  type StaffAccountActionState,
} from "@/app/(private)/staff-accounts/actions";

export type StaffAccount = {
  id: string;
  email: string;
  display_name: string;
  active: boolean;
  created_at: string;
};

function Feedback({ state }: { state: StaffAccountActionState }) {
  if (state?.error) return <p className="form-error" role="alert">{state.error}</p>;
  if (state?.warning) return <p className="form-error" role="alert">{state.warning}</p>;
  if (state?.message) return <p className="form-success" role="status">{state.message}</p>;
  return null;
}

function CreateAccountForm({ authAdminConfigured }: { authAdminConfigured: boolean }) {
  const [state, action, pending] = useActionState(createStaffAccountAction, undefined);
  return (
    <form action={action} className="surface staff-create-card">
      <div className="section-heading"><div><h2>Cấp tài khoản mới</h2><p>Email và mật khẩu do bạn tạo, không có đăng ký công khai.</p></div></div>
      <div className="staff-account-fields">
        <label className="field"><span>Tên hiển thị</span><input name="displayName" autoComplete="name" required maxLength={100} placeholder="Ví dụ: Nhân viên Betea" /></label>
        <label className="field"><span>Email đăng nhập</span><input name="email" type="email" autoComplete="username" required maxLength={254} placeholder="nhanvien@example.com" /></label>
        <label className="field"><span>Mật khẩu ban đầu</span><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={!authAdminConfigured} /><small className="form-note">Ít nhất 12 ký tự. Mật khẩu không được lưu vào nhật ký.</small></label>
      </div>
      <Feedback state={state} />
      <div className="form-actions"><button className="button button-primary" type="submit" disabled={pending || !authAdminConfigured}>{pending ? "Đang tạo…" : "Tạo tài khoản nhân viên"}</button></div>
    </form>
  );
}

function AccountCard({ account, authAdminConfigured }: { account: StaffAccount; authAdminConfigured: boolean }) {
  const [profileState, profileAction, profilePending] = useActionState(updateStaffAccountAction, undefined);
  const [passwordState, passwordAction, passwordPending] = useActionState(resetStaffPasswordAction, undefined);
  const [accessState, accessAction, accessPending] = useActionState(toggleStaffAccountAction, undefined);
  const createdAt = new Intl.DateTimeFormat("vi-VN", { dateStyle: "medium", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(account.created_at));

  return (
    <article className="surface staff-account-card">
      <header className="staff-account-header">
        <div><h2>{account.display_name}</h2><p>{account.email}</p></div>
        <span className={`status ${account.active ? "status-success" : "status-neutral"}`}>{account.active ? "Đang hoạt động" : "Đã khóa"}</span>
      </header>
      <p className="form-note">Tài khoản dùng chung · tạo ngày {createdAt}</p>

      <form action={profileAction} className="staff-account-section">
        <input type="hidden" name="membershipId" value={account.id} />
        <div className="section-heading"><div><h3>Thông tin đăng nhập</h3><p>Có thể đổi tên hiển thị hoặc email.</p></div></div>
        <div className="staff-account-fields staff-account-fields-two">
          <label className="field"><span>Tên hiển thị</span><input name="displayName" autoComplete="name" required maxLength={100} defaultValue={account.display_name} /></label>
          <label className="field"><span>Email</span><input name="email" type="email" autoComplete="username" required maxLength={254} defaultValue={account.email} readOnly={!authAdminConfigured} /></label>
        </div>
        <Feedback state={profileState} />
        <div className="form-actions"><button className="button button-secondary" type="submit" disabled={profilePending}>{profilePending ? "Đang lưu…" : "Lưu thông tin"}</button></div>
      </form>

      <form action={passwordAction} className="staff-account-section">
        <input type="hidden" name="membershipId" value={account.id} />
        <div className="section-heading"><div><h3>Đặt lại mật khẩu</h3><p>Mật khẩu mới sẽ thay thế mật khẩu đang dùng và yêu cầu đăng nhập lại trên các thiết bị.</p></div></div>
        <div className="staff-account-fields staff-account-fields-two">
          <label className="field"><span>Mật khẩu mới</span><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={!authAdminConfigured} /></label>
        </div>
        <Feedback state={passwordState} />
        <div className="form-actions"><button className="button button-secondary" type="submit" disabled={passwordPending || !authAdminConfigured}>{passwordPending ? "Đang đặt lại…" : "Đặt mật khẩu mới"}</button></div>
      </form>

      <form action={accessAction} className="staff-account-section staff-access-form" onSubmit={(event) => {
        const text = account.active ? "Khóa tài khoản nhân viên? Nhân viên sẽ mất quyền đọc dữ liệu ngay." : "Mở lại tài khoản nhân viên này? Bạn sẽ đặt mật khẩu mới và các phiên cũ sẽ mất quyền.";
        if (!window.confirm(text)) event.preventDefault();
      }}>
        <input type="hidden" name="membershipId" value={account.id} />
        <div><h3>Quyền truy cập</h3><p>{account.active ? "Tài khoản hiện có thể đăng nhập và nhập liệu." : "Tài khoản không thể truy cập dữ liệu cửa hàng. Khi mở lại, hãy cấp mật khẩu mới."}</p></div>
        {!account.active ? <label className="field"><span>Mật khẩu mới khi mở lại</span><input name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} disabled={!authAdminConfigured} /><small className="form-note">Ít nhất 12 ký tự; các phiên đăng nhập cũ sẽ bị thu hồi.</small></label> : null}
        <button className={account.active ? "button button-danger" : "button button-secondary"} type="submit" disabled={accessPending || !authAdminConfigured}>{accessPending ? "Đang cập nhật…" : account.active ? "Khóa tài khoản" : "Mở lại tài khoản"}</button>
        <Feedback state={accessState} />
      </form>
    </article>
  );
}

export function StaffAccountManager({ accounts, hasActiveAccount, authAdminConfigured }: { accounts: StaffAccount[]; hasActiveAccount: boolean; authAdminConfigured: boolean }) {
  return (
    <div className="staff-manager">
      {!authAdminConfigured ? <div className="login-config" role="status">Chưa cấu hình được Supabase Auth Admin. Bạn vẫn có thể sửa tên hiển thị; tạo, đổi email, đặt lại mật khẩu và khóa tài khoản sẽ khả dụng sau khi thêm khóa ở môi trường máy chủ.</div> : null}
      {hasActiveAccount ? (
        <div className="login-config staff-shared-note"><strong>Đang dùng một tài khoản chung.</strong> Nhân viên cùng dùng thông tin đăng nhập này; nhật ký chỉ xác định tài khoản chung, không xác định từng người.</div>
      ) : <CreateAccountForm authAdminConfigured={authAdminConfigured} />}
      <section className="staff-account-list">
        <div className="section-heading"><div><h2>Lịch sử tài khoản</h2><p>Khóa tài khoản sẽ chặn quyền dữ liệu ngay. Bạn có thể mở lại hoặc tạo tài khoản thay thế.</p></div></div>
        {accounts.length === 0 ? <div className="empty-state"><div><h2>Chưa có tài khoản nhân viên</h2><p>Tạo tài khoản dùng chung khi bạn sẵn sàng cho nhân viên nhập liệu.</p></div></div> : accounts.map((account) => <AccountCard account={account} authAdminConfigured={authAdminConfigured} key={account.id} />)}
      </section>
    </div>
  );
}
