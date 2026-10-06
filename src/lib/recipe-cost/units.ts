import type { UnitConversion } from "./types";

const MAX_DECIMAL_PLACES = 8;
const TEN = BigInt(10);

export type DecimalFraction = { numerator: bigint; denominator: bigint };

export class UnitConversionError extends RangeError {
  constructor(readonly code: "INCOMPATIBLE_UNITS" | "AMBIGUOUS_CONVERSION", message: string) {
    super(message);
    this.name = "UnitConversionError";
  }
}

function absolute(value: bigint) {
  return value < BigInt(0) ? -value : value;
}

function gcd(left: bigint, right: bigint): bigint {
  let a = absolute(left);
  let b = absolute(right);
  while (b !== BigInt(0)) [a, b] = [b, a % b];
  return a || BigInt(1);
}

function fraction(numerator: bigint, denominator: bigint): DecimalFraction {
  if (denominator === BigInt(0)) throw new RangeError("Cannot divide by zero");
  const sign = denominator < BigInt(0) ? BigInt(-1) : BigInt(1);
  const divisor = gcd(numerator, denominator);
  return { numerator: (numerator / divisor) * sign, denominator: absolute(denominator) / divisor };
}

export function parseDecimal(value: string): DecimalFraction {
  if (typeof value !== "string") throw new RangeError("Decimal values must be supplied as strings");
  const match = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new RangeError(`Invalid decimal value: ${value}`);
  const fractionDigits = match[3] ?? "";
  if (fractionDigits.length > MAX_DECIMAL_PLACES || match[2].length > 22) {
    throw new RangeError(`Decimal value exceeds supported precision: ${value}`);
  }
  const denominator = TEN ** BigInt(fractionDigits.length);
  const digits = BigInt(`${match[2]}${fractionDigits}`);
  return fraction((match[1] === "-" ? BigInt(-1) * digits : digits), denominator);
}

const ONE = parseDecimal("1");

export function add(left: DecimalFraction, right: DecimalFraction): DecimalFraction {
  return fraction(left.numerator * right.denominator + right.numerator * left.denominator, left.denominator * right.denominator);
}

export function subtract(left: DecimalFraction, right: DecimalFraction): DecimalFraction {
  return fraction(left.numerator * right.denominator - right.numerator * left.denominator, left.denominator * right.denominator);
}

export function multiply(left: DecimalFraction, right: DecimalFraction): DecimalFraction {
  return fraction(left.numerator * right.numerator, left.denominator * right.denominator);
}

export function divide(left: DecimalFraction, right: DecimalFraction): DecimalFraction {
  if (right.numerator === BigInt(0)) throw new RangeError("Cannot divide by zero");
  return fraction(left.numerator * right.denominator, left.denominator * right.numerator);
}

export function compare(left: DecimalFraction, right: DecimalFraction): number {
  const delta = left.numerator * right.denominator - right.numerator * left.denominator;
  return delta < BigInt(0) ? -1 : delta > BigInt(0) ? 1 : 0;
}

export function formatDecimal(value: DecimalFraction | string, maximumFractionDigits = MAX_DECIMAL_PLACES): string {
  const parsed = typeof value === "string" ? parseDecimal(value) : value;
  if (!Number.isInteger(maximumFractionDigits) || maximumFractionDigits < 0 || maximumFractionDigits > MAX_DECIMAL_PLACES) {
    throw new RangeError("Display precision must be an integer from 0 to 8");
  }

  const scale = TEN ** BigInt(maximumFractionDigits);
  const absoluteNumerator = absolute(parsed.numerator) * scale;
  let rounded = absoluteNumerator / parsed.denominator;
  const remainder = absoluteNumerator % parsed.denominator;
  if (remainder * BigInt(2) >= parsed.denominator) rounded += BigInt(1);

  const sign = parsed.numerator < BigInt(0) && rounded !== BigInt(0) ? "-" : "";
  if (maximumFractionDigits === 0) return `${sign}${rounded}`;
  const whole = rounded / scale;
  const fractional = (rounded % scale).toString().padStart(maximumFractionDigits, "0").replace(/0+$/, "");
  return fractional ? `${sign}${whole}.${fractional}` : `${sign}${whole}`;
}

export function addDecimals(left: string, right: string): string {
  return formatDecimal(add(parseDecimal(left), parseDecimal(right)));
}

type BuiltinUnit = { canonical: string; dimension: "mass" | "volume" | "count"; baseFactor: string };

const BUILTIN_UNITS: Record<string, BuiltinUnit> = {};
function addUnit(aliases: string[], unit: BuiltinUnit) {
  for (const alias of aliases) BUILTIN_UNITS[alias] = unit;
}

