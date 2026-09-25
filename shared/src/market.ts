import { impliedVolPct, quotedPremium, roundTo, usableIv, yearsToExpiry } from "./pricing.ts";
import type { HistoryBar, Moneyness, OptionRow, QuoteContract, StockInfo } from "./types.ts";

export function calendarDate(value: string | number): string {
  if (typeof value === "number") return new Date(value * 1000).toISOString().slice(0, 10);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value.slice(0, 10);
  return new Date(parsed).toISOString().slice(0, 10);
}

export function historicalVolatility(closes: Array<number | null>, window = 30): Array<number | null> {
  const logReturns: Array<number | null> = closes.map((close, index) => {
    const prev = closes[index - 1];
    if (close == null || prev == null || close <= 0 || prev <= 0) return null;
    return Math.log(close / prev);
  });

  return logReturns.map((_, index) => {
    if (index < window) return null;
    const slice = logReturns.slice(index - window + 1, index + 1);
    const values = slice.filter((value): value is number => value != null);
    if (values.length < window * 0.8) return null;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return roundTo(Math.sqrt(variance) * Math.sqrt(252) * 100);
  });
}

export function categorizeMoneyness(strike: number, currentPrice: number, isCall: boolean): Moneyness {
  if (!(currentPrice > 0)) return "OTM";
  const percentDiff = Math.abs(strike - currentPrice) / currentPrice;
  if (percentDiff <= 0.02) return "ATM";
  if (isCall) return strike < currentPrice ? "ITM" : "OTM";
  return strike > currentPrice ? "ITM" : "OTM";
}

export function mapContract(
  raw: QuoteContract,
  currentPrice: number,
  isCall: boolean,
  years: number,
): OptionRow {
  const strike = raw.strike;
  const lastPrice = roundTo(raw.lastPrice);
  const bid = roundTo(raw.bid);
  const ask = roundTo(raw.ask);
  const premium = quotedPremium(bid, ask, lastPrice);
  const impliedVolatility =
    usableIv(raw.impliedVolatilityPct) ?? impliedVolPct(premium, currentPrice, strike, years, isCall) ?? 0;
  return {
    strike: roundTo(strike),
    lastPrice,
    bid,
    ask,
    volume: raw.volume,
    openInterest: raw.openInterest,
    impliedVolatility: roundTo(impliedVolatility),
    moneyness: categorizeMoneyness(strike, currentPrice, isCall),
  };
}

export function fillMissingIv(rows: OptionRow[]): OptionRow[] {
  const withIv = rows.filter((row) => usableIv(row.impliedVolatility) != null);
  if (!withIv.length) return rows;
  return rows.map((row) => {
    if (usableIv(row.impliedVolatility) != null) return row;
    return { ...row, impliedVolatility: interpolateStrikeIv(withIv, row.strike) ?? row.impliedVolatility };
  });
}

