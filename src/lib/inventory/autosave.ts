export function queueInventorySave<T>(previous: Promise<unknown>, save: () => Promise<T>): Promise<T> {
  return previous.catch(() => undefined).then(save);
}

export type InventoryCountDraftValue = { large: string; small: string };
export type InventoryCountDraftDirty = Record<string, Partial<Record<"large" | "small", true>>>;
export type InventoryCountDraftChange = {
  item_id: string;
  large_quantity?: string | null;
  small_quantity?: string | null;
};

export function collectInventoryDraftChanges({
  current,
  saved,
  dirty,
  recountItemIds,
}: {
  current: Record<string, InventoryCountDraftValue>;
  saved: Record<string, InventoryCountDraftValue>;
  dirty: InventoryCountDraftDirty;
  recountItemIds: Iterable<string>;
}): { changes: InventoryCountDraftChange[]; dirty: InventoryCountDraftDirty } {
  const nextDirty = Object.fromEntries(Object.entries(dirty).map(([itemId, fields]) => [itemId, { ...fields }])) as InventoryCountDraftDirty;
  const recountIds = new Set(recountItemIds);
  const itemIds = new Set([...Object.keys(nextDirty), ...recountIds]);
  const changes = new Map<string, InventoryCountDraftChange>();

  for (const itemId of itemIds) {
    const value = current[itemId];
    if (!value) continue;
    const fields = nextDirty[itemId] ?? {};
    if (recountIds.has(itemId)) {
      changes.set(itemId, {
        item_id: itemId,
        large_quantity: value.large === "" ? null : value.large,
        small_quantity: value.small === "" ? null : value.small,
      });
      delete nextDirty[itemId];
      continue;
    }

    const savedValue = saved[itemId];
    for (const field of ["large", "small"] as const) {
      if (!fields[field]) continue;
      const quantity = value[field];
      if (quantity === savedValue[field]) {
        delete fields[field];
        continue;
      }
      const change = changes.get(itemId) ?? { item_id: itemId };
      change[field === "large" ? "large_quantity" : "small_quantity"] = quantity === "" ? null : quantity;
      changes.set(itemId, change);
    }
    if (!fields.large && !fields.small) delete nextDirty[itemId];
  }

  return { changes: [...changes.values()], dirty: nextDirty };
}
