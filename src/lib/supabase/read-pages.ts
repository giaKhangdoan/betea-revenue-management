type PageResult<Row> = {
  data: Row[] | null;
  error: unknown;
};

/** Read every row from a bounded query without relying on the REST row cap. */
export async function readAllPages<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<Row>>,
  pageSize = 500,
): Promise<{ data: Row[]; error: unknown | null }> {
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) return { data: [], error: result.error };
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < pageSize) break;
  }
  return { data: rows, error: null };
}

type GroupPageResult<Row> = PageResult<Row>;

/**
 * Fetch child rows for a small parent page in batches while preserving a per-parent
 * row cap. The extra row detects truncation, and completed parents are removed
 * from later pages so one unusually large parent cannot force an unbounded read.
 */
export async function readGroupedPages<Row>(options: {
  groupIds: string[];
  maxRowsPerGroup: number;
  getGroupId: (row: Row) => string;
  getRowId: (row: Row) => string;
  fetchPage: (groupIds: string[], from: number, to: number) => PromiseLike<GroupPageResult<Row>>;
  pageSize?: number;
}): Promise<{
  rowsByGroup: Map<string, Row[]>;
  truncatedGroupIds: Set<string>;
  error: unknown | null;
}> {
  const pageSize = options.pageSize ?? 500;
  const rowsByGroup = new Map<string, Row[]>();
  const seenByGroup = new Map<string, Set<string>>();
  const truncatedGroupIds = new Set<string>();
  let pendingIds = [...new Set(options.groupIds)];
  let from = 0;

  while (pendingIds.length > 0) {
    const result = await options.fetchPage(pendingIds, from, from + pageSize - 1);
    if (result.error) return { rowsByGroup: new Map(), truncatedGroupIds: new Set(), error: result.error };

    const activeIds = new Set(pendingIds);
    const completedIds = new Set<string>();
    for (const row of result.data ?? []) {
      const groupId = options.getGroupId(row);
      if (!activeIds.has(groupId) || completedIds.has(groupId)) continue;

      const seen = seenByGroup.get(groupId) ?? new Set<string>();
      const rowId = options.getRowId(row);
      if (seen.has(rowId)) continue;
      seen.add(rowId);
      seenByGroup.set(groupId, seen);

      const groupRows = rowsByGroup.get(groupId) ?? [];
      if (groupRows.length >= options.maxRowsPerGroup) {
        truncatedGroupIds.add(groupId);
        completedIds.add(groupId);
        continue;
      }
      groupRows.push(row);
      rowsByGroup.set(groupId, groupRows);
    }

    if (completedIds.size > 0) {
      pendingIds = pendingIds.filter((id) => !completedIds.has(id));
      from = 0;
      continue;
    }

    const rowCount = result.data?.length ?? 0;
    if (rowCount < pageSize) break;
    from += rowCount;
  }

  return { rowsByGroup, truncatedGroupIds, error: null };
}
