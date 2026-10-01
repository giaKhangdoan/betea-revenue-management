import { InventoryWorkspace } from "@/components/inventory/inventory-workspace";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { addDays, currentBusinessDate, weekStart } from "@/lib/finance/format";
import { getInventoryCatalog } from "@/lib/inventory/catalog";
import { getInventoryCount, isInventoryBusinessDate } from "@/lib/inventory/counts";
import { getInventoryReceipts } from "@/lib/inventory/receipts";

export const dynamic = "force-dynamic";

export default async function OwnerInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; date?: string | string[] }>;
}) {
  const owner = await requireOwnerClient();
  if (!owner) return null;

  const [{ data: catalog, error }, receipts, params] = await Promise.all([
    getInventoryCatalog(owner.supabase, owner.ownerId),
    getInventoryReceipts(owner.supabase, owner.ownerId, true),
    searchParams,
  ]);
  const today = currentBusinessDate();
  const requestedDate = typeof params.date === "string" ? params.date : "";
  const date = isInventoryBusinessDate(requestedDate) && requestedDate <= today ? requestedDate : today;
  const tab = params.tab === "receiving" ? "receiving" : params.tab === "catalog" ? "catalog" : "stock";
  const items = (catalog ?? []).filter((item) => item.active);
  const count = tab === "stock" ? await getInventoryCount(owner.supabase, owner.ownerId, date) : { count: null, items: [], error: false };

  return <InventoryWorkspace basePath="/inventory" items={items} catalogItems={catalog ?? []} receipts={receipts.data} tab={tab} error={Boolean(error)} receivingError={receipts.error} canCreateReceipts={false} owner date={date} today={today} weekStart={weekStart(today)} weekEnd={addDays(weekStart(today), 6)} count={count.count} countItems={count.items} countError={count.error} />;
}
