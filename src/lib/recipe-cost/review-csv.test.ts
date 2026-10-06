import { describe, expect, it } from "vitest";
import { createWorkbookReviewCsv } from "./review-csv";

describe("workbook review CSV", () => {
  it("quotes cells and neutralizes spreadsheet formula injection", () => {
    const csv = createWorkbookReviewCsv([{
      sourceCell: "=HYPERLINK(\"https://example.test\")",
      name: "@SUM(A1:A2)",
      reason: " +2+3",
      required: true,
    }]);

    expect(csv).toContain("\"'=HYPERLINK(\"\"https://example.test\"\")\"");
    expect(csv).toContain("\"'@SUM(A1:A2)\"");
    expect(csv).toContain("\"' +2+3\"");
  });
});
