type ReviewCsvItem = {
  sourceCell: string;
  name: string;
  reason: string;
  required: boolean;
  resolutionNote?: string;
};

function csvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function createWorkbookReviewCsv(items: readonly ReviewCsvItem[]): string {
  const rows = [
    ["Ô nguồn", "Tên", "Lý do", "Trạng thái", "Ghi chú xử lý"],
    ...items.map((item) => [
      item.sourceCell,
      item.name,
      item.reason,
      item.required ? "Chờ xử lý" : "Đã ghi nhận",
      item.resolutionNote ?? "",
    ]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}`;
}
