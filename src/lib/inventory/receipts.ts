import type { createClient } from "@/lib/supabase/server";

type ServerSupabaseClient = NonNullable<Awaited<ReturnType<typeof createClient>>>;

export type InventoryReceiptLine = {
  id: string;
  receipt_id: string;
  item_id: string;
  item_name: string;
  category: string;
  large_unit: string | null;
  large_quantity: string | number;
  conversion_factor: string | number | null;
  small_unit: string;
  loose_quantity: string | number;
  converted_quantity: string | number | null;
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
  history_truncated?: boolean;
  versions?: InventoryReceiptHistoryVersion[];
  history_integrity?: InventoryReceiptHistoryIntegrity;
};

export type InventoryReceiptHistoryIntegrity = {
  status: "verified" | "unverified";
  reason: string | null;
};

export type InventoryReceiptHistoryVersion = {
  effective_at: string;
  sequence_no: number | string;
  event_type: string;
  actor_id: string;
  actor_label: string;
  reason: string | null;
  lines: InventoryReceiptLine[];
};

export type InventoryReceiptCorrection = {
  id: string;
  receipt_id: string;
  corrected_at: string;
  corrected_by: string;
  corrected_by_label: string;
  reason: string;
  prior_lines: InventoryReceiptLine[];
  sequence_no?: number | string;
  after_lines?: InventoryReceiptLine[];
};

type InventoryReceiptHeader = Omit<InventoryReceipt, "lines" | "corrections" | "staff_editable" | "versions" | "history_integrity">;

export type InventoryReceiptPage = {
  data: InventoryReceipt[];
  error: boolean;
  hasMore: boolean;
  nextCursor: { receivedAt: string; id: string } | null;
};

export const INVENTORY_HISTORY_PAGE_SIZE = 20;
const MAX_RECEIPT_LINES_PER_RECEIPT = 200;
const MAX_RECEIPT_AUDIT_EVENTS_PER_RECEIPT = 50;

export function parseInventoryHistoryCursor(beforeAt?: string, beforeId?: string) {
  if (!beforeAt && !beforeId) return { beforeAt: null, beforeId: null };
  if (!beforeAt || !beforeId || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(beforeAt)
    || !Number.isFinite(Date.parse(beforeAt))
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(beforeId)) return null;
  // Keep the original timestamp text so Postgres microseconds aren't truncated
  // to JavaScript milliseconds at a keyset page boundary.
  return { beforeAt, beforeId };
}

