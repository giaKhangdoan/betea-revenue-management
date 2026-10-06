# Inventory workspace and history

## Owner workspace

`/inventory` is task-first and has three tabs:

- **Tồn kho** loads active catalog items and the count for the selected date. It does not fetch receipt movement history or correction history on page load.
- **Nhập kho** loads active catalog items and one recent receipt page (20 receipts). Receipt audit snapshots are fetched from the history screen only.
- **Danh mục** loads the catalog only.

The owner can open `/inventory/history` to browse receipt and finalized-count history. Both lists use timestamp-plus-ID keyset cursors, fetch 20 rows by default, and cap requested pages at 50. Receipt lines are bounded to 200 per receipt, and each receipt history page shows at most 50 correction/version events per receipt with an explicit truncation indicator.

For a finalized count, the correction form is available in the stock view. The correction history is separate and loads only after the owner selects **Mở lịch sử hiệu chỉnh**. The server action requires an owner session, validates the count UUID, and verifies that the count belongs to that owner and is finalized. Correction history uses a `corrected_at DESC, id DESC` keyset, 20 rows per page, and the owner/count index from migration `20261007130000_inventory_workspace_ux.sql`.

## Staff boundaries

Staff inventory pages are restricted to the current Vietnam week (Monday through the next Monday). The UI clamps selectable dates, and database policies/RPCs enforce the same week boundary. Staff do not access owner-only correction history or inventory movement summaries.

## Quantity review

Receipt and count forms preview the entered quantity, conversion factor, and resulting stock unit before saving. Changing a package unit or conversion factor clears its owner-verified state. A receipt quantity greater than five times the median of the last five receipts requires owner confirmation when at least three prior receipts are available; the entered quantity is not changed automatically.

## Excel export

`GET /inventory/export?from=YYYY-MM-DD&to=YYYY-MM-DD` is owner-only and returns a private, no-store workbook. A request is limited to 366 calendar days and bounded row budgets. Timestamp scans use deterministic tie-breakers and owner-scoped indexes. The route responds with:

- `400` for an invalid date range or a finalized-history span that is too wide.
- `413` when a bounded export exceeds its safe row/event budget; narrow the date range.
- `500` for a Supabase query failure.

The old full-history readers `getInventoryReceipts()` and `getFinalizedInventoryCountHistory()` are deprecated. New screens must use the bounded page readers; exports must use the dedicated bounded export reader.

## Local verification

Run application tests, typecheck, lint, production build, and pgTAP against an isolated Docker database. Never point destructive local test commands at the linked/hosted Supabase project. The production-facing environment may not contain a new phase migration until the separate, approved release step.
