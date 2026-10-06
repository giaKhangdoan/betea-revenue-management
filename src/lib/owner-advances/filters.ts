export type VoucherMonthBounds = { startDate: string; endDateExclusive: string };

export function getVoucherMonthBounds(month: string): VoucherMonthBounds {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!match) throw new Error("Tháng không hợp lệ.");

  const year = Number(match[1]);
  const monthNumber = Number(match[2]);
  if (year < 1 || year > 9998) throw new Error("Tháng không hợp lệ.");

  const nextMonth = monthNumber === 12
    ? `${String(year + 1).padStart(4, "0")}-01-01`
    : `${String(year).padStart(4, "0")}-${String(monthNumber + 1).padStart(2, "0")}-01`;

  return { startDate: `${match[1]}-${match[2]}-01`, endDateExclusive: nextMonth };
}

export function getVoucherPageRange(page: number, pageSize: number): { from: number; to: number } {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error("Trang không hợp lệ.");
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) throw new Error("Kích thước trang không hợp lệ.");
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  if (!Number.isSafeInteger(to)) throw new Error("Trang vượt giới hạn.");
  return { from, to };
}
