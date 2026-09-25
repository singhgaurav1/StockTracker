import test from "node:test";
import assert from "node:assert/strict";
import * as Calc from "../shared/src/index.ts";

test("default strike window uses IV with wider guardrails", () => {
  const strikes = [80, 90, 100, 110, 120];
  const short = Calc.defaultStrikeWindow(100, strikes, 30, 7 / 365.25, 100);
  const long = Calc.defaultStrikeWindow(100, strikes, 80, 1, 100);
  const lowIv = Calc.defaultStrikeWindow(100, strikes, 5, 7 / 365.25, 100);
  assert.equal(short.minStrike < 100, true);
  assert.equal(short.maxStrike > 100, true);
  assert.equal(short.minStrike >= short.chainMin, true);
  assert.equal(short.maxStrike <= short.chainMax, true);
  assert.equal(long.maxStrike - long.minStrike >= short.maxStrike - short.minStrike, true);
  assert.equal(lowIv.maxStrike - lowIv.minStrike >= 20, true);
});

test("weekly columns for short-dated options", () => {
  const { dates, kind } = Calc.buildDateColumns("2026-09-01", "2026-09-18", 6);
  assert.equal(kind, "weekly");
  assert.equal(dates[0], "2026-09-01");
  assert.equal(dates[dates.length - 1], "2026-09-18");
  assert.equal(dates.length <= 6, true);
});

test("monthly columns for long-dated options stay bounded", () => {
  const { dates, kind } = Calc.buildDateColumns("2026-09-01", "2027-09-17", 6);
  assert.equal(kind, "monthly");
  assert.equal(dates.length <= 6, true);
  assert.equal(dates[dates.length - 1], "2027-09-17");
});

test("black-scholes matches intrinsic at expiry", () => {
  assert.equal(Calc.blackScholes(110, 100, 0, 0.05, 0.2, true), 10);
  assert.equal(Calc.blackScholes(90, 100, 0, 0.05, 0.2, false), 10);
  assert.equal(Calc.blackScholes(90, 100, 0, 0.05, 0.2, true), 0);
});

test("IV interpolation uses the term structure", () => {
  const term = [
    { date: "2026-09-04", iv: 40 },
    { date: "2026-10-16", iv: 20 },
  ];
  const mid = Calc.interpolateIv(term, "2026-09-25", "2026-09-01");
  assert.equal(mid > 20 && mid < 40, true);
});

test("heatmap rows stay within the requested strike window", () => {
  const option = { strike: 100, lastPrice: 4, bid: 3.8, ask: 4.2, impliedVolatility: 30 };
  const grid = Calc.buildHeatmap({
    spot: 100,
    option,
    isCall: true,
    expiry: "2026-10-16",
    today: "2026-09-01",
    term: [
      { date: "2026-09-18", iv: 32, atmIv: 28 },
      { date: "2026-10-16", iv: 30, atmIv: 27 },
    ],
    strikeMin: 90,
    strikeMax: 110,
    maxRows: 9,
    maxCols: 5,
    strikes: [80, 90, 95, 100, 105, 110, 120],
  });
  assert.equal(grid.rows.length <= 9, true);
  assert.equal(grid.rows.every((strike) => strike >= 90 && strike <= 110), true);
  assert.equal(grid.columns[0].date, "2026-09-01");
  assert.equal(grid.columns.every((column) => column.ivPct != null), true);
  assert.equal(grid.cells[0].length, grid.columns.length);
  assert.equal(grid.premium > 0, true);
});

test("suggested target is a rounded 10 percent move", () => {
  assert.equal(Calc.suggestedTarget(248.32, true), 270);
  assert.equal(Calc.suggestedTarget(248.32, false), 220);
  assert.equal(Calc.suggestedTarget(100, true), 110);
  assert.equal(Calc.suggestedTarget(0, true), 0);
});

test("neighbor strikes prefer the next strike on each side", () => {
  assert.deepEqual(Calc.neighborStrikes([240, 250, 260, 270], 250), [260, 240]);
  assert.deepEqual(Calc.neighborStrikes([250], 250), []);
  assert.deepEqual(Calc.neighborStrikes([240, 250], 250), [240]);
});

test("expiry snapshot prices the contract at the target", () => {
  const call = Calc.contractSnapshot({
    spot: 248.32,
    target: 270,
    strike: 250,
    premium: 8.5,
    ivPct: 25,
    years: 30 / 365.25,
    isCall: true,
  });
  assert.equal(call.value, 20);
  assert.ok(Math.abs(call.pnlPerShare - 11.5) < 1e-9);
  assert.ok(Math.abs(call.pnlPerContract - 1150) < 1e-6);
  assert.ok(Math.abs(call.breakeven - 258.5) < 1e-9);
  assert.equal(call.maxLossPerContract, 850);
  assert.ok(call.returnPct > 135 && call.returnPct < 136);
  assert.ok(call.delta > 0 && call.delta < 1);
  assert.ok(call.vega > 0);
  assert.ok(call.theta < 0);

  const put = Calc.contractSnapshot({
    spot: 248,
    target: 220,
    strike: 250,
    premium: 7,
    ivPct: 25,
    years: 0.1,
    isCall: false,
  });
  assert.equal(put.value, 30);
  assert.ok(Math.abs(put.breakeven - 243) < 1e-9);
  assert.ok(put.delta < 0);
});

test("greeks stay finite and put-call delta sums to one", () => {
  const call = Calc.greeks(100, 100, 1, 0.2, true);
  const put = Calc.greeks(100, 100, 1, 0.2, false);
  assert.ok(call.delta > 0.6 && call.delta < 0.7);
  assert.ok(Math.abs(call.delta - put.delta - 1) < 1e-9);
  assert.equal(Calc.greeks(100, 100, 1, 0, true).delta, null);
});

test("payoff curve covers the price domain", () => {
  const points = Calc.payoffCurve({
    strike: 100,
    premium: 4,
    isCall: true,
    minPrice: 80,
    maxPrice: 120,
    steps: 4,
  });
  assert.equal(points.length, 5);
  assert.equal(points[0].price, 80);
  assert.equal(points[points.length - 1].price, 120);
  assert.ok(points[0].pnl < 0);
  assert.ok(points[points.length - 1].value > 0);
  const domain = Calc.payoffDomain(100, 130, [90, 110]);
  assert.ok(domain.minPrice < 90);
  assert.ok(domain.maxPrice > 130);
});

test("bar widths scale to the chain maximum", () => {
  assert.equal(Calc.barWidthPct(0, 100), 0);
  assert.equal(Calc.barWidthPct(50, 100), 50);
  assert.equal(Calc.barWidthPct(100, 100), 100);
  assert.equal(Calc.barWidthPct(1, 1000) >= 4, true);
  assert.equal(Calc.maxMetric([{ volume: 10 }, { volume: 40 }, { volume: 25 }], "volume"), 40);
  assert.equal(Calc.maxMetric([], "openInterest"), 0);
});
