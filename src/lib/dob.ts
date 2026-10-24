export interface MonthOption {
  value: string;
  label: string;
}

export const MONTH_NAMES: readonly MonthOption[] = [
  { value: "01", label: "Jan" },
  { value: "02", label: "Feb" },
  { value: "03", label: "Mar" },
  { value: "04", label: "Apr" },
  { value: "05", label: "May" },
  { value: "06", label: "Jun" },
  { value: "07", label: "Jul" },
  { value: "08", label: "Aug" },
  { value: "09", label: "Sep" },
  { value: "10", label: "Oct" },
  { value: "11", label: "Nov" },
  { value: "12", label: "Dec" },
] as const;

export function clampDayForMonth(day: number, month: number, year?: number): number {
  if (!month || month < 1 || month > 12) return day;
  const y = year || 2024;
  const maxDays = new Date(y, month, 0).getDate();
  return Math.min(Math.max(1, day), maxDays);
}

export function buildIsoDate(day: string, month: string, year: string): string {
  if (!day || !month || !year) return "";
  const d = parseInt(day, 10);
  const m = parseInt(month, 10);
  const y = parseInt(year, 10);
  if (Number.isNaN(d) || Number.isNaN(m) || Number.isNaN(y)) return "";
  const clamped = clampDayForMonth(d, m, y);
  return `${year}-${String(m).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}