addUnit(["mg", "milligram", "milligrams"], { canonical: "mg", dimension: "mass", baseFactor: "0.001" });
addUnit(["g", "gr", "gram", "grams", "gramme", "grammes"], { canonical: "g", dimension: "mass", baseFactor: "1" });
addUnit(["kg", "kilogram", "kilograms", "kilogramme", "kilogrammes"], { canonical: "kg", dimension: "mass", baseFactor: "1000" });
addUnit(["ml", "milliliter", "milliliters", "millilitre", "millilitres"], { canonical: "ml", dimension: "volume", baseFactor: "1" });
addUnit(["l", "liter", "liters", "litre", "litres"], { canonical: "l", dimension: "volume", baseFactor: "1000" });
addUnit(["cái", "cai", "pc", "pcs", "piece", "pieces", "ea", "each"], { canonical: "piece", dimension: "count", baseFactor: "1" });

function unitKey(unit: string): string {
  if (typeof unit !== "string" || unit.trim().length === 0) throw new UnitConversionError("INCOMPATIBLE_UNITS", "Unit cannot be blank");
  const normalized = unit.normalize("NFKC").trim().toLocaleLowerCase("vi-VN").replace(/\s+/g, " ");
  return BUILTIN_UNITS[normalized]?.canonical ?? normalized;
}

function findConversionFactor(from: string, to: string, conversions: readonly UnitConversion[]): DecimalFraction | null {
  const graph = new Map<string, Array<{ to: string; factor: DecimalFraction }>>();
  const addEdge = (edgeFrom: string, edgeTo: string, edgeFactor: DecimalFraction) => {
    const edges = graph.get(edgeFrom) ?? [];
    edges.push({ to: edgeTo, factor: edgeFactor });
    graph.set(edgeFrom, edges);
  };

  // Built-in units connect through their dimension's canonical base unit.
  const baseUnits = { mass: "g", volume: "ml", count: "piece" } as const;
  const seenBuiltins = new Set<string>();
  for (const unit of Object.values(BUILTIN_UNITS)) {
    if (seenBuiltins.has(unit.canonical)) continue;
    seenBuiltins.add(unit.canonical);
    const base = baseUnits[unit.dimension];
    if (unit.canonical === base) continue;
    const toBase = parseDecimal(unit.baseFactor);
    addEdge(unit.canonical, base, toBase);
    addEdge(base, unit.canonical, divide(ONE, toBase));
  }

  for (const conversion of conversions) {
    const conversionFrom = unitKey(conversion.fromUnit);
    const conversionTo = unitKey(conversion.toUnit);
    const factor = parseDecimal(conversion.factor);
    if (compare(factor, parseDecimal("0")) <= 0) throw new RangeError("Unit conversion factors must be positive");
    if (conversionFrom === conversionTo) {
      if (compare(factor, ONE) !== 0) throw new UnitConversionError("AMBIGUOUS_CONVERSION", `A conversion from ${conversion.fromUnit} to itself must have factor 1`);
      continue;
    }
    addEdge(conversionFrom, conversionTo, factor);
    addEdge(conversionTo, conversionFrom, divide(ONE, factor));
  }

  const factors = new Map<string, DecimalFraction>([[from, ONE]]);
  const queue = [from];
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index]!;
    for (const edge of graph.get(current) ?? []) {
      const nextFactor = multiply(factors.get(current)!, edge.factor);
      const knownFactor = factors.get(edge.to);
      if (knownFactor === undefined) {
        factors.set(edge.to, nextFactor);
        queue.push(edge.to);
      } else if (compare(knownFactor, nextFactor) !== 0) {
        throw new UnitConversionError("AMBIGUOUS_CONVERSION", `Conflicting conversions exist between ${from} and ${to}`);
      }
    }
  }
  return factors.get(to) ?? null;
}

export function convertQuantityExact(
  quantity: DecimalFraction,
  fromUnit: string,
  toUnit: string,
  conversions: readonly UnitConversion[] = [],
): DecimalFraction {
  const from = unitKey(fromUnit);
  const to = unitKey(toUnit);
  if (from === to) return quantity;

  const factor = findConversionFactor(from, to, conversions);
  if (factor) return multiply(quantity, factor);
  throw new UnitConversionError("INCOMPATIBLE_UNITS", `Cannot convert ${fromUnit} to ${toUnit} without an explicit conversion factor`);
}

export function convertQuantity(
  quantity: string,
  fromUnit: string,
  toUnit: string,
  conversions: readonly UnitConversion[] = [],
): string {
  return formatDecimal(convertQuantityExact(parseDecimal(quantity), fromUnit, toUnit, conversions));
}
