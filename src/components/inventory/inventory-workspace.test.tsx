import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InventoryMovementPanel } from "./inventory-workspace";
import { summarizeInventoryMovement } from "@/lib/inventory/counts";

describe("inventory movement visibility", () => {
  it("does not render owner-only movement numbers for staff", () => {
    const summary = summarizeInventoryMovement([
      {
        id: "opening",
        business_date: "2026-09-01",
        finalized_at: "2026-09-01T08:00:00.000Z",
        items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "90" }],
      },
      {
        id: "closing",
        business_date: "2026-09-02",
        finalized_at: "2026-09-02T08:00:00.000Z",
        items: [{ item_id: "tea", item_name: "Trà", small_unit: "g", counted_quantity: "40" }],
      },
    ], []);

    const markup = renderToStaticMarkup(createElement(InventoryMovementPanel, {
      summary,
      error: false,
      owner: false,
    }));

    expect(markup).toContain("chỉ dành cho quản trị viên");
    expect(markup).toContain("Nhân viên vẫn có thể xem bản kiểm và phiếu nhập");
    expect(markup).not.toContain("90 g");
    expect(markup).not.toContain("40 g");
    expect(markup).not.toContain("50 g");
  });
});
