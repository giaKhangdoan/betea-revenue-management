"use client";

import { useState } from "react";
import { formatVnd } from "@/lib/finance/format";
import { formatPurchaseQuantity } from "@/lib/owner-advances/presentation";

export type PurchaseLineDisplay = {
  id: string;
  description: string;
  costClass: string;
  inventoryClass: string;
  active?: boolean;
  convertedQuantity?: string | number | null;
  smallUnit?: string | null;
  quantity?: string | number | null;
  unit?: string | null;
  lineAmountVnd?: string | number | null;
};

export function PurchaseLineList({ lines }: { lines: PurchaseLineDisplay[] }) {
  if (!lines.length) return <p className="form-note">Phiếu chưa có dòng hàng.</p>;
  return <ul className="owner-purchase-line-list">
    {lines.map((line) => (
      <li className="owner-purchase-line" key={line.id}>
        <div className="owner-purchase-line-main">
          <strong>{line.description}</strong>
          <span className="owner-purchase-line-meta">
            {line.costClass === "raw_material" ? "Nguyên liệu" : "Không phải nguyên liệu"}
            {" · "}
            {line.inventoryClass === "stock"
              ? `${formatPurchaseQuantity(line.convertedQuantity ?? 0)} ${line.smallUnit ?? ""} vào kho`
              : `Không nhập kho · ${formatPurchaseQuantity(line.quantity ?? 0)} ${line.unit ?? ""}`}
            {line.active === false ? " · Đã thay thế trong lịch sử" : ""}
          </span>
        </div>
        <strong className="owner-purchase-line-amount">
          {line.lineAmountVnd === null || line.lineAmountVnd === undefined ? "Chưa phân bổ" : formatVnd(Number(line.lineAmountVnd))}
        </strong>
      </li>
    ))}
  </ul>;
}

export type EvidenceGalleryItem = {
  id: string;
  fileName: string;
  signedUrl?: string | null;
  caption?: string | null;
  reimbursementId?: string | null;
};

export function EvidenceGallery({ evidence }: { evidence: EvidenceGalleryItem[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!evidence.length) return <p className="form-note">Chưa có ảnh chứng từ.</p>;

  async function showEvidence(item: EvidenceGalleryItem) {
    if (item.signedUrl || urls[item.id]) return;
    setError(null);
    setLoadingId(item.id);
    try {
      const response = await fetch(`/api/admin/advances/evidence/${encodeURIComponent(item.id)}/url`, { cache: "no-store" });
      const body = await response.json() as { url?: string; error?: string };
      if (!response.ok || !body.url) throw new Error(body.error || "Chưa mở được ảnh chứng từ.");
      setUrls((current) => ({ ...current, [item.id]: body.url! }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Chưa mở được ảnh chứng từ.");
    } finally {
      setLoadingId(null);
    }
  }

  return <div className="owner-evidence-gallery">
    {evidence.map((item) => {
      const source = item.signedUrl ?? urls[item.id];
      return <article className="owner-evidence-item" key={item.id}>
        {source ? <a href={source} target="_blank" rel="noreferrer" className="owner-evidence-image-link">
          {/* The page requests a short-lived URL only after the owner asks to view this file. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- Direct private R2 URL avoids routing image bytes through the Next image optimizer. */}
          <img src={source} alt={item.caption?.trim() || item.fileName} loading="lazy" />
        </a> : <button className="owner-evidence-open" type="button" disabled={loadingId !== null} onClick={() => void showEvidence(item)}>
          {loadingId === item.id ? "Đang mở…" : "Bấm để xem ảnh"}
        </button>}
        <div className="owner-evidence-caption">
          <strong>{item.fileName}</strong>
          {item.caption ? <span>{item.caption}</span> : null}
          {item.reimbursementId ? <small>Chứng từ hoàn tiền</small> : null}
        </div>
      </article>;
    })}
    {error ? <p className="form-error" role="alert">{error}</p> : null}
  </div>;
}
