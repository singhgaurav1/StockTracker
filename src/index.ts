import { ApiError, errorMessage, statusForError } from "../shared/src/errors.ts";
import {
  buildHistoryBars,
  buildStockInfo,
  calendarDate,
  interpolateStrikeIv,
  readQuoteContract,
  sampleExpirations,
  summarizeChain,
} from "../shared/src/market.ts";
import { normalizeTicker } from "../shared/src/ticker.ts";
import type { IvTermPoint, OptionRight } from "../shared/src/types.ts";
import { CACHE_TTL_SECONDS, cachedJson, getYahooSession, yahooFetch, type YahooSession } from "./yahoo.ts";

type YahooOptionsResult = {
  expirationDates?: number[];
  quote?: Record<string, unknown>;
  options?: Array<{
    expirationDate?: number;
    calls?: Array<Record<string, unknown>>;
    puts?: Array<Record<string, unknown>>;
  }>;
};

type ChartPayload = {
  chart?: {
    result?: Array<{
      meta?: Record<string, unknown>;
      timestamp?: number[];
      indicators?: { quote?: Array<Record<string, Array<number | null>>> };
    }>;
    error?: { description?: string };
  };
};

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

function expiryUnix(date: string): number {
  const expiry = Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
  if (!Number.isFinite(expiry)) throw new ApiError("Invalid expiration date.");
  return expiry;
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

async function loadChart(ticker: string, session: YahooSession) {
  const chartUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1y&interval=1d&includePrePost=false&events=div%7Csplit&crumb=${encodeURIComponent(session.crumb)}`;
  const response = await yahooFetch(chartUrl, session);
  if (!response.ok) throw new ApiError("Please check the ticker symbol and try again.");
  const payload = (await response.json()) as ChartPayload;
  const result = payload.chart?.result?.[0];
  if (!result) {
    throw new ApiError(payload.chart?.error?.description ?? "Please check the ticker symbol and try again.");
  }
  return result;
}

async function getStock(url: URL, ctx: ExecutionContext) {
  const ticker = normalizeTicker(url.searchParams.get("ticker") ?? "");
  return cachedJson(`https://stock-tracker.internal/stock/${ticker}`, ctx, async () => {
    const session = await getYahooSession(ctx);
    const result = await loadChart(ticker, session);
    const meta = result.meta ?? {};
    const quote = result.indicators?.quote?.[0] ?? {};
    const history = buildHistoryBars(result.timestamp ?? [], quote);
    const closes = quote.close ?? [];
    const latestClose = [...closes].reverse().find((value) => value != null) ?? 0;
    const priorClose = [...closes].reverse().filter((value) => value != null)[1] ?? null;
    return {
      info: buildStockInfo({
        ticker,
        meta,
        history,
        latestClose: Number(latestClose),
        priorClose: priorClose == null ? null : Number(priorClose),
      }),
      history,
    };
  });
}

async function fetchYahooOptions(ticker: string, date: string | null, ctx: ExecutionContext): Promise<YahooOptionsResult> {
  return cachedJson(`https://stock-tracker.internal/yahoo-options/${ticker}/${date || "list"}`, ctx, async () => {
    const session = await getYahooSession(ctx);
    let endpoint = `https://query1.finance.yahoo.com/v7/finance/options/${encodeURIComponent(ticker)}?crumb=${encodeURIComponent(session.crumb)}`;
    if (date) endpoint += `&date=${expiryUnix(date)}`;
    const response = await yahooFetch(endpoint, session);
    if (!response.ok) throw new ApiError("No options data available for this ticker.");
    const payload = (await response.json()) as {
      optionChain?: { result?: YahooOptionsResult[]; error?: { description?: string } };
    };
    const chain = payload.optionChain?.result?.[0];
    if (!chain) {
      throw new ApiError(payload.optionChain?.error?.description ?? "No options data available for this ticker.");
    }
    return chain;
  });
}

function expirationDateList(chain: YahooOptionsResult): string[] {
  return (chain.expirationDates ?? []).map((ts) => calendarDate(ts));
}

function chainSummary(chain: YahooOptionsResult) {
  const expirationDates = expirationDateList(chain);
  const currentPrice = Number(chain.quote?.regularMarketPrice ?? chain.quote?.regularMarketPreviousClose ?? 0);
  const optionSet = chain.options?.[0];
  const expiryDate = optionSet?.expirationDate ? calendarDate(optionSet.expirationDate) : expirationDates[0];
  return summarizeChain({
    expirationDates,
    currentPrice,
    expiryDate: expiryDate ?? new Date().toISOString().slice(0, 10),
    calls: (optionSet?.calls ?? []).map(readQuoteContract),
    puts: (optionSet?.puts ?? []).map(readQuoteContract),
  });
}

async function getOptions(url: URL, ctx: ExecutionContext) {
  const ticker = normalizeTicker(url.searchParams.get("ticker") ?? "");
  const date = url.searchParams.get("date") ?? "";
  const chain = await fetchYahooOptions(ticker, date || null, ctx);
  if (!date) return { expirationDates: expirationDateList(chain) };
  return chainSummary(chain);
}

async function getIvTerm(url: URL, ctx: ExecutionContext) {
  const ticker = normalizeTicker(url.searchParams.get("ticker") ?? "");
  const expiry = (url.searchParams.get("expiry") ?? "").trim();
  const strike = Number(url.searchParams.get("strike") ?? "");
  const right: OptionRight = (url.searchParams.get("right") ?? "call").toLowerCase() === "put" ? "put" : "call";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new ApiError("Invalid expiration date.");
  if (!Number.isFinite(strike) || strike <= 0) throw new ApiError("Invalid strike.");

  return cachedJson(`https://stock-tracker.internal/iv-term/v3/${ticker}/${expiry}/${strike}/${right}`, ctx, async () => {
    const listed = await fetchYahooOptions(ticker, null, ctx);
    const expirationDates = expirationDateList(listed);
    const sampled = sampleExpirations(expirationDates, expiry);
    if (!sampled.length) throw new ApiError("No options data available for this ticker.");

    const term = (
      await mapPool(sampled, 4, async (date) => {
        try {
          const chain = chainSummary(await fetchYahooOptions(ticker, date, ctx));
          const rows = right === "put" ? chain.puts : chain.calls;
          const iv = interpolateStrikeIv(rows, strike);
          const atm = right === "put" ? chain.atmPutIv : chain.atmCallIv;
          return { date, iv: iv ?? atm, atmIv: atm };
        } catch {
          return null;
        }
      })
    ).filter((row): row is IvTermPoint => row != null);

    return { ticker, expiry, strike, right, expirationDates, term };
  });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

    try {
      if (url.pathname === "/api/stock") return json(await getStock(url, ctx));
      if (url.pathname === "/api/options") return json(await getOptions(url, ctx));
      if (url.pathname === "/api/iv-term") return json(await getIvTerm(url, ctx));
      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: errorMessage(error) }, statusForError(error));
    }
  },
} satisfies ExportedHandler<Env>;
