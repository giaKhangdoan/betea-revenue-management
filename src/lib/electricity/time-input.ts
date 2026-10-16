// Accept a 24-hour clock time, including compact input from a phone keypad.
export function normalizeElectricityTime(value: string): string | null {
  const text = value.trim();
  let hours: string;
  let minutes: string;
  if (/^\d{1,2}:\d{2}$/.test(text)) {
    [hours, minutes] = text.split(":");
  } else if (/^\d{3,4}$/.test(text)) {
    hours = text.slice(0, -2);
    minutes = text.slice(-2);
  } else if (/^\d{1,2}$/.test(text)) {
    hours = text;
    minutes = "00";
  } else return null;
  if (Number(hours) > 23 || Number(minutes) > 59) return null;
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

export function electricityDurationMinutes(start: string, end: string, nextDay: boolean): number | null {
  const from = normalizeElectricityTime(start);
  const to = normalizeElectricityTime(end);
  if (!from || !to) return null;
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const duration = minutes(to) - minutes(from) + (nextDay ? 1440 : 0);
  return duration >= 0 ? duration : null;
}
