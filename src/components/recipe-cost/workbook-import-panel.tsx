"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";
import { resolveWorkbookImportReviewItem } from "@/app/(private)/product-costs/actions";
import type { CogsWorkbookPreview } from "@/lib/recipe-cost/workbook-import";
import { createWorkbookReviewCsv } from "@/lib/recipe-cost/review-csv";
import type { RecipeCostDocument } from "@/lib/recipe-cost/types";

function amount(value: string | number | null) {
  if (value === null) return "—";
  const number = Number(value);
  return Number.isFinite(number) ? `${new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(number)} ₫` : "—";
}

export function WorkbookImportPanel({ revision, effectiveDate, disabled, reviewItems, importedFiles }: {
  revision: number;
  effectiveDate: string;
  disabled: boolean;
  reviewItems: NonNullable<RecipeCostDocument["importReview"]>["items"];
  importedFiles: NonNullable<RecipeCostDocument["importReview"]>["importedFiles"];
}) {
  const router = useRouter();
  const [resolutionState, resolveAction, resolving] = useActionState(resolveWorkbookImportReviewItem, undefined);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CogsWorkbookPreview | null>(null);
  const [previewRevision, setPreviewRevision] = useState<number | null>(null);
  const [date, setDate] = useState(effectiveDate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const pendingReviewItems = reviewItems.filter((item) => item.required);
  const resolvedReviewItems = reviewItems.filter((item) => !item.required);
  const matchingReviewItems = pendingReviewItems.filter((item) => {
    const query = reviewFilter.trim().toLocaleLowerCase("vi-VN");
    return !query || `${item.sourceCell} ${item.name} ${item.reason}`.toLocaleLowerCase("vi-VN").includes(query);
  }).slice(0, 100);

  useEffect(() => {
    if (resolutionState?.revision !== undefined) router.refresh();
  }, [resolutionState?.revision, router]);

  async function request(mode: "preview" | "confirm") {
    if (!file || busy || disabled) return;
    setBusy(true); setError(""); setSuccess("");
    try {
      const data = new FormData();
      data.set("mode", mode);
      data.set("file", file);
      if (mode === "confirm" && preview) {
        data.set("expectedRevision", String(previewRevision ?? revision));
        data.set("expectedHash", preview.sha256);
        data.set("effectiveDate", date);
      }
      const response = await fetch("/api/recipe-cost/import", { method: "POST", body: data, cache: "no-store" });
      const result = await response.json() as { error?: string; preview?: CogsWorkbookPreview; workspaceRevision?: number; success?: boolean; importedIngredients?: number; unresolvedCount?: number; revision?: number };
      if (!response.ok) throw new Error(result.error || "Không hoàn tất được yêu cầu.");
      if (mode === "preview" && result.preview) {
        setPreview(result.preview);
        setPreviewRevision(Number.isSafeInteger(result.workspaceRevision) ? result.workspaceRevision! : revision);
        setSuccess("Đã đọc workbook. Chưa có dữ liệu nào được ghi vào hệ thống.");
      } else if (mode === "confirm" && result.success) {
        setSuccess(`Đã nhập ${result.importedIngredients ?? 0} nguyên liệu vào phiên bản ${result.revision ?? "mới"}. Còn ${result.unresolvedCount ?? 0} mục cần đối soát.`);
        setPreview(null); setPreviewRevision(null); setFile(null);
        router.refresh();
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Không hoàn tất được yêu cầu.");
    } finally {
      setBusy(false);
    }
  }

  function downloadReviewCsv(items: typeof reviewItems, filename: string) {
    const content = createWorkbookReviewCsv(items);
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename; anchor.click();
    URL.revokeObjectURL(url);
  }

  return <>
    <div className="section-heading"><div><h2>Nhập workbook COGS BETEA</h2><p>Chỉ đọc file để lập preview. Workbook gốc không được sửa hoặc lưu lên máy chủ.</p></div><span className="status status-neutral">Owner only</span></div>
    <div className="recipe-import-upload">
      <label className="field"><span>Chọn file Excel (.xlsx, tối đa 4 MB)</span><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={disabled || busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setPreview(null); setPreviewRevision(null); setError(""); setSuccess(""); }} /></label>
      <label className="field"><span>Ngày hiệu lực giá</span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setPreview(null); setPreviewRevision(null); }} disabled={disabled || busy} /><small>Ngày này gắn với giá mua đã đọc từ workbook. Bạn có thể nhập ngày cũ nếu giá đó có hiệu lực từ trước.</small></label>
      <button className="button" type="button" disabled={!file || disabled || busy} onClick={() => void request("preview")}>{busy ? "Đang đọc…" : "Xem trước và đối soát"}</button>
    </div>
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    {success ? <p className="form-success" role="status">{success}</p> : null}
    {importedFiles.length ? <details className="recipe-saved-review">
      <summary>Workbook đã nhập · {pendingReviewItems.length} mục chờ · {resolvedReviewItems.length} mục đã ghi nhận</summary>
      <div className="recipe-saved-review-content"><div className="section-heading"><div><h3>Danh sách đối soát đã lưu</h3><p>{importedFiles.map((item) => `${item.filename} · ${item.ingredientCount} nguyên liệu`).join("; ")}</p></div>{reviewItems.length ? <button className="button button-secondary" type="button" onClick={() => downloadReviewCsv(reviewItems, "betea-workbook-review.csv")}>Tải danh sách CSV</button> : <span className="status status-success">Đã đối soát</span>}</div>
        {pendingReviewItems.length ? <form action={resolveAction} className="recipe-review-resolve"><input type="hidden" name="expected_revision" value={revision} /><label className="field"><span>Tìm mục theo ô nguồn, tên hoặc lý do</span><input value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value)} placeholder="Ví dụ: Bảng NVl!F50 hoặc Mật ong" /></label><label className="field"><span>Mục cần ghi nhận đã xử lý</span><select name="item_id" required defaultValue=""><option value="" disabled>Chọn một mục trong kết quả</option>{matchingReviewItems.map((item) => <option key={item.id} value={item.id}>{item.sourceCell} · {item.name} — {item.reason.slice(0, 140)}</option>)}</select><small>Đang hiện {matchingReviewItems.length} trên {pendingReviewItems.length} mục phù hợp; tìm kiếm nếu chưa thấy.</small></label><label className="field"><span>Ghi chú cách đối soát</span><input name="resolution_note" minLength={5} maxLength={500} required placeholder="Ví dụ: đã đối chiếu lại giá mua với hóa đơn ngày…" /></label><button className="button button-secondary" type="submit" disabled={resolving || !matchingReviewItems.length}>{resolving ? "Đang lưu…" : "Ghi nhận đã xử lý"}</button>{resolutionState?.error ? <p className="form-error" role="alert">{resolutionState.error}</p> : null}{resolutionState?.success ? <p className="form-success" role="status">{resolutionState.success}</p> : null}</form> : <p className="form-note">Không còn mục bắt buộc cần đối soát.</p>}
        {reviewItems.length ? <ul>{[...pendingReviewItems, ...resolvedReviewItems].slice(0, 24).map((item) => <li key={item.id}><div><strong>{item.sourceCell}</strong><span>{item.name}</span><span className={item.required ? "status status-warning" : "status status-success"}>{item.required ? "Chờ xử lý" : "Đã ghi nhận"}</span></div><p>{item.reason}</p>{item.resolutionNote ? <p>Ghi chú: {item.resolutionNote}</p> : null}</li>)}</ul> : null}
        {reviewItems.length > 24 ? <p className="form-note">Đang hiện 24 trên {reviewItems.length} mục; tải CSV để xem đầy đủ.</p> : null}
      </div>
    </details> : null}
    {preview ? <div className="recipe-import-preview">
      <div className="section-heading"><div><h3>Đối soát trước khi nhập</h3><p>{preview.filename} · SHA-256 {preview.sha256.slice(0, 16)}… · ngày hiệu lực {date}</p></div><span className={preview.summary.canMarkComplete ? "status status-success" : "status status-warning"}>{preview.summary.canMarkComplete ? "Có thể hoàn tất" : "Còn mục chờ xem"}</span></div>
      <div className="recipe-import-stats"><div><span>Nguyên liệu có thể nhập</span><strong>{preview.summary.importableIngredients}</strong></div><div><span>Tổng giá mua có thể nhập</span><strong>{amount(preview.summary.totalPurchasePriceVnd)}</strong></div><div><span>Mục giữ lại để xem</span><strong>{preview.summary.reviewItems}</strong></div><div><span>Cảnh báo công thức</span><strong>{preview.summary.recipeWarnings}</strong></div></div>
      {preview.ingredients.length ? <div className="recipe-import-table-wrap"><table className="recipe-import-table"><thead><tr><th>Nguyên liệu</th><th>Giá mua</th><th>Lượng / đơn vị cost</th><th>Nguồn</th></tr></thead><tbody>{preview.ingredients.slice(0, 20).map((item) => <tr key={item.id}><td>{item.name}</td><td>{amount(item.purchasePriceVnd)}</td><td>{item.purchaseQuantity} {item.purchaseUnit} → {item.costUnit}</td><td>{item.sourceTrace?.sheet}!{item.sourceTrace?.cell}</td></tr>)}</tbody></table>{preview.ingredients.length > 20 ? <p className="form-note">Đang hiện 20 trên {preview.ingredients.length} dòng nhập được.</p> : null}</div> : <p className="form-note">Workbook không có nguyên liệu gốc nào đủ điều kiện nhập tự động.</p>}
      {preview.reviewItems.length ? <div className="recipe-review-queue"><div className="section-heading"><div><h3>Hàng chờ đối soát</h3><p>Những dòng này không bị nhập thành 0 và không được xem là đã hoàn tất.</p></div><span className="status status-warning">{preview.reviewItems.length} mục</span></div><button className="button button-secondary" type="button" onClick={() => downloadReviewCsv(preview.reviewItems, "betea-workbook-preview-review.csv")}>Tải toàn bộ danh sách CSV</button><ul>{preview.reviewItems.slice(0, 18).map((item) => <li key={item.id}><div><strong>{item.sourceCell}</strong><span>{item.name}</span></div><p>{item.reason}</p></li>)}</ul>{preview.reviewItems.length > 18 ? <p className="form-note">Còn {preview.reviewItems.length - 18} mục chưa hiển thị. Có thể tải toàn bộ danh sách CSV để đối soát trước khi nhập.</p> : null}</div> : null}
      <div className="recipe-import-confirm"><p>Chỉ những dòng có thể nhập được đưa vào workspace. Món, cốt và công thức size cần được rà soát thủ công trước khi nhập riêng.</p><button type="button" className="button" disabled={disabled || busy || !file || !date} onClick={() => void request("confirm")}>{busy ? "Đang lưu…" : `Xác nhận nhập ${preview.summary.importableIngredients} nguyên liệu`}</button></div>
    </div> : null}
  </>;
}
