import { clamp, daysBetween, addDays, todayISO } from "./format.ts";
import {
  greeks,
  optionPremium,
  optionValue,
  roundTo,
  sanitizeIv,
  yearsBetween,
} from "./pricing.ts";
import type { OptionRight } from "./types.ts";

export function nearestIndex(values: number[], target: number): number {
  let best = 0;
  let bestDiff = Infinity;
  values.forEach((value, index) => {
    const diff = Math.abs(value - target);
    if (diff < bestDiff) {
      best = index;
      bestDiff = diff;
    }
  });
  return best;
}

export function defaultStrikeWindow(
  spot: number,
  strikes: number[],
  ivPct: number,
  years: number,
  selectedStrike: number,
) {
  const iv = Math.max(sanitizeIv(ivPct) ?? 20, 10) / 100;
  const tenor = Math.max(years, 2 / 365.25);
  const oneSigmaPct = iv * Math.sqrt(tenor) * 100;
  const halfWindow = clamp(oneSigmaPct * 1.75, 15, 55);
  const unique = [...new Set((strikes ?? []).filter((strike) => strike > 0))].sort((a, b) => a - b);
  const chainMin = unique[0] ?? spot * (1 - halfWindow / 100);
  const chainMax = unique[unique.length - 1] ?? spot * (1 + halfWindow / 100);
  let minStrike = spot * (1 - halfWindow / 100);
  let maxStrike = spot * (1 + halfWindow / 100);
  if (selectedStrike) {
    minStrike = Math.min(minStrike, selectedStrike * 0.92);
    maxStrike = Math.max(maxStrike, selectedStrike * 1.08);
  }
  minStrike = clamp(minStrike, chainMin, chainMax);
  maxStrike = clamp(maxStrike, chainMin, chainMax);
  if (minStrike > maxStrike) [minStrike, maxStrike] = [maxStrike, minStrike];
  return {
    minStrike: roundTo(minStrike, 2),
    maxStrike: roundTo(maxStrike, 2),
    chainMin: roundTo(chainMin, 2),
    chainMax: roundTo(chainMax, 2),
  };
}

export function tableCapacity(width = 390, height = 800) {
  const maxCols = width < 380 ? 8 : width < 700 ? 9 : 11;
  const maxRows = height < 680 ? 10 : height < 900 ? 12 : 14;
  return { maxCols, maxRows };
}

function dateGranularity(dte: number) {
  if (dte <= 21) return { step: 7, kind: "weekly" as const };
  if (dte <= 60) return { step: 14, kind: "biweekly" as const };
  return { step: 30, kind: "monthly" as const };
}

export function buildDateColumns(today: string, expiry: string, maxCols = 6) {
  const dte = Math.max(0, daysBetween(today, expiry));
  const { step, kind } = dateGranularity(dte);
  if (dte <= 0) return { dates: [expiry], kind, step };

  const dates = [today];
  let cursor = addDays(today, step);
  while (daysBetween(cursor, expiry) > 2 && dates.length < 24) {
    dates.push(cursor);
    cursor = addDays(cursor, step);
  }
  if (dates[dates.length - 1] !== expiry) dates.push(expiry);

  if (dates.length <= maxCols) return { dates, kind, step };

  const inner = dates.slice(1, -1);
  const keep = Math.max(1, maxCols - 2);
  const sampled = [];
  for (let i = 0; i < keep; i += 1) {
    const idx = keep === 1 ? Math.floor((inner.length - 1) / 2) : Math.round((i * (inner.length - 1)) / (keep - 1));
    sampled.push(inner[idx]);
  }
  return { dates: [...new Set([dates[0], ...sampled, dates[dates.length - 1]])], kind, step };
}

