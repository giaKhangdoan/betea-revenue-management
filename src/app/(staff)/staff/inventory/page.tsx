import { InventoryWorkspace } from "@/components/inventory/inventory-workspace";
import { requireStaff } from "@/lib/auth/require-staff";
import { getActiveInventoryItems } from "@/lib/inventory/catalog";

export const dynamic = "force-dynamic";

export default async function StaffInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const staff = await requireStaff();
  if (!staff) return null;

  const [{ data, error }, params] = await Promise.all([
    getActiveInventoryItems(staff.supabase, staff.ownerId),
    searchParams,
  ]);

  return <InventoryWorkspace basePath="/staff/inventory" items={data ?? []} tab={params.tab === "receiving" ? "receiving" : "stock"} error={Boolean(error)} />;
}
