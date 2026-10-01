# Ticket 06 plan: catalog management

## Overview

Let the store owner add, edit, and deactivate inventory items while keeping saved count and receipt snapshots intact.

## Steps

1. Add owner-only catalog RPCs and database checks; serialize catalog writes with count snapshots and extend the boundary test for direct writes and invalid values.
2. Add validated owner Server Actions and a catalog query that includes inactive items.
3. Add an owner-only catalog tab with add, edit, and deactivate forms; keep count and receipt pickers on active items.
4. Run the repository checks, review the diff, and update ticket 06.

## Completion criteria

- Only the owner can change catalog rows, including through direct RPC calls.
- Invalid labels and conversion factors fail at both action and database boundaries.
- Deactivated items are excluded from new counts and remain visible in saved count and receipt history.
- Catalog edits do not alter historical snapshots, including when a count or receipt is being saved concurrently.
- Typecheck and lint pass; existing test failures and the unavailable local database are reported.
