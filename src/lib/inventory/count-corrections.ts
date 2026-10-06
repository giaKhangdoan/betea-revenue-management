import type { createClient } from "@/lib/supabase/server";
import type { InventoryCountItem } from "@/lib/inventory/counts";
import { INVENTORY_HISTORY_PAGE_SIZE, parseInventoryHistoryCursor } from "@/lib/inventory/receipts";

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

export type InventoryCountCorrectionItem = Pick<
  InventoryCountItem,
  "item_id" | "item_name" | "large_unit" | "conversion_factor" | "small_unit" |
  "large_quantity" | "small_quantity" | "counted_quantity"
>;

export type InventoryCountCorrection = {
  id: string;
  corrected_at: string;
  corrected_by: string;
  corrected_by_label: string;
  reason: string;
  prior_items: InventoryCountCorrectionItem[];
  updated_items: InventoryCountCorrectionItem[];
  sequence_no?: number | string;
};

export type InventoryCountCorrectionPage = {
  data: InventoryCountCorrection[];
  error: boolean;
  hasMore: boolean;
  nextCursor: { correctedAt: string; id: string } | null;
};

const MAX_COUNT_CORRECTION_PAGE_SIZE = 50;

function snapshotItems(value: unknown): InventoryCountCorrectionItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      item_id: String(row.item_id ?? ""),
      item_name: String(row.item_name ?? ""),
      large_unit: row.large_unit == null ? null : String(row.large_unit),
      conversion_factor: row.conversion_factor == null ? null : String(row.conversion_factor),
      small_unit: String(row.small_unit ?? ""),
      large_quantity: row.large_quantity == null ? null : String(row.large_quantity),
      small_quantity: row.small_quantity == null ? null : String(row.small_quantity),
      counted_quantity: row.counted_quantity == null ? null : String(row.counted_quantity),
    };
  });
}

export async function getInventoryCountCorrections(
  supabase: ServerSupabaseClient,
  ownerId: string,
  countId: string,
  options: { beforeAt?: string; beforeId?: string; limit?: number } = {},
): Promise<InventoryCountCorrectionPage> {
  const limit = Math.max(1, Math.min(options.limit ?? INVENTORY_HISTORY_PAGE_SIZE, MAX_COUNT_CORRECTION_PAGE_SIZE));
  const cursor = parseInventoryHistoryCursor(options.beforeAt, options.beforeId);
  if (!cursor) return { data: [], error: true, hasMore: false, nextCursor: null };

  let query = supabase.from("inventory_count_corrections")
    .select("id,corrected_at,corrected_by,corrected_by_label,reason,prior_items,updated_items")
    .eq("owner_id", ownerId).eq("count_id", countId)
    .order("corrected_at", { ascending: false }).order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor.beforeAt && cursor.beforeId) {
    query = query.or(`corrected_at.lt.${cursor.beforeAt},and(corrected_at.eq.${cursor.beforeAt},id.lt.${cursor.beforeId})`);
  }

  const { data, error } = await query;
  if (error) return { data: [], error: true, hasMore: false, nextCursor: null };
  const rows: InventoryCountCorrection[] = (data ?? []).slice(0, limit).map((row) => ({
    id: row.id,
    corrected_at: row.corrected_at,
    corrected_by: row.corrected_by,
    corrected_by_label: row.corrected_by_label,
    reason: row.reason,
    prior_items: snapshotItems(row.prior_items),
    updated_items: snapshotItems(row.updated_items),
  }));
  const hasMore = (data?.length ?? 0) > limit;
  const last = rows.at(-1);
  return {
    data: rows,
    error: false,
    hasMore,
    nextCursor: hasMore && last ? { correctedAt: last.corrected_at, id: last.id } : null,
  };
}
