/** "PTP_Bengaluru" -> "Bengaluru" */
export function cityLabel(raw: string): string {
  return raw.replace(/^PTP_/, "").replace(/_/g, " ");
}

/** "2026-09-18" -> "18 Sep 2026 (Fri)" */
export function dateLabel(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    weekday: "short",
  });
}

/** "2026-09-18" -> "18 Sep" */
export function dateShort(iso: string): string {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
  });
}

export function currency(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

export function number(value: number, maximumFractionDigits = 2): string {
  return value.toLocaleString("en-IN", { maximumFractionDigits });
}

/** Minutes between two "HH:MM" strings, or null if end is not after start. */
export function durationMinutes(start: string, end: string): number | null {
  const toMinutes = (value: string): number | null => {
    const [h, m] = value.split(":").map(Number);
    if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return null;
    return h * 60 + m;
  };
  const from = toMinutes(start);
  const to = toMinutes(end);
  if (from === null || to === null || to <= from) return null;
  return to - from;
}

/** 285 -> "4h 45m" */
export function durationLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

/** Current local time as "HH:MM". */
export function nowHm(): string {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
}

export const PHONE_RE = /^[6-9]\d{9}$/;
