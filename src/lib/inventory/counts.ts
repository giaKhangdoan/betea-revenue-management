import type { createClient } from "@/lib/supabase/server";
import { parseInventoryHistoryCursor, type InventoryReceipt } from "@/lib/inventory/receipts";

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

export type InventoryHistoryIntegrity = {
  status: "verified" | "unverified";
  reason: string | null;
};

export type InventoryCountHistoryVersion = {
  effective_at: string;
  sequence_no?: string | number;
  event_type: string;
  actor_id?: string;
  actor_label?: string;
  reason?: string | null;
  items: InventoryMovementCountItem[];
};

export type InventoryFinalizedCount = Pick<InventoryCount, "id" | "business_date"> & {
  finalized_at: string;
  items: InventoryMovementCountItem[];
  versions?: InventoryCountHistoryVersion[];
  history_integrity?: InventoryHistoryIntegrity;
  history_truncated?: boolean;
};

export type InventoryStockSnapshot = Pick<InventoryCount, "id" | "business_date"> & {
  finalized_at: string;
  items: InventoryCountItem[];
  history_integrity?: InventoryHistoryIntegrity;
};

export type InventoryFinalizedCountPage = {
  data: InventoryFinalizedCount[];
  error: boolean;
  hasMore: boolean;
  nextCursor: { finalizedAt: string; id: string } | null;
};

export const INVENTORY_COUNT_HISTORY_PAGE_SIZE = 20;

export type InventoryMovementReceiptLine = {
  item_id: string;
  item_name: string;
  large_unit?: string | null;
  large_quantity?: string | number;
  conversion_factor?: string | number | null;
  small_unit: string;
  loose_quantity?: string | number;
  converted_quantity: string | number | null;
};

export type InventoryReceiptHistoryVersion = {
  effective_at: string;
  sequence_no?: string | number;
  event_type: string;
  actor_id?: string;
  actor_label?: string;
  reason?: string | null;
  lines: InventoryMovementReceiptLine[];
};

export type InventoryMovementReceipt = {
  id: string;
  receipt_code: string;
  received_at: string;
  updated_at?: string;
  created_by_label: string;
  lines: InventoryMovementReceiptLine[];
  versions?: InventoryReceiptHistoryVersion[];
  history_integrity?: InventoryHistoryIntegrity;
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
  history_unverified?: boolean;
};

