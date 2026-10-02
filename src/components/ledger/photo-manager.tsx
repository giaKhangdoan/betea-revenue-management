"use client";

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient as createBrowserClient } from "@/lib/supabase/browser";
import { addDayPhotoRecord, deleteDayPhotoRecord } from "@/app/(private)/ledger/photo-actions";

type Photo = {
  id: string;
  category: string;
  shift_code: string | null;
  object_path: string;
  caption: string | null;
  signed_url: string;
};

type UploadMetadata = { category: string; shiftCode: string; caption: string };
type UploadStatus = "queued" | "preparing" | "uploading" | "saving" | "saved" | "failed";
type UploadItem = {
  id: string;
  sourceFile: File;
  previewUrl: string;
  status: UploadStatus;
  preparedFile?: File;
  objectPath?: string;
  metadata?: UploadMetadata;
  message?: string;
  retryable?: boolean;
};

const TARGET_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_BATCH_SIZE = 20;
const EVIDENCE_BUCKET = "betea-evidence";
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

const categoryLabels: Record<string, string> = {
  bluebook: "Bluebook",
  cleaning: "Vệ sinh",
  arrangement: "Sắp xếp",
  other: "Khác",
};

const statusLabels: Record<UploadStatus, string> = {
  queued: "Đang chờ tải lên",
  preparing: "Đang chuẩn bị ảnh",
  uploading: "Đang tải ảnh lên",
  saving: "Đang lưu nhãn ảnh",
  saved: "Đã lưu",
  failed: "Chưa tải xong",
};

