"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/login/actions";

export function LoginForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(loginAction, undefined);

  return (
    <form action={action} className="login-form">
      {state?.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      <div className="field">
        <label htmlFor="email">Email đăng nhập</label>
        <input autoComplete="username" id="email" name="email" type="email" required disabled={!configured || pending} />
      </div>
      <div className="field">
        <label htmlFor="password">Mật khẩu</label>
        <input autoComplete="current-password" id="password" name="password" type="password" required disabled={!configured || pending} />
      </div>
      <button className="button" type="submit" disabled={!configured || pending}>
        {pending ? "Đang đăng nhập…" : "Đăng nhập"}
      </button>
      <p className="form-note">Tài khoản được cấp riêng cho chủ cửa hàng. Không có đăng ký công khai.</p>
    </form>
  );
}