export type InventoryMovementPeriod = {
  previous_count: InventoryFinalizedCount;
  current_count: InventoryFinalizedCount;
  items: InventoryMovementItem[];
  history_unverified?: boolean;
  history_unverified_reasons?: string[];
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

type InventoryHistoryPosition = {
  timestamp: bigint;
  sequence: bigint | null;
  fallbackOrder: number;
};

function historyPosition(timestamp: string, sequence?: string | number, fallbackOrder = 0): InventoryHistoryPosition | null {
  const timestampValue = inventoryTimestampMicros(timestamp);
  if (timestampValue === null) return null;
  const sequenceText = sequence === undefined ? null : String(sequence);
  const sequenceValue = sequenceText && /^\d+$/.test(sequenceText) ? BigInt(sequenceText) : null;
  return { timestamp: timestampValue, sequence: sequenceValue, fallbackOrder };
}

function compareHistoryPositions(a: InventoryHistoryPosition, b: InventoryHistoryPosition): number {
  if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
  if (a.sequence !== null && b.sequence !== null && a.sequence !== b.sequence) {
    return a.sequence < b.sequence ? -1 : 1;
  }
  return 0;
}

function compareHistoryEvents(a: InventoryHistoryPosition, b: InventoryHistoryPosition): number {
  return compareHistoryPositions(a, b) || a.fallbackOrder - b.fallbackOrder;
}

function countCutoffPosition(count: InventoryFinalizedCount): InventoryHistoryPosition {
  const initialVersion = count.versions?.find((version) => version.effective_at === count.finalized_at
    && (version.event_type === "count_finalized" || version.event_type === "count_backfill"));
  return historyPosition(count.finalized_at, initialVersion?.sequence_no) ?? {
    timestamp: inventoryTimestampMicros(count.finalized_at) ?? BigInt(0), sequence: null, fallbackOrder: 0,
  };
}

function countItemsAsOf(count: InventoryFinalizedCount, cutoff: InventoryHistoryPosition): InventoryMovementCountItem[] {
  if (!count.versions?.length) return count.items;
  const ordered = count.versions.map((version, index) => ({
    version,
    position: historyPosition(version.effective_at, version.sequence_no, index),
  })).filter((entry): entry is { version: InventoryCountHistoryVersion; position: InventoryHistoryPosition } => Boolean(entry.position))
    .sort((a, b) => compareHistoryEvents(a.position, b.position));
  const selected = ordered.filter(({ position }) => compareHistoryPositions(position, cutoff) <= 0).at(-1);
  return selected?.version.items ?? count.items;
}

function latestCountItems(count: InventoryFinalizedCount): InventoryMovementCountItem[] {
  if (!count.versions?.length) return count.items;
  const latest = count.versions.map((version, index) => ({
    version,
    position: historyPosition(version.effective_at, version.sequence_no, index),
  })).filter((entry): entry is { version: InventoryCountHistoryVersion; position: InventoryHistoryPosition } => Boolean(entry.position))
    .sort((a, b) => compareHistoryEvents(a.position, b.position)).at(-1);
  return latest?.version.items ?? count.items;
}

type ReceiptStateByItem = Map<string, {
  quantity: bigint | null;
  unit: string;
  compatible: boolean;
  conversionUnavailable: boolean;
}>;

function receiptStateByItem(lines: InventoryMovementReceiptLine[]): ReceiptStateByItem {
  const state: ReceiptStateByItem = new Map();
  for (const line of lines) {
    const quantity = toInventoryMicros(line.converted_quantity);
    const previous = state.get(line.item_id);
    state.set(line.item_id, {
      quantity: quantity === null || previous?.quantity === null
        ? null
        : (previous?.quantity ?? BigInt(0)) + quantity,
      unit: previous?.unit ?? line.small_unit,
      compatible: (previous?.compatible ?? true) && (!previous || sameInventoryUnit(previous.unit, line.small_unit)),
      conversionUnavailable: (previous?.conversionUnavailable ?? false) || quantity === null,
    });
  }
  return state;
}

function receiptStateDelta(before: ReceiptStateByItem | null, after: ReceiptStateByItem): {
  item_id: string;
  quantity: bigint | null;
  unit: string;
  compatible: boolean;
  conversionUnavailable: boolean;
}[] {
  if (before === null) {
    return [...after].map(([item_id, value]) => ({ item_id, ...value }));
  }
  const ids = new Set([...before.keys(), ...after.keys()]);
  return [...ids].map((item_id) => {
    const previous = before.get(item_id);
    const current = after.get(item_id);
    const quantity = previous?.quantity === null || current?.quantity === null
      ? null
      : (current?.quantity ?? BigInt(0)) - (previous?.quantity ?? BigInt(0));
    return {
      item_id,
      quantity,
      unit: current?.unit ?? previous?.unit ?? "",
      compatible: (previous?.compatible ?? true) && (current?.compatible ?? true)
        && (!previous || !current || sameInventoryUnit(previous.unit, current.unit)),
      conversionUnavailable: (previous?.conversionUnavailable ?? false) || (current?.conversionUnavailable ?? false)
        || quantity === null,
    };
  });
}

function formatSignedInventoryMicros(value: bigint): string {
  return `${value < 0 ? "−" : ""}${formatInventoryMicros(value)}`;
}

export function summarizeInventoryMovement(
  counts: InventoryFinalizedCount[],
  receipts: InventoryMovementReceipt[],
): InventoryMovementSummary {
  const ordered = counts.filter((count) => inventoryTimestampMicros(count.finalized_at) !== null)
    .sort((a, b) => compareHistoryEvents(countCutoffPosition(a), countCutoffPosition(b)) || a.id.localeCompare(b.id));
  const latestRaw = ordered.at(-1) ?? null;
  const latest = latestRaw ? { ...latestRaw, items: latestCountItems(latestRaw) } : null;
  const latestCutoff = latestRaw ? countCutoffPosition(latestRaw) : null;
  const receiptEvents: {
    receipt: InventoryMovementReceipt;
    position: InventoryHistoryPosition;
    deltas: ReturnType<typeof receiptStateDelta>;
  }[] = [];
  for (const receipt of receipts) {
    if (receipt.history_integrity?.status !== "unverified" && receipt.versions?.length) {
      const versions = receipt.versions.map((version, index) => ({
        version,
        position: historyPosition(version.effective_at, version.sequence_no, index),
      })).filter((entry): entry is { version: InventoryReceiptHistoryVersion; position: InventoryHistoryPosition } => Boolean(entry.position))
        .sort((a, b) => compareHistoryEvents(a.position, b.position));
      let previousState: ReceiptStateByItem | null = null;
      for (const { version, position } of versions) {
        const state = receiptStateByItem(version.lines);
        receiptEvents.push({ receipt, position, deltas: receiptStateDelta(previousState, state) });
        previousState = state;
      }
    } else if (receipt.history_integrity?.status !== "unverified") {
      const position = historyPosition(receipt.received_at);
      if (position) receiptEvents.push({ receipt, position, deltas: receiptStateDelta(null, receiptStateByItem(receipt.lines)) });
    }
  }
  receiptEvents.sort((a, b) => compareHistoryEvents(a.position, b.position)
    || a.receipt.id.localeCompare(b.receipt.id));
  const receiptsSinceLatest = latestCutoff === null
    ? receipts
    : receipts.filter((receipt) => {
      if (receiptEvents.some((event) => event.receipt.id === receipt.id
        && compareHistoryPositions(event.position, latestCutoff) > 0)) return true;
      if (receipt.history_integrity?.status !== "unverified") return false;
      const receivedPosition = historyPosition(receipt.received_at);
      const updatedPosition = historyPosition(receipt.updated_at ?? receipt.received_at);
      if (!receivedPosition) return false;
      const latestActivity = updatedPosition && compareHistoryPositions(receivedPosition, updatedPosition) < 0
        ? updatedPosition
        : receivedPosition;
      return compareHistoryPositions(latestActivity, latestCutoff) > 0;
    });

  const periods = ordered.slice(1).map((currentRaw, index): InventoryMovementPeriod => {
    const previousRaw = ordered[index];
    const start = countCutoffPosition(previousRaw);
    const end = countCutoffPosition(currentRaw);
    const historyUnverifiedReasons = new Set<string>();
    if (previousRaw.history_integrity?.status === "unverified") {
      historyUnverifiedReasons.add(previousRaw.history_integrity.reason ?? `Tồn đầu kỳ (${previousRaw.business_date}) chưa xác minh.`);
    }
    if (currentRaw.history_integrity?.status === "unverified") {
      historyUnverifiedReasons.add(currentRaw.history_integrity.reason ?? `Tồn cuối kỳ (${currentRaw.business_date}) chưa xác minh.`);
    }
    const unverifiedReceiptActivity = receipts.filter((receipt) => {
      if (receipt.history_integrity?.status !== "unverified") return false;
      const receivedPosition = historyPosition(receipt.received_at);
      const updatedPosition = historyPosition(receipt.updated_at ?? receipt.received_at);
      if (!receivedPosition || !updatedPosition) return false;
      const uncertainStart = compareHistoryPositions(receivedPosition, updatedPosition) <= 0 ? receivedPosition : updatedPosition;
      const uncertainEnd = compareHistoryPositions(receivedPosition, updatedPosition) <= 0 ? updatedPosition : receivedPosition;
      return compareHistoryPositions(uncertainStart, end) <= 0 && compareHistoryPositions(uncertainEnd, start) > 0;
    });
    for (const receipt of unverifiedReceiptActivity) {
      historyUnverifiedReasons.add(receipt.history_integrity?.reason ?? `Phiếu nhập ${receipt.receipt_code} có lịch sử chưa xác minh.`);
    }
    const previous = { ...previousRaw, items: countItemsAsOf(previousRaw, end) };
    const current = { ...currentRaw, items: countItemsAsOf(currentRaw, end) };
    const previousByItem = new Map(previous.items.map((item) => [item.item_id, item]));
    const currentByItem = new Map(current.items.map((item) => [item.item_id, item]));
    const receivedByItem = new Map<string, { quantity: bigint; unit: string; compatible: boolean; conversionUnavailable: boolean }>();
    for (const event of receiptEvents) {
      if (compareHistoryPositions(event.position, start) <= 0 || compareHistoryPositions(event.position, end) > 0) continue;
      for (const delta of event.deltas) {
        const existing = receivedByItem.get(delta.item_id);
        receivedByItem.set(delta.item_id, {
          quantity: delta.quantity === null || existing?.conversionUnavailable
            ? existing?.quantity ?? BigInt(0)
            : (existing?.quantity ?? BigInt(0)) + delta.quantity,
          unit: existing?.unit ?? delta.unit,
          compatible: (existing?.compatible ?? true) && delta.compatible
            && (!existing || !delta.unit || sameInventoryUnit(existing.unit, delta.unit)),
          conversionUnavailable: (existing?.conversionUnavailable ?? false) || delta.conversionUnavailable,
        });
      }
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
      const itemHistoryUnverified = historyUnverifiedReasons.size > 0;
      const movement = !itemHistoryUnverified && previousQuantity !== null && currentQuantity !== null && !unitChanged && !conversionUnavailable
        ? previousQuantity + receivedQuantity - currentQuantity
        : null;

      return {
        item_id: itemId,
        item_name: after?.item_name ?? before?.item_name ?? "",
        sort_order: after?.sort_order ?? before?.sort_order,
        small_unit: after?.small_unit ?? before?.small_unit ?? "",
        previous_quantity: previousQuantity === null ? null : formatInventoryMicros(previousQuantity),
        received_quantity: itemHistoryUnverified || unitChanged || conversionUnavailable ? "—" : formatSignedInventoryMicros(receivedQuantity),
        current_quantity: currentQuantity === null ? null : formatInventoryMicros(currentQuantity),
        movement_quantity: movement === null ? null : formatInventoryMicros(movement),
        movement_sign: movement === null ? null : movement > 0 ? 1 : movement < 0 ? -1 : 0,
        ...(unitChanged ? { unit_changed: true } : {}),
        ...(conversionUnavailable ? { conversion_unavailable: true } : {}),
        ...(itemHistoryUnverified ? { history_unverified: true } : {}),
      };
    }).sort((a, b) => (a.sort_order ?? Number.MAX_SAFE_INTEGER) - (b.sort_order ?? Number.MAX_SAFE_INTEGER)
      || a.item_name.localeCompare(b.item_name, "vi"));

    return {
      previous_count: previous,
      current_count: current,
      items,
      ...(historyUnverifiedReasons.size > 0 ? {
        history_unverified: true,
        history_unverified_reasons: [...historyUnverifiedReasons],
      } : {}),
    };
  });

  return { latest, receiptsSinceLatest, periods };
}

