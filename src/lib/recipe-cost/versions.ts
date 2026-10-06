import type { RecipeCostCalculation, RecipeCostDocument } from "./types";

export type RecipeCostSnapshot = {
  revision: number;
  capturedAt: string;
  capturedBy: string;
  reason: string;
  document: RecipeCostDocument;
  calculation: RecipeCostCalculation;
};

function freezeRecursively<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as Record<string, unknown>).forEach((child) => freezeRecursively(child));
  }
  return value;
}

function jsonCopy<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    throw new RangeError("Recipe snapshots must contain JSON-serializable data");
  }
}

export function createRecipeCostSnapshot(input: RecipeCostSnapshot): RecipeCostSnapshot {
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) throw new RangeError("Snapshot revision must be a positive integer");
  if (!Number.isFinite(Date.parse(input.capturedAt))) throw new RangeError("Snapshot time must be a valid date");
  if (!input.capturedBy.trim()) throw new RangeError("Snapshot owner is required");
  if (!input.reason.trim() || input.reason.length > 500) throw new RangeError("Snapshot reason must contain 1 to 500 characters");

  return freezeRecursively({
    revision: input.revision,
    capturedAt: input.capturedAt,
    capturedBy: input.capturedBy,
    reason: input.reason,
    document: jsonCopy(input.document),
    calculation: jsonCopy(input.calculation),
  });
}
