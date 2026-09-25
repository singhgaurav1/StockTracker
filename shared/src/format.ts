export function todayISO(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const utc = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return new Date(utc + days * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function formatDateLabel(isoDate: string, today: string, expiry: string): string {
  const day = isoDate.slice(0, 10);
  if (day === today.slice(0, 10)) return "Now";
  if (day === expiry.slice(0, 10)) return "Exp";
  const date = new Date(`${day}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function formatChartDate(isoDate: string): string {
  const day = isoDate.slice(0, 10);
  return new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function formatPct(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value <= -99.5) return "−100%";
  const rounded = Number(value).toFixed(0);
  if (value > 0) return `+${rounded}%`;
  if (value < 0) return `−${Math.abs(Number(rounded))}%`;
  return "0%";
}

export function formatMultiple(value: number | null): string {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  if (value >= 100) return "99x+";
  if (value >= 10) return `${value.toFixed(0)}x`;
  if (value >= 1) return `${value.toFixed(1)}x`;
  return `${value.toFixed(2)}x`;
}

export function heatColor(multiple: number | null, pct: number | null): string {
  const score = multiple != null ? multiple - 1 : pct != null ? pct / 100 : 0;
  const intensity = clamp(Math.abs(score) / (multiple != null ? 1.5 : 2), 0, 1);
  if (score > 0.02) return `rgba(61, 220, 145, ${0.18 + intensity * 0.72})`;
  if (score < -0.02) return `rgba(255, 107, 107, ${0.18 + intensity * 0.72})`;
  return "rgba(232, 238, 246, 0.08)";
}

export function compactNumber(value: number): string {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

export function money(value: number, digits = 2): string {
  return `$${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function barWidthPct(value: number, max: number, minVisible = 4): number {
  const n = Number(value) || 0;
  const cap = Number(max) || 0;
  if (n <= 0 || cap <= 0) return 0;
  return Math.max(minVisible, Math.min(100, (n / cap) * 100));
}

export function maxMetric<T extends Record<string, unknown>>(rows: T[] | null | undefined, key: keyof T): number {
  return (rows ?? []).reduce((max, row) => Math.max(max, Number(row?.[key]) || 0), 0);
}

export function pickDefaultExpiry(dates: string[], today = todayISO()): string {
  const ranked = dates.map((date) => ({ date, dte: daysBetween(today, date) }));
  return ranked.find((row) => row.dte >= 14)?.date
    ?? ranked.find((row) => row.dte >= 7)?.date
    ?? dates[0]
    ?? "";
}

export function priceStep(spot: number): number {
  if (spot >= 100) return 1;
  if (spot >= 20) return 0.5;
  return 0.05;
}

export function snapPrice(price: number, step: number): number {
  const snapped = Math.round(price / step) * step;
  return roundTo(snapped, 2);
}

function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function filterHistory<T extends { date: string }>(
  history: T[],
  period: string,
  now = Date.now(),
): T[] {
  const days = { "1m": 31, "3m": 93, "6m": 186, "1y": 400 }[period] ?? 93;
  const cutoff = now - days * 86400000;
  return history.filter((bar) => Date.parse(bar.date) >= cutoff);
}

export function quoteChange(currentPrice: number, previousClose: number) {
  const change = currentPrice - previousClose;
  const changePct = previousClose ? (change / previousClose) * 100 : 0;
  return { change, changePct };
}
