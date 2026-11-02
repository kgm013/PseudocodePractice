// AS Level DATE values are stored as a day number (days since 1 January 1970).

const MS_PER_DAY = 86_400_000;

export function isValidDate(day: number, month: number, year: number): boolean {
  if (!Number.isInteger(day) || !Number.isInteger(month) || !Number.isInteger(year)) return false;
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) return false;
  const d = new Date(Date.UTC(2000, month - 1, day));
  d.setUTCFullYear(year);
  return d.getUTCMonth() === month - 1 && d.getUTCDate() === day;
}

export function toDayNumber(day: number, month: number, year: number): number {
  const d = new Date(Date.UTC(2000, month - 1, day));
  d.setUTCFullYear(year);
  return Math.round(d.getTime() / MS_PER_DAY);
}

export function fromDayNumber(n: number): { day: number; month: number; year: number; weekday: number } {
  const d = new Date(n * MS_PER_DAY);
  return { day: d.getUTCDate(), month: d.getUTCMonth() + 1, year: d.getUTCFullYear(), weekday: d.getUTCDay() };
}

export function formatDate(n: number): string {
  const { day, month, year } = fromDayNumber(n);
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${String(year).padStart(4, "0")}`;
}

/** Parses DD/MM/YYYY (one or two digits for day and month). Returns null if it isn't a real date. */
export function parseDate(text: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [day, month, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return isValidDate(day, month, year) ? toDayNumber(day, month, year) : null;
}

export function todayDayNumber(): number {
  const now = new Date();
  return toDayNumber(now.getDate(), now.getMonth() + 1, now.getFullYear());
}
