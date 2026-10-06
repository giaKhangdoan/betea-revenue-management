"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type UploadItem = {
  id: string;
  file: File;
  previewUrl: string;
  caption: string;
  status: "ready" | "uploading" | "saved" | "failed";
  message?: string;
};

type UploadResponse = { uploadIntentId?: string; uploadUrl?: string; requiredHeaders?: Record<string, string>; error?: string };

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const maxFileSize = 2 * 1024 * 1024;

export function EvidenceUploader({ voucherId, reimbursementId }: { voucherId: string; reimbursementId?: string | null }) {
  const router = useRouter();
  const previewUrls = useRef(new Set<string>());
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => {
    for (const url of previewUrls.current) URL.revokeObjectURL(url);
    previewUrls.current.clear();
  }, []);

  function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    setError("");
    const added: UploadItem[] = [];
    for (const file of Array.from(fileList)) {
      if (!acceptedTypes.has(file.type)) { setError("Chỉ nhận ảnh JPEG, PNG hoặc WebP."); continue; }
      if (file.size > maxFileSize) { setError("Mỗi ảnh tối đa 2 MB. Hãy nén ảnh trước khi tải lên."); continue; }
      const previewUrl = URL.createObjectURL(file);
      previewUrls.current.add(previewUrl);
      added.push({ id: crypto.randomUUID(), file, previewUrl, caption: "", status: "ready" });
    }
    if (added.length) setItems((current) => [...current, ...added]);
  }

  function updateCaption(id: string, caption: string) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, caption } : item));
  }

  function removeItem(id: string) {
    setItems((current) => {
      const removed = current.find((item) => item.id === id);
      if (removed) {
        URL.revokeObjectURL(removed.previewUrl);
        previewUrls.current.delete(removed.previewUrl);
      }
      return current.filter((item) => item.id !== id);
    });
  }

  async function uploadSelected() {
    if (busy) return;
    const pendingItems = items.filter((item) => item.status === "ready" || item.status === "failed");
    if (!pendingItems.length) return;
    setBusy(true);
    setError("");
    for (const item of pendingItems) {
      setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "uploading", message: "Đang tạo phiên tải riêng tư…" } : entry));
      try {
        const intentResponse = await fetch("/api/admin/advances/evidence/upload", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({
            voucherId,
            reimbursementId: reimbursementId ?? null,
            contentType: item.file.type,
            size: item.file.size,
            fileName: item.file.name,
            caption: item.caption,
          }),
        });
        const intent = await intentResponse.json() as UploadResponse;
        if (!intentResponse.ok || !intent.uploadIntentId || !intent.uploadUrl) throw new Error(intent.error || "Chưa tạo được phiên tải ảnh.");

        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, message: "Đang tải ảnh lên kho riêng tư…" } : entry));
        const putResponse = await fetch(intent.uploadUrl, {
          method: "PUT",
          headers: intent.requiredHeaders ?? { "Content-Type": item.file.type },
          body: item.file,
          mode: "cors",
          credentials: "omit",
        });
        if (!putResponse.ok) throw new Error("Chưa tải được ảnh lên kho. Kiểm tra kết nối rồi thử lại.");

        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, message: "Đang xác nhận ảnh…" } : entry));
        const finalizeResponse = await fetch("/api/admin/advances/evidence/finalize", {
          method: "POST",
          headers: { "content-type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ uploadIntentId: intent.uploadIntentId }),
        });
        const finalize = await finalizeResponse.json() as { error?: string };
        if (!finalizeResponse.ok) throw new Error(finalize.error || "Chưa lưu được ảnh chứng từ.");
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "saved", message: "Đã lưu ảnh." } : entry));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Chưa tải được ảnh chứng từ.";
        setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, status: "failed", message } : entry));
        setError(message);
      }
    }
    setBusy(false);
    router.refresh();
  }

  return <section className="owner-evidence-uploader" aria-label="Tải ảnh hóa đơn">
    <div className="owner-evidence-upload-heading"><div><strong>Ảnh hóa đơn và chứng từ</strong><p>Ảnh được lưu riêng tư. Chọn nhiều ảnh; mỗi ảnh tối đa 2 MB.</p></div>
      <label className="button button-secondary owner-evidence-pick">Chọn ảnh<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => { addFiles(event.currentTarget.files); event.currentTarget.value = ""; }} /></label>
    </div>
    {items.length ? <div className="owner-evidence-queue">{items.map((item) => <article className="owner-evidence-queue-item" key={item.id}>
      {/* Local previews use object URLs and do not request the stored receipt. */}
      {/* eslint-disable-next-line @next/next/no-img-element -- This is a local blob preview; proxying it through an image optimizer would not help. */}
      <img src={item.previewUrl} alt={`Xem trước ${item.file.name}`} />
      <div className="owner-evidence-queue-fields"><strong>{item.file.name}</strong><span>{Math.max(1, Math.round(item.file.size / 1024))} KB</span>
        <div className="field"><label htmlFor={`${item.id}-caption`}>Ghi chú ảnh (không bắt buộc)</label><input id={`${item.id}-caption`} maxLength={500} value={item.caption} onChange={(event) => updateCaption(item.id, event.target.value)} disabled={item.status === "uploading" || item.status === "saved"} placeholder="Ví dụ: Mặt hàng nhận đủ" /></div>
        <span className={item.status === "failed" ? "owner-evidence-upload-status status-danger" : item.status === "saved" ? "owner-evidence-upload-status status-success" : "owner-evidence-upload-status status-neutral"} role={item.status === "failed" ? "alert" : "status"}>{item.message || (item.status === "ready" ? "Chờ tải lên" : "")}</span>
      </div>
      <button className="button button-plain" type="button" disabled={busy || item.status === "saved"} onClick={() => removeItem(item.id)}>Bỏ ảnh</button>
    </article>)}</div> : null}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {items.some((item) => item.status === "ready" || item.status === "failed") ? <button className="button" type="button" disabled={busy} onClick={() => void uploadSelected()}>{busy ? "Đang tải ảnh…" : "Tải các ảnh đã chọn"}</button> : null}
  </section>;
}
