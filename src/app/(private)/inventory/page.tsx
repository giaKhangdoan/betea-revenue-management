import { InventoryWorkspace } from "@/components/inventory/inventory-workspace";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { getActiveInventoryItems } from "@/lib/inventory/catalog";

export const dynamic = "force-dynamic";

export default async function OwnerInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const owner = await requireOwnerClient();
  if (!owner) return null;

  const [{ data, error }, params] = await Promise.all([
    getActiveInventoryItems(owner.supabase, owner.ownerId),
    searchParams,
  ]);

  return <InventoryWorkspace basePath="/inventory" items={data ?? []} tab={params.tab === "receiving" ? "receiving" : "stock"} error={Boolean(error)} />;
}
