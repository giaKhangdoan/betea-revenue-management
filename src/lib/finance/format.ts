const vnd = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 });

export function formatVnd(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${vnd.format(value)} ₫`;
}

export function currentBusinessDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatBusinessDate(date: string, options: Intl.DateTimeFormatOptions = {
  weekday: "long", day: "numeric", month: "long", year: "numeric",
}): string {
  return new Intl.DateTimeFormat("vi-VN", {
    ...options,
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(new Date(`${date}T12:00:00+07:00`));
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: string): string {
  const [year, month] = date.slice(0, 7).split("-").map(Number);
  return `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`;
}

export function weekStart(date: string): string {
  const day = new Date(`${date}T12:00:00Z`);
  const weekday = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - weekday);
  return day.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function parseVnd(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const normalized = value.replace(/[.,\s]/g, "");
  if (!/^\d+$/.test(normalized)) return Number.NaN;
  const amount = Number(normalized);
  return Number.isSafeInteger(amount) ? amount : Number.NaN;
}

export function displayVndInput(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : vnd.format(value);
}
