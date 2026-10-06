import type { createClient } from "@/lib/supabase/server";
import type { InventoryReceipt } from "@/lib/inventory/receipts";

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

export type InventoryCount = {
  id: string;
  business_date: string;
  status: string;
  created_at: string;
  updated_at: string;
  finalized_at: string | null;
};

export type InventoryCountItem = {
  item_id: string;
  item_name: string;
  category: string;
  large_unit: string | null;
  conversion_factor: number | string | null;
  small_unit: string;
  count_large_unit_only?: boolean;
  sort_order?: number;
  large_quantity: number | string | null;
  small_quantity: number | string | null;
  counted_quantity: number | string | null;
  counted_at?: string | null;
};

export type InventoryMovementCountItem = Pick<InventoryCountItem, "item_id" | "item_name" | "small_unit" | "counted_quantity">
  & Partial<Pick<InventoryCountItem, "large_unit" | "conversion_factor" | "large_quantity" | "small_quantity" | "sort_order">>;

export type InventoryFinalizedCount = Pick<InventoryCount, "id" | "business_date"> & {
  finalized_at: string;
  items: InventoryMovementCountItem[];
};

export type InventoryMovementReceipt = {
  id: string;
  receipt_code: string;
  received_at: string;
  created_by_label: string;
  lines: {
    item_id: string;
    item_name: string;
    large_unit?: string | null;
    large_quantity?: string | number;
    conversion_factor?: string | number | null;
    small_unit: string;
    loose_quantity?: string | number;
    converted_quantity: string | number | null;
  }[];
};

export type InventoryMovementItem = {
  item_id: string;
  item_name: string;
  sort_order?: number;
  small_unit: string;
  previous_quantity: string | null;
  received_quantity: string;
  current_quantity: string | null;
  movement_quantity: string | null;
  movement_sign: -1 | 0 | 1 | null;
  unit_changed?: boolean;
  conversion_unavailable?: boolean;
};

export type InventoryMovementPeriod = {
  previous_count: InventoryFinalizedCount;
  current_count: InventoryFinalizedCount;
  items: InventoryMovementItem[];
};

export type InventoryMovementSummary = {
  latest: InventoryFinalizedCount | null;
  receiptsSinceLatest: InventoryMovementReceipt[];
  periods: InventoryMovementPeriod[];
};

const inventoryQuantityScale = BigInt(1_000_000);

export function toInventoryMicros(value: string | number | null): bigint | null {
  if (value === null) return null;
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  const quantity = BigInt(match[2]) * inventoryQuantityScale + BigInt((match[3] ?? "").padEnd(6, "0") || "0");
  return match[1] ? -quantity : quantity;
}

export function formatInventoryMicros(value: bigint): string {
  const absolute = value < 0 ? -value : value;
  const whole = absolute / inventoryQuantityScale;
  const fraction = String(absolute % inventoryQuantityScale).padStart(6, "0").replace(/0+$/, "");
  return `${whole.toLocaleString("vi-VN")}${fraction ? `,${fraction}` : ""}`;
}

function inventoryTimestampMicros(value: string): bigint | null {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const fraction = value.match(/\.(\d+)/)?.[1] ?? "";
  return BigInt(milliseconds) * BigInt(1000) + BigInt(fraction.slice(3, 6).padEnd(3, "0") || "0");
}

export function compareInventoryTimestamps(a: string, b: string): number {
  const left = inventoryTimestampMicros(a);
  const right = inventoryTimestampMicros(b);
  if (left === null) return right === null ? 0 : -1;
  if (right === null) return 1;
  return left < right ? -1 : left > right ? 1 : 0;
}

export function getInventoryItemsNeedingRecount(items: InventoryCountItem[], receipts: InventoryReceipt[], isDraft: boolean): Set<string> {
  if (!isDraft) return new Set();

  const latestReceiptActivity = new Map<string, string>();
  for (const receipt of receipts) {
    const activityAt = compareInventoryTimestamps(receipt.received_at, receipt.updated_at) >= 0
      ? receipt.received_at
      : receipt.updated_at;
    for (const line of receipt.lines) {
      const latest = latestReceiptActivity.get(line.item_id);
      if (!latest || compareInventoryTimestamps(activityAt, latest) > 0) {
        latestReceiptActivity.set(line.item_id, activityAt);
      }
    }
  }

  return new Set(items.filter((item) => {
    if (!item.counted_at) return false;
    const receiptActivityAt = latestReceiptActivity.get(item.item_id);
    return Boolean(receiptActivityAt && compareInventoryTimestamps(receiptActivityAt, item.counted_at) > 0);
  }).map((item) => item.item_id));
}

