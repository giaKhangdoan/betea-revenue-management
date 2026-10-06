export type OwnerPurchaseVoucherRow = {
  id: string;
  owner_id: string;
  purchase_date: string;
  vendor: string | null;
  invoice_total_vnd: number | string;
  note: string | null;
  status: "draft" | "finalized" | "canceled";
  created_by: string;
  created_at: string;
  updated_by: string;
  updated_at: string;
  finalized_by: string | null;
  finalized_at: string | null;
  canceled_by: string | null;
  canceled_at: string | null;
  cancel_reason: string | null;
  linked_inventory_receipt_id: string | null;
  inventory_receipt_created: boolean;
};

export type OwnerPurchaseLineRow = {
  id: string;
  line_number: number;
  active: boolean;
  description: string;
  cost_class: "raw_material" | "non_ingredient";
  inventory_class: "stock" | "non_stock";
  inventory_item_id: string | null;
  item_name_snapshot: string | null;
  large_unit_snapshot: string | null;
  conversion_factor_snapshot: number | string | null;
  small_unit_snapshot: string | null;
  large_quantity: number | string | null;
  loose_quantity: number | string | null;
  converted_quantity: number | string | null;
  unit_snapshot: string | null;
  quantity_snapshot: number | string | null;
  line_amount_vnd: number | string | null;
};

export type OwnerPurchaseEvidenceRow = {
  id: string;
  reimbursement_id: string | null;
  file_name: string;
  caption: string | null;
  mime_type: string;
  byte_size: number | string;
  created_at: string;
};

export type DailyExpenseCandidateRow = {
  id: string;
  business_date: string;
  amount_vnd: number | string;
  reason: string;
  created_at: string;
};

export type InventoryItemChoice = {
  id: string;
  name: string;
  category: string;
  large_unit: string | null;
  conversion_factor: number | string | null;
  small_unit: string;
  count_large_unit_only: boolean;
};
