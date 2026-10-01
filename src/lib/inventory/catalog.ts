import type { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

export type InventoryItem = {
  id: string;
  name: string;
  category: string;
  large_unit: string;
  conversion_factor: number | string;
  small_unit: string;
};

export function getActiveInventoryItems(supabase: ServerSupabaseClient, ownerId: string) {
  return supabase.from("inventory_items")
    .select("id,name,category,large_unit,conversion_factor,small_unit")
    .eq("owner_id", ownerId).eq("active", true).order("category").order("name");
}