export function interpolateIv(
  term: Array<{ date: string; iv?: number | null; atmIv?: number | null }> | null | undefined,
  date: string,
  today = todayISO(),
): number | null {
  const points = (term ?? [])
    .map((row) => ({ date: row.date, iv: sanitizeIv(row.iv ?? row.atmIv ?? NaN) }))
    .filter((row): row is { date: string; iv: number } => row.iv != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) return null;
  if (date <= points[0].date) return points[0].iv;
  const last = points[points.length - 1];
  if (date >= last.date) return last.iv;

  let left = points[0];
  let right = last;
  for (let i = 0; i < points.length - 1; i += 1) {
    if (date >= points[i].date && date <= points[i + 1].date) {
      left = points[i];
      right = points[i + 1];
      break;
    }
  }
  if (right.date === left.date) return left.iv;
  const tOf = (iso: string) => Math.max(yearsBetween(today, iso), 1 / 365.25);
  const tLeft = tOf(left.date);
  const tRight = tOf(right.date);
  const t = tOf(date);
  const wLeft = (left.iv / 100) ** 2 * tLeft;
  const wRight = (right.iv / 100) ** 2 * tRight;
  const span = tRight - tLeft || 1 / 365.25;
  const weight = (t - tLeft) / span;
  const variance = wLeft * (1 - weight) + wRight * weight;
  return Math.sqrt(Math.max(variance, 0) / t) * 100;
}

export function remainingSigma(
  term: Array<{ date: string; iv?: number | null; atmIv?: number | null }>,
  optionIvPct: number,
  today: string,
  scenarioDate: string,
  expiryDate: string,
): number {
  const optionIv = (sanitizeIv(optionIvPct) ?? 25) / 100;
  const tau = yearsBetween(scenarioDate, expiryDate);
  if (tau <= 0.5 / 365.25) return optionIv;

  const total = Math.max(yearsBetween(today, expiryDate), 1 / 365.25);
  const elapsed = Math.max(yearsBetween(today, scenarioDate), 0);
  if (elapsed <= 0.5 / 365.25) return optionIv;

  const wExpiry = optionIv * optionIv * total;
  const ivToScenario = interpolateIv(term, scenarioDate, today);
  if (ivToScenario == null) return optionIv;
  const wElapsed = (ivToScenario / 100) ** 2 * elapsed;
  const forwardVar = (wExpiry - wElapsed) / tau;
  if (forwardVar <= 0.0025) return optionIv;
  return Math.sqrt(forwardVar);
}

export function typicalStep(strikes: number[]): number {
  const diffs = [];
  for (let i = 1; i < strikes.length; i += 1) {
    const diff = roundTo(strikes[i] - strikes[i - 1], 4);
    if (diff > 0) diffs.push(diff);
  }
  if (!diffs.length) return 1;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 1;
}

function niceStep(raw: number): number {
  if (raw <= 0.25) return 0.5;
  if (raw <= 0.75) return 1;
  if (raw <= 2) return 1;
  if (raw <= 3.5) return 2.5;
  if (raw <= 7) return 5;
  if (raw <= 15) return 10;
  if (raw <= 35) return 25;
  return 50;
}

export function buildPriceRows({
  spot,
  strikes,
  strikeMin,
  strikeMax,
  maxRows,
  selectedStrike,
}: {
  spot: number;
  strikes: number[];
  strikeMin: number;
  strikeMax: number;
  maxRows: number;
  selectedStrike: number;
}): number[] {
  const lo = Math.min(strikeMin, strikeMax);
  const hi = Math.max(strikeMin, strikeMax);
  const unique = [...new Set((strikes ?? []).filter((strike) => Number.isFinite(strike) && strike > 0))].sort((a, b) => a - b);
  const step = typicalStep(unique);
  let levels = unique.filter((strike) => strike >= lo && strike <= hi);

  const extras = [selectedStrike, unique[nearestIndex(unique, spot)]].filter((value) => Number.isFinite(value) && value > 0);
  for (const extra of extras) {
    if (extra >= lo && extra <= hi && !levels.includes(extra)) levels.push(extra);
  }

  if (levels.length < 5) {
    const synthetic = [];
    const usedStep = step || niceStep((hi - lo) / Math.max(maxRows - 1, 1));
    const start = Math.max(usedStep, Math.floor(lo / usedStep) * usedStep);
    for (let price = start; price <= hi + usedStep / 4; price = roundTo(price + usedStep, 4)) {
      if (price > 0) synthetic.push(roundTo(price, 2));
    }
    levels = [...new Set([...levels, ...synthetic])].sort((a, b) => a - b);
    levels = levels.filter((price) => price >= lo * 0.98 && price <= hi * 1.02);
  }

  levels.sort((a, b) => a - b);
  if (levels.length > maxRows) {
    const keep = new Set(extras.filter((value) => value >= lo && value <= hi));
    const remainingSlots = Math.max(3, maxRows - keep.size);
    const others = levels.filter((price) => !keep.has(price));
    const picked = [];
    for (let i = 0; i < remainingSlots && others.length; i += 1) {
      const idx = remainingSlots === 1
        ? Math.floor((others.length - 1) / 2)
        : Math.round((i * (others.length - 1)) / (remainingSlots - 1));
      picked.push(others[idx]);
    }
    levels = [...new Set([...picked, ...keep])].sort((a, b) => a - b);
  }

  return levels.sort((a, b) => b - a);
}

