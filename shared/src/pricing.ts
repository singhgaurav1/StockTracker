export const RISK_FREE_RATE = 0.05;
export const IV_MIN_PCT = 5;
export const IV_MAX_PCT = 250;

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

export function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * abs);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-abs * abs);
  return sign * y;
}

export function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

export function blackScholes(
  spot: number,
  strike: number,
  years: number,
  rate: number,
  sigma: number,
  isCall: boolean,
): number {
  if (years <= 0) return Math.max(isCall ? spot - strike : strike - spot, 0);
  if (sigma <= 0) return Math.max(isCall ? spot - strike : strike - spot, 0);
  const d1 = (Math.log(spot / strike) + (rate + sigma ** 2 / 2) * years) / (sigma * Math.sqrt(years));
  const d2 = d1 - sigma * Math.sqrt(years);
  if (isCall) return spot * normCdf(d1) - strike * Math.exp(-rate * years) * normCdf(d2);
  return strike * Math.exp(-rate * years) * normCdf(-d2) - spot * normCdf(-d1);
}

/** Calendar fraction between two YYYY-MM-DD dates. Used for scenario date columns. */
export function yearsBetween(from: string, to: string): number {
  const a = Date.parse(`${from.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  return (b - a) / YEAR_MS;
}

/**
 * Time from `now` until the option's expiry session.
 * Expiry is modeled at 20:00 UTC so solved IV and live greeks share one clock.
 */
export function yearsToExpiry(date: string, now = Date.now()): number {
  const expiry = Date.parse(`${date.slice(0, 10)}T20:00:00Z`);
  if (!Number.isFinite(expiry)) return 1 / 365.25;
  return Math.max((expiry - now) / YEAR_MS, 1 / (365.25 * 24));
}

export function quotedPremium(bid: number, ask: number, lastPrice: number): number {
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  if (lastPrice > 0) return lastPrice;
  if (ask > 0) return ask;
  if (bid > 0) return bid;
  return 0;
}

export function optionPremium(
  option: { bid?: number; ask?: number; lastPrice?: number } | null | undefined,
): number {
  if (!option) return 0;
  return quotedPremium(Number(option.bid) || 0, Number(option.ask) || 0, Number(option.lastPrice) || 0);
}

export function impliedVolPct(
  price: number,
  spot: number,
  strike: number,
  years: number,
  isCall: boolean,
): number | null {
  if (!(price > 0) || !(spot > 0) || !(strike > 0) || !(years > 0)) return null;
  const discountedStrike = strike * Math.exp(-RISK_FREE_RATE * years);
  const floor = isCall ? Math.max(spot - discountedStrike, 0) : Math.max(discountedStrike - spot, 0);
  if (price < floor * 0.995) return null;

  let lo = 0.03;
  let hi = 3;
  const lowPrice = blackScholes(spot, strike, years, RISK_FREE_RATE, lo, isCall);
  const highPrice = blackScholes(spot, strike, years, RISK_FREE_RATE, hi, isCall);
  if (price <= lowPrice) return IV_MIN_PCT;
  if (price >= highPrice) return null;

  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2;
    const model = blackScholes(spot, strike, years, RISK_FREE_RATE, mid, isCall);
    if (model > price) hi = mid;
    else lo = mid;
  }
  const iv = ((lo + hi) / 2) * 100;
  if (!Number.isFinite(iv) || iv < IV_MIN_PCT || iv > IV_MAX_PCT) return null;
  return roundTo(iv, 2);
}

export function usableIv(percent: number): number | null {
  if (!Number.isFinite(percent) || percent < IV_MIN_PCT || percent > IV_MAX_PCT) return null;
  return percent;
}

export function sanitizeIv(iv: number): number | null {
  return usableIv(iv);
}

export function optionValue(spot: number, strike: number, yearsRemaining: number, sigma: number, isCall: boolean): number {
  if (yearsRemaining <= 0.5 / 365.25) {
    return Math.max(isCall ? spot - strike : strike - spot, 0);
  }
  return blackScholes(spot, strike, yearsRemaining, RISK_FREE_RATE, sigma, isCall);
}

export function greeks(spot: number, strike: number, years: number, sigma: number, isCall: boolean) {
  const empty = { delta: null, gamma: null, theta: null, vega: null };
  if (!(spot > 0) || !(strike > 0) || !(sigma > 0) || !(years > 0)) return empty;
  const t = Math.max(years, 1 / 365.25);
  const sqrtT = Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (RISK_FREE_RATE + sigma ** 2 / 2) * t) / (sigma * sqrtT);
  const d2 = d1 - sigma * sqrtT;
  const pdf = normPdf(d1);
  const discount = Math.exp(-RISK_FREE_RATE * t);
  const delta = isCall ? normCdf(d1) : normCdf(d1) - 1;
  const gamma = pdf / (spot * sigma * sqrtT);
  let thetaAnnual = -(spot * pdf * sigma) / (2 * sqrtT);
  if (isCall) thetaAnnual -= RISK_FREE_RATE * strike * discount * normCdf(d2);
  else thetaAnnual += RISK_FREE_RATE * strike * discount * normCdf(-d2);
  const theta = thetaAnnual / 365.25;
  const vega = (spot * pdf * sqrtT) / 100;
  if (![delta, gamma, theta, vega].every(Number.isFinite)) return empty;
  return { delta, gamma, theta, vega };
}
