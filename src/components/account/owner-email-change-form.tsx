"use client";

import { useActionState } from "react";
import { changeOwnerEmailAction } from "@/app/(private)/account/actions";

export function OwnerEmailChangeForm() {
  const [state, action, pending] = useActionState(changeOwnerEmailAction, undefined);

  return <form action={action} className="account-email-form">
    <label className="field" htmlFor="new-account-email">
      <span>Email mới</span>
      <input autoComplete="email" id="new-account-email" maxLength={254} name="email" required type="email" disabled={pending} />
    </label>
    <label className="field" htmlFor="confirm-account-email">
      <span>Nhập lại email mới</span>
      <input autoComplete="email" id="confirm-account-email" maxLength={254} name="confirmEmail" required type="email" disabled={pending} />
    </label>
    {state?.error ? <p className="form-error" role="alert">{state.error}</p> : null}
    {state?.success ? <p className="form-success" role="status">{state.success}</p> : null}
    <button className="button" type="submit" disabled={pending}>
      {pending ? "Đang gửi yêu cầu…" : "Gửi email xác nhận"}
    </button>
  </form>;
}
