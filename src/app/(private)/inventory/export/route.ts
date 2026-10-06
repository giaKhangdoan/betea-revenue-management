import { currentBusinessDate } from "@/lib/finance/format";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { createInventoryWorkbook, getInventoryExportData, isInventoryExportRangeWithinLimit } from "@/lib/inventory/export";
import { isInventoryBusinessDate } from "@/lib/inventory/counts";

export async function GET(request: Request) {
  const owner = await requireOwnerClient();
  if (!owner) return Response.json({ error: "Chỉ chủ cửa hàng mới được tải workbook kho." }, { status: 403 });

  const params = new URL(request.url).searchParams;
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  if (!isInventoryBusinessDate(from) || !isInventoryBusinessDate(to) || from > to || to > currentBusinessDate()) {
    return Response.json({ error: "Khoảng ngày không hợp lệ." }, { status: 400 });
  }
  if (!isInventoryExportRangeWithinLimit(from, to)) {
    return Response.json({ error: "Mỗi lần xuất tối đa 366 ngày. Hãy thu hẹp khoảng ngày." }, { status: 400 });
  }

  const { data, error, errorCode } = await getInventoryExportData(owner.supabase, owner.ownerId, from, to);
  if (error) {
    const tooLarge = errorCode === "too_large";
    const rangeTooLarge = errorCode === "range_too_large";
    return Response.json({ error: tooLarge
      ? "Lịch sử kho vượt giới hạn an toàn của một lần xuất. Hãy thu hẹp khoảng ngày."
      : rangeTooLarge
        ? "Mốc lịch sử kiểm kê cách nhau quá xa. Hãy xuất một khoảng ngày hẹp hơn."
        : "Chưa tải được dữ liệu kho." }, {
      status: tooLarge ? 413 : rangeTooLarge ? 400 : 500,
    });
  }

  const workbook = createInventoryWorkbook(data, from, to);
  return new Response(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Kho_${from}_${to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
