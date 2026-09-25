"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  requestPasswordResetAction,
  setPasswordAction,
} from "@/app/auth/password/actions";

export function PasswordResetRequestForm() {
  const [state, action, pending] = useActionState(requestPasswordResetAction, undefined);

  return (
    <form action={action} className="login-form">
      <div className="field">
        <label htmlFor="reset-email">Email tài khoản</label>
        <input autoComplete="email" id="reset-email" name="email" type="email" required disabled={pending} />
      </div>
      {state?.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state?.message ? <p className="form-success" role="status">{state.message}</p> : null}
      <button className="button" type="submit" disabled={pending}>
        {pending ? "Đang gửi…" : "Gửi hướng dẫn"}
      </button>
      <Link className="auth-text-link" href="/login">Quay lại đăng nhập</Link>
    </form>
  );
}

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setPasswordAction, undefined);

  return (
    <form action={action} className="login-form">
      <div className="field">
        <label htmlFor="new-password">Mật khẩu mới</label>
        <input autoComplete="new-password" id="new-password" minLength={12} name="password" type="password" required disabled={pending} />
      </div>
      <div className="field">
        <label htmlFor="confirm-password">Nhập lại mật khẩu</label>
        <input autoComplete="new-password" id="confirm-password" minLength={12} name="confirmPassword" type="password" required disabled={pending} />
      </div>
      {state?.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <button className="button" type="submit" disabled={pending}>
        {pending ? "Đang cập nhật…" : "Lưu mật khẩu"}
      </button>
      <p className="form-note">Dùng mật khẩu riêng dài ít nhất 12 ký tự. Không gửi mật khẩu qua tin nhắn.</p>
    </form>
  );
}
