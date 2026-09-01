const YAHOO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const CACHE_TTL_SECONDS = 300;
const SESSION_CACHE_KEY = "https://stock-tracker.internal/yahoo-session";

type YahooSession = {
  cookie: string;
  crumb: string;
};

type StockInfo = {
  longName: string;
  symbol: string;
  currentPrice: number;
  previousClose: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  averageVolume: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
};

type HistoryBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  historicalVolatility: number | null;
};

type OptionRow = {
  strike: number;
  lastPrice: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  moneyness: "ITM" | "ATM" | "OTM";
};

type YahooOptionsResult = {
  expirationDates?: number[];
  quote?: Record<string, unknown>;
  options?: Array<{
    expirationDate?: number;
    calls?: Array<Record<string, unknown>>;
    puts?: Array<Record<string, unknown>>;
  }>;
};

export default {
  async fetch(request, _env, ctx): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      if (url.pathname === "/api/stock") {
        return json(await getStock(url, ctx));
      }
      if (url.pathname === "/api/options") {
        return json(await getOptions(url, ctx));
      }
      if (url.pathname === "/api/iv-term") {
        return json(await getIvTerm(url, ctx));
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      const status = message.startsWith("Please check") ? 400 : 502;
      return json({ error: message }, status);
    }
  },
} satisfies ExportedHandler<Env>;

function corsHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? `public, max-age=${CACHE_TTL_SECONDS}` : "no-store",
      ...corsHeaders(),
    },
  });
}

function tickerFrom(url: URL): string {
  const ticker = (url.searchParams.get("ticker") ?? "").trim().toUpperCase();
  if (!/^[A-Z.]{1,10}$/.test(ticker)) {
    throw new Error("Please check the ticker symbol and try again.");
  }
  return ticker;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mergeCookies(existing: string, response: Response): string {
  const map = new Map<string, string>();
  for (const part of existing.split(";").map((item) => item.trim()).filter(Boolean)) {
    const eq = part.indexOf("=");
    if (eq > 0) map.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const setCookies =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("Set-Cookie")].filter((value): value is string => Boolean(value));
  for (const header of setCookies) {
    const pair = header.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq > 0) map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1));
  }
  return [...map.entries()].map(([key, value]) => `${key}=${value}`).join("; ");
}

async function yahooFetch(url: string, session: YahooSession): Promise<Response> {
  return fetch(url, {
    headers: {
      "User-Agent": YAHOO_UA,
      Accept: "application/json,text/plain,*/*",
      Cookie: session.cookie,
    },
  });
}

async function getYahooSession(ctx: ExecutionContext): Promise<YahooSession> {
  const cache = caches.default;
  const cached = await cache.match(SESSION_CACHE_KEY);
  if (cached) {
    return (await cached.json()) as YahooSession;
  }

  const bootstrap = await fetch("https://fc.yahoo.com", {
    headers: { "User-Agent": YAHOO_UA, Accept: "*/*" },
    redirect: "manual",
  });
  let cookie = mergeCookies("", bootstrap);

  const crumbResponse = await fetch("https://query1.finance.yahoo.com/v1/test/getcrumb", {
    headers: {
      "User-Agent": YAHOO_UA,
      Accept: "text/plain,*/*",
      Cookie: cookie,
    },
  });
  cookie = mergeCookies(cookie, crumbResponse);
  const crumb = (await crumbResponse.text()).trim();
  if (!crumb || crumb.includes(" ") || crumb.length > 40) {
    throw new Error("Unable to authenticate with market data provider.");
  }

  const session = { cookie, crumb };
  const stored = new Response(JSON.stringify(session), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  ctx.waitUntil(cache.put(SESSION_CACHE_KEY, stored));
  return session;
}

async function cachedJson<T>(url: string, ctx: ExecutionContext, loader: () => Promise<T>): Promise<T> {
  const cache = caches.default;
  const key = new Request(url, { method: "GET" });
  const hit = await cache.match(key);
  if (hit) {
    return (await hit.json()) as T;
  }
  const data = await loader();
  const stored = new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
    },
  });
  ctx.waitUntil(cache.put(key, stored));
  return data;
}

function calculateHistoricalVolatility(closes: Array<number | null>, window = 30): Array<number | null> {
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
    return round(Math.sqrt(variance) * Math.sqrt(252) * 100);
  });
}

function categorizeMoneyness(strike: number, currentPrice: number, isCall: boolean): "ITM" | "ATM" | "OTM" {
  const percentDiff = Math.abs(strike - currentPrice) / currentPrice;
  if (percentDiff <= 0.02) return "ATM";
  if (isCall) return strike < currentPrice ? "ITM" : "OTM";
  return strike > currentPrice ? "ITM" : "OTM";
}

