import { InventoryWorkspace } from "@/components/inventory/inventory-workspace";
import { InventoryCountCorrectionPanel } from "@/components/inventory/inventory-count-correction-panel";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { addDays, currentBusinessDate, weekStart } from "@/lib/finance/format";
import { getInventoryCatalog } from "@/lib/inventory/catalog";
import { getFinalizedInventoryCountHistory, getInventoryCount, isInventoryBusinessDate, summarizeInventoryMovement } from "@/lib/inventory/counts";
import { getInventoryCountCorrections } from "@/lib/inventory/count-corrections";
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
  const [history, count] = await Promise.all([
    tab === "stock" ? getFinalizedInventoryCountHistory(owner.supabase, owner.ownerId) : Promise.resolve({ data: [], error: false }),
    tab === "stock" ? getInventoryCount(owner.supabase, owner.ownerId, date) : Promise.resolve({ count: null, items: [], error: false }),
  ]);
  const corrections = count.count?.status === "finalized"
    ? await getInventoryCountCorrections(owner.supabase, owner.ownerId, count.count.id)
    : { data: [], error: false };

  const movement = summarizeInventoryMovement(history.data, receipts.data);

  return <>
    <InventoryWorkspace basePath="/inventory" items={items} catalogItems={catalog ?? []} receipts={receipts.data} movement={movement} movementError={history.error || receipts.error} tab={tab} error={Boolean(error)} receivingError={receipts.error} canCreateReceipts={false} owner date={date} today={today} weekStart={weekStart(today)} weekEnd={addDays(weekStart(today), 6)} count={count.count} countItems={count.items} countError={count.error} />
    {tab === "stock" && count.count?.status === "finalized" ? <InventoryCountCorrectionPanel count={count.count} items={count.items} corrections={corrections.data} historyError={corrections.error} /> : null}
  </>;
}
