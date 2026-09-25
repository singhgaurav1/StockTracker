import { ApiError } from "./errors.ts";

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;

export function normalizeTicker(raw: string): string {
  const ticker = raw.trim().toUpperCase();
  if (!TICKER.test(ticker)) {
    throw new ApiError("Please check the ticker symbol and try again.");
  }
  return ticker;
}
