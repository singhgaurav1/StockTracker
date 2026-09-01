import test from "node:test";
import assert from "node:assert/strict";
import * as Calc from "../public/calc.js";

test("default strike window uses integers", () => {
  const window = Calc.defaultStrikeWindow(325.67, [300, 305, 310, 320, 330, 350], 30, 0.05, 320);
  assert.equal(Number.isInteger(window.minStrike), true);
  assert.equal(Number.isInteger(window.maxStrike), true);
  assert.equal(Number.isInteger(window.chainMin), true);
  assert.equal(Number.isInteger(window.chainMax), true);
  assert.equal(window.minStrike % 5, 0);
  assert.equal(window.maxStrike % 5, 0);
});

test("snapToStep rounds strike window values to fives", () => {
  assert.equal(Calc.snapToStep(179, 5), 180);
  assert.equal(Calc.snapToStep(177, 5, "floor"), 175);
  assert.equal(Calc.snapToStep(751, 5, "ceil"), 755);
});

test("chart dates parse full timestamps without showing Invalid Date", () => {
  assert.match(Calc.formatLongDate("2026-06-15T13:30:00.000Z"), /Jun 15, 2026/);
  assert.match(Calc.formatLongDate("2026-06-15"), /Jun 15, 2026/);
  assert.equal(Calc.formatLongDate("not-a-date"), "");
});

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

test("bar widths scale to the chain maximum", () => {
  assert.equal(Calc.barWidthPct(0, 100), 0);
  assert.equal(Calc.barWidthPct(50, 100), 50);
  assert.equal(Calc.barWidthPct(100, 100), 100);
  assert.equal(Calc.barWidthPct(1, 1000) >= 4, true);
  assert.equal(Calc.maxMetric([{ volume: 10 }, { volume: 40 }, { volume: 25 }], "volume"), 40);
  assert.equal(Calc.maxMetric([], "openInterest"), 0);
});
