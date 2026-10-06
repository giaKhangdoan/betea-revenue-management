import { describe, expect, it } from "vitest";
import { addDecimals, convertQuantity, divide, formatDecimal, parseDecimal } from "./units";

describe("recipe cost units and decimal arithmetic", () => {
  it("converts within weight and volume dimensions without floating point drift", () => {
    expect(convertQuantity("1.25", "kg", "g")).toBe("1250");
    expect(convertQuantity("1250", "g", "kg")).toBe("1.25");
    expect(convertQuantity("1.5", "l", "ml")).toBe("1500");
  });

  it("does not infer a conversion between weight and volume", () => {
    expect(() => convertQuantity("50", "g", "ml")).toThrowError(
      expect.objectContaining({ code: "INCOMPATIBLE_UNITS" }),
    );
  });

  it("uses an explicitly entered conversion factor when dimensions differ", () => {
    expect(convertQuantity("50", "g", "ml", [{ fromUnit: "g", toUnit: "ml", factor: "0.9" }])).toBe("45");
  });

  it("composes standard same-dimension units with an explicit cross-dimension factor", () => {
    expect(convertQuantity("1", "kg", "ml", [{ fromUnit: "g", toUnit: "ml", factor: "0.9" }])).toBe("900");
  });

  it("rejects inconsistent alternate conversion paths even when the direct route is shorter", () => {
    const inconsistent = [
      { fromUnit: "g", toUnit: "ml", factor: "1" },
      { fromUnit: "g", toUnit: "cup", factor: "2" },
      { fromUnit: "cup", toUnit: "ml", factor: "3" },
    ];

    expect(() => convertQuantity("1", "g", "ml", inconsistent)).toThrowError(
      expect.objectContaining({ code: "AMBIGUOUS_CONVERSION" }),
    );
  });

  it("supports exact decimal parsing and normalized display values", () => {
    expect(addDecimals("0.1", "0.2")).toBe("0.3");
    expect(formatDecimal(parseDecimal("10.12500000"))).toBe("10.125");
    expect(formatDecimal(divide(parseDecimal("1"), parseDecimal("3")), 2)).toBe("0.33");
    expect(formatDecimal(parseDecimal("1.245"), 2)).toBe("1.25");
    expect(() => parseDecimal("1e3")).toThrow(RangeError);
    expect(() => parseDecimal("0.000000001")).toThrow(RangeError);
  });
});