async function loadFinalizedInventoryCounts(
  supabase: ServerSupabaseClient,
  ownerId: string,
  headers: { id: string; business_date: string; finalized_at: string }[],
  limits: { maxItems?: number; maxVersions?: number } = {},
) {
  if (headers.length === 0) return { data: [] as InventoryFinalizedCount[], error: false };
  const itemsByCount = new Map<string, InventoryMovementCountItem[]>();
  let itemCount = 0;
  for (let from = 0; from < headers.length; from += 1000) {
    const ids = headers.slice(from, from + 1000).map(({ id }) => id);
    for (let itemFrom = 0; ; itemFrom += 1000) {
      const { data, error } = await supabase.from("inventory_count_items")
        .select("count_id,item_id,item_name,large_unit,conversion_factor,small_unit,large_quantity,small_quantity,counted_quantity,sort_order")
        .eq("owner_id", ownerId).in("count_id", ids).order("count_id").order("sort_order").order("item_id").range(itemFrom, itemFrom + 999);
      if (error) return { data: [] as InventoryFinalizedCount[], error: true };
      itemCount += data?.length ?? 0;
      if (limits.maxItems !== undefined && itemCount > limits.maxItems) return { data: [] as InventoryFinalizedCount[], error: true, errorCode: "too_large" as const };
      for (const item of data ?? []) {
        const countItems = itemsByCount.get(item.count_id) ?? [];
        countItems.push(item);
        itemsByCount.set(item.count_id, countItems);
      }
      if ((data?.length ?? 0) < 1000) break;
    }
  }

  const versionsByCount = new Map<string, InventoryCountHistoryVersion[]>();
  let versionCount = 0;
  for (let from = 0; from < headers.length; from += 1000) {
    const ids = headers.slice(from, from + 1000).map(({ id }) => id);
    for (let versionFrom = 0; ; versionFrom += 1000) {
      const { data, error } = await supabase.from("inventory_count_versions")
        .select("count_id,effective_at,sequence_no,event_type,actor_id,actor_label,reason,items_snapshot")
        .eq("owner_id", ownerId).in("count_id", ids)
        .order("effective_at").order("sequence_no")
        .range(versionFrom, versionFrom + 999);
      if (error) return { data: [] as InventoryFinalizedCount[], error: true };
      versionCount += data?.length ?? 0;
      if (limits.maxVersions !== undefined && versionCount > limits.maxVersions) return { data: [] as InventoryFinalizedCount[], error: true, errorCode: "too_large" as const };
      for (const row of data ?? []) {
        const versions = versionsByCount.get(row.count_id) ?? [];
        versions.push({
          effective_at: row.effective_at,
          sequence_no: row.sequence_no,
          event_type: row.event_type,
          actor_id: row.actor_id,
          actor_label: row.actor_label,
          reason: row.reason,
          items: snapshotCountItems(row.items_snapshot),
        });
        versionsByCount.set(row.count_id, versions);
      }
      if ((data?.length ?? 0) < 1000) break;
    }
  }

  const integrityByCount = new Map<string, InventoryHistoryIntegrity>();
  for (let from = 0; from < headers.length; from += 1000) {
    const ids = headers.slice(from, from + 1000).map(({ id }) => id);
    const { data, error } = await supabase.from("inventory_history_backfill_status")
      .select("entity_id,status,reason")
      .eq("owner_id", ownerId).eq("entity_type", "count").in("entity_id", ids);
    if (error) return { data: [] as InventoryFinalizedCount[], error: true };
    for (const row of data ?? []) {
      integrityByCount.set(row.entity_id, {
        status: row.status === "verified" ? "verified" : "unverified",
        reason: row.reason,
      });
    }
  }

  return {
    data: headers.map((count) => ({
      ...count,
      items: itemsByCount.get(count.id) ?? [],
      ...(versionsByCount.has(count.id) ? { versions: versionsByCount.get(count.id)! } : {}),
      ...(integrityByCount.has(count.id) ? { history_integrity: integrityByCount.get(count.id)! } : {}),
    })),
    error: false,
  };
}

