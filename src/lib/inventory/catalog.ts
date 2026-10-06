import type { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

export type InventoryItem = {
  id: string;
  name: string;
  category: string;
  large_unit: string | null;
  conversion_factor: number | string | null;
  small_unit: string;
  count_large_unit_only: boolean;
  sort_order: number;
  conversion_verified_at: string | null;
  conversion_verified_by?: string | null;
};

export type InventoryCatalogItem = InventoryItem & { active: boolean };

export function getActiveInventoryItems(supabase: ServerSupabaseClient, ownerId: string) {
  return supabase.from("inventory_items")
    .select("id,name,category,large_unit,conversion_factor,small_unit,count_large_unit_only,sort_order,conversion_verified_at,conversion_verified_by")
    .eq("owner_id", ownerId).eq("active", true).order("sort_order").order("category").order("name");
}

export function getInventoryCatalog(supabase: ServerSupabaseClient, ownerId: string) {
  return supabase.from("inventory_items")
    .select("id,name,category,large_unit,conversion_factor,small_unit,count_large_unit_only,sort_order,active,conversion_verified_at,conversion_verified_by")
    .eq("owner_id", ownerId).order("sort_order").order("category").order("name");
}