export function formatInventoryQuantity(value: string | number | null): string | null {
  const micros = toInventoryMicros(value);
  return micros === null ? null : `${micros < 0 ? "−" : ""}${formatInventoryMicros(micros)}`;
}

export function sameInventoryUnit(a: string, b: string) {
  return a.trim().toLocaleLowerCase("vi") === b.trim().toLocaleLowerCase("vi");
}

export function summarizeInventoryMovement(
  counts: InventoryFinalizedCount[],
  receipts: InventoryMovementReceipt[],
): InventoryMovementSummary {
  const ordered = counts.filter((count) => inventoryTimestampMicros(count.finalized_at) !== null)
    .sort((a, b) => compareInventoryTimestamps(a.finalized_at, b.finalized_at) || a.id.localeCompare(b.id));
  const latest = ordered.at(-1) ?? null;
  const latestCutoff = latest ? inventoryTimestampMicros(latest.finalized_at) : null;
  const receiptsSinceLatest = receipts.filter((receipt) => {
    const receivedAt = inventoryTimestampMicros(receipt.received_at);
    return receivedAt !== null && (latestCutoff === null || receivedAt > latestCutoff);
  });
  const receiptEvents: { receipt: InventoryMovementReceipt; receivedAt: bigint }[] = [];
  for (const receipt of receipts) {
    const receivedAt = inventoryTimestampMicros(receipt.received_at);
    if (receivedAt !== null) receiptEvents.push({ receipt, receivedAt });
  }
  receiptEvents.sort((a, b) => a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0);
  let receiptIndex = 0;

  const periods = ordered.slice(1).map((current, index): InventoryMovementPeriod => {
    const previous = ordered[index];
    const previousByItem = new Map(previous.items.map((item) => [item.item_id, item]));
    const currentByItem = new Map(current.items.map((item) => [item.item_id, item]));
    const receivedByItem = new Map<string, { quantity: bigint; unit: string; compatible: boolean; conversionUnavailable: boolean }>();
    const start = inventoryTimestampMicros(previous.finalized_at)!;
    const end = inventoryTimestampMicros(current.finalized_at)!;

    while (receiptIndex < receiptEvents.length && receiptEvents[receiptIndex].receivedAt <= start) receiptIndex += 1;
    while (receiptIndex < receiptEvents.length && receiptEvents[receiptIndex].receivedAt <= end) {
      const receipt = receiptEvents[receiptIndex].receipt;
      for (const line of receipt.lines) {
        const quantity = toInventoryMicros(line.converted_quantity);
        const previous = receivedByItem.get(line.item_id);
        receivedByItem.set(line.item_id, {
          quantity: (previous?.quantity ?? BigInt(0)) + (quantity ?? BigInt(0)),
          unit: previous?.unit ?? line.small_unit,
          compatible: (previous?.compatible ?? true) && (!previous || sameInventoryUnit(previous.unit, line.small_unit)),
          conversionUnavailable: (previous?.conversionUnavailable ?? false) || quantity === null,
        });
      }
      receiptIndex += 1;
    }

    const itemIds = new Set([...previousByItem.keys(), ...currentByItem.keys()]);
    const items = [...itemIds].map((itemId): InventoryMovementItem => {
      const before = previousByItem.get(itemId);
      const after = currentByItem.get(itemId);
      const previousQuantity = before ? toInventoryMicros(before.counted_quantity) : null;
      const currentQuantity = after ? toInventoryMicros(after.counted_quantity) : null;
      const received = receivedByItem.get(itemId);
      const receivedQuantity = received?.quantity ?? BigInt(0);
      const unitChanged = Boolean(before && after && (
        !sameInventoryUnit(before.small_unit, after.small_unit)
        || (received && (!received.compatible || !sameInventoryUnit(received.unit, before.small_unit)))
      ));
      const conversionUnavailable = Boolean(
        (before?.large_unit && before.conversion_factor == null)
        || (after?.large_unit && after.conversion_factor == null)
        || received?.conversionUnavailable
      );
      const movement = previousQuantity !== null && currentQuantity !== null && !unitChanged && !conversionUnavailable
        ? previousQuantity + receivedQuantity - currentQuantity
        : null;

      return {
        item_id: itemId,
        item_name: after?.item_name ?? before?.item_name ?? "",
        sort_order: after?.sort_order ?? before?.sort_order,
        small_unit: after?.small_unit ?? before?.small_unit ?? "",
        previous_quantity: previousQuantity === null ? null : formatInventoryMicros(previousQuantity),
        received_quantity: unitChanged || conversionUnavailable ? "—" : formatInventoryMicros(receivedQuantity),
        current_quantity: currentQuantity === null ? null : formatInventoryMicros(currentQuantity),
        movement_quantity: movement === null ? null : formatInventoryMicros(movement),
        movement_sign: movement === null ? null : movement > 0 ? 1 : movement < 0 ? -1 : 0,
        ...(unitChanged ? { unit_changed: true } : {}),
        ...(conversionUnavailable ? { conversion_unavailable: true } : {}),
      };
    }).sort((a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
      || a.item_name.localeCompare(b.item_name, "vi"));

    return { previous_count: previous, current_count: current, items };
  });

  return { latest, receiptsSinceLatest, periods };
}

export async function getFinalizedInventoryCountHistory(supabase: ServerSupabaseClient, ownerId: string) {
  const headers: { id: string; business_date: string; finalized_at: string }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("inventory_counts")
      .select("id,business_date,finalized_at")
      .eq("owner_id", ownerId).eq("status", "finalized").not("finalized_at", "is", null)
      .order("finalized_at").order("id").range(from, from + 999);
    if (error) return { data: [] as InventoryFinalizedCount[], error: true };
    for (const count of data ?? []) {
      if (count.finalized_at !== null) headers.push(count);
    }
    if ((data?.length ?? 0) < 1000) break;
  }

  const itemsByCount = new Map<string, InventoryMovementCountItem[]>();
  for (let from = 0; from < headers.length; from += 1000) {
    const ids = headers.slice(from, from + 1000).map(({ id }) => id);
    for (let itemFrom = 0; ; itemFrom += 1000) {
      const { data, error } = await supabase.from("inventory_count_items")
        .select("count_id,item_id,item_name,large_unit,conversion_factor,small_unit,large_quantity,small_quantity,counted_quantity,sort_order")
        .eq("owner_id", ownerId).in("count_id", ids).order("count_id").order("sort_order").order("item_id").range(itemFrom, itemFrom + 999);
      if (error) return { data: [] as InventoryFinalizedCount[], error: true };
      for (const item of data ?? []) {
        const countItems = itemsByCount.get(item.count_id) ?? [];
        countItems.push(item);
        itemsByCount.set(item.count_id, countItems);
      }
      if ((data?.length ?? 0) < 1000) break;
    }
  }

  return {
    data: headers.map((count) => ({ ...count, items: itemsByCount.get(count.id) ?? [] })),
    error: false,
  };
}

export function isInventoryBusinessDate(value: string): boolean {
  const parsed = new Date(`${value}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

export async function getInventoryCount(supabase: ServerSupabaseClient, ownerId: string, date: string) {
  const { data: count, error: countError } = await supabase
    .from("inventory_counts")
    .select("id,business_date,status,created_at,updated_at,finalized_at")
    .eq("owner_id", ownerId)
    .eq("business_date", date)
    .maybeSingle();

  if (countError || !count) return { count: null, items: [], error: Boolean(countError) };

  const { data: items, error } = await supabase
    .from("inventory_count_items")
    .select("item_id,item_name,category,large_unit,conversion_factor,small_unit,count_large_unit_only,large_quantity,small_quantity,counted_quantity,counted_at,sort_order")
    .eq("count_id", count.id)
    .order("sort_order")
    .order("category")
    .order("item_name");

  return { count, items: items ?? [], error: Boolean(error) };
}
