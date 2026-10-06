# Phase 01 — Workbook mapping and import audit

**Audit date:** 2026-10-05 (Asia/Saigon)
**Source:** `C:\Users\khang\Downloads\COGS BETEA.xlsx`
**Method:** Read-only inspection with `openpyxl`, comparing formula text and cached Excel values. The workbook was not saved or changed. `openpyxl` warned that Excel Data Validation extensions are not supported on save; no save was performed.

## Workbook structure

The workbook has 44 sheets: five shared/summary sheets and 39 individual product sheets. The owner-confirmed size mapping is **S = 12oz, M = 17oz, L = 22oz**.

| Sheet | Populated area | Rows / fields to map | Disposition |
|---|---|---|---|
| `Bảng NVl` | A9:K58 | Rows 14–39 contain supplier purchase price, purchase unit/quantity, and a cost-unit lookup table; rows 43–58 contain further unit-cost entries including bases and products. K51:K53 is a separate unlabeled formula block. | Map source rows and units; hold duplicate, unmatched, and unlabeled entries described below. |
| `Bán Thành Phẩm` | A4:K70 | Two side-by-side batch-recipe blocks. Titles/yields, ingredient, unit, unit price, quantity, line cost, and output cost are repeated by block. Blocks include tea bases, matcha base, sugar syrup, cheese cream, winter-melon base, toppings, jellies, and cream mixes. | Map each batch and yield; do not infer links from display names alone. Several unit prices are hard-coded. |
| `Menu` | A4:N33 | 20 menu rows in four groups, with S/M/L sale prices and cost/margin formulas linked to recipe sheets. | Use as menu/price cross-check, not as a second source of recipe lines. |
| `Sheet1` (hidden) | A1:C77 | 76 legacy name/cost entries; no formulas. | Not referenced by Menu; hold until its purpose is confirmed. |
| `GP Tổng` | A1:F26 | Summary averages derived from Menu. | Derived report; do not import as recipe or ingredient data. |

All product sheets use the three size blocks at roughly A:F, H:M, and O:T. Ingredient rows are separated into formula/base, topping, and packaging sections, but the exact row numbers shift by recipe. Two winter-melon sheets only have two populated size blocks (12oz and 17oz), so no L recipe is present there.

## Product-sheet manifest

`cached #` is the number of formula cells whose saved Excel result is an error. `external` counts formulas referring to another workbook. Hidden sheets remain listed; hidden state is not evidence that a recipe is obsolete.