/** @deprecated Use getFinalizedInventoryCountPage() for a bounded page of owner history. */
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
  return loadFinalizedInventoryCounts(supabase, ownerId, headers);
}

export async function getFinalizedInventoryCountHistoryForIds(
  supabase: ServerSupabaseClient,
  ownerId: string,
  countIds: string[],
  limits: { maxItems?: number; maxVersions?: number } = {},
) {
  const headers: { id: string; business_date: string; finalized_at: string }[] = [];
  for (let from = 0; from < countIds.length; from += 500) {
    const { data, error } = await supabase.from("inventory_counts")
      .select("id,business_date,finalized_at")
      .eq("owner_id", ownerId).eq("status", "finalized").not("finalized_at", "is", null)
      .in("id", countIds.slice(from, from + 500)).order("finalized_at").order("id");
    if (error) return { data: [] as InventoryFinalizedCount[], error: true };
    headers.push(...(data ?? []).filter((count) => count.finalized_at !== null));
  }
  return loadFinalizedInventoryCounts(supabase, ownerId, headers, limits);
}

/** Fetch one bounded page of finalized count snapshots for the owner history screen. */
export async function getFinalizedInventoryCountPage(
  supabase: ServerSupabaseClient,
  ownerId: string,
  options: { beforeAt?: string; beforeId?: string; limit?: number } = {},
): Promise<InventoryFinalizedCountPage> {
  const limit = Math.max(1, Math.min(options.limit ?? INVENTORY_COUNT_HISTORY_PAGE_SIZE, 50));
  const cursor = parseInventoryHistoryCursor(options.beforeAt, options.beforeId);
  if (!cursor) {
    return { data: [], error: true, hasMore: false, nextCursor: null };
  }

  let query = supabase.from("inventory_counts")
    .select("id,business_date,finalized_at")
    .eq("owner_id", ownerId).eq("status", "finalized").not("finalized_at", "is", null)
    .order("finalized_at", { ascending: false }).order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor.beforeAt && cursor.beforeId) {
    query = query.or(`finalized_at.lt.${cursor.beforeAt},and(finalized_at.eq.${cursor.beforeAt},id.lt.${cursor.beforeId})`);
  }
  const { data: rawHeaders, error: headerError } = await query;
  if (headerError) return { data: [], error: true, hasMore: false, nextCursor: null };
  const rows = (rawHeaders ?? []).filter((row): row is typeof row & { finalized_at: string } => row.finalized_at !== null);
  const hasMore = rows.length > limit;
  const headers = rows.slice(0, limit);
  if (headers.length === 0) return { data: [], error: false, hasMore: false, nextCursor: null };

  const itemResults = await Promise.all(headers.map((header) => supabase.from("inventory_count_items")
    .select("item_id,item_name,large_unit,conversion_factor,small_unit,large_quantity,small_quantity,counted_quantity,sort_order")
    .eq("owner_id", ownerId).eq("count_id", header.id)
    .order("sort_order").order("item_id").limit(501)));
  const versionResults = await Promise.all(headers.map((header) => supabase.from("inventory_count_versions")
    .select("count_id,effective_at,sequence_no,event_type,actor_id,actor_label,reason,items_snapshot")
    .eq("owner_id", ownerId).eq("count_id", header.id)
    .order("effective_at", { ascending: false }).order("sequence_no", { ascending: false }).limit(101)));
  const integrityResult = await supabase.from("inventory_history_backfill_status")
    .select("entity_id,status,reason")
    .eq("owner_id", ownerId).eq("entity_type", "count").in("entity_id", headers.map(({ id }) => id));
  if (itemResults.some(({ error }) => error) || versionResults.some(({ error }) => error) || integrityResult.error) {
    return { data: [], error: true, hasMore: false, nextCursor: null };
  }

  const integrityByCount = new Map((integrityResult.data ?? []).map((row) => [row.entity_id, {
    status: row.status === "verified" ? "verified" as const : "unverified" as const,
    reason: row.reason,
  }]));
  const data = headers.map((header, index) => {
    const rawItems = itemResults[index].data ?? [];
    const rawVersions = versionResults[index].data ?? [];
    const items = rawItems.slice(0, 500) as InventoryMovementCountItem[];
    const versions = rawVersions.slice(0, 100).map((row) => ({
      effective_at: row.effective_at,
      sequence_no: row.sequence_no,
      event_type: row.event_type,
      actor_id: row.actor_id,
      actor_label: row.actor_label,
      reason: row.reason,
      items: snapshotCountItems(row.items_snapshot),
    })).reverse();
    return {
      ...header,
      finalized_at: header.finalized_at,
      items,
      history_truncated: rawItems.length > 500 || rawVersions.length > 100,
      ...(versions.length ? { versions } : {}),
      ...(integrityByCount.has(header.id) ? { history_integrity: integrityByCount.get(header.id)! } : {}),
    };
  });
  const last = headers.at(-1)!;
  return {
    data,
    error: false,
    hasMore,
    nextCursor: hasMore ? { finalizedAt: last.finalized_at, id: last.id } : null,
  };
}

