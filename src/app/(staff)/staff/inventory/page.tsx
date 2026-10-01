import { InventoryWorkspace } from "@/components/inventory/inventory-workspace";
import { requireStaff } from "@/lib/auth/require-staff";

export const dynamic = "force-dynamic";

export default async function StaffInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const staff = await requireStaff();
  if (!staff) return null;

  const [{ data, error }, params] = await Promise.all([
    staff.supabase.from("inventory_items")
      .select("id,name,category,large_unit,conversion_factor,small_unit")
      .eq("owner_id", staff.ownerId).eq("active", true).order("category").order("name"),
    searchParams,
  ]);

  return <InventoryWorkspace basePath="/staff/inventory" items={data ?? []} tab={params.tab === "receiving" ? "receiving" : "stock"} error={Boolean(error)} />;
}
