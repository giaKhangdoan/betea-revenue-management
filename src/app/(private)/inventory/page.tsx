import { InventoryWorkspace } from "@/components/inventory/inventory-workspace";
import { requireOwnerClient } from "@/lib/auth/require-owner";

export const dynamic = "force-dynamic";

export default async function OwnerInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const owner = await requireOwnerClient();
  if (!owner) return null;

  const [{ data, error }, params] = await Promise.all([
    owner.supabase.from("inventory_items")
      .select("id,name,category,large_unit,conversion_factor,small_unit")
      .eq("owner_id", owner.ownerId).eq("active", true).order("category").order("name"),
    searchParams,
  ]);

  return <InventoryWorkspace basePath="/inventory" items={data ?? []} tab={params.tab === "receiving" ? "receiving" : "stock"} error={Boolean(error)} />;
}
