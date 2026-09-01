import test from "node:test";
import assert from "node:assert/strict";
import * as Calc from "../public/calc.js";

test("default range uses IV with guardrails", () => {
  assert.equal(Calc.defaultRangePct(30, 7 / 365.25) >= 10, true);
  assert.equal(Calc.defaultRangePct(30, 1) <= 40, true);
  assert.equal(Calc.defaultRangePct(80, 1), 40);
  assert.equal(Calc.defaultRangePct(5, 7 / 365.25), 10);
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
  const mid = Calc.interpolateIv(term, "2026-09-25");
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
    rangePct: 10,
    maxRows: 9,
    maxCols: 5,
    strikes: [80, 90, 95, 100, 105, 110, 120],
  });
  assert.equal(grid.rows.length <= 9, true);
  assert.equal(grid.dates[0], "2026-09-01");
  assert.equal(grid.columns.every((column) => column.ivPct != null), true);
  assert.equal(grid.cells[0].length, grid.columns.length);
  assert.equal(grid.premium > 0, true);
});

test("bar widths scale to the chain maximum", () => {
  assert.equal(Calc.barWidthPct(0, 100), 0);
  assert.equal(Calc.barWidthPct(50, 100), 50);
  assert.equal(Calc.barWidthPct(100, 100), 100);
  assert.equal(Calc.barWidthPct(1, 1000) >= 4, true);
  assert.equal(Calc.maxMetric([{ volume: 10 }, { volume: 40 }, { volume: 25 }], "volume"), 40);
  assert.equal(Calc.maxMetric([], "openInterest"), 0);
});
