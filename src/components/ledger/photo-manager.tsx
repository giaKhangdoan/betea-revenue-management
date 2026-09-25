"use client";

import { useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient as createBrowserClient } from "@/lib/supabase/browser";
import { addDayPhotoRecord, deleteDayPhotoRecord } from "@/app/ledger/photo-actions";

type Photo = {
  id: string;
  category: string;
  shift_code: string | null;
  object_path: string;
  caption: string | null;
  signed_url: string;
};

const categoryLabels: Record<string, string> = {
  bluebook: "Bluebook",
  cleaning: "Vệ sinh",
  arrangement: "Sắp xếp",
  other: "Khác",
};

export function PhotoManager({ date, initialPhotos }: { date: string; initialPhotos: Photo[] }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState("bluebook");
  const [shiftCode, setShiftCode] = useState("");
  const [caption, setCaption] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");

  async function prepareImage(file: File): Promise<File> {
    if (file.size <= 5 * 1024 * 1024) return file;
    const bitmap = await createImageBitmap(file);
    try {
      let scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
      for (const quality of [0.9, 0.84, 0.78]) {
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Không thể chuẩn bị ảnh trên thiết bị này.");
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", quality));
        if (blob && blob.size <= 5 * 1024 * 1024) return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp", lastModified: file.lastModified });
        if (blob && quality === 0.78) {
          scale = Math.min(scale, 1900 / Math.max(bitmap.width, bitmap.height));
          const smaller = document.createElement("canvas");
          smaller.width = Math.max(1, Math.round(bitmap.width * scale));
          smaller.height = Math.max(1, Math.round(bitmap.height * scale));
          const smallerContext = smaller.getContext("2d");
          if (!smallerContext) break;
          smallerContext.drawImage(bitmap, 0, 0, smaller.width, smaller.height);
          const smallerBlob = await new Promise<Blob | null>((resolve) => smaller.toBlob(resolve, "image/webp", 0.76));
          if (smallerBlob && smallerBlob.size <= 5 * 1024 * 1024) return new File([smallerBlob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp", lastModified: file.lastModified });
        }
      }
      throw new Error(`Ảnh “${file.name}” vẫn lớn hơn 5 MB sau khi nén. Hãy chọn ảnh có độ phân giải thấp hơn.`);
    } finally {
      bitmap.close();
    }
  }

  async function uploadPhotos(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const files = Array.from(fileRef.current?.files ?? []);
    if (files.length === 0) return setMessage("Chọn ít nhất một ảnh.");
    if (files.length > 20) return setMessage("Mỗi lần tải lên tối đa 20 ảnh.");
    const allowed = new Set(["image/jpeg", "image/png", "image/webp"]);
    const invalid = files.find((file) => !allowed.has(file.type));
    if (invalid) return setMessage("Chỉ nhận ảnh JPEG, PNG hoặc WebP.");

    const client = createBrowserClient();
    if (!client) return setMessage("Ứng dụng chưa kết nối kho ảnh.");
    setBusy(true);
    try {
      const { data: userData, error: authError } = await client.auth.getUser();
      if (authError || !userData.user) return setMessage("Phiên đăng nhập hết hạn. Hãy đăng nhập lại.");
      for (const [index, sourceFile] of files.entries()) {
        setProgress(`Đang chuẩn bị ảnh ${index + 1}/${files.length}`);
        const file = await prepareImage(sourceFile);
        setProgress(`Đang tải ảnh ${index + 1}/${files.length}`);
        const extension = file.type === "image/jpeg" ? "jpg" : file.type.split("/")[1];
        const objectPath = `${userData.user.id}/${date}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await client.storage.from("betea-evidence").upload(objectPath, file, {
          cacheControl: "3600", contentType: file.type, upsert: false,
        });
        if (uploadError) throw new Error("Tải ảnh lên thất bại. Kiểm tra kết nối và thử lại.");
        const result = await addDayPhotoRecord({ date, category, shiftCode, objectPath, caption });
        if (result.error) {
          const { error: cleanupError } = await client.storage.from("betea-evidence").remove([objectPath]);
          throw new Error(cleanupError ? `${result.error} Tệp ảnh chưa được dọn khỏi kho; liên hệ chủ quản để xử lý.` : result.error);
        }
      }
      if (fileRef.current) fileRef.current.value = "";
      setCaption("");
      setProgress("");
      setMessage(`Đã lưu ${files.length} ảnh.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Chưa tải được ảnh.");
      setProgress("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(id: string) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await deleteDayPhotoRecord({ date, id });
      if (result.error) setMessage(result.error);
      else {
        setMessage(result.success ?? "Đã xóa ảnh.");
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="surface photo-card">
      <div className="section-heading"><div><h2>Ảnh xác nhận</h2><p>Bluebook, vệ sinh và sắp xếp · tối đa 5 MB/ảnh</p></div><strong>{initialPhotos.length}</strong></div>
      <form className="photo-form" onSubmit={uploadPhotos}>
        <label className="field"><span>Loại ảnh</span><select value={category} onChange={(event) => setCategory(event.target.value)}><option value="bluebook">Bluebook</option><option value="cleaning">Vệ sinh</option><option value="arrangement">Sắp xếp</option><option value="other">Khác</option></select></label>
        <label className="field"><span>Gắn với ca (không bắt buộc)</span><select value={shiftCode} onChange={(event) => setShiftCode(event.target.value)}><option value="">Cả ngày</option><option value="06-10">Ca 06:00–10:00</option><option value="10-14">Ca 10:00–14:00</option><option value="14-18">Ca 14:00–18:00</option><option value="18-22">Ca 18:00–22:00</option></select></label>
        <label className="field"><span>Ghi chú cho ảnh (không bắt buộc)</span><input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={240} placeholder="Ví dụ: ảnh bàn giao ca tối" /></label>
        <label className="field"><span>Chọn ảnh · tối đa 20 ảnh/lần</span><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple required /></label>
        {progress ? <p className="form-note" role="status">{progress}</p> : null}
        {message ? <p className={message.startsWith("Đã") ? "form-success" : "form-error"} role="status">{message}</p> : null}
        <button className="button button-secondary" type="submit" disabled={busy}>{busy ? "Đang tải ảnh…" : "Tải ảnh lên"}</button>
      </form>
      {initialPhotos.length === 0 ? <p className="empty-inline">Chưa có ảnh cho ngày này.</p> : (
        <div className="photo-grid">
          {initialPhotos.map((photo) => <article className="photo-item" key={photo.id}>
            {/* Signed URLs expire quickly; the database stores only the private object path. */}
            <a href={photo.signed_url} target="_blank" rel="noreferrer"><Image src={photo.signed_url} alt={`${categoryLabels[photo.category] ?? "Ảnh"}${photo.caption ? `: ${photo.caption}` : ""}`} width={600} height={450} unoptimized /></a>
            <div className="photo-meta"><div><strong>{categoryLabels[photo.category] ?? "Ảnh"}</strong><span>{photo.shift_code ? `Ca ${photo.shift_code.replace("-", ":00–")}:00` : "Cả ngày"}</span>{photo.caption ? <span>{photo.caption}</span> : null}</div><button className="text-button" type="button" onClick={() => removePhoto(photo.id)} disabled={busy}>Xóa</button></div>
          </article>)}
        </div>
      )}
    </section>
  );
}
