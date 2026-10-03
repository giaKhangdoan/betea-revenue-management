import { expect, test } from "vitest";
import { formatCombinedQuantity, isQuantityKeyAllowed, isQuantityPasteAllowed, quantityAllowsFractional } from "./quantity-input";

test("inventory quantity input accepts numeric values only and combines equivalent units", () => {
  expect(isQuantityKeyAllowed("4", "", false)).toBe(true);
  expect(isQuantityKeyAllowed("e", "", true)).toBe(false);
  expect(isQuantityKeyAllowed(".", "", true)).toBe(true);
  expect(isQuantityKeyAllowed(".", "1.5", true)).toBe(false);
  expect(isQuantityPasteAllowed("2e3", false)).toBe(false);
  expect(isQuantityPasteAllowed("1.25", true)).toBe(true);
  expect(isQuantityPasteAllowed("1,25", true)).toBe(false);
  expect(formatCombinedQuantity("", "")).toBe("");
  expect(formatCombinedQuantity("3", "1.25")).toBe("4.25");
  expect(quantityAllowsFractional("Gr")).toBe(true);
  expect(quantityAllowsFractional("Ml")).toBe(true);
  expect(quantityAllowsFractional("Kg")).toBe(false);
  expect(quantityAllowsFractional("Cái")).toBe(false);
});
