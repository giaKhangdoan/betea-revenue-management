import type { createClient } from "@/lib/supabase/server";

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
  large_unit: string;
  conversion_factor: number | string;
  small_unit: string;
  large_quantity: number | string | null;
  small_quantity: number | string | null;
  counted_quantity: number | string | null;
};

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
    .select("item_id,item_name,category,large_unit,conversion_factor,small_unit,large_quantity,small_quantity,counted_quantity")
    .eq("count_id", count.id)
    .order("category")
    .order("item_name");

  return { count, items: items ?? [], error: Boolean(error) };
}