export async function getInventoryItemsNeedingRecountForCount(
  supabase: ServerSupabaseClient,
  countId: string,
): Promise<{ itemIds: string[]; error: boolean }> {
  const { data, error } = await supabase.rpc("inventory_count_items_needing_recount", { p_count_id: countId });
  return { itemIds: Array.isArray(data) ? data.filter((id): id is string => typeof id === "string") : [], error: Boolean(error) };
}

function snapshotCountItems(value: unknown): InventoryMovementCountItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const row = entry as Record<string, unknown>;
    return {
      item_id: String(row.item_id ?? ""),
      item_name: String(row.item_name ?? ""),
      large_unit: row.large_unit == null ? null : String(row.large_unit),
      conversion_factor: row.conversion_factor == null ? null : String(row.conversion_factor),
      small_unit: String(row.small_unit ?? ""),
      large_quantity: row.large_quantity == null ? null : String(row.large_quantity),
      small_quantity: row.small_quantity == null ? null : String(row.small_quantity),
      counted_quantity: row.counted_quantity == null ? null : String(row.counted_quantity),
      ...(row.sort_order == null ? {} : { sort_order: Number(row.sort_order) }),
    };
  });
}

export function isInventoryBusinessDate(value: string): boolean {
  const parsed = new Date(`${value}T12:00:00Z`);
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}

