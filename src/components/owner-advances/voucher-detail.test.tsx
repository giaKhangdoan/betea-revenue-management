import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EvidenceGallery, PurchaseLineList } from "./voucher-detail";

describe("owner purchase voucher detail display", () => {
  it("shows a clear empty state when no receipt image has been attached", () => {
    const markup = renderToStaticMarkup(createElement(EvidenceGallery, { evidence: [] }));

    expect(markup).toContain("Chưa có ảnh chứng từ");
    expect(markup).not.toContain("<img");
  });

  it("renders one evidence preview with its caption and accessible label", () => {
    const markup = renderToStaticMarkup(createElement(EvidenceGallery, { evidence: [
      { id: "evidence-1", fileName: "hoa-don.png", signedUrl: "https://images.example/one", caption: "Hóa đơn nhập trà" },
    ] }));

    expect(markup).toContain("hoa-don.png");
    expect(markup).toContain("Hóa đơn nhập trà");
    expect(markup).toContain("https://images.example/one");
  });

  it("renders every attached evidence preview for multiple receipt/condition photos", () => {
    const markup = renderToStaticMarkup(createElement(EvidenceGallery, { evidence: [
      { id: "invoice", fileName: "hoa-don.jpg", signedUrl: "https://images.example/invoice", caption: "Hóa đơn" },
      { id: "cleaning", fileName: "ve-sinh.jpg", signedUrl: "https://images.example/cleaning", caption: "Đã vệ sinh" },
      { id: "shelf", fileName: "sap-xep.jpg", signedUrl: "https://images.example/shelf", caption: "Đã sắp xếp" },
    ] }));

    expect((markup.match(/<img\b/g) ?? [])).toHaveLength(3);
    expect(markup).toContain("Hóa đơn");
    expect(markup).toContain("Đã vệ sinh");
    expect(markup).toContain("Đã sắp xếp");
  });

  it("distinguishes stock lines from service/non-stock lines so service has no inventory movement", () => {
    const markup = renderToStaticMarkup(createElement(PurchaseLineList, { lines: [
      { id: "tea", description: "Trà đen", costClass: "raw_material", inventoryClass: "stock", convertedQuantity: "1000", smallUnit: "g", lineAmountVnd: 200_000 },
      { id: "repair", description: "Sửa máy dập nắp", costClass: "non_ingredient", inventoryClass: "non_stock", quantity: "1", unit: "lần", lineAmountVnd: 50_000 },
    ] }));

    expect(markup).toContain("Trà đen");
    expect(markup).toContain("1.000 g");
    expect(markup).toContain("Sửa máy dập nắp");
    expect(markup).toContain("Không nhập kho");
    expect(markup).not.toContain("1 lần vào kho");
  });
});
