const RATE = 0.05;
const YEAR_MS = 365.25 * 24 * 3600 * 1000;

export function todayISO(now = new Date()) {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function addDays(isoDate, days) {
  const utc = Date.parse(`${isoDate.slice(0, 10)}T00:00:00Z`);
  return new Date(utc + days * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(from, to) {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

export function yearsBetween(from, to) {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return (b - a) / YEAR_MS;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function optionPremium(option) {
  if (!option) return 0;
  if (option.bid > 0 && option.ask > 0) return (option.bid + option.ask) / 2;
  if (option.lastPrice > 0) return option.lastPrice;
  if (option.ask > 0) return option.ask;
  if (option.bid > 0) return option.bid;
  return 0;
}

export function sanitizeIv(iv) {
  if (!Number.isFinite(iv) || iv < 1 || iv > 250) return null;
  return iv;
}

export function nearestIndex(values, target) {
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

export function defaultStrikeWindow(spot, strikes, ivPct, years, selectedStrike) {
  const iv = Math.max(sanitizeIv(ivPct) ?? 20, 10) / 100;
  const tenor = Math.max(years, 2 / 365.25);
  const oneSigmaPct = iv * Math.sqrt(tenor) * 100;
  const halfWindow = clamp(oneSigmaPct * 1.75, 15, 55);
  const unique = [...new Set((strikes ?? []).filter((s) => s > 0))].sort((a, b) => a - b);
  const listedMin = unique[0] ?? spot * (1 - halfWindow / 100);
  const listedMax = unique[unique.length - 1] ?? spot * 2;
  let minStrike = Math.min(listedMin, spot * (1 - halfWindow / 100));
  let maxStrike = spot * 4;
  if (selectedStrike) {
    minStrike = Math.min(minStrike, selectedStrike * 0.92);
    maxStrike = Math.max(maxStrike, selectedStrike * 1.08);
  }
  if (minStrike > maxStrike) [minStrike, maxStrike] = [maxStrike, minStrike];
  const chainLo = snapToStep(Math.min(listedMin, minStrike), 5, "floor");
  const chainHi = snapToStep(Math.max(listedMax, maxStrike), 5, "ceil");
  const windowMin = clamp(snapToStep(minStrike, 5, "round"), chainLo, chainHi);
  const windowMax = clamp(Math.max(windowMin + 5, snapToStep(maxStrike, 5, "round")), chainLo, chainHi);
  return {
    minStrike: windowMin,
    maxStrike: windowMax,
    chainMin: chainLo,
    chainMax: chainHi,
  };
}

export function snapToStep(value, step = 5, mode = "round") {
  if (!Number.isFinite(value) || step <= 0) return step;
  const snapped = mode === "floor"
    ? Math.floor(value / step) * step
    : mode === "ceil"
      ? Math.ceil(value / step) * step
      : Math.round(value / step) * step;
  return Math.max(step, snapped);
}

export function parseDate(value) {
  if (!value) return null;
  const raw = String(value);
  const date = /T/.test(raw) ? new Date(raw) : new Date(`${raw.slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatLongDate(value) {
  const date = parseDate(value);
  if (!date) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function tableCapacity(width = 390, height = 800) {
  const maxCols = width < 380 ? 8 : width < 700 ? 9 : 11;
  const maxRows = height < 680 ? 10 : height < 900 ? 12 : 14;
  return { maxCols, maxRows };
}

function dateGranularity(dte) {
  if (dte <= 21) return { step: 7, kind: "weekly" };
  if (dte <= 60) return { step: 14, kind: "biweekly" };
  return { step: 30, kind: "monthly" };
}

export function buildDateColumns(today, expiry, maxCols = 6) {
  const dte = Math.max(0, daysBetween(today, expiry));
  const { step, kind } = dateGranularity(dte);
  if (dte <= 0) {
    return { dates: [expiry], kind, step };
  }

  const dates = [today];
  let cursor = addDays(today, step);
  while (daysBetween(cursor, expiry) > 2 && dates.length < 24) {
    dates.push(cursor);
    cursor = addDays(cursor, step);
  }
  if (dates[dates.length - 1] !== expiry) dates.push(expiry);

  if (dates.length <= maxCols) {
    return { dates, kind, step };
  }

  const inner = dates.slice(1, -1);
  const keep = Math.max(1, maxCols - 2);
  const sampled = [];
  for (let i = 0; i < keep; i += 1) {
    const idx = keep === 1 ? Math.floor((inner.length - 1) / 2) : Math.round((i * (inner.length - 1)) / (keep - 1));
    sampled.push(inner[idx]);
  }
  const unique = [...new Set([dates[0], ...sampled, dates[dates.length - 1]])];
  return { dates: unique, kind, step };
}

export function formatDateLabel(isoDate, today, expiry) {
  if (isoDate === today) return "Now";
  if (isoDate === expiry) return "Exp";
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

export function interpolateIv(term, date, today = todayISO()) {
  const points = (term ?? [])
    .map((row) => ({ date: row.date, iv: sanitizeIv(row.iv ?? row.atmIv) }))
    .filter((row) => row.iv != null)
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
  const tOf = (iso) => Math.max(yearsBetween(today, iso), 1 / 365.25);
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

export function remainingSigma(term, optionIvPct, today, scenarioDate, expiryDate) {
  const optionIv = (sanitizeIv(optionIvPct) ?? 25) / 100;
  const tau = yearsBetween(scenarioDate, expiryDate);
  if (tau <= 0.5 / 365.25) return optionIv;

  const T = Math.max(yearsBetween(today, expiryDate), 1 / 365.25);
  const t = Math.max(yearsBetween(today, scenarioDate), 0);
  if (t <= 0.5 / 365.25) return optionIv;

  const wExpiry = optionIv * optionIv * T;
  const ivToScenario = interpolateIv(term, scenarioDate, today);
  if (ivToScenario == null) return optionIv;
  const wElapsed = (ivToScenario / 100) ** 2 * t;
  const forwardVar = (wExpiry - wElapsed) / tau;
  if (forwardVar <= 0.0025) return optionIv;
  return Math.sqrt(forwardVar);
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * abs);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-abs * abs);
  return sign * y;
}

function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

export function blackScholes(spot, strike, years, rate, sigma, isCall) {
  if (years <= 0) return Math.max(isCall ? spot - strike : strike - spot, 0);
  if (sigma <= 0) return Math.max(isCall ? spot - strike : strike - spot, 0);
  const d1 = (Math.log(spot / strike) + (rate + (sigma ** 2) / 2) * years) / (sigma * Math.sqrt(years));
  const d2 = d1 - sigma * Math.sqrt(years);
  if (isCall) return spot * normCdf(d1) - strike * Math.exp(-rate * years) * normCdf(d2);
  return strike * Math.exp(-rate * years) * normCdf(-d2) - spot * normCdf(-d1);
}

export function optionValue(spot, strike, yearsRemaining, sigma, isCall) {
  if (yearsRemaining <= 0.5 / 365.25) {
    return Math.max(isCall ? spot - strike : strike - spot, 0);
  }
  return blackScholes(spot, strike, yearsRemaining, RATE, sigma, isCall);
}

export function typicalStep(strikes) {
  const diffs = [];
  for (let i = 1; i < strikes.length; i += 1) {
    const diff = roundTo(strikes[i] - strikes[i - 1], 4);
    if (diff > 0) diffs.push(diff);
  }
  if (!diffs.length) return 1;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)] || 1;
}

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function niceStep(raw) {
  if (raw <= 0.25) return 0.5;
  if (raw <= 0.75) return 1;
  if (raw <= 2) return 1;
  if (raw <= 3.5) return 2.5;
  if (raw <= 7) return 5;
  if (raw <= 15) return 10;
  if (raw <= 35) return 25;
  return 50;
}

export function buildPriceRows({ spot, strikes, strikeMin, strikeMax, maxRows, selectedStrike }) {
  const lo = Math.min(strikeMin, strikeMax);
  const hi = Math.max(strikeMin, strikeMax);
  const unique = [...new Set((strikes ?? []).filter((strike) => Number.isFinite(strike) && strike > 0))].sort((a, b) => a - b);
  const step = typicalStep(unique);
  let levels = unique.filter((strike) => strike >= lo && strike <= hi);

  const extras = [selectedStrike, spot, unique[nearestIndex(unique, spot)]].filter((value) => Number.isFinite(value) && value > 0);
  for (const extra of extras) {
    if (extra >= lo && extra <= hi && !levels.includes(extra)) levels.push(extra);
  }

  const usedStep = niceStep((hi - lo) / Math.max(maxRows - 1, 1)) || step || 5;
  const synthetic = [];
  const start = Math.max(usedStep, Math.floor(lo / usedStep) * usedStep);
  for (let price = start; price <= hi + usedStep / 4; price = roundTo(price + usedStep, 4)) {
    if (price > 0) synthetic.push(roundTo(price, 2));
  }
  levels = [...new Set([...levels, ...synthetic])].sort((a, b) => a - b);
  levels = levels.filter((price) => price >= lo * 0.98 && price <= hi * 1.02);

  levels.sort((a, b) => a - b);
  if (levels.length > maxRows) {
    const keep = new Set(extras.filter((v) => v >= lo && v <= hi));
    keep.add(levels[0]);
    keep.add(levels[levels.length - 1]);
    const remainingSlots = Math.max(3, maxRows - keep.size);
    const others = levels.filter((price) => !keep.has(price));
    const picked = [];
    for (let i = 0; i < remainingSlots && others.length; i += 1) {
      const idx = remainingSlots === 1 ? Math.floor((others.length - 1) / 2) : Math.round((i * (others.length - 1)) / (remainingSlots - 1));
      picked.push(others[idx]);
    }
    levels = [...new Set([...picked, ...keep])].sort((a, b) => a - b);
  }

  return levels.sort((a, b) => b - a);
}

export function columnIvPct(term, optionIvPct, today, scenarioDate, expiryDate) {
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
}) {
  const premium = optionPremium(option);
  const strike = option.strike;
  const optionIv = sanitizeIv(option.impliedVolatility) ?? interpolateIv(term, expiry) ?? 25;
  const { dates, kind } = buildDateColumns(today, expiry, maxCols);
  const rows = buildPriceRows({
    spot,
    strikes,
    strikeMin,
    strikeMax,
    maxRows,
    selectedStrike: strike,
  });

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
    spotRow: spot >= Math.min(strikeMin, strikeMax) && spot <= Math.max(strikeMin, strikeMax)
      ? rows[nearestIndex(rows, spot)]
      : null,
    strikeRow: rows.includes(strike) ? strike : null,
  };
}

export function formatPct(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  if (value <= -99.5) return "−100%";
  if (value === 0) return "0%";
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : "−";
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k%`;
  return `${sign}${abs.toFixed(0)}%`;
}

export function formatMultiple(value) {
  if (value == null || !Number.isFinite(value) || value < 0) return "—";
  if (value >= 100) return "99x+";
  if (value >= 10) return `${value.toFixed(0)}x`;
  if (value >= 1) return `${value.toFixed(1)}x`;
  return `${value.toFixed(2)}x`;
}

export function heatColor(multiple, pct) {
  const score = multiple != null ? multiple - 1 : pct != null ? pct / 100 : 0;
  if (score > 0.02) {
    const t = clamp(Math.log10(1 + score) / Math.log10(5), 0, 1);
    return `hsl(158, ${48 + t * 10}%, ${16 + t * 12}%)`;
  }
  if (score < -0.02) {
    const t = clamp(Math.log10(1 + Math.abs(score)) / Math.log10(3), 0, 1);
    return `hsl(4, ${50 + t * 10}%, ${18 + t * 10}%)`;
  }
  return "#18222d";
}

export function heatTextColor(multiple, pct) {
  const score = multiple != null ? multiple - 1 : pct != null ? pct / 100 : 0;
  if (score > 0.02) return "#f2fff8";
  if (score < -0.02) return "#fff1f0";
  return "#d5deea";
}

export function compactNumber(value) {
  const n = Number(value) || 0;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toLocaleString();
}

export function barWidthPct(value, max, minVisible = 4) {
  const n = Number(value) || 0;
  const cap = Number(max) || 0;
  if (n <= 0 || cap <= 0) return 0;
  return Math.max(minVisible, Math.min(100, (n / cap) * 100));
}

export function maxMetric(rows, key) {
  return (rows ?? []).reduce((max, row) => Math.max(max, Number(row?.[key]) || 0), 0);
}

export function money(value, digits = 2) {
  return `$${Number(value).toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}