| Product sheet | Populated area | Formula cells | Cached # | External | State |
|---|---:|---:|---:|---:|---|
| Hồng Trà Sữa | A10:T31 | 86 | 0 | 0 | visible |
| Lục Hoàng Trà Sữa | A10:T31 | 78 | 0 | 0 | visible |
| Trà Sữa Olong Lài Chi Tử | A10:T31 | 83 | 1 | 1 | visible |
| Trà Sữa Oolong Mật ong | A10:T31 | 83 | 1 | 1 | visible |
| Trà Sữa Matcha | A10:T30 | 75 | 0 | 1 | visible |
| Trà Sữa Chocolate | A10:T30 | 75 | 0 | 1 | visible |
| Trà Sữa Khoai Môn | A10:T31 | 86 | 28 | 1 | hidden |
| Sữa Tươi Trân Châu Đường Đen | A10:T31 | 85 | 26 | 0 | hidden |
| Trà Sữa Đại Hồng Bào Đường Đen | A10:T32 | 95 | 45 | 0 | hidden |
| Trà Sữa Olong Đường Đen | A10:T32 | 95 | 24 | 0 | hidden |
| Lục Hoàng Trà Sữa Đường Đen | A10:T32 | 95 | 18 | 0 | hidden |
| Trà Đại Hồng Bào Kem Sữa | A10:T31 | 85 | 32 | 0 | hidden |
| Lục Hoàng Kem Sữa | A10:T31 | 85 | 18 | 0 | hidden |
| Olong Chi Tử Kem Sữa | A10:T31 | 85 | 18 | 0 | hidden |
| Trà Bí Đao Betea | A10:M31 | 54 | 24 | 0 | hidden |
| Trà Đại Hồng Bào Nguyên Bản | A10:T31 | 85 | 32 | 0 | hidden |
| Lục Hoàng Trà | A10:T30 | 74 | 0 | 0 | visible |
| Olong Lài Chi Tử | A10:T30 | 74 | 0 | 0 | visible |
| Trà Bí Đao | A10:M31 | 54 | 20 | 0 | hidden |
| Matcha Đá Xay | A10:T31 | 85 | 0 | 0 | visible |
| Chocolate Đá Xay | A10:T31 | 85 | 0 | 0 | visible |
| Khoai Môn Đá Xay | A10:T31 | 85 | 0 | 0 | hidden |
| Hồng Trà Đá Xay | A10:T31 | 85 | 0 | 0 | hidden |
| Oolong Chi Tử Đá Xay | A10:T31 | 85 | 0 | 0 | hidden |
| Oreo Đá Xay | A10:T31 | 85 | 0 | 0 | visible |
| Trà Kiwi | A10:T30 | 75 | 0 | 1 | visible |
| Trà Ổi Hồng | A10:T30 | 75 | 0 | 1 | visible |
| Lục Trà Mật Ong | A10:T31 | 86 | 0 | 1 | visible |
| Trà Lựu Nha Đam | A10:T30 | 75 | 0 | 1 | visible |
| Trà Đào | A10:T31 | 86 | 0 | 1 | visible |
| Trà Chanh Mind | A10:T33 | 108 | 0 | 0 | hidden |
| Trà Tắc Quế Hoa | A10:T33 | 108 | 0 | 0 | hidden |
| Trà Vải Hoa Hồng | A10:T30 | 75 | 0 | 1 | visible |
| Matcha Latte | A10:T30 | 75 | 31 | 1 | hidden |
| Khoai Môn Latte | A10:T30 | 75 | 31 | 1 | hidden |
| Chocolate Latte | A10:T30 | 75 | 31 | 1 | hidden |
| Đại Hồng Bào LAtte | A10:T30 | 75 | 31 | 1 | hidden |
| Oolong Chỉ Tử Latte | A10:T30 | 75 | 23 | 1 | hidden |
| Lục Hoàng Trà Latte | A10:T30 | 75 | 23 | 1 | hidden |

The 20 rows in `Menu` reference 20 product sheets. The 19 remaining product sheets are not referenced by Menu and are left in a review queue rather than treated as active menu recipes. Hidden/legacy content is retained in the manifest.

## Formula and unit baselines

The workbook provides useful test baselines, but its cached results are not all trustworthy. Values below are **Excel’s stored formula/cache outputs**, not approval that the source business rules are correct.

| Example | Source | Workbook calculation / cached output |
|---|---|---|
| Raw Hồng Trà unit cost | `Bảng NVl!D14:E14`, formula `H14` | 150,000 ÷ 1,000 = 150 VND/g |
| Hồng Trà base batch | `Bán Thành Phẩm!C11:D14`, `E11:E14` | 55g × 150 = 8,250 VND; 1,000 ml output → 8.25 VND/ml |
| Lục Hoàng base batch | `Bán Thành Phẩm!C19:D22`, `E19:E22` | 50g × 150 = 7,500 VND; 1,000 ml output → 7.5 VND/ml |
| Oolong base batch | `Bán Thành Phẩm!I19:J22`, `K19:K22` | 55g × 240 = 13,200 VND; 1,000 ml output → 13.2 VND/ml |
| Nước Đường batch | `Bán Thành Phẩm!I27:J29`, `K27:K29` | 1,000g × 30 = 30,000 VND; 800 ml output → 37.5 VND/ml |
| Hồng Trà Sữa, S/M/L | `Menu!G11/J11/M11`, references `Hồng Trà Sữa!F28/M28/T28` | Cached 8,025 / 11,477.5 / 13,930 VND |
| Trà Sữa Matcha, S/M/L | `Menu!G15/J15/M15`, references `Trà Sữa Matcha!F27/M27/T27` | Cached 9,900 / 14,350 / 15,000 VND |

