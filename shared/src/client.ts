import { ApiError, errorMessage } from "./errors.ts";
import { normalizeTicker } from "./ticker.ts";
import type { ChainResponse, ExpirationsResponse, IvTermResponse, OptionRight, StockResponse } from "./types.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type StockClient = {
  stock(ticker: string): Promise<StockResponse>;
  expirations(ticker: string): Promise<ExpirationsResponse>;
  chain(ticker: string, date: string): Promise<ChainResponse>;
  ivTerm(input: { ticker: string; expiry: string; strike: number; right: OptionRight }): Promise<IvTermResponse>;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new ApiError(data.error || "Request failed", response.status);
  return data as T;
}

export function createStockClient(options: { baseUrl?: string; fetch?: FetchLike } = {}): StockClient {
  const baseUrl = (options.baseUrl ?? "").replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;

  async function get<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`);
    } catch (error) {
      throw new ApiError(errorMessage(error) || "Request failed", 502);
    }
    return readJson<T>(response);
  }

  return {
    async stock(ticker) {
      return get<StockResponse>(`/api/stock?ticker=${encodeURIComponent(normalizeTicker(ticker))}`);
    },
    async expirations(ticker) {
      return get<ExpirationsResponse>(`/api/options?ticker=${encodeURIComponent(normalizeTicker(ticker))}`);
    },
    async chain(ticker, date) {
      const symbol = normalizeTicker(ticker);
      return get<ChainResponse>(
        `/api/options?ticker=${encodeURIComponent(symbol)}&date=${encodeURIComponent(date)}`,
      );
    },
    async ivTerm({ ticker, expiry, strike, right }) {
      const symbol = normalizeTicker(ticker);
      const side: OptionRight = right === "put" ? "put" : "call";
      const query = new URLSearchParams({
        ticker: symbol,
        expiry,
        strike: String(strike),
        right: side,
      });
      return get<IvTermResponse>(`/api/iv-term?${query.toString()}`);
    },
  };
}
