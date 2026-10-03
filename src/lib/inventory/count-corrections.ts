import type { createClient } from "@/lib/supabase/server";
import type { InventoryCountItem } from "@/lib/inventory/counts";

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

export type InventoryCountCorrectionItem = Pick<
  InventoryCountItem,
  "item_id" | "item_name" | "large_unit" | "conversion_factor" | "small_unit" |
  "large_quantity" | "small_quantity" | "counted_quantity"
>;

export type InventoryCountCorrection = {
  id: string;
  corrected_at: string;
  corrected_by_label: string;
  reason: string;
  prior_items: InventoryCountCorrectionItem[];
  updated_items: InventoryCountCorrectionItem[];
};

function snapshotItems(value: unknown): InventoryCountCorrectionItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      item_id: String(row.item_id ?? ""),
      item_name: String(row.item_name ?? ""),
      large_unit: String(row.large_unit ?? ""),
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
) {
  const rows: InventoryCountCorrection[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("inventory_count_corrections")
      .select("id,corrected_at,corrected_by_label,reason,prior_items,updated_items")
      .eq("owner_id", ownerId).eq("count_id", countId)
      .order("corrected_at", { ascending: false }).order("id", { ascending: false })
      .range(from, from + 999);
    if (error) return { data: [] as InventoryCountCorrection[], error: true };
    rows.push(...(data ?? []).map((row) => ({
      id: row.id,
      corrected_at: row.corrected_at,
      corrected_by_label: row.corrected_by_label,
      reason: row.reason,
      prior_items: snapshotItems(row.prior_items),
      updated_items: snapshotItems(row.updated_items),
    })));
    if ((data?.length ?? 0) < 1000) break;
  }
  return { data: rows, error: false };
}
