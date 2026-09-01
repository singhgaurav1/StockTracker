const RATE = 0.05;

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

function normCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
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
  const d1 = (Math.log(spot / strike) + (rate + (sigma ** 2) / 2) * years) / (sigma * Math.sqrt(years));
  const d2 = d1 - sigma * Math.sqrt(years);
  if (isCall) return spot * normCdf(d1) - strike * Math.exp(-rate * years) * normCdf(d2);
  return strike * Math.exp(-rate * years) * normCdf(-d2) - spot * normCdf(-d1);
}

export function yearsToExpiry(date: string, now = Date.now()): number {
  const expiry = Date.parse(`${date}T20:00:00Z`);
  if (!Number.isFinite(expiry)) return 1 / 365.25;
  return Math.max((expiry - now) / (365.25 * 24 * 3600 * 1000), 1 / (365.25 * 24));
}

export function optionPremium(bid: number, ask: number, lastPrice: number): number {
  if (bid > 0 && ask > 0) return (bid + ask) / 2;
  if (lastPrice > 0) return lastPrice;
  if (ask > 0) return ask;
  if (bid > 0) return bid;
  return 0;
}

export function impliedVolPct(
  price: number,
  spot: number,
  strike: number,
  years: number,
  isCall: boolean,
): number | null {
  if (!(price > 0) || !(spot > 0) || !(strike > 0) || !(years > 0)) return null;
  const discountedStrike = strike * Math.exp(-RATE * years);
  const floor = isCall ? Math.max(spot - discountedStrike, 0) : Math.max(discountedStrike - spot, 0);
  if (price < floor * 0.995) return null;

  let lo = 0.03;
  let hi = 3;
  const lowPrice = blackScholes(spot, strike, years, RATE, lo, isCall);
  const highPrice = blackScholes(spot, strike, years, RATE, hi, isCall);
  if (price <= lowPrice) return 5;
  if (price >= highPrice) return null;

  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2;
    const model = blackScholes(spot, strike, years, RATE, mid, isCall);
    if (model > price) hi = mid;
    else lo = mid;
  }
  const iv = ((lo + hi) / 2) * 100;
  if (!Number.isFinite(iv) || iv < 5 || iv > 250) return null;
  return Math.round(iv * 100) / 100;
}

export function usableIv(yahooPct: number): number | null {
  if (!Number.isFinite(yahooPct) || yahooPct < 8 || yahooPct > 250) return null;
  return yahooPct;
}
