import { InventoryWorkspace } from "@/components/inventory/inventory-workspace";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { addDays, currentBusinessDate, weekStart } from "@/lib/finance/format";
import { getActiveInventoryItems } from "@/lib/inventory/catalog";
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

  const [{ data, error }, receipts, params] = await Promise.all([
    getActiveInventoryItems(owner.supabase, owner.ownerId),
    getInventoryReceipts(owner.supabase, owner.ownerId, true),
    searchParams,
  ]);
  const today = currentBusinessDate();
  const requestedDate = typeof params.date === "string" ? params.date : "";
  const date = isInventoryBusinessDate(requestedDate) && requestedDate <= today ? requestedDate : today;
  const count = params.tab === "receiving" ? { count: null, items: [], error: false } : await getInventoryCount(owner.supabase, owner.ownerId, date);

  return <InventoryWorkspace basePath="/inventory" items={data ?? []} receipts={receipts.data} tab={params.tab === "receiving" ? "receiving" : "stock"} error={Boolean(error)} receivingError={receipts.error} canCreateReceipts={false} owner date={date} today={today} weekStart={weekStart(today)} weekEnd={addDays(weekStart(today), 6)} count={count.count} countItems={count.items} countError={count.error} />;
}