Menu cost cells use the number format `#,##0` (zero displayed decimal places), while cached values can contain fractions. Preserve full calculation precision and round only for display until the owner confirms any different rule.

## Import queue and blockers

1. **Formula errors:** 457 formula cells have cached errors in 19 product sheets; 180 are lookup cells and 277 are downstream calculations. These cells are individually unverified and must not be silently imported as zero. The sheet table above marks every affected sheet and error count.
2. **External workbook links:** 17 formulas across 17 sheets refer to `[1]Bảng NVL`. They cannot be treated as live links to this workbook; preserve them as unresolved source formulas until mapped.
3. **Potential wrong-row unit lookups:** 186 lookup formulas in 39 product sheets refer to `$B$16` even when located on later ingredient rows. This is a strong review signal, not proof that every result is wrong. `Trà Kiwi!C18` is concrete: it returns the unit for `B16` (“Cốt Lục Hoàng Trà”) while the row ingredient is `B18` (“Mứt Kiwi”).
4. **Mứt Kiwi unit:** `Bảng NVl!G27` is `KG`, and its lookup cost is 225.72 per that unit; other fruit jams are listed as ml. `Trà Kiwi` consumes 30/40/50 with a cached unit label `KG` in two size blocks and `Ml` in the first because of the lookup above. Do not convert or import this line until the intended unit and purchase yield are confirmed.
5. **Duplicate source name:** `Mật ong` appears in `Bảng NVl` rows 50 and 58 with the same displayed unit/price. Keep both source rows in the import review; do not silently merge them.
6. **Semi-product mismatch:** `Trân Châu Hoàng Kim` has a unit rate of 50 in `Bảng NVl!H49`, while its batch recipe in `Bán Thành Phẩm` computes 19,800 ÷ 400 = 49.5. `Cốt Mãng Cầu` is listed at 100/g in `Bảng NVl!H53`, while the batch recipe computes 75,000 ÷ 1,000 = 75/g. These are distinct source values, not safe to reconcile automatically.
7. **Missing formula ingredients:** the two winter-melon recipes cache `#N/A` for `Cốt Trà Bí Đao` and `Kem Muối`; the workbook’s lookup table does not provide matching entries for those names. Both sheets lack an L-sized block.
8. **Packaging discrepancy:** product sheets and Canva show 12oz, 17oz, and 23oz packaging, while the owner-confirmed product mapping says L=22oz. In `Hồng Trà Sữa`, individual packaging lines are present, but the final cost formula uses a fixed 1,000 VND cell instead of summing those line costs. The listed packaging sums differ by size; do not substitute one interpretation without confirmation.
9. **Unlabeled cells:** `Bảng NVl!K51:K53` contains values/formulas but no labels; hold outside the ingredient import.
10. **Legacy and non-menu content:** hidden `Sheet1` is not referenced by Menu, and 19 product sheets are not referenced by Menu. Preserve them for review; import only verified Menu-linked lines.
11. **Parser bounds:** the two winter-melon sheets report a formatted worksheet dimension through column 16,378, although populated cells stop at column M. The importer must scan populated cells or bounded areas, not the worksheet’s formatted maximum.

Workbook cells were also scanned for `Bước`, `Quy trình`, and `Thời gian làm`; no step-by-step SOP text was found. The workbook is a costing/recipe-quantity source. SOP instructions must be sourced from Canva or entered/verified by the owner.

## Import contract for later phases

- Use explicit source sheet/cell traceability for each imported price, yield, recipe line, and menu price.
- Preserve original unit labels. Never infer g↔ml or repair typos through fuzzy matching without owner review.
- Do not turn missing/error cells into zero.
- Stage verified rows and send the unresolved items above to an import review queue. Import completion stays false while required rows remain unresolved.
- Keep formula-cost data separate from `monthly_costs.cogs_vnd` (POS COGS).