export function columnIvPct(
  term: Array<{ date: string; iv?: number | null; atmIv?: number | null }>,
  optionIvPct: number,
  today: string,
  scenarioDate: string,
  expiryDate: string,
): number | null {
  const tau = yearsBetween(scenarioDate, expiryDate);
  if (tau <= 0.5 / 365.25) return sanitizeIv(optionIvPct);
  const sigma = remainingSigma(term, optionIvPct, today, scenarioDate, expiryDate);
  return roundTo(sigma * 100, 1);
}

export function buildHeatmap({
  spot,
  option,
  isCall,
  expiry,
  today,
  term,
  strikeMin,
  strikeMax,
  maxRows,
  maxCols,
  strikes,
}: {
  spot: number;
  option: { strike: number; bid?: number; ask?: number; lastPrice?: number; impliedVolatility: number };
  isCall: boolean;
  expiry: string;
  today: string;
  term: Array<{ date: string; iv?: number | null; atmIv?: number | null }>;
  strikeMin: number;
  strikeMax: number;
  maxRows: number;
  maxCols: number;
  strikes: number[];
}) {
  const premium = optionPremium(option);
  const strike = option.strike;
  const optionIv = sanitizeIv(option.impliedVolatility) ?? interpolateIv(term, expiry) ?? 25;
  const { dates, kind } = buildDateColumns(today, expiry, maxCols);
  const rows = buildPriceRows({ spot, strikes, strikeMin, strikeMax, maxRows, selectedStrike: strike });
  const columns = dates.map((date) => {
    const remaining = Math.max(yearsBetween(date, expiry), 0);
    const ivPct = columnIvPct(term, optionIv, today, date, expiry);
    const sigma = (ivPct ?? optionIv) / 100;
    return { date, remaining, ivPct, sigma };
  });
  const cells = rows.map((price) =>
    columns.map((column) => {
      const value = optionValue(price, strike, column.remaining, column.sigma, isCall);
      const multiple = premium > 0 ? value / premium : null;
      const pct = premium > 0 ? ((value - premium) / premium) * 100 : null;
      return { value, multiple, pct };
    }),
  );
  return {
    premium,
    optionIv,
    kind,
    dates,
    columns,
    rows,
    cells,
    spotRow: rows[nearestIndex(rows, spot)],
    strikeRow: rows.includes(strike) ? strike : null,
  };
}

export function suggestedTarget(spot: number, isCall: boolean): number {
  if (!(spot > 0)) return 0;
  const step = spot >= 200 ? 10 : spot >= 50 ? 5 : spot >= 20 ? 1 : 0.5;
  const raw = spot * (isCall ? 1.1 : 0.9);
  let target = Math.round(raw / step) * step;
  if (isCall && target <= spot) target += step;
  if (!isCall && target >= spot) target = Math.max(step, target - step);
  return roundTo(target, 2);
}

