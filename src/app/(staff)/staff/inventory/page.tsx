import { InventoryWorkspace } from "@/components/inventory/inventory-workspace";
import { requireStaff } from "@/lib/auth/require-staff";
import { addDays, currentBusinessDate, weekStart } from "@/lib/finance/format";
import { getActiveInventoryItems } from "@/lib/inventory/catalog";
import { getFinalizedInventoryCountHistory, getInventoryCount, isInventoryBusinessDate, summarizeInventoryMovement } from "@/lib/inventory/counts";
import { getInventoryReceipts } from "@/lib/inventory/receipts";

export const dynamic = "force-dynamic";

export default async function StaffInventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[]; date?: string | string[] }>;
}) {
  const staff = await requireStaff();
  if (!staff) return null;

  const [{ data, error }, receipts, params] = await Promise.all([
    getActiveInventoryItems(staff.supabase, staff.ownerId),
    getInventoryReceipts(staff.supabase, staff.ownerId),
    searchParams,
  ]);
  const today = currentBusinessDate();
  const monday = weekStart(today);
  const sunday = addDays(monday, 6);
  const requestedDate = typeof params.date === "string" ? params.date : "";
  const date = isInventoryBusinessDate(requestedDate) && requestedDate >= monday && requestedDate <= sunday ? requestedDate : today;
  const [history, count] = await Promise.all([
    params.tab === "receiving" ? Promise.resolve({ data: [], error: false }) : getFinalizedInventoryCountHistory(staff.supabase, staff.ownerId),
    params.tab === "receiving" ? Promise.resolve({ count: null, items: [], error: false }) : getInventoryCount(staff.supabase, staff.ownerId, date),
  ]);

  const movement = summarizeInventoryMovement(history.data, receipts.data);

  return <InventoryWorkspace basePath="/staff/inventory" items={data ?? []} catalogItems={[]} receipts={receipts.data} movement={movement} movementError={history.error || receipts.error} tab={params.tab === "receiving" ? "receiving" : "stock"} error={Boolean(error)} receivingError={receipts.error} canCreateReceipts owner={false} date={date} today={today} weekStart={monday} weekEnd={sunday} count={count.count} countItems={count.items} countError={count.error} />;
}