export function interpolateStrikeIv(rows: OptionRow[], strike: number): number | null {
  const points = rows
    .map((row) => ({ strike: row.strike, iv: usableIv(row.impliedVolatility) }))
    .filter((row): row is { strike: number; iv: number } => row.iv != null)
    .sort((a, b) => a.strike - b.strike);
  if (!points.length) return null;
  if (strike <= points[0].strike) return points[0].iv;
  const last = points[points.length - 1];
  if (strike >= last.strike) return last.iv;
  for (let i = 0; i < points.length - 1; i += 1) {
    const left = points[i];
    const right = points[i + 1];
    if (strike >= left.strike && strike <= right.strike) {
      if (right.strike === left.strike) return left.iv;
      const weight = (strike - left.strike) / (right.strike - left.strike);
      return roundTo(left.iv * (1 - weight) + right.iv * weight);
    }
  }
  return last.iv;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function atmIv(rows: OptionRow[]): number | null {
  const all = rows.map((row) => usableIv(row.impliedVolatility)).filter((iv): iv is number => iv != null);
  const atmRows = rows.filter((row) => row.moneyness === "ATM");
  const source = atmRows.length ? atmRows : rows;
  const values = source.map((row) => usableIv(row.impliedVolatility)).filter((iv): iv is number => iv != null);
  if (!values.length) return all.length ? roundTo(median(all)) : null;
  return roundTo(median(values));
}

export function sampleExpirations(dates: string[], expiry: string, max = 12): string[] {
  const until = dates.filter((date) => date <= expiry).sort();
  if (!until.length) return dates.includes(expiry) ? [expiry] : [];
  if (until.length <= max) return until;
  const picked = new Set<string>([until[0], until[until.length - 1]]);
  for (let i = 1; i < max - 1; i += 1) {
    const idx = Math.round((i * (until.length - 1)) / (max - 1));
    picked.add(until[idx]);
  }
  return [...picked].sort();
}

export function summarizeChain(input: {
  expirationDates: string[];
  currentPrice: number;
  expiryDate: string;
  calls: QuoteContract[];
  puts: QuoteContract[];
  now?: number;
}) {
  const currentPrice = roundTo(input.currentPrice);
  const years = yearsToExpiry(input.expiryDate, input.now);
  const calls = fillMissingIv(input.calls.map((row) => mapContract(row, input.currentPrice, true, years)));
  const puts = fillMissingIv(input.puts.map((row) => mapContract(row, input.currentPrice, false, years)));
  const avgCallIv = atmIv(calls);
  const avgPutIv = atmIv(puts);
  return {
    expirationDates: input.expirationDates,
    currentPrice,
    calls,
    puts,
    atmCallIv: avgCallIv,
    atmPutIv: avgPutIv,
    ivSkew: avgCallIv != null && avgPutIv != null ? roundTo(avgPutIv - avgCallIv) : null,
  };
}

function finite(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function resolvePreviousClose(
  currentPrice: number,
  previousClose: unknown,
  chartPreviousClose: unknown,
  regularMarketChange: unknown,
  regularMarketChangePercent: unknown,
  priorBarClose: number | null,
): number {
  const quoted = finite(previousClose) ?? finite(chartPreviousClose);
  if (quoted != null && quoted > 0) return quoted;
  const change = finite(regularMarketChange);
  if (change != null) return currentPrice - change;
  const changePct = finite(regularMarketChangePercent);
  if (changePct != null && changePct !== 0) return currentPrice / (1 + changePct / 100);
  if (priorBarClose != null && priorBarClose > 0) return priorBarClose;
  return currentPrice;
}

export function buildHistoryBars(
  timestamps: number[],
  quote: {
    open?: Array<number | null>;
    high?: Array<number | null>;
    low?: Array<number | null>;
    close?: Array<number | null>;
    volume?: Array<number | null>;
  },
): HistoryBar[] {
  const closes = quote.close ?? [];
  const volatility = historicalVolatility(closes);
  return timestamps
    .map((ts, index) => ({
      date: calendarDate(ts),
      open: roundTo(Number(quote.open?.[index] ?? 0)),
      high: roundTo(Number(quote.high?.[index] ?? 0)),
      low: roundTo(Number(quote.low?.[index] ?? 0)),
      close: roundTo(Number(quote.close?.[index] ?? 0)),
      volume: Number(quote.volume?.[index] ?? 0),
      historicalVolatility: volatility[index],
    }))
    .filter((bar) => bar.close > 0);
}

export function buildStockInfo(input: {
  ticker: string;
  meta: Record<string, unknown>;
  history: HistoryBar[];
  latestClose: number;
  priorClose: number | null;
}): StockInfo {
  const { meta, history, ticker } = input;
  const currentPrice = Number(meta.regularMarketPrice ?? input.latestClose);
  const previousClose = resolvePreviousClose(
    currentPrice,
    meta.previousClose,
    meta.chartPreviousClose,
    meta.regularMarketChange,
    meta.regularMarketChangePercent,
    input.priorClose,
  );
  const volumes = history.map((bar) => bar.volume).filter((value) => value > 0);
  const averageVolume = volumes.length
    ? Math.round(volumes.slice(-60).reduce((sum, value) => sum + value, 0) / Math.min(volumes.length, 60))
    : Number(meta.averageDailyVolume3Month ?? 0);

  return {
    longName: String(meta.longName ?? meta.shortName ?? ticker),
    symbol: ticker,
    currentPrice: roundTo(currentPrice),
    previousClose: roundTo(previousClose),
    dayHigh: roundTo(Number(meta.regularMarketDayHigh ?? currentPrice)),
    dayLow: roundTo(Number(meta.regularMarketDayLow ?? currentPrice)),
    volume: Number(meta.regularMarketVolume ?? 0),
    averageVolume,
    fiftyTwoWeekHigh: roundTo(Number(meta.fiftyTwoWeekHigh ?? currentPrice)),
    fiftyTwoWeekLow: roundTo(Number(meta.fiftyTwoWeekLow ?? currentPrice)),
  };
}

export function readQuoteContract(raw: Record<string, unknown>): QuoteContract {
  const num = (value: unknown) => {
    const n = Number(value ?? 0);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    strike: num(raw.strike),
    lastPrice: num(raw.lastPrice),
    bid: num(raw.bid),
    ask: num(raw.ask),
    volume: num(raw.volume),
    openInterest: num(raw.openInterest),
    impliedVolatilityPct: num(raw.impliedVolatility) * 100,
  };
}