export function inventoryQuantityToMilli(value: string | number): bigint | null {
  const match = String(value).match(/^(\d+)(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  return BigInt(match[1]) * BigInt(1000) + BigInt((match[2] ?? "").padEnd(3, "0") || "0");
}

export function formatInventoryMilli(value: bigint): string {
  const whole = value / BigInt(1000);
  const fraction = String(value % BigInt(1000)).padStart(3, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

export function calculateConvertedReceiptQuantity(large: string, factor: string | number | null, loose: string) {
  if (factor === null) return null;
  const largeMilli = inventoryQuantityToMilli(large);
  const factorMilli = inventoryQuantityToMilli(factor);
  const looseMilli = inventoryQuantityToMilli(loose);
  if (largeMilli === null || factorMilli === null || looseMilli === null) return null;
  return formatInventoryMilli(largeMilli * factorMilli / BigInt(1000) + looseMilli);
}

export function calculateInventoryReceiptOutlier(
  currentQuantity: string | number,
  medianQuantity: string | number | null,
  priorReceiptCount: number,
) {
  const current = inventoryQuantityToMilli(currentQuantity);
  const median = medianQuantity === null ? null : inventoryQuantityToMilli(medianQuantity);
  if (current === null || median === null || median <= BigInt(0) || priorReceiptCount < 3 || current <= median * BigInt(5)) return null;
  // Round up the displayed multiplier so a value just over the 5× trigger is
  // never rendered as exactly 5,0×.
  const ratioHundredths = (current * BigInt(100) + median - BigInt(1)) / median;
  return {
    currentQuantity: formatInventoryMilli(current),
    medianQuantity: formatInventoryMilli(median),
    ratio: `${ratioHundredths / BigInt(100)},${String(ratioHundredths % BigInt(100)).padStart(2, "0")}×`,
  };
}

export function snapshotReceiptLines(value: unknown): InventoryReceiptLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const row = entry as Record<string, unknown>;
    return {
      id: String(row.id ?? ""),
      receipt_id: String(row.receipt_id ?? ""),
      item_id: String(row.item_id ?? ""),
      item_name: String(row.item_name ?? ""),
      category: String(row.category ?? ""),
      large_unit: row.large_unit == null ? null : String(row.large_unit),
      large_quantity: row.large_quantity == null ? "0" : String(row.large_quantity),
      conversion_factor: row.conversion_factor == null ? null : String(row.conversion_factor),
      small_unit: String(row.small_unit ?? ""),
      loose_quantity: row.loose_quantity == null ? "0" : String(row.loose_quantity),
      converted_quantity: row.converted_quantity == null ? null : String(row.converted_quantity),
    };
  });
}

/** @deprecated Use getInventoryReceiptPage() to read a bounded receipt page and opt into history only for that page. */
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

  const versionsByReceipt = new Map<string, InventoryReceiptHistoryVersion[]>();
  const integrityByReceipt = new Map<string, InventoryReceiptHistoryIntegrity>();
  for (let from = 0; from < receipts.length; from += 1000) {
    const ids = receipts.slice(from, from + 1000).map(({ id }) => id);
    for (let versionFrom = 0; ; versionFrom += 1000) {
      const { data, error } = await supabase.from("inventory_receipt_versions")
        .select("receipt_id,effective_at,sequence_no,event_type,actor_id,actor_label,reason,lines_snapshot")
        .eq("owner_id", ownerId).in("receipt_id", ids)
        .order("effective_at").order("sequence_no")
        .range(versionFrom, versionFrom + 999);
      if (error) return { data: [] as InventoryReceipt[], error: true };
      for (const row of data ?? []) {
        const history = versionsByReceipt.get(row.receipt_id) ?? [];
        history.push({
          effective_at: row.effective_at,
          sequence_no: row.sequence_no,
          event_type: row.event_type,
          actor_id: row.actor_id,
          actor_label: row.actor_label,
          reason: row.reason,
          lines: snapshotReceiptLines(row.lines_snapshot),
        });
        versionsByReceipt.set(row.receipt_id, history);
      }
      if ((data?.length ?? 0) < 1000) break;
    }

    const { data, error } = await supabase.from("inventory_history_backfill_status")
      .select("entity_id,status,reason")
      .eq("owner_id", ownerId).eq("entity_type", "receipt").in("entity_id", ids);
    if (error) return { data: [] as InventoryReceipt[], error: true };
    for (const row of data ?? []) {
      integrityByReceipt.set(row.entity_id, {
        status: row.status === "verified" ? "verified" : "unverified",
        reason: row.reason,
      });
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

  for (const [receiptId, receiptCorrections] of correctionsByReceipt) {
    const versions = versionsByReceipt.get(receiptId) ?? [];
    for (const correction of receiptCorrections) {
      const version = versions.find((entry) => entry.event_type === "receipt_corrected"
        && entry.effective_at === correction.corrected_at
        && entry.reason === correction.reason
        && entry.actor_id === correction.corrected_by);
      if (version) {
        correction.sequence_no = version.sequence_no;
        correction.after_lines = version.lines;
      }
    }
  }

  return {
    data: receipts.map((receipt) => ({
      ...receipt,
      lines: linesByReceipt.get(receipt.id) ?? [],
      corrections: correctionsByReceipt.get(receipt.id) ?? [],
      staff_editable: !finalizedAt.some((cutoff) => Date.parse(cutoff) >= Date.parse(receipt.received_at)),
      ...(versionsByReceipt.has(receipt.id) ? { versions: versionsByReceipt.get(receipt.id)! } : {}),
      ...(integrityByReceipt.has(receipt.id) ? { history_integrity: integrityByReceipt.get(receipt.id)! } : {}),
    })),
    error: false,
  };
}

/** Load one bounded, newest-first receipt page. History/audit snapshots are included only when requested. */
export async function getInventoryReceiptPage(
  supabase: ServerSupabaseClient,
  ownerId: string,
  options: {
    beforeAt?: string;
    beforeId?: string;
    receivedFrom?: string;
    receivedUntil?: string;
    includeHistory?: boolean;
    limit?: number;
  } = {},
): Promise<InventoryReceiptPage> {
  const limit = Math.max(1, Math.min(options.limit ?? INVENTORY_HISTORY_PAGE_SIZE, 50));
  const cursor = parseInventoryHistoryCursor(options.beforeAt, options.beforeId);
  if (!cursor) return { data: [], error: true, hasMore: false, nextCursor: null };

  let query = supabase.from("inventory_receipts")
    .select("id,receipt_code,received_at,created_by,created_by_label,updated_at")
    .eq("owner_id", ownerId)
    .order("received_at", { ascending: false }).order("id", { ascending: false })
    .limit(limit + 1);
  if (options.receivedFrom) query = query.gte("received_at", options.receivedFrom);
  if (options.receivedUntil) query = query.lt("received_at", options.receivedUntil);
  if (cursor.beforeAt && cursor.beforeId) {
    query = query.or(`received_at.lt.${cursor.beforeAt},and(received_at.eq.${cursor.beforeAt},id.lt.${cursor.beforeId})`);
  }

  const { data: rawHeaders, error: headerError } = await query;
  if (headerError) return { data: [], error: true, hasMore: false, nextCursor: null };
  const rows = (rawHeaders ?? []) as InventoryReceiptHeader[];
  const hasMore = rows.length > limit;
  const headers = rows.slice(0, limit);
  if (headers.length === 0) return { data: [], error: false, hasMore: false, nextCursor: null };

  const lineResults = await Promise.all(headers.map((header) => supabase.from("inventory_receipt_lines")
    .select("id,receipt_id,item_id,item_name,category,large_unit,large_quantity,conversion_factor,small_unit,loose_quantity,converted_quantity")
    .eq("owner_id", ownerId).eq("receipt_id", header.id).order("line_number").limit(MAX_RECEIPT_LINES_PER_RECEIPT)));
  if (lineResults.some(({ error }) => error)) return { data: [], error: true, hasMore: false, nextCursor: null };

  const linesByReceipt = new Map<string, InventoryReceiptLine[]>();
  for (const result of lineResults) {
    for (const line of (result.data ?? []) as InventoryReceiptLine[]) {
      const lines = linesByReceipt.get(line.receipt_id) ?? [];
      lines.push(line);
      linesByReceipt.set(line.receipt_id, lines);
    }
  }

  const integrityByReceipt = new Map<string, InventoryReceiptHistoryIntegrity>();
  if (options.includeHistory) {
    const [integrityResult, ...auditResults] = await Promise.all([
      supabase.from("inventory_history_backfill_status").select("entity_id,status,reason")
        .eq("owner_id", ownerId).eq("entity_type", "receipt").in("entity_id", headers.map(({ id }) => id)),
      ...headers.map((header) => Promise.all([
        supabase.from("inventory_receipt_corrections")
          .select("id,receipt_id,corrected_at,corrected_by,corrected_by_label,reason,prior_lines")
          .eq("owner_id", ownerId).eq("receipt_id", header.id)
          .order("corrected_at", { ascending: false }).limit(MAX_RECEIPT_AUDIT_EVENTS_PER_RECEIPT + 1),
        supabase.from("inventory_receipt_versions")
          .select("receipt_id,effective_at,sequence_no,event_type,actor_id,actor_label,reason,lines_snapshot")
          .eq("owner_id", ownerId).eq("receipt_id", header.id)
          .order("effective_at", { ascending: false }).order("sequence_no", { ascending: false })
          .limit(MAX_RECEIPT_AUDIT_EVENTS_PER_RECEIPT + 1),
      ])),
    ]);
    if (integrityResult.error || auditResults.some((pair) => pair.some(({ error }) => error))) {
      return { data: [], error: true, hasMore: false, nextCursor: null };
    }
    for (const row of integrityResult.data ?? []) integrityByReceipt.set(row.entity_id, {
      status: row.status === "verified" ? "verified" : "unverified", reason: row.reason,
    });

    const resultById = new Map(headers.map((header, index) => [header.id, auditResults[index]]));
    const receipts = headers.map((header) => {
      const [correctionsData, versionsData] = resultById.get(header.id) ?? [
        { data: [], error: null }, { data: [], error: null },
      ];
      const rawVersions = versionsData.data ?? [];
      const rawCorrections = (correctionsData.data ?? []) as InventoryReceiptCorrection[];
      const versions: InventoryReceiptHistoryVersion[] = rawVersions.slice(0, MAX_RECEIPT_AUDIT_EVENTS_PER_RECEIPT).map((row) => ({
        effective_at: row.effective_at,
        sequence_no: row.sequence_no,
        event_type: row.event_type,
        actor_id: row.actor_id,
        actor_label: row.actor_label,
        reason: row.reason,
        lines: snapshotReceiptLines(row.lines_snapshot),
      })).reverse();
      const corrections = rawCorrections.slice(0, MAX_RECEIPT_AUDIT_EVENTS_PER_RECEIPT)
        .sort((a, b) => Date.parse(a.corrected_at) - Date.parse(b.corrected_at));
      for (const correction of corrections) {
        const version = versions.find((entry) => entry.event_type === "receipt_corrected"
          && entry.effective_at === correction.corrected_at
          && entry.reason === correction.reason
          && entry.actor_id === correction.corrected_by);
        if (version) {
          correction.sequence_no = version.sequence_no;
          correction.after_lines = version.lines;
        }
      }
      return {
        ...header,
        lines: linesByReceipt.get(header.id) ?? [],
        corrections,
        staff_editable: true,
      history_truncated: rawCorrections.length > MAX_RECEIPT_AUDIT_EVENTS_PER_RECEIPT
        || rawVersions.length > MAX_RECEIPT_AUDIT_EVENTS_PER_RECEIPT,
        ...(versions.length ? { versions } : {}),
        ...(integrityByReceipt.has(header.id) ? { history_integrity: integrityByReceipt.get(header.id)! } : {}),
      };
    });
    const last = headers.at(-1)!;
    return { data: receipts, error: false, hasMore, nextCursor: hasMore ? { receivedAt: last.received_at, id: last.id } : null };
  }

  const last = headers.at(-1)!;
  return {
    data: headers.map((header) => ({
      ...header,
      lines: linesByReceipt.get(header.id) ?? [],
      corrections: [],
      staff_editable: true,
    })),
    error: false,
    hasMore,
    nextCursor: hasMore ? { receivedAt: last.received_at, id: last.id } : null,
  };
}

export const MAX_INVENTORY_EXPORT_RECEIPTS = 5_000;
const MAX_INVENTORY_EXPORT_LINES = 50_000;
const MAX_INVENTORY_EXPORT_VERSIONS = 50_000;

/**
 * Load receipt rows for an explicit export window plus only the receipt IDs
 * whose timestamped edits overlap a selected stock-count period. This keeps an
 * export bounded while preserving correction-aware movement calculations.
 */
export async function getInventoryReceiptsForExport(
  supabase: ServerSupabaseClient,
  ownerId: string,
  options: { receivedFrom: string; receivedUntil: string; additionalReceiptIds?: string[]; historyReceiptIds?: string[] },
) {
  const headersById = new Map<string, InventoryReceiptHeader>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from("inventory_receipts")
      .select("id,receipt_code,received_at,created_by,created_by_label,updated_at")
      .eq("owner_id", ownerId).gte("received_at", options.receivedFrom).lt("received_at", options.receivedUntil)
      .order("received_at").order("id").range(from, from + 999);
    if (error) return { data: [] as InventoryReceipt[], error: true };
    for (const header of data ?? []) headersById.set(header.id, header);
    if (headersById.size > MAX_INVENTORY_EXPORT_RECEIPTS) return { data: [] as InventoryReceipt[], error: true, errorCode: "too_large" as const };
    if ((data?.length ?? 0) < 1000) break;
  }

  const additionalIds = [...new Set(options.additionalReceiptIds ?? [])]
    .filter((id) => !headersById.has(id));
  for (let from = 0; from < additionalIds.length; from += 500) {
    const { data, error } = await supabase.from("inventory_receipts")
      .select("id,receipt_code,received_at,created_by,created_by_label,updated_at")
      .eq("owner_id", ownerId).in("id", additionalIds.slice(from, from + 500));
    if (error) return { data: [] as InventoryReceipt[], error: true };
    for (const header of data ?? []) headersById.set(header.id, header);
    if (headersById.size > MAX_INVENTORY_EXPORT_RECEIPTS) return { data: [] as InventoryReceipt[], error: true, errorCode: "too_large" as const };
  }

  const headers = [...headersById.values()].sort((a, b) => a.received_at.localeCompare(b.received_at) || a.id.localeCompare(b.id));
  if (headers.length === 0) return { data: [] as InventoryReceipt[], error: false };
  const ids = headers.map(({ id }) => id);
  const linesByReceipt = new Map<string, InventoryReceiptLine[]>();
  let lineCount = 0;
  for (let from = 0; from < ids.length; from += 500) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from("inventory_receipt_lines")
        .select("id,receipt_id,item_id,item_name,category,large_unit,large_quantity,conversion_factor,small_unit,loose_quantity,converted_quantity")
        .eq("owner_id", ownerId).in("receipt_id", ids.slice(from, from + 500))
        .order("receipt_id").order("line_number").range(offset, offset + 999);
      if (error) return { data: [] as InventoryReceipt[], error: true };
      lineCount += data?.length ?? 0;
      if (lineCount > MAX_INVENTORY_EXPORT_LINES) return { data: [] as InventoryReceipt[], error: true, errorCode: "too_large" as const };
      for (const line of (data ?? []) as InventoryReceiptLine[]) {
        const receiptLines = linesByReceipt.get(line.receipt_id) ?? [];
        receiptLines.push(line);
        linesByReceipt.set(line.receipt_id, receiptLines);
      }
      if ((data?.length ?? 0) < 1000) break;
    }
  }

  const historyIds = [...new Set(options.historyReceiptIds ?? [])].filter((id) => headersById.has(id));
  const versionsByReceipt = new Map<string, InventoryReceiptHistoryVersion[]>();
  let versionCount = 0;
  for (let from = 0; from < historyIds.length; from += 100) {
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.from("inventory_receipt_versions")
        .select("receipt_id,effective_at,sequence_no,event_type,actor_id,actor_label,reason,lines_snapshot")
        .eq("owner_id", ownerId).in("receipt_id", historyIds.slice(from, from + 100))
        .order("effective_at").order("sequence_no").range(offset, offset + 999);
      if (error) return { data: [] as InventoryReceipt[], error: true };
      versionCount += data?.length ?? 0;
      if (versionCount > MAX_INVENTORY_EXPORT_VERSIONS) return { data: [] as InventoryReceipt[], error: true, errorCode: "too_large" as const };
      for (const row of data ?? []) {
        const versions = versionsByReceipt.get(row.receipt_id) ?? [];
        versions.push({
          effective_at: row.effective_at,
          sequence_no: row.sequence_no,
          event_type: row.event_type,
          actor_id: row.actor_id,
          actor_label: row.actor_label,
          reason: row.reason,
          lines: snapshotReceiptLines(row.lines_snapshot),
        });
        versionsByReceipt.set(row.receipt_id, versions);
      }
      if ((data?.length ?? 0) < 1000) break;
    }
  }

  const integrityByReceipt = new Map<string, InventoryReceiptHistoryIntegrity>();
  for (let from = 0; from < historyIds.length; from += 500) {
    const { data, error } = await supabase.from("inventory_history_backfill_status")
      .select("entity_id,status,reason")
      .eq("owner_id", ownerId).eq("entity_type", "receipt").in("entity_id", historyIds.slice(from, from + 500));
    if (error) return { data: [] as InventoryReceipt[], error: true };
    for (const row of data ?? []) integrityByReceipt.set(row.entity_id, {
      status: row.status === "verified" ? "verified" : "unverified",
      reason: row.reason,
    });
  }

  return {
    data: headers.map((header) => ({
      ...header,
      lines: linesByReceipt.get(header.id) ?? [],
      corrections: [] as InventoryReceiptCorrection[],
      staff_editable: false,
      ...(versionsByReceipt.has(header.id) ? { versions: versionsByReceipt.get(header.id)! } : {}),
      ...(integrityByReceipt.has(header.id) ? { history_integrity: integrityByReceipt.get(header.id)! } : {}),
    })),
    error: false,
  };
}