export function neighborStrikes(strikes: number[] | null | undefined, selected: number | null): number[] {
  const sorted = [...new Set((strikes ?? []).filter((strike) => strike > 0))].sort((a, b) => a - b);
  const index = sorted.indexOf(selected ?? NaN);
  if (index < 0) return [];
  const picks = [];
  for (const offset of [1, -1, 2, -2, 3, -3]) {
    const strike = sorted[index + offset];
    if (strike != null) picks.push(strike);
    if (picks.length === 2) break;
  }
  return picks;
}

export function contractSnapshot({
  spot,
  target,
  strike,
  premium,
  ivPct,
  years,
  isCall,
}: {
  spot: number;
  target: number;
  strike: number;
  premium: number;
  ivPct: number;
  years: number;
  isCall: boolean;
}) {
  const safePremium = premium > 0 ? premium : 0;
  const value = Math.max(isCall ? target - strike : strike - target, 0);
  const pnlPerShare = value - safePremium;
  const greek = greeks(spot, strike, years, ivPct > 0 ? ivPct / 100 : 0, isCall);
  return {
    value,
    pnlPerShare,
    pnlPerContract: pnlPerShare * 100,
    maxLossPerContract: safePremium * 100,
    returnPct: safePremium > 0 ? (pnlPerShare / safePremium) * 100 : null,
    multiple: safePremium > 0 ? value / safePremium : null,
    breakeven: isCall ? strike + safePremium : strike - safePremium,
    delta: greek.delta,
    gamma: greek.gamma,
    theta: greek.theta,
    vega: greek.vega,
  };
}

export function payoffCurve({
  strike,
  premium,
  isCall,
  minPrice,
  maxPrice,
  steps = 80,
}: {
  strike: number;
  premium: number;
  isCall: boolean;
  minPrice: number;
  maxPrice: number;
  steps?: number;
}) {
  const safePremium = premium > 0 ? premium : 0;
  const count = Math.max(2, steps);
  const span = maxPrice - minPrice;
  const points = [];
  for (let i = 0; i <= count; i += 1) {
    const price = minPrice + (span * i) / count;
    const value = Math.max(isCall ? price - strike : strike - price, 0);
    points.push({ price, value, pnl: value - safePremium });
  }
  return points;
}

export function payoffDomain(spot: number, target: number, strikes: number[]) {
  const anchors = [spot * 0.8, spot * 1.2, target, ...(strikes ?? [])].filter((price) => price > 0 && Number.isFinite(price));
  const minAnchor = Math.min(...anchors);
  const maxAnchor = Math.max(...anchors);
  const pad = Math.max((maxAnchor - minAnchor) * 0.08, (spot > 0 ? spot : 1) * 0.02);
  return {
    minPrice: Math.max(0.01, minAnchor - pad),
    maxPrice: maxAnchor + pad,
  };
}

export function chipStrikes(strikes: number[], spot: number, selectedStrike: number | null): number[] {
  let band = strikes.filter((strike) => strike >= spot * 0.75 && strike <= spot * 1.25);
  if (band.length < 7) band = strikes;
  if (selectedStrike != null && !band.includes(selectedStrike)) {
    band = [...band, selectedStrike].sort((a, b) => a - b);
  }
  return band;
}

export type MaterializedSlot = {
  auto: boolean;
  hidden: boolean;
  empty?: boolean;
  strike?: number;
  right?: OptionRight;
  expiry?: string;
};

export function materializeCompareSlot(
  stored: MaterializedSlot | undefined,
  index: number,
  chainStrikes: number[],
  selectedStrike: number | null,
  selectedExpiry: string,
  right: OptionRight,
): MaterializedSlot {
  const slot = stored ?? { auto: true, hidden: false };
  if (slot.hidden) return { ...slot, hidden: true };
  if (slot.auto === false && slot.strike != null && slot.expiry && slot.right) return slot;
  const neighbors = neighborStrikes(chainStrikes, selectedStrike);
  const strike = neighbors[index];
  if (strike == null) return { auto: true, hidden: true, empty: true };
  return { strike, right, expiry: selectedExpiry, auto: true, hidden: false };
}