function mapOption(raw: Record<string, unknown>, currentPrice: number, isCall: boolean): OptionRow {
  const strike = Number(raw.strike ?? 0);
  return {
    strike: round(strike),
    lastPrice: round(Number(raw.lastPrice ?? 0)),
    bid: round(Number(raw.bid ?? 0)),
    ask: round(Number(raw.ask ?? 0)),
    volume: Number(raw.volume ?? 0),
    openInterest: Number(raw.openInterest ?? 0),
    impliedVolatility: round(Number(raw.impliedVolatility ?? 0) * 100),
    moneyness: categorizeMoneyness(strike, currentPrice, isCall),
  };
}

function expiryUnix(date: string): number {
  const expiry = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
  if (!Number.isFinite(expiry)) {
    throw new Error("Invalid expiration date.");
  }
  return expiry;
}

function sanitizeIv(iv: number): number | null {
  if (!Number.isFinite(iv) || iv < 1 || iv > 250) return null;
  return iv;
}

function interpolateStrikeIv(rows: OptionRow[], strike: number): number | null {
  const points = rows
    .map((row) => ({ strike: row.strike, iv: sanitizeIv(row.impliedVolatility) }))
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
      return round(left.iv * (1 - weight) + right.iv * weight);
    }
  }
  return last.iv;
}

