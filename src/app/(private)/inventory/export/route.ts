import { currentBusinessDate } from "@/lib/finance/format";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { createInventoryWorkbook, getInventoryExportData } from "@/lib/inventory/export";
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

  const { data, error } = await getInventoryExportData(owner.supabase, owner.ownerId, from, to);
  if (error) return Response.json({ error: "Chưa tải được dữ liệu kho." }, { status: 500 });

  const workbook = createInventoryWorkbook(data, from, to);
  return new Response(workbook, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="Kho_${from}_${to}.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
