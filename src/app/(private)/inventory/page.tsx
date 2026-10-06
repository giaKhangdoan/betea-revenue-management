import { InventoryWorkspace } from "@/components/inventory/inventory-workspace";
import { requireOwnerClient } from "@/lib/auth/require-owner";
import { addDays, currentBusinessDate, weekStart } from "@/lib/finance/format";
import { getActiveInventoryItems, getInventoryCatalog } from "@/lib/inventory/catalog";
import { getLatestFinalizedInventoryCount } from "@/lib/inventory/counts";
import { getInventoryReceiptPage, getLatestInventoryReceiptsForItems } from "@/lib/inventory/receipts";

export const dynamic = "force-dynamic";

export default async function OwnerInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; date?: string | string[] }>;
}) {
  const owner = await requireOwnerClient();
  if (!owner) return null;

  const params = await searchParams;
  const today = currentBusinessDate();
  const date = today;
  const tab: "stock" | "receiving" | "catalog" = params.tab === "receiving" ? "receiving" : params.tab === "catalog" ? "catalog" : "stock";
  const monday = weekStart(today);
  const common = {
    basePath: "/inventory",
    tab,
    owner: true,
    today,
    date,
    weekStart: monday,
    weekEnd: addDays(monday, 6),
    count: null,
    countItems: [],
    countError: false,
    needsRecountItemIds: [],
    receipts: [],
    receiptHasMore: false,
    receiptNextCursor: null,
    receivingError: false,
    canCreateReceipts: false,
    error: false,
  };

  if (tab === "catalog") {
    const { data, error } = await getInventoryCatalog(owner.supabase, owner.ownerId);
    return <InventoryWorkspace {...common} items={(data ?? []).filter((item) => item.active)} catalogItems={data ?? []} error={Boolean(error)} />;
  }

  if (tab === "receiving") {
    const [{ data: items, error }, receipts] = await Promise.all([
      getActiveInventoryItems(owner.supabase, owner.ownerId),
      getInventoryReceiptPage(owner.supabase, owner.ownerId),
    ]);
    return <InventoryWorkspace {...common} items={items ?? []} catalogItems={[]} receipts={receipts.data}
      receiptHasMore={receipts.hasMore} receiptNextCursor={receipts.nextCursor}
      receivingError={Boolean(error) || receipts.error} canCreateReceipts />;
  }

  const [{ data: items, error }, snapshot] = await Promise.all([
    getActiveInventoryItems(owner.supabase, owner.ownerId),
    getLatestFinalizedInventoryCount(owner.supabase, owner.ownerId),
  ]);
  const checkedItemIds = new Set(snapshot.data?.items.map((item) => item.item_id) ?? []);
  const itemIdsNeedingLatestReceipt = (items ?? []).filter((item) => !checkedItemIds.has(item.id)).map((item) => item.id);
  const latestReceipts = await getLatestInventoryReceiptsForItems(owner.supabase, owner.ownerId, itemIdsNeedingLatestReceipt);

  return <InventoryWorkspace {...common} items={items ?? []} catalogItems={[]} error={Boolean(error)}
    latestStockSnapshot={snapshot.data} latestStockSnapshotError={snapshot.error}
    latestStockReceipts={latestReceipts.data} latestStockReceiptsError={latestReceipts.error} />;
}
