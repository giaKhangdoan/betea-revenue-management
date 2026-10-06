import { InventoryWorkspace } from "@/components/inventory/inventory-workspace";
import { requireStaff } from "@/lib/auth/require-staff";
import { addDays, currentBusinessDate, weekStart } from "@/lib/finance/format";
import { getActiveInventoryItems } from "@/lib/inventory/catalog";
import { getInventoryCount, getInventoryItemsNeedingRecountForCount, isInventoryBusinessDate } from "@/lib/inventory/counts";
import { getInventoryReceiptPage } from "@/lib/inventory/receipts";

export const dynamic = "force-dynamic";

function vietnamStartOfDay(date: string) {
  return new Date(`${date}T00:00:00+07:00`).toISOString();
}

export default async function StaffInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; date?: string | string[]; before?: string | string[]; beforeId?: string | string[] }>;
}) {
  const staff = await requireStaff();
  if (!staff) return null;

  const params = await searchParams;
  const today = currentBusinessDate();
  const monday = weekStart(today);
  const sunday = addDays(monday, 6);
  const requestedDate = typeof params.date === "string" ? params.date : "";
  const date = isInventoryBusinessDate(requestedDate) && requestedDate >= monday && requestedDate <= sunday ? requestedDate : today;
  const tab: "stock" | "receiving" = params.tab === "receiving" ? "receiving" : "stock";
  const itemsResult = await getActiveInventoryItems(staff.supabase, staff.ownerId);

  const common = {
    basePath: "/staff/inventory",
    items: itemsResult.data ?? [],
    catalogItems: [],
    receipts: [],
    receiptHasMore: false,
    receiptNextCursor: null,
    needsRecountItemIds: [],
    tab,
    error: Boolean(itemsResult.error),
    receivingError: false,
    canCreateReceipts: true,
    owner: false,
    date,
    today,
    weekStart: monday,
    weekEnd: sunday,
    count: null,
    countItems: [],
    countError: false,
  };

  if (tab === "receiving") {
    const receipts = await getInventoryReceiptPage(staff.supabase, staff.ownerId, {
      beforeAt: typeof params.before === "string" ? params.before : undefined,
      beforeId: typeof params.beforeId === "string" ? params.beforeId : undefined,
      receivedFrom: vietnamStartOfDay(monday),
      receivedUntil: vietnamStartOfDay(addDays(sunday, 1)),
    });
    return <InventoryWorkspace {...common} receipts={receipts.data} receiptHasMore={receipts.hasMore}
      receiptNextCursor={receipts.nextCursor} receivingError={Boolean(itemsResult.error) || receipts.error} />;
  }

  const count = await getInventoryCount(staff.supabase, staff.ownerId, date);
  const recount = count.count?.status === "draft"
    ? await getInventoryItemsNeedingRecountForCount(staff.supabase, count.count.id)
    : { itemIds: [] as string[], error: false };

  return <InventoryWorkspace {...common} count={count.count} countItems={count.items}
    countError={count.error || recount.error} needsRecountItemIds={recount.itemIds} />;
}