/** Fetch only the latest completed stock count for the admin's current-stock view. */
export async function getLatestFinalizedInventoryCount(supabase: ServerSupabaseClient, ownerId: string) {
  const { data: count, error: countError } = await supabase
    .from("inventory_counts")
    .select("id,business_date,finalized_at")
    .eq("owner_id", ownerId)
    .eq("status", "finalized")
    .not("finalized_at", "is", null)
    .order("finalized_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (countError) return { data: null as InventoryStockSnapshot | null, error: true };
  if (!count?.finalized_at) return { data: null as InventoryStockSnapshot | null, error: false };

  const [itemsResult, integrityResult] = await Promise.all([
    supabase.from("inventory_count_items")
      .select("item_id,item_name,category,large_unit,conversion_factor,small_unit,count_large_unit_only,large_quantity,small_quantity,counted_quantity,counted_at,sort_order")
      .eq("owner_id", ownerId)
      .eq("count_id", count.id)
      .order("sort_order")
      .order("category")
      .order("item_name")
      .limit(501),
    supabase.from("inventory_history_backfill_status")
      .select("status,reason")
      .eq("owner_id", ownerId)
      .eq("entity_type", "count")
      .eq("entity_id", count.id)
      .maybeSingle(),
  ]);

  if (itemsResult.error || integrityResult.error || (itemsResult.data?.length ?? 0) > 500) {
    return { data: null as InventoryStockSnapshot | null, error: true };
  }

  return {
    data: {
      ...count,
      finalized_at: count.finalized_at,
      items: itemsResult.data ?? [],
      ...(integrityResult.data ? {
        history_integrity: {
          status: integrityResult.data.status === "verified" ? "verified" as const : "unverified" as const,
          reason: integrityResult.data.reason,
        },
      } : {}),
    } satisfies InventoryStockSnapshot,
    error: false,
  };
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
