export type ReimbursementEvent = {
  id: string;
  event_type: "payment" | "reversal";
  business_date: string;
  amount_vnd: number | string;
  note: string | null;
  reverses_event_id?: string | null;
  created_at: string;
  actor_id?: string;
};

export type ReimbursementSummary = {
  reimbursedVnd: number;
  outstandingVnd: number;
  events: readonly ReimbursementEvent[];
};

function safeVnd(value: number | string): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error("Số tiền hoàn không hợp lệ.");
  return amount;
}

export function summarizeReimbursements(
  originalAmountVnd: number | string,
  events: readonly ReimbursementEvent[],
): ReimbursementSummary {
  const original = safeVnd(originalAmountVnd);
  let reimbursedVnd = 0;
  for (const event of events) {
    const amount = safeVnd(event.amount_vnd);
    if (event.event_type === "payment") reimbursedVnd += amount;
    else if (event.event_type === "reversal") reimbursedVnd -= amount;
    if (!Number.isSafeInteger(reimbursedVnd) || reimbursedVnd < 0) throw new Error("Lịch sử hoàn tiền không hợp lệ.");
  }
  if (reimbursedVnd > original) throw new Error("Số tiền hoàn vượt quá khoản đã ứng.");
  return { reimbursedVnd, outstandingVnd: original - reimbursedVnd, events };
}

export type ProfitCandidateLine = {
  id: string;
  description: string;
  active: boolean;
  costClass: string;
  inventoryClass?: string;
  lineAmountVnd: number | string | null;
};

export type ExcludedProfitLine = ProfitCandidateLine & {
  reason: "inactive" | "raw_material" | "unpriced";
};

export function getEligibleProfitLines<T extends ProfitCandidateLine>(lines: readonly T[]): {
  eligible: T[];
  excluded: ExcludedProfitLine[];
} {
  const eligible: T[] = [];
  const excluded: ExcludedProfitLine[] = [];

  for (const line of lines) {
    if (!line.active) {
      excluded.push({ ...line, reason: "inactive" });
    } else if (line.costClass !== "non_ingredient") {
      excluded.push({ ...line, reason: "raw_material" });
    } else if (line.lineAmountVnd === null || line.lineAmountVnd === "") {
      excluded.push({ ...line, reason: "unpriced" });
    } else {
      const amount = safeVnd(line.lineAmountVnd);
      eligible.push({ ...line, lineAmountVnd: amount });
    }
  }

  return { eligible, excluded };
}

export function formatPurchaseQuantity(value: number | string): string {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return String(value);
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 3 }).format(parsed);
}
