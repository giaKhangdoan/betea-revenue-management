"use client";

import { useRef, useState } from "react";

export function EvidenceMigrationManager({ initialRemaining, unavailable }: { initialRemaining: number; unavailable: boolean }) {
  const [remaining, setRemaining] = useState(initialRemaining);
  const [migrated, setMigrated] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const stopRef = useRef(false);

  async function startMigration() {
    if (busy || unavailable || remaining === 0) return;
    stopRef.current = false;
    setBusy(true);
    setMessage("Đang chuyển từng ảnh và đối chiếu SHA-256…");

    try {
      while (!stopRef.current) {
        const result = await fetch("/api/admin/evidence/migrate-next", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
          cache: "no-store",
        });
        const body = await result.json() as { done?: boolean; migrated?: boolean; remaining?: number; error?: string };
        if (!result.ok) throw new Error(body.error ?? "Chưa chuyển được ảnh.");

        if (typeof body.remaining === "number") setRemaining(body.remaining);
        if (body.migrated) setMigrated((current) => current + 1);
        if (body.done) {
          setMessage("Đã chuyển xong toàn bộ ảnh. Bản lưu Supabase vẫn được giữ để dự phòng.");
          break;
        }
      }

      if (stopRef.current) setMessage("Đã tạm dừng sau ảnh đang xử lý. Bạn có thể tiếp tục sau.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Chưa chuyển được ảnh. Hãy thử lại.");
    } finally {
      setBusy(false);
    }
  }

  function pauseMigration() {
    stopRef.current = true;
  }

  const total = initialRemaining;
  const completed = Math.max(0, total - remaining);
  const percent = total === 0 ? 100 : Math.min(100, Math.round((completed / total) * 100));

  return (
    <div className="form-stack">
      <div className="electricity-grid">
        <div><span>Còn trên Supabase</span><strong>{new Intl.NumberFormat("vi-VN").format(remaining)} ảnh</strong></div>
        <div><span>Đã chuyển trong lượt này</span><strong>{new Intl.NumberFormat("vi-VN").format(migrated)} ảnh</strong></div>
      </div>
      <progress max={100} value={percent} aria-label={`Tiến độ chuyển ảnh ${percent}%`} />
      {message ? <p className={remaining === 0 ? "form-success" : "form-note"} role="status">{message}</p> : null}
      <div className="form-actions">
        <button className="button" type="button" onClick={() => void startMigration()} disabled={unavailable || busy || remaining === 0}>
          {busy ? "Đang chuyển ảnh…" : remaining === 0 ? "Đã chuyển xong" : migrated > 0 ? "Tiếp tục chuyển ảnh" : "Bắt đầu chuyển ảnh"}
        </button>
        {busy ? <button className="button button-secondary" type="button" onClick={pauseMigration}>Tạm dừng</button> : null}
      </div>
      <p className="form-note">Chỉ chủ cửa hàng dùng được màn hình này. Nếu bị gián đoạn, ảnh đã xác minh sẽ được giữ ở R2 và lần tiếp theo chỉ xử lý phần còn lại.</p>
    </div>
  );
}