function atmIv(rows: OptionRow[]): number | null {
  const atm = rows.map((row) => sanitizeIv(row.impliedVolatility)).filter((iv): iv is number => iv != null);
  const atmRows = rows.filter((row) => row.moneyness === "ATM");
  const source = atmRows.length ? atmRows : rows;
  const values = source.map((row) => sanitizeIv(row.impliedVolatility)).filter((iv): iv is number => iv != null);
  if (!values.length) return atm.length ? round(median(atm)) : null;
  return round(median(values));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sampleExpirations(dates: string[], expiry: string, max = 12): string[] {
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

async function mapPool<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

async function getStock(url: URL, ctx: ExecutionContext) {
  const ticker = tickerFrom(url);
  const cacheUrl = `https://stock-tracker.internal/stock/${ticker}`;
  return cachedJson(cacheUrl, ctx, async () => {
    const session = await getYahooSession(ctx);
    const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d&includePrePost=false&events=div%7Csplit&crumb=${encodeURIComponent(session.crumb)}`;
    const response = await yahooFetch(chartUrl, session);
    if (!response.ok) {
      throw new Error("Please check the ticker symbol and try again.");
    }
    const payload = (await response.json()) as {
      chart?: {
        result?: Array<{
          meta?: Record<string, unknown>;
          timestamp?: number[];
          indicators?: { quote?: Array<Record<string, Array<number | null>>> };
        }>;
        error?: { description?: string };
      };
    };
    const result = payload.chart?.result?.[0];
    if (!result) {
      throw new Error(payload.chart?.error?.description ?? "Please check the ticker symbol and try again.");
    }

    const meta = result.meta ?? {};
    const quote = result.indicators?.quote?.[0] ?? {};
    const timestamps = result.timestamp ?? [];
    const closes = quote.close ?? [];
    const volatility = calculateHistoricalVolatility(closes);
    const latestClose = [...closes].reverse().find((value) => value != null) ?? 0;
    const priorClose = [...closes].reverse().filter((value) => value != null)[1];
    const currentPrice = Number(meta.regularMarketPrice ?? latestClose);
    const changePct = Number(meta.regularMarketChangePercent);
    const previousClose =
      Number.isFinite(changePct) && changePct !== 0
        ? currentPrice / (1 + changePct / 100)
        : Number(priorClose ?? latestClose);
    const history: HistoryBar[] = timestamps
      .map((ts, index) => ({
        date: new Date(ts * 1000).toISOString(),
        open: round(Number(quote.open?.[index] ?? 0)),
        high: round(Number(quote.high?.[index] ?? 0)),
        low: round(Number(quote.low?.[index] ?? 0)),
        close: round(Number(quote.close?.[index] ?? 0)),
        volume: Number(quote.volume?.[index] ?? 0),
        historicalVolatility: volatility[index],
      }))
      .filter((bar) => bar.close > 0);

    const volumes = history.map((bar) => bar.volume).filter((value) => value > 0);
    const averageVolume = volumes.length
      ? Math.round(volumes.slice(-60).reduce((sum, value) => sum + value, 0) / Math.min(volumes.length, 60))
      : Number(meta.averageDailyVolume3Month ?? 0);

    const info: StockInfo = {
      longName: String(meta.longName ?? meta.shortName ?? ticker),
      symbol: ticker,
      currentPrice: round(currentPrice),
      previousClose: round(previousClose),
      dayHigh: round(Number(meta.regularMarketDayHigh ?? currentPrice)),
      dayLow: round(Number(meta.regularMarketDayLow ?? currentPrice)),
      volume: Number(meta.regularMarketVolume ?? 0),
      averageVolume,
      fiftyTwoWeekHigh: round(Number(meta.fiftyTwoWeekHigh ?? currentPrice)),
      fiftyTwoWeekLow: round(Number(meta.fiftyTwoWeekLow ?? currentPrice)),
    };

    return { info, history };
  });
}

async function fetchYahooOptions(ticker: string, date: string | null, ctx: ExecutionContext): Promise<YahooOptionsResult> {
  const cacheUrl = `https://stock-tracker.internal/yahoo-options/${ticker}/${date || "list"}`;
  return cachedJson(cacheUrl, ctx, async () => {
    const session = await getYahooSession(ctx);
    let endpoint = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}?crumb=${encodeURIComponent(session.crumb)}`;
    if (date) {
      endpoint += `&date=${expiryUnix(date)}`;
    }
    const response = await yahooFetch(endpoint, session);
    if (!response.ok) {
      throw new Error("No options data available for this ticker.");
    }
    const payload = (await response.json()) as {
      optionChain?: {
        result?: YahooOptionsResult[];
        error?: { description?: string };
      };
    };
    const chain = payload.optionChain?.result?.[0];
    if (!chain) {
      throw new Error(payload.optionChain?.error?.description ?? "No options data available for this ticker.");
    }
    return chain;
  });
}

function expirationDateList(chain: YahooOptionsResult): string[] {
  return (chain.expirationDates ?? []).map((ts) => new Date(ts * 1000).toISOString().slice(0, 10));
}

function summarizeChain(chain: YahooOptionsResult) {
  const expirationDates = expirationDateList(chain);
  const currentPrice = Number(chain.quote?.regularMarketPrice ?? chain.quote?.regularMarketPreviousClose ?? 0);
  const optionSet = chain.options?.[0];
  const calls = (optionSet?.calls ?? []).map((row) => mapOption(row, currentPrice, true));
  const puts = (optionSet?.puts ?? []).map((row) => mapOption(row, currentPrice, false));
  const avgCallIv = atmIv(calls);
  const avgPutIv = atmIv(puts);
  return {
    expirationDates,
    currentPrice: round(currentPrice),
    calls,
    puts,
    atmCallIv: avgCallIv,
    atmPutIv: avgPutIv,
    ivSkew: avgCallIv != null && avgPutIv != null ? round(avgPutIv - avgCallIv) : null,
  };
}

async function getOptions(url: URL, ctx: ExecutionContext) {
  const ticker = tickerFrom(url);
  const date = url.searchParams.get("date") ?? "";
  const chain = await fetchYahooOptions(ticker, date || null, ctx);
  if (!date) {
    return { expirationDates: expirationDateList(chain) };
  }
  return summarizeChain(chain);
}

async function getIvTerm(url: URL, ctx: ExecutionContext) {
  const ticker = tickerFrom(url);
  const expiry = (url.searchParams.get("expiry") ?? "").trim();
  const strike = Number(url.searchParams.get("strike") ?? "");
  const right = (url.searchParams.get("right") ?? "call").toLowerCase() === "put" ? "put" : "call";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) {
    throw new Error("Invalid expiration date.");
  }
  if (!Number.isFinite(strike) || strike <= 0) {
    throw new Error("Invalid strike.");
  }

  const cacheUrl = `https://stock-tracker.internal/iv-term/${ticker}/${expiry}/${strike}/${right}`;
  return cachedJson(cacheUrl, ctx, async () => {
    const listed = await fetchYahooOptions(ticker, null, ctx);
    const expirationDates = expirationDateList(listed);
    const sampled = sampleExpirations(expirationDates, expiry);
    if (!sampled.length) {
      throw new Error("No options data available for this ticker.");
    }

    const term = (
      await mapPool(sampled, 4, async (date) => {
        try {
          const chain = summarizeChain(await fetchYahooOptions(ticker, date, ctx));
          const rows = right === "put" ? chain.puts : chain.calls;
          const iv = interpolateStrikeIv(rows, strike);
          const atm = right === "put" ? chain.atmPutIv : chain.atmCallIv;
          return {
            date,
            iv: iv ?? atm,
            atmIv: atm,
          };
        } catch {
          return null;
        }
      })
    ).filter((row): row is { date: string; iv: number | null; atmIv: number | null } => row != null);

    return {
      ticker,
      expiry,
      strike,
      right,
      expirationDates,
      term,
    };
  });
}
