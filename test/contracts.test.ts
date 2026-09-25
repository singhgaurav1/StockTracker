import test from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoryBars,
  buildStockInfo,
  calendarDate,
  createStockClient,
  normalizeTicker,
  resolvePreviousClose,
  statusForError,
  ApiError,
} from "../shared/src/index.ts";

test("ticker accepts class shares and rejects blanks", () => {
  assert.equal(normalizeTicker(" brk-b "), "BRK-B");
  assert.equal(normalizeTicker("brk.b"), "BRK.B");
  assert.throws(() => normalizeTicker(""), ApiError);
  assert.throws(() => normalizeTicker("TOO LONG TICKER"), ApiError);
});

test("history bars use calendar dates", () => {
  const bars = buildHistoryBars(
    [1_700_000_000, 1_700_086_400],
    { close: [100, 101], open: [99, 100], high: [102, 103], low: [98, 99], volume: [10, 11] },
  );
  assert.equal(bars.every((bar) => /^\d{4}-\d{2}-\d{2}$/.test(bar.date)), true);
  assert.equal(calendarDate("2026-09-23T20:00:00.000Z"), "2026-09-23");
});

test("previous close prefers the quoted close", () => {
  const quoted = resolvePreviousClose(110, 100, 90, 5, 10, 80);
  assert.equal(quoted, 100);
  const fromChange = resolvePreviousClose(110, null, null, 4, 0, 80);
  assert.equal(fromChange, 106);
  const info = buildStockInfo({
    ticker: "AAPL",
    meta: { regularMarketPrice: 110, previousClose: 100, longName: "Apple" },
    history: [],
    latestClose: 110,
    priorClose: 90,
  });
  assert.equal(info.previousClose, 100);
  assert.equal(info.currentPrice, 110);
});

test("client errors stay 400 and provider failures stay 502", () => {
  assert.equal(statusForError(new ApiError("Invalid strike.")), 400);
  assert.equal(statusForError(new Error("Unable to authenticate with market data provider.")), 502);
});

test("stock client splits expirations from a dated chain", async () => {
  const calls: string[] = [];
  const client = createStockClient({
    baseUrl: "https://example.test",
    fetch: async (input) => {
      calls.push(String(input));
      const url = String(input);
      const body = url.includes("date=")
        ? { expirationDates: ["2026-10-16"], currentPrice: 100, calls: [], puts: [], atmCallIv: 20, atmPutIv: 22, ivSkew: 2 }
        : url.includes("/api/options")
          ? { expirationDates: ["2026-10-16"] }
          : url.includes("/api/stock")
            ? { info: { symbol: "AAPL" }, history: [] }
            : { ticker: "AAPL", expiry: "2026-10-16", strike: 100, right: "call", expirationDates: [], term: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const stock = await client.stock("aapl");
  const expirations = await client.expirations("AAPL");
  const chain = await client.chain("AAPL", "2026-10-16");
  assert.equal(stock.info.symbol, "AAPL");
  assert.deepEqual(expirations.expirationDates, ["2026-10-16"]);
  assert.equal(chain.ivSkew, 2);
  assert.equal(calls.some((url) => url.startsWith("https://example.test/api/stock")), true);
  assert.equal(calls.some((url) => url.includes("date=2026-10-16")), true);

  await assert.rejects(() => client.stock("!!!"), ApiError);
});
