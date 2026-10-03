import type { ClipboardEvent, KeyboardEvent } from "react";

export function milli(value: string): bigint | null {
  if (value === "") return BigInt(0);
  if (!/^\d{1,12}(\.\d{1,3})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(1000) + BigInt(fraction.padEnd(3, "0"));
}

export function formatMilli(value: bigint): string {
  const whole = value / BigInt(1000);
  const fraction = String(value % BigInt(1000)).padStart(3, "0").replace(/0+$/, "");
  return `${whole}${fraction ? `.${fraction}` : ""}`;
}

export function formatCombinedQuantity(large: string, small: string): string {
  if (large === "" && small === "") return "";
  const largeMilli = milli(large);
  const smallMilli = milli(small);
  return largeMilli === null || smallMilli === null ? "" : formatMilli(largeMilli + smallMilli);
}

export function quantityAllowsFractional(unit: string): boolean {
  return ["gr", "ml"].includes(unit.trim().toLocaleLowerCase("vi"));
}

export function isQuantityKeyAllowed(key: string, value: string, fractional: boolean): boolean {
  return key.length !== 1 || /^\d$/.test(key)
    || Boolean(fractional && key === "." && !value.includes("."));
}

export function isQuantityPasteAllowed(value: string, fractional: boolean): boolean {
  return fractional ? /^\d+(?:\.\d{1,3})?$/.test(value.trim()) : /^\d+$/.test(value.trim());
}

export function preventInvalidQuantityKey(event: KeyboardEvent<HTMLInputElement>, fractional: boolean) {
  if (!event.ctrlKey && !event.metaKey && !isQuantityKeyAllowed(event.key, event.currentTarget.value, fractional)) {
    event.preventDefault();
  }
}

export function preventInvalidQuantityPaste(event: ClipboardEvent<HTMLInputElement>, fractional: boolean) {
  if (!isQuantityPasteAllowed(event.clipboardData.getData("text"), fractional)) event.preventDefault();
}
