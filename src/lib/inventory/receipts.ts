import type { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

export type InventoryReceiptLine = {
  id: string;
  receipt_id: string;
  item_id: string;
  item_name: string;
  category: string;
  large_unit: string;
  large_quantity: string | number;
  conversion_factor: string | number;
  small_unit: string;
  loose_quantity: string | number;
  converted_quantity: string | number;
};

export type InventoryReceipt = {
  id: string;
  receipt_code: string;
  received_at: string;
  created_by: string;
  created_by_label: string;
  updated_at: string;
  lines: InventoryReceiptLine[];
  corrections: InventoryReceiptCorrection[];
  staff_editable: boolean;
};

export type InventoryReceiptCorrection = {
  id: string;
  receipt_id: string;
  corrected_at: string;
  corrected_by: string;
  corrected_by_label: string;
  reason: string;
  prior_lines: InventoryReceiptLine[];
};

type InventoryReceiptHeader = Omit<InventoryReceipt, "lines" | "corrections" | "staff_editable">;

export async function getInventoryReceipts(supabase: ServerSupabaseClient, ownerId: string, includeCorrections = false) {
  const receipts: InventoryReceiptHeader[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("inventory_receipts")
      .select("id,receipt_code,received_at,created_by,created_by_label,updated_at")
      .eq("owner_id", ownerId).order("received_at", { ascending: false }).range(from, from + 999);
    if (error) return { data: [] as InventoryReceipt[], error: true };
    receipts.push(...(data ?? []));
    if ((data?.length ?? 0) < 1000) break;
  }

  const finalizedAt: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("inventory_counts")
      .select("finalized_at").eq("owner_id", ownerId).eq("status", "finalized")
      .not("finalized_at", "is", null).range(from, from + 999);
    if (error) return { data: [] as InventoryReceipt[], error: true };
    finalizedAt.push(...(data ?? []).map(({ finalized_at }) => finalized_at));
    if ((data?.length ?? 0) < 1000) break;
  }

  const lines: InventoryReceiptLine[] = [];
  for (let from = 0; from < receipts.length; from += 1000) {
    const ids = receipts.slice(from, from + 1000).map((receipt) => receipt.id);
    for (let lineFrom = 0; ; lineFrom += 1000) {
      const { data, error } = await supabase.from("inventory_receipt_lines")
        .select("id,receipt_id,item_id,item_name,category,large_unit,large_quantity,conversion_factor,small_unit,loose_quantity,converted_quantity")
        .eq("owner_id", ownerId).in("receipt_id", ids).order("line_number").range(lineFrom, lineFrom + 999);
      if (error) return { data: [] as InventoryReceipt[], error: true };
      lines.push(...(data ?? []));
      if ((data?.length ?? 0) < 1000) break;
    }
  }

  const corrections: InventoryReceiptCorrection[] = [];
  if (includeCorrections) {
    for (let from = 0; from < receipts.length; from += 1000) {
      const ids = receipts.slice(from, from + 1000).map((receipt) => receipt.id);
      for (let correctionFrom = 0; ; correctionFrom += 1000) {
        const { data, error } = await supabase.from("inventory_receipt_corrections")
          .select("id,receipt_id,corrected_at,corrected_by,corrected_by_label,reason,prior_lines")
          .eq("owner_id", ownerId).in("receipt_id", ids).order("corrected_at", { ascending: false }).range(correctionFrom, correctionFrom + 999);
        if (error) return { data: [] as InventoryReceipt[], error: true };
        corrections.push(...(data ?? []) as InventoryReceiptCorrection[]);
        if ((data?.length ?? 0) < 1000) break;
      }
    }
  }

  const linesByReceipt = new Map<string, InventoryReceiptLine[]>();
  for (const line of lines) {
    const receiptLines = linesByReceipt.get(line.receipt_id) ?? [];
    receiptLines.push(line);
    linesByReceipt.set(line.receipt_id, receiptLines);
  }

  const correctionsByReceipt = new Map<string, InventoryReceiptCorrection[]>();
  for (const correction of corrections) {
    const history = correctionsByReceipt.get(correction.receipt_id) ?? [];
    history.push(correction);
    correctionsByReceipt.set(correction.receipt_id, history);
  }

  return {
    data: receipts.map((receipt) => ({
      ...receipt,
      lines: linesByReceipt.get(receipt.id) ?? [],
      corrections: correctionsByReceipt.get(receipt.id) ?? [],
      staff_editable: !finalizedAt.some((cutoff) => Date.parse(cutoff) >= Date.parse(receipt.received_at)),
    })),
    error: false,
  };
}