export function PhotoManager({ date, initialPhotos, ownerId, canDelete = true, canUpload = true }: { date: string; initialPhotos: Photo[]; ownerId: string; canDelete?: boolean; canUpload?: boolean }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const previewDialogRef = useRef<HTMLDialogElement>(null);
  const uploadItemsRef = useRef<UploadItem[]>([]);
  const busyRef = useRef(false);
  const [uploadItems, setUploadItems] = useState<UploadItem[]>([]);
  const [category, setCategory] = useState("bluebook");
  const [shiftCode, setShiftCode] = useState("");
  const [caption, setCaption] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [activePhoto, setActivePhoto] = useState<{ url: string; title: string; detail: string } | null>(null);
  const [savedPhotos, setSavedPhotos] = useState<Photo[]>(initialPhotos);
  const savedPhotosRef = useRef<Photo[]>(initialPhotos);
  const signedUrlExpiryRef = useRef(new Map<string, number>());

  useEffect(() => {
    const now = Date.now();
    const previousPhotos = new Map(savedPhotosRef.current.map((photo) => [photo.id, photo]));
    const nextPhotos = initialPhotos.map((photo) => {
      const previousPhoto = previousPhotos.get(photo.id);
      const previousExpiry = signedUrlExpiryRef.current.get(photo.id);
      if (previousPhoto && previousExpiry !== undefined && previousExpiry > now) {
        return { ...photo, signed_url: previousPhoto.signed_url };
      }
      signedUrlExpiryRef.current.set(photo.id, now + 300_000);
      return photo;
    });
    const nextPhotoIds = new Set(nextPhotos.map((photo) => photo.id));
    for (const photoId of signedUrlExpiryRef.current.keys()) {
      if (!nextPhotoIds.has(photoId)) signedUrlExpiryRef.current.delete(photoId);
    }
    savedPhotosRef.current = nextPhotos;
    setSavedPhotos(nextPhotos);
  }, [initialPhotos]);

  function replaceUploadItems(nextItems: UploadItem[]) {
    uploadItemsRef.current = nextItems;
    setUploadItems(nextItems);
  }

  function updateUploadItem(id: string, updates: Partial<UploadItem>) {
    const nextItems = uploadItemsRef.current.map((item) => item.id === id ? { ...item, ...updates } : item);
    replaceUploadItems(nextItems);
    return nextItems.find((item) => item.id === id);
  }

  useEffect(() => () => {
    for (const item of uploadItemsRef.current) URL.revokeObjectURL(item.previewUrl);
  }, []);

  useEffect(() => {
    const dialog = previewDialogRef.current;
    if (activePhoto && dialog && !dialog.open) dialog.showModal();
    return () => {
      if (dialog?.open) dialog.close();
    };
  }, [activePhoto]);

  async function prepareImage(file: File): Promise<File> {
    if (file.size <= TARGET_IMAGE_BYTES) return file;
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
        if (blob && blob.size <= TARGET_IMAGE_BYTES) {
          return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp", lastModified: file.lastModified });
        }
        if (blob && quality === 0.78) {
          scale = Math.min(scale, 1900 / Math.max(bitmap.width, bitmap.height));
          const smaller = document.createElement("canvas");
          smaller.width = Math.max(1, Math.round(bitmap.width * scale));
          smaller.height = Math.max(1, Math.round(bitmap.height * scale));
          const smallerContext = smaller.getContext("2d");
          if (!smallerContext) break;
          smallerContext.drawImage(bitmap, 0, 0, smaller.width, smaller.height);
          const smallerBlob = await new Promise<Blob | null>((resolve) => smaller.toBlob(resolve, "image/webp", 0.76));
          if (smallerBlob && smallerBlob.size <= TARGET_IMAGE_BYTES) {
            return new File([smallerBlob], `${file.name.replace(/\.[^.]+$/, "")}.webp`, { type: "image/webp", lastModified: file.lastModified });
          }
        }
      }
      throw new Error(`Ảnh “${file.name}” vẫn lớn hơn 2 MB sau khi nén. Hãy chọn ảnh có độ phân giải thấp hơn.`);
    } finally {
      bitmap.close();
    }
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const selectedFiles = Array.from(input.files ?? []);
    input.value = "";
    if (selectedFiles.length === 0) return;
    if (selectedFiles.length > MAX_BATCH_SIZE) {
      setMessage("Mỗi lần chọn tối đa 20 ảnh.");
      return;
    }
    const invalidFile = selectedFiles.find((file) => !allowedImageTypes.has(file.type));
    if (invalidFile) {
      setMessage(`Ảnh “${invalidFile.name}” không đúng định dạng. Chỉ nhận JPEG, PNG hoặc WebP.`);
      return;
    }

    const currentItems = uploadItemsRef.current;
    const unfinishedItems = currentItems.filter((item) => item.status !== "saved");
    if (unfinishedItems.length + selectedFiles.length > MAX_BATCH_SIZE) {
      setMessage("Danh sách đang có tối đa 20 ảnh chưa lưu. Hãy tải xong ảnh hiện tại rồi chọn thêm.");
      return;
    }

    for (const item of currentItems) {
      if (item.status === "saved") URL.revokeObjectURL(item.previewUrl);
    }
    const newItems = selectedFiles.map((file): UploadItem => ({
      id: crypto.randomUUID(),
      sourceFile: file,
      previewUrl: URL.createObjectURL(file),
      status: "queued",
    }));
    replaceUploadItems([...unfinishedItems, ...newItems]);
    setMessage("");
  }

  async function uploadOne(
    id: string,
    client: NonNullable<ReturnType<typeof createBrowserClient>>,
    ownerId: string,
    currentMetadata: UploadMetadata,
  ) {
    let item = uploadItemsRef.current.find((candidate) => candidate.id === id);
    if (!item || item.status === "saved") return;

    const metadata = item.metadata ?? currentMetadata;
    updateUploadItem(id, { status: "preparing", metadata, message: undefined, retryable: true });
    item = uploadItemsRef.current.find((candidate) => candidate.id === id);
    if (!item) return;

    const preparedFile = item.preparedFile ?? await prepareImage(item.sourceFile);
    const extension = preparedFile.type === "image/jpeg" ? "jpg" : preparedFile.type.split("/")[1];
    const objectPath = item.objectPath ?? `${ownerId}/${date}/${crypto.randomUUID()}.${extension}`;
    updateUploadItem(id, { preparedFile, objectPath, status: "uploading" });

    // Check both stores before retrying so a response lost after a successful write
    // cannot create another metadata row or upload the same image again.
    const { data: existingPhoto, error: metadataLookupError } = await client.from("day_photos")
      .select("id").eq("owner_id", ownerId).eq("object_path", objectPath).maybeSingle();
    if (metadataLookupError) throw new Error("Chưa kiểm tra được ảnh đã lưu. Hãy thử lại sau.");

    const folderPath = objectPath.slice(0, objectPath.lastIndexOf("/"));
    const fileName = objectPath.slice(objectPath.lastIndexOf("/") + 1);
    const { data: storedObjects, error: listError } = await client.storage.from(EVIDENCE_BUCKET)
      .list(folderPath, { limit: 100, search: fileName });
    if (listError) throw new Error("Chưa kiểm tra được tệp ảnh trong kho. Hãy thử lại sau.");
    const objectAlreadyUploaded = storedObjects.some((object) => object.name === fileName);

    // A metadata row without its private Storage object is not a saved photo.
    // Restore that exact object path so the existing label continues to work.
    if (!objectAlreadyUploaded) {
      const { error: uploadError } = await client.storage.from(EVIDENCE_BUCKET).upload(objectPath, preparedFile, {
        cacheControl: "86400", contentType: preparedFile.type, upsert: false,
      });
      if (uploadError) throw new Error("Tải ảnh lên thất bại. Hãy thử lại; ứng dụng sẽ kiểm tra tệp trước khi gửi lại.");
    }

    if (existingPhoto) {
      updateUploadItem(id, { status: "saved", message: undefined, retryable: false });
      return;
    }

    updateUploadItem(id, { status: "saving" });
    const result = await addDayPhotoRecord({ date, category: metadata.category, shiftCode: metadata.shiftCode, objectPath, caption: metadata.caption });
    if (!result.error) {
      updateUploadItem(id, { status: "saved", message: undefined, retryable: false });
      return;
    }

    const { data: savedAfterError, error: recheckError } = await client.from("day_photos")
      .select("id").eq("owner_id", ownerId).eq("object_path", objectPath).maybeSingle();
    if (recheckError) {
      throw new Error("Ảnh đã tải lên nhưng chưa xác nhận được nhãn. Hãy thử lại; ứng dụng sẽ kiểm tra trước khi gửi lại.");
    }
    if (savedAfterError) {
      updateUploadItem(id, { status: "saved", message: undefined, retryable: false });
      return;
    }

    const { error: cleanupError } = await client.storage.from(EVIDENCE_BUCKET).remove([objectPath]);
    if (cleanupError) {
      throw new Error(`${result.error} Tệp ảnh vẫn còn trong kho; hãy thử lại để lưu nhãn mà không tải ảnh lần nữa.`);
    }
    throw new Error(result.error);
  }

  async function processUploads(ids: string[]) {
    if (busyRef.current) return;
    const client = createBrowserClient();
    if (!client) {
      setMessage("Ứng dụng chưa kết nối kho ảnh.");
      return;
    }

    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const currentMetadata: UploadMetadata = { category, shiftCode, caption: caption.trim() };
      for (const id of ids) {
        const item = uploadItemsRef.current.find((candidate) => candidate.id === id);
        if (!item || item.status === "saved") continue;
        try {
          await uploadOne(id, client, ownerId, currentMetadata);
        } catch (error) {
          const currentItem = uploadItemsRef.current.find((candidate) => candidate.id === id);
          updateUploadItem(id, {
            status: "failed",
            message: error instanceof Error ? error.message : "Chưa tải được ảnh.",
            retryable: Boolean(currentItem?.preparedFile || currentItem?.objectPath),
          });
        }
      }

      const processedItems = uploadItemsRef.current.filter((item) => ids.includes(item.id));
      const failedCount = processedItems.filter((item) => item.status === "failed").length;
      const savedCount = processedItems.filter((item) => item.status === "saved").length;
      for (const item of processedItems) {
        if (item.status === "saved") URL.revokeObjectURL(item.previewUrl);
      }
      replaceUploadItems(uploadItemsRef.current.filter((item) => item.status !== "saved"));
      if (failedCount > 0) setMessage(`${savedCount} ảnh đã lưu, ${failedCount} ảnh chưa xong. Có thể thử lại riêng từng ảnh.`);
      else {
        setMessage(`Đã lưu ${savedCount} ảnh.`);
        setCaption("");
      }
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Chưa tải được ảnh.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function uploadSelected(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const ids = uploadItemsRef.current
      .filter((item) => item.status === "queued" || (item.status === "failed" && item.retryable))
      .map((item) => item.id);
    if (ids.length === 0) {
      setMessage("Chọn ảnh cần tải lên trước.");
      return;
    }
    void processUploads(ids);
  }

  function retryOne(id: string) {
    void processUploads([id]);
  }

  function discardQueuedItem(id: string) {
    const item = uploadItemsRef.current.find((candidate) => candidate.id === id);
    const canDiscard = item?.status === "queued" || (item?.status === "failed" && !item.retryable && !item.objectPath);
    if (!item || !canDiscard || busyRef.current) return;
    URL.revokeObjectURL(item.previewUrl);
    replaceUploadItems(uploadItemsRef.current.filter((candidate) => candidate.id !== id));
    setMessage("Đã bỏ ảnh khỏi danh sách. Ảnh chưa được tải lên.");
  }

  async function removePhoto(id: string) {
    if (busyRef.current || !canDelete) return;
    const photo = savedPhotos.find((item) => item.id === id);
    const category = photo ? categoryLabels[photo.category] ?? "ảnh" : "ảnh";
    if (!window.confirm(`Xóa ${category.toLowerCase()} này khỏi ngày ${date}? Ảnh đã xóa không thể khôi phục từ màn hình này.`)) return;
    busyRef.current = true;
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
      busyRef.current = false;
      setBusy(false);
    }
  }

  const hasRetryableItems = uploadItems.some((item) => item.status === "queued" || (item.status === "failed" && item.retryable));
  const retryableCount = uploadItems.filter((item) => item.status === "queued" || (item.status === "failed" && item.retryable)).length;

  return (
    <section className="surface photo-card">
      <div className="section-heading"><div><h2>Ảnh xác nhận</h2><p>Bluebook, vệ sinh và sắp xếp · ảnh sẽ được nén còn khoảng 2 MB</p></div><strong>{savedPhotos.length} ảnh đã lưu</strong></div>
      <form className="photo-form" onSubmit={uploadSelected}>
        <label className="field"><span>Loại ảnh</span><select value={category} onChange={(event) => setCategory(event.target.value)} disabled={busy || !canUpload}><option value="bluebook">Bluebook</option><option value="cleaning">Vệ sinh</option><option value="arrangement">Sắp xếp</option><option value="other">Khác</option></select></label>
        <label className="field"><span>Gắn với ca (không bắt buộc)</span><select value={shiftCode} onChange={(event) => setShiftCode(event.target.value)} disabled={busy || !canUpload}><option value="">Cả ngày</option><option value="06-10">Ca 06:00–10:00</option><option value="10-14">Ca 10:00–14:00</option><option value="14-18">Ca 14:00–18:00</option><option value="18-22">Ca 18:00–22:00</option></select></label>
        <label className="field"><span>Ghi chú cho ảnh (không bắt buộc)</span><input value={caption} onChange={(event) => setCaption(event.target.value)} maxLength={240} placeholder="Ví dụ: ảnh bàn giao ca tối" disabled={busy || !canUpload} /></label>
        <div className="field"><span>Ảnh cần lưu</span><div className="photo-picker"><input className="visually-hidden" id={`photo-files-${date}`} ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={selectFiles} disabled={busy || !canUpload} aria-label="Chọn ảnh JPEG, PNG hoặc WebP" /><button className="button button-secondary" type="button" onClick={() => fileRef.current?.click()} disabled={busy || !canUpload}>Chọn ảnh từ thiết bị</button><span className="photo-picker-note">Có thể chọn nhiều ảnh · JPEG, PNG hoặc WebP</span></div><p className="form-note">Loại ảnh, ca và ghi chú bên trên sẽ áp dụng cho tất cả ảnh đã chọn.</p></div>
        {uploadItems.length > 0 ? <p className="photo-selection-summary" aria-live="polite">{uploadItems.length} ảnh trong danh sách · xem trước từng ảnh, bỏ ảnh chọn nhầm rồi mới lưu.</p> : <p className="form-note" aria-live="polite">Chưa chọn ảnh.</p>}
        {message ? <p className={message.startsWith("Đã") ? "form-success" : "form-error"} role="status">{message}</p> : null}
        <button className="button" type="submit" disabled={!canUpload || busy || !hasRetryableItems}>{busy ? "Đang lưu ảnh…" : retryableCount > 0 ? `Lưu ${retryableCount} ảnh` : canUpload ? "Chọn ảnh trước khi lưu" : "Chỉ xem ảnh"}</button>
      </form>

      {uploadItems.length > 0 ? (
        <div className="photo-grid" role="list" aria-label="Ảnh đang tải lên">
          {uploadItems.map((item) => (
            <article className="photo-item" key={item.id} role="listitem" aria-label={`Ảnh tải lên: ${item.sourceFile.name}`}>
              <button className="photo-preview-button" type="button" onClick={() => setActivePhoto({ url: item.previewUrl, title: item.sourceFile.name, detail: `${categoryLabels[category] ?? "Ảnh"}${shiftCode ? ` · Ca ${shiftCode.replace("-", ":00–")}:00` : " · Cả ngày"}${caption.trim() ? ` · ${caption.trim()}` : ""}` })} aria-label={`Xem ảnh lớn: ${item.sourceFile.name}`}>
                <Image src={item.previewUrl} alt={`Xem trước ${item.sourceFile.name}`} width={600} height={450} unoptimized />
              </button>
              <div className="photo-meta"><div>
                <strong>{item.sourceFile.name}</strong>
                <span>{categoryLabels[category] ?? "Ảnh"} · {shiftCode ? `Ca ${shiftCode.replace("-", ":00–")}:00` : "Cả ngày"}</span>
                {caption.trim() ? <span>{caption.trim()}</span> : null}
                <span role="status">{statusLabels[item.status]}</span>
                {item.message ? <span className="form-error">{item.message}</span> : null}
                {item.status === "preparing" || item.status === "uploading" || item.status === "saving" ? (
                  <progress aria-label={`Tiến độ ${statusLabels[item.status].toLowerCase()}: ${item.sourceFile.name}`} />
                ) : item.status === "saved" ? (
                  <progress max={100} value={100} aria-label={`Đã tải xong ${item.sourceFile.name}`} />
                ) : null}
              </div><div className="photo-actions"><button className="text-button" type="button" onClick={() => setActivePhoto({ url: item.previewUrl, title: item.sourceFile.name, detail: `${categoryLabels[category] ?? "Ảnh"}${shiftCode ? ` · Ca ${shiftCode.replace("-", ":00–")}:00` : " · Cả ngày"}${caption.trim() ? ` · ${caption.trim()}` : ""}` })}>Xem ảnh</button>
                {item.status === "failed" && item.retryable ? <button className="text-button" type="button" onClick={() => retryOne(item.id)} disabled={busy} aria-label={`Thử lại ảnh ${item.sourceFile.name}`}>Thử lại</button> : null}
                {(item.status === "queued" || (item.status === "failed" && !item.retryable && !item.objectPath)) ? <button className="text-button" type="button" onClick={() => discardQueuedItem(item.id)} disabled={busy} aria-label={`Bỏ ảnh ${item.sourceFile.name} khỏi danh sách`}>Bỏ ảnh</button> : null}
              </div></div>
            </article>
          ))}
        </div>
      ) : null}

      {savedPhotos.length === 0 && uploadItems.length === 0 ? <div className="photo-empty-state"><strong>Chưa có ảnh lưu cho ngày này</strong><p>Chọn Bluebook, ảnh vệ sinh hoặc sắp xếp. Ảnh sẽ hiện ở đây sau khi lưu.</p></div> : savedPhotos.length > 0 ? (
        <div className="photo-grid">
          {savedPhotos.map((photo) => <article className="photo-item" key={photo.id}>
            {/* Signed URLs expire quickly; the database stores only the private object path. */}
            <button className="photo-preview-button" type="button" onClick={() => setActivePhoto({ url: photo.signed_url, title: categoryLabels[photo.category] ?? "Ảnh", detail: `${photo.shift_code ? `Ca ${photo.shift_code.replace("-", ":00–")}:00` : "Cả ngày"}${photo.caption ? ` · ${photo.caption}` : ""}` })} aria-label={`Xem ảnh lớn: ${categoryLabels[photo.category] ?? "Ảnh"}${photo.caption ? `, ${photo.caption}` : ""}`}><Image src={photo.signed_url} alt={`${categoryLabels[photo.category] ?? "Ảnh"}${photo.caption ? `: ${photo.caption}` : ""}`} width={600} height={450} loading="lazy" unoptimized /></button>
            <div className="photo-meta"><div><strong>{categoryLabels[photo.category] ?? "Ảnh"}</strong><span>{photo.shift_code ? `Ca ${photo.shift_code.replace("-", ":00–")}:00` : "Cả ngày"}</span>{photo.caption ? <span>{photo.caption}</span> : null}</div><div className="photo-actions"><button className="text-button" type="button" onClick={() => setActivePhoto({ url: photo.signed_url, title: categoryLabels[photo.category] ?? "Ảnh", detail: `${photo.shift_code ? `Ca ${photo.shift_code.replace("-", ":00–")}:00` : "Cả ngày"}${photo.caption ? ` · ${photo.caption}` : ""}` })}>Xem ảnh</button>{canDelete ? <button className="text-button text-button-danger" type="button" onClick={() => removePhoto(photo.id)} disabled={busy}>Xóa ảnh</button> : null}</div></div>
          </article>)}
        </div>
      ) : null}
      <dialog className="photo-preview-dialog" ref={previewDialogRef} aria-labelledby="photo-preview-title" onClose={() => setActivePhoto(null)} onClick={(event) => { if (event.target === event.currentTarget) previewDialogRef.current?.close(); }}>
        {activePhoto ? <div className="photo-preview-dialog-content"><div className="photo-preview-dialog-heading"><div><h2 id="photo-preview-title">{activePhoto.title}</h2><p>{activePhoto.detail}</p></div><button className="button button-secondary" type="button" autoFocus onClick={() => previewDialogRef.current?.close()}>Đóng ảnh</button></div><Image src={activePhoto.url} alt={`${activePhoto.title}${activePhoto.detail ? ` · ${activePhoto.detail}` : ""}`} width={1600} height={1200} unoptimized /></div> : null}
      </dialog>
    </section>
  );
}
