import * as Calc from "../shared/src/index.ts";

const client = Calc.createStockClient();

const POPULAR = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "SPY", "QQQ", "IWM"];
const LEG_COLORS = ["#5b8cff", "#f0c35b", "#d28bff"];
const MOVES = [-20, -10, -5, 5, 10, 20];

const CHAIN_COLUMNS = [
  { id: "last", label: "Last" },
  { id: "oi", label: "Open interest", helpKey: "oi" },
  { id: "volume", label: "Volume", helpKey: "volume" },
  { id: "bidAsk", label: "Bid / Ask" },
  { id: "iv", label: "IV" },
];

const HELP_COPY = {
  volume: {
    title: "Volume",
    body: "The number of contracts traded today for this strike. Higher volume usually means more liquidity and tighter pricing.",
  },
  oi: {
    title: "Open interest",
    body: "The number of outstanding contracts that have not been closed. Rising open interest can mean new positions are being opened at that strike.",
  },
};

const els = {
  pick: document.getElementById("view-pick"),
  analyzer: document.getElementById("view-analyzer"),
  form: document.getElementById("ticker-form"),
  input: document.getElementById("ticker-input"),
  lookup: document.getElementById("lookup-btn"),
  chips: document.getElementById("popular-chips"),
  pickError: document.getElementById("pick-error"),
  analyzerError: document.getElementById("analyzer-error"),
  backPick: document.getElementById("back-pick"),
  refresh: document.getElementById("refresh-btn"),
  switchForm: document.getElementById("switch-form"),
  switchInput: document.getElementById("switch-input"),
  tradeSymbol: document.getElementById("trade-symbol"),
  company: document.getElementById("company-name"),
  price: document.getElementById("stock-price"),
  change: document.getElementById("price-change"),
  history: document.getElementById("history-panel"),
  historyMeta: document.getElementById("history-meta"),
  chart: document.getElementById("price-chart"),
  chartToggle: document.getElementById("chart-toggle"),
  chartCaption: document.getElementById("chart-caption"),
  periods: document.getElementById("period-toggle"),
  stats: document.getElementById("stock-stats"),
  expiry: document.getElementById("expiry-select"),
  typeCall: document.getElementById("type-call"),
  typePut: document.getElementById("type-put"),
  strikeScroll: document.getElementById("strike-scroll"),
  targetName: document.getElementById("target-name"),
  targetInput: document.getElementById("target-input"),
  targetMove: document.getElementById("target-move"),
  targetRange: document.getElementById("target-range"),
  moveChips: document.getElementById("move-chips"),
  heroKicker: document.getElementById("hero-kicker"),
  heroContract: document.getElementById("hero-contract"),
  heroPnl: document.getElementById("hero-pnl"),
  heroUnit: document.getElementById("hero-unit"),
  heroDetail: document.getElementById("hero-detail"),
  heroFacts: document.getElementById("hero-facts"),
  payoffLegend: document.getElementById("payoff-legend"),
  payoff: document.getElementById("payoff-chart"),
  compareInsight: document.getElementById("compare-insight"),
  compareEditors: document.getElementById("compare-editors"),
  compareTable: document.getElementById("compare-table"),
  compareReset: document.getElementById("compare-reset"),
  chainTable: document.getElementById("chain-table"),
  strikeMinInput: document.getElementById("strike-min-input"),
  strikeMaxInput: document.getElementById("strike-max-input"),
  strikeMinRange: document.getElementById("strike-min-range"),
  strikeMaxRange: document.getElementById("strike-max-range"),
  modeMultiple: document.getElementById("mode-multiple"),
  modePct: document.getElementById("mode-pct"),
  heatmap: document.getElementById("heatmap"),
  status: document.getElementById("status"),
  helpModal: document.getElementById("help-modal"),
  helpTitle: document.getElementById("help-title"),
  helpBody: document.getElementById("help-body"),
  helpClose: document.getElementById("help-close"),
};

const state = {
  ticker: "",
  info: null,
  history: [],
  period: "3m",
  chart: "price",
  expirations: [],
  selectedExpiry: "",
  loadedExpiry: "",
  right: "call",
  calls: [],
  puts: [],
  atmCallIv: null,
  atmPutIv: null,
  selectedStrike: null,
  strikeMin: null,
  strikeMax: null,
  chainMin: null,
  chainMax: null,
  display: "multiple",
  term: [],
  termKey: "",
  termToken: 0,
  termTimer: 0,
  heatmap: null,
  view: "pick",
  restoring: false,
  targetPrice: null,
  targetTouched: false,
  chainCache: {},
  chainLoading: {},
  compare: [{ auto: true, hidden: false }, { auto: true, hidden: false }],
  windowKey: "",
  pendingMin: null,
  pendingMax: null,
  payoffMap: null,
  urlTimer: 0,
};

let lastChipStrike = null;
const CHART_PLOT_HEIGHT = () => (window.innerWidth < 720 ? 160 : 200);
const Y_AXIS_WIDTH = 42;

function urlParams() {
  return new URLSearchParams(location.search);
}

function defaultCompare() {
  return [{ auto: true, hidden: false }, { auto: true, hidden: false }];
}

function buildShareUrl() {
  if (!state.ticker) return location.pathname;
  const qs = Calc.buildShareParams(state).toString();
  return qs ? `${location.pathname}?${qs}` : location.pathname;
}

function syncUrl({ push = true, replace = false } = {}) {
  if (state.restoring) return;
  const url = state.view === "pick" && !state.ticker ? location.pathname : buildShareUrl();
  const snapshot = { view: state.view, ticker: state.ticker };
  if (replace || !push) history.replaceState(snapshot, "", url);
  else history.pushState(snapshot, "", url);
}

function queueUrl() {
  if (state.restoring) return;
  clearTimeout(state.urlTimer);
  state.urlTimer = setTimeout(() => syncUrl({ replace: true }), 120);
}

function showView(name, { push = true } = {}) {
  state.view = name;
  els.pick.hidden = name !== "pick";
  els.analyzer.hidden = name !== "analyzer";
  document.body.dataset.view = name;
  document.title = name === "analyzer" && state.info
    ? `${state.info.symbol} · Options Scenario Analyzer`
    : "Options Scenario Analyzer";
  if (push) syncUrl({ push: true });
}

function goBack() {
  if (state.view !== "analyzer") return;
  if (history.length > 1) {
    history.back();
    return;
  }
  state.ticker = "";
  showView("pick", { push: false });
  history.replaceState({ view: "pick" }, "", location.pathname);
}

window.addEventListener("popstate", () => {
  restoreFromUrl();
});

async function restoreFromUrl() {
  const share = Calc.readShareParams(urlParams());
  const symbol = share.symbol;

  if (!symbol) {
    state.restoring = true;
    showView("pick", { push: false });
    state.restoring = false;
    history.replaceState({ view: "pick" }, "", location.pathname);
    return;
  }

  const { expiry, right, strike, target, period, chart, display: mode, compare } = share;

  if (period) {
    state.period = period;
    [...els.periods.querySelectorAll("button")].forEach((node) => {
      node.classList.toggle("active", node.dataset.period === period);
    });
  }
  if (chart) {
    state.chart = chart;
    [...els.chartToggle.querySelectorAll("button")].forEach((node) => {
      node.classList.toggle("active", node.dataset.chart === chart);
    });
  }
  if (mode) {
    state.display = mode;
    els.modeMultiple.classList.toggle("active", mode === "multiple");
    els.modePct.classList.toggle("active", mode === "pct");
  }
  state.pendingMin = share.strikeMin;
  state.pendingMax = share.strikeMax;

  state.restoring = true;
  try {
    await loadTicker(symbol, {
      expiry,
      right,
      strike,
      target: Number.isFinite(target) ? target : null,
      compare,
      pushUrl: false,
    });
  } catch {
    showView("pick", { push: false });
  } finally {
    state.restoring = false;
    syncUrl({ replace: true });
  }
}

function toast(message) {
  els.status.hidden = !message;
  els.status.textContent = message || "";
}

function setBanner(el, message) {
  el.hidden = !message;
  el.textContent = message || "";
}

function pickDefaultExpiry(dates) {
  return Calc.pickDefaultExpiry(dates, Calc.todayISO());
}

function quotePair(bid, ask) {
  if (!(bid > 0) && !(ask > 0)) return "—";
  return `${Calc.money(bid)} / ${Calc.money(ask)}`;
}

function currentOptions() {
  return state.right === "put" ? state.puts : state.calls;
}

function selectedOption() {
  return currentOptions().find((row) => row.strike === state.selectedStrike) ?? null;
}

function chainStrikes() {
  return currentOptions().map((row) => row.strike);
}

function changeClass(value) {
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "";
}

function formatPrice(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  const digits = Math.abs(n - Math.round(n)) < 0.001 ? 0 : 2;
  return Calc.money(n, digits);
}

function formatSignedMoney(value, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  const abs = Calc.money(Math.abs(value), digits);
  if (value > 0.0000001) return `+${abs}`;
  if (value < -0.0000001) return `−${abs}`;
  return Calc.money(0, digits);
}

function contractDigits(value) {
  return Math.abs(value) >= 100 ? 0 : 2;
}

function formatSignedContract(value) {
  return formatSignedMoney(value, contractDigits(value));
}

function formatUnsignedContract(value) {
  if (!Number.isFinite(value)) return "—";
  return Calc.money(Math.abs(value), contractDigits(value));
}

function formatDelta(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

function formatTheta(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  const digits = Math.abs(value) >= 0.1 ? 2 : 3;
  return `${formatSignedMoney(value, digits)}/d`;
}

function formatVega(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return Calc.money(value, 2);
}

function priceStep(spot) {
  return Calc.priceStep(spot);
}

function snapPrice(price, step) {
  return Calc.snapPrice(price, step);
}

function targetBounds() {
  const spot = state.info?.currentPrice || 1;
  const step = priceStep(spot);
  let min = Math.max(step, snapPrice(spot * 0.5, step));
  let max = snapPrice(spot * 1.5, step);
  if (state.targetPrice != null) {
    min = Math.min(min, state.targetPrice);
    max = Math.max(max, state.targetPrice);
  }
  return { min, max };
}

function formatMove(target, spot) {
  const pct = ((target - spot) / spot) * 100;
  const sign = pct > 0 ? "+" : pct < 0 ? "−" : "";
  return `${sign}${Math.abs(pct).toFixed(1)}% from ${formatPrice(spot)}`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[ch]));
}

function targetPhrase(symbol, target, spot) {
  const price = `<b>${formatPrice(target)}</b>`;
  const name = escapeHtml(symbol);
  const pct = ((target - spot) / spot) * 100;
  if (Math.abs(pct) < 0.25) return `If ${name} stays near ${price} through expiry`;
  if (target > spot) return `If ${name} goes to ${price} by expiry`;
  return `If ${name} falls to ${price} by expiry`;
}

function renderChips() {
  els.chips.innerHTML = POPULAR.map(
    (ticker) => `<button type="button" data-ticker="${ticker}">${ticker}</button>`,
  ).join("");
}

function filterHistory() {
  return Calc.filterHistory(state.history, state.period);
}

function latestHv() {
  return [...state.history].reverse().find((bar) => bar.historicalVolatility != null)?.historicalVolatility ?? null;
}

function currentAtmIv() {
  return state.right === "put" ? state.atmPutIv : state.atmCallIv;
}

function chartHeight() {
  return CHART_PLOT_HEIGHT();
}

function formatChartDate(isoDate) {
  return Calc.formatChartDate(isoDate);
}

function renderChart() {
  if (state.chart === "iv") renderIvChart();
  else renderPriceChart();
}

function renderInteractiveChart({
  points,
  color,
  formatValue,
  emptyText = "Not enough data yet.",
  extras = [],
}) {
  const height = chartHeight();
  const plotWidth = Math.max((els.chart.clientWidth || 320) - Y_AXIS_WIDTH - 4, 180);
  els.chartCaption.textContent = "";

  if (points.length < 2) {
    els.chart.innerHTML = `
      <div class="chart-yaxis" aria-hidden="true"></div>
      <div class="chart-plot"><div class="chart-empty">${emptyText}</div></div>
    `;
    return;
  }

  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.08, formatValue === formatIvValue ? 1 : (max - min) * 0.02 || 0.5);
  const lo = formatValue === formatIvValue ? Math.max(0, min - pad) : min - pad;
  const hi = max + pad;
  const span = hi - lo || 1;
  const yOf = (value) => height - 8 - ((value - lo) / span) * (height - 16);
  const coords = points.map((point, index) => {
    const x = (index / (points.length - 1)) * plotWidth;
    return { x, y: yOf(point.value), point };
  });
  const line = `M${coords.map((coord) => `${coord.x.toFixed(1)},${coord.y.toFixed(1)}`).join(" L")}`;
  const area = `${line} L${plotWidth},${height} L0,${height} Z`;
  const yLabels = [hi, (hi + lo) / 2, lo].map((value) => formatValue(value));

  const extraSvg = extras.map((extra) => `
    <line x1="0" x2="${plotWidth}" y1="${yOf(extra.value).toFixed(1)}" y2="${yOf(extra.value).toFixed(1)}"
      stroke="${extra.color}" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" />
  `).join("");

  els.chart.innerHTML = `
    <div class="chart-yaxis" aria-hidden="true">
      <span>${yLabels[0]}</span>
      <span>${yLabels[1]}</span>
      <span>${yLabels[2]}</span>
    </div>
    <div class="chart-plot" data-chart-interactive="true">
      <svg viewBox="0 0 ${plotWidth} ${height}" preserveAspectRatio="none" role="img" aria-label="Chart">
        <defs>
          <linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stop-color="${color}" stop-opacity="0.35" />
            <stop offset="100%" stop-color="${color}" stop-opacity="0.02" />
          </linearGradient>
        </defs>
        <path d="${area}" fill="url(#chart-fill)"></path>
        <path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"></path>
        ${extraSvg}
      </svg>
      <div class="chart-crosshair" hidden></div>
      <div class="chart-dot" hidden></div>
      <div class="chart-tooltip" hidden></div>
    </div>
  `;

  bindChartInteraction(els.chart.querySelector(".chart-plot"), coords, formatValue);
}

function formatPriceValue(value) {
  return value >= 100 ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`;
}

function formatIvValue(value) {
  return `${value.toFixed(1)}%`;
}

function bindChartInteraction(plot, coords, formatValue) {
  const crosshair = plot.querySelector(".chart-crosshair");
  const dot = plot.querySelector(".chart-dot");
  const tooltip = plot.querySelector(".chart-tooltip");
  const lineColor = plot.querySelector("path[stroke]")?.getAttribute("stroke") || "#5b8cff";

  const showAt = (clientX) => {
    const rect = plot.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const ratio = rect.width > 0 ? x / rect.width : 0;
    const index = Math.round(ratio * (coords.length - 1));
    const coord = coords[index];
    if (!coord) return;
    const leftPct = (coord.x / (coords[coords.length - 1].x || 1)) * 100;
    crosshair.hidden = false;
    crosshair.style.left = `${leftPct}%`;
    dot.hidden = false;
    dot.style.left = `${leftPct}%`;
    dot.style.top = `${(coord.y / chartHeight()) * 100}%`;
    dot.style.background = lineColor;
    tooltip.hidden = false;
    tooltip.innerHTML = `<strong>${formatChartDate(coord.point.date)}</strong>${formatValue(coord.point.value)}`;
    const flip = leftPct > 72;
    tooltip.style.left = flip ? "auto" : "50%";
    tooltip.style.right = flip ? "0" : "auto";
    tooltip.style.transform = flip ? "none" : "translateX(-50%)";
  };

  const hide = () => {
    crosshair.hidden = true;
    dot.hidden = true;
    tooltip.hidden = true;
  };

  plot.addEventListener("pointerdown", (event) => {
    plot.setPointerCapture(event.pointerId);
    showAt(event.clientX);
  });
  plot.addEventListener("pointermove", (event) => {
    if (plot.hasPointerCapture(event.pointerId) || event.pointerType === "mouse") {
      showAt(event.clientX);
    }
  });
  plot.addEventListener("pointerup", (event) => {
    if (plot.hasPointerCapture(event.pointerId)) plot.releasePointerCapture(event.pointerId);
    if (event.pointerType !== "mouse") hide();
  });
  plot.addEventListener("pointerleave", () => {
    if (!plot.querySelector(":active")) hide();
  });
}

function renderPriceChart() {
  const bars = filterHistory();
  const up = (state.info?.currentPrice ?? 0) >= (state.info?.previousClose ?? 0);
  const color = up ? "#3ddc91" : "#ff6b6b";
  renderInteractiveChart({
    points: bars.map((bar) => ({ date: bar.date, value: bar.close })),
    color,
    formatValue: formatPriceValue,
    emptyText: "Not enough price history yet.",
  });
}

function renderIvChart() {
  const bars = filterHistory().filter((bar) => bar.historicalVolatility != null);
  const atmIv = currentAtmIv();
  const hvNow = bars.length ? bars[bars.length - 1].historicalVolatility : null;
  els.chartCaption.textContent = [
    hvNow != null ? `HV ${hvNow.toFixed(1)}%` : null,
    atmIv != null ? `ATM IV ${atmIv.toFixed(1)}%` : null,
  ].filter(Boolean).join(" · ");
  const extras = atmIv != null ? [{ value: atmIv, color: "#f0c35b" }] : [];
  renderInteractiveChart({
    points: bars.map((bar) => ({ date: bar.date, value: bar.historicalVolatility })),
    color: "#b7adff",
    formatValue: formatIvValue,
    emptyText: "Not enough history yet.",
    extras,
  });
}

function stat(label, value) {
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

function renderQuote() {
  const { info } = state;
  if (!info) return;
  const change = info.currentPrice - info.previousClose;
  const changePct = info.previousClose ? (change / info.previousClose) * 100 : 0;
  const pct = `${changePct >= 0 ? "+" : "−"}${Math.abs(changePct).toFixed(2)}%`;
  const dollars = `${change >= 0 ? "+" : "−"}${Calc.money(Math.abs(change))}`;
  els.tradeSymbol.textContent = info.symbol;
  els.company.textContent = info.longName;
  els.price.textContent = Calc.money(info.currentPrice);
  els.change.className = `change ${changeClass(change)}`;
  els.change.textContent = `${pct}  ${dollars}`;
  els.switchInput.value = info.symbol;
  els.targetName.textContent = info.symbol;
  document.title = `${info.symbol} · Options Scenario Analyzer`;
  renderHistoryStats();
}

function renderHistoryStats() {
  const { info } = state;
  if (!info) return;
  const hv = latestHv();
  const atmIv = currentAtmIv();
  els.historyMeta.textContent = [
    hv != null ? `HV ${hv.toFixed(1)}%` : null,
    atmIv != null ? `IV ${atmIv.toFixed(1)}%` : null,
  ].filter(Boolean).join(" · ");
  els.stats.innerHTML = [
    stat("High", Calc.money(info.dayHigh)),
    stat("Low", Calc.money(info.dayLow)),
    stat("Vol", Calc.compactNumber(info.volume)),
    stat("52w", `${Calc.money(info.fiftyTwoWeekLow, 0)}–${Calc.money(info.fiftyTwoWeekHigh, 0)}`),
  ].join("");
}

function expiryLabel(date) {
  const dte = Calc.daysBetween(Calc.todayISO(), date);
  const pretty = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  return `${pretty} · ${dte}d`;
}

function renderExpiries() {
  els.expiry.innerHTML = state.expirations
    .map((date) => `<option value="${date}" ${date === state.selectedExpiry ? "selected" : ""}>${expiryLabel(date)}</option>`)
    .join("");
  if (state.selectedExpiry) els.expiry.value = state.selectedExpiry;
}

function renderType() {
  els.typeCall.classList.toggle("active", state.right === "call");
  els.typePut.classList.toggle("active", state.right === "put");
}

function chipStrikes(rows) {
  const spot = state.info?.currentPrice ?? 0;
  const strikes = rows.map((row) => row.strike);
  let band = strikes.filter((strike) => strike >= spot * 0.75 && strike <= spot * 1.25);
  if (band.length < 7) band = strikes;
  if (state.selectedStrike != null && !band.includes(state.selectedStrike)) {
    band = [...band, state.selectedStrike].sort((a, b) => a - b);
  }
  return band;
}

function renderStrikeChips() {
  const rows = currentOptions();
  const visible = new Set(chipStrikes(rows));
  const shown = rows.filter((row) => visible.has(row.strike));
  els.strikeScroll.innerHTML = shown.map((row) => {
    const selected = row.strike === state.selectedStrike ? "selected" : "";
    const atm = row.moneyness === "ATM" ? "atm" : "";
    const premium = Calc.optionPremium(row);
    return `<button type="button" class="strike-chip ${selected} ${atm}" data-strike="${row.strike}" role="option" aria-selected="${selected ? "true" : "false"}"><strong>${formatPrice(row.strike).slice(1)}</strong><small>${premium > 0 ? Calc.money(premium) : "—"}</small></button>`;
  }).join("");
  if (lastChipStrike !== state.selectedStrike) {
    lastChipStrike = state.selectedStrike;
    requestAnimationFrame(() => {
      const chip = els.strikeScroll.querySelector(".selected");
      if (!chip) return;
      els.strikeScroll.scrollLeft = Math.max(0, chip.offsetLeft - els.strikeScroll.clientWidth / 2 + chip.offsetWidth / 2);
    });
  }
}

function renderMoveChips() {
  if (!state.info || state.targetPrice == null) return;
  const spot = state.info.currentPrice;
  const step = priceStep(spot);
  els.moveChips.innerHTML = MOVES.map((pct) => {
    const price = snapPrice(spot * (1 + pct / 100), step);
    const active = Math.abs(price - state.targetPrice) <= step * 0.51;
    const label = `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
    return `<button type="button" data-move="${pct}" class="${active ? "active" : ""}">${label}</button>`;
  }).join("");
}

function renderTargetControls() {
  if (!state.info || state.targetPrice == null) return;
  const bounds = targetBounds();
  const step = priceStep(state.info.currentPrice);
  els.targetRange.min = String(bounds.min);
  els.targetRange.max = String(bounds.max);
  els.targetRange.step = String(step);
  els.targetRange.value = String(state.targetPrice);
  els.targetInput.min = String(bounds.min);
  els.targetInput.max = String(bounds.max);
  els.targetInput.step = String(step);
  if (document.activeElement !== els.targetInput) els.targetInput.value = String(state.targetPrice);
  const pct = ((state.targetPrice - state.info.currentPrice) / state.info.currentPrice) * 100;
  els.targetMove.className = `target-move ${pct > 0.05 ? "up" : pct < -0.05 ? "down" : ""}`;
  els.targetMove.textContent = formatMove(state.targetPrice, state.info.currentPrice);
  renderMoveChips();
}

function renderScenario() {
  renderType();
  renderExpiries();
  renderStrikeChips();
  renderTargetControls();
}

function chainFor(expiry) {
  if (expiry === state.selectedExpiry) return { calls: state.calls, puts: state.puts };
  return state.chainCache[expiry] ?? null;
}

function materializedSlot(index) {
  return Calc.materializeCompareSlot(
    state.compare[index],
    index,
    chainStrikes(),
    state.selectedStrike,
    state.selectedExpiry,
    state.right,
  );
}

function primarySpec() {
  return {
    key: "primary",
    color: LEG_COLORS[0],
    strike: state.selectedStrike,
    right: state.right,
    expiry: state.selectedExpiry,
    primary: true,
  };
}

function legId(leg) {
  return `${leg.expiry}|${leg.right}|${leg.strike}`;
}

function activeLegs() {
  const legs = [];
  const primary = primarySpec();
  if (primary.strike != null) legs.push(primary);
  const seen = new Set(legs.map(legId));
  [0, 1].forEach((index) => {
    const slot = materializedSlot(index);
    if (!slot || slot.hidden || slot.empty || slot.strike == null) return;
    const leg = {
      key: `alt-${index}`,
      slot: index,
      color: LEG_COLORS[index + 1],
      strike: slot.strike,
      right: slot.right,
      expiry: slot.expiry,
      primary: false,
      auto: slot.auto,
    };
    if (seen.has(legId(leg))) return;
    seen.add(legId(leg));
    legs.push(leg);
  });
  return legs;
}

function legName(leg) {
  const side = leg.right === "put" ? "Put" : "Call";
  return `${formatPrice(leg.strike)} ${side}`;
}

function legSnapshot(leg) {
  const chain = chainFor(leg.expiry);
  if (!chain) return { ...leg, pending: true };
  const rows = leg.right === "put" ? chain.puts : chain.calls;
  const option = rows.find((row) => row.strike === leg.strike);
  if (!option) return { ...leg, missing: true, pending: false };
  const premium = Calc.optionPremium(option);
  const years = Calc.yearsToExpiry(leg.expiry);
  const stats = Calc.contractSnapshot({
    spot: state.info.currentPrice,
    target: state.targetPrice,
    strike: option.strike,
    premium,
    ivPct: option.impliedVolatility,
    years,
    isCall: leg.right === "call",
  });
  return { ...leg, option, premium, years, pending: false, missing: false, ...stats };
}

function fact(label, value) {
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

function renderHero() {
  const option = selectedOption();
  if (!state.info || state.targetPrice == null || !option) {
    els.heroKicker.textContent = "Choose a strike to price the scenario.";
    els.heroContract.textContent = "";
    els.heroPnl.textContent = "";
    els.heroUnit.textContent = "";
    els.heroDetail.textContent = "";
    els.heroFacts.innerHTML = "";
    return;
  }
  const snap = legSnapshot(primarySpec());
  els.heroKicker.innerHTML = targetPhrase(state.info.symbol, state.targetPrice, state.info.currentPrice);
  els.heroContract.textContent = `${legName(snap)} · ${expiryLabel(snap.expiry)}`;
  if (!(snap.premium > 0)) {
    els.heroPnl.className = "hero-pnl";
    els.heroPnl.textContent = "No quoted premium";
    els.heroUnit.textContent = "";
    els.heroDetail.textContent = "This strike doesn’t have a usable bid or ask yet.";
    els.heroFacts.innerHTML = "";
    return;
  }
  const up = snap.pnlPerContract > 0.5;
  const down = snap.pnlPerContract < -0.5;
  els.heroPnl.className = `hero-pnl ${up ? "up" : down ? "down" : ""}`;
  if (Math.abs(snap.pnlPerShare) < 0.005) {
    els.heroPnl.textContent = "$0";
    els.heroUnit.textContent = "per contract";
    els.heroDetail.textContent = `You break even at expiry · paid ${formatPrice(snap.premium)}`;
  } else if (snap.value <= 0.0001) {
    els.heroPnl.textContent = formatSignedContract(snap.pnlPerContract);
    els.heroUnit.textContent = "per contract";
    els.heroDetail.textContent = `Expires worthless · paid ${formatPrice(snap.premium)}`;
  } else {
    els.heroPnl.textContent = formatSignedContract(snap.pnlPerContract);
    els.heroUnit.textContent = "per contract";
    const bits = [
      `Worth ${formatPrice(snap.value)}`,
      `paid ${formatPrice(snap.premium)}`,
      Calc.formatPct(snap.returnPct),
    ];
    if (snap.multiple >= 1) bits.push(Calc.formatMultiple(snap.multiple));
    els.heroDetail.textContent = bits.join(" · ");
  }
  els.heroFacts.innerHTML = [
    fact("Premium", formatPrice(snap.premium)),
    fact("Breakeven", formatPrice(snap.breakeven)),
    fact("Max loss", formatUnsignedContract(snap.maxLossPerContract)),
    fact("Delta", formatDelta(snap.delta)),
  ].join("");
}

function renderPayoff(retry = true) {
  if (!state.info || state.targetPrice == null) return;
  const snaps = activeLegs().map(legSnapshot).filter((snap) => !snap.pending && !snap.missing && snap.strike != null);
  if (!snaps.length) {
    els.payoffLegend.innerHTML = "";
    els.payoff.innerHTML = `<div class="chart-empty">Choose a strike with a quoted premium.</div>`;
    state.payoffMap = null;
    return;
  }
  const spot = state.info.currentPrice;
  const target = state.targetPrice;
  const domain = Calc.payoffDomain(spot, target, snaps.map((snap) => snap.strike));
  const curves = snaps.map((snap) => ({
    ...snap,
    points: Calc.payoffCurve({
      strike: snap.strike,
      premium: snap.premium,
      isCall: snap.right === "call",
      minPrice: domain.minPrice,
      maxPrice: domain.maxPrice,
      steps: 96,
    }),
  }));
  const pnls = curves.flatMap((curve) => curve.points.map((point) => point.pnl));
  let yMin = Math.min(0, ...pnls);
  let yMax = Math.max(0, ...pnls);
  const yPad = (yMax - yMin) * 0.14 || 1;
  yMin -= yPad;
  yMax += yPad;

  const height = els.payoff.clientHeight || 230;
  const plotWidth = Math.max((els.payoff.clientWidth || 320) - 56, 160);
  const padTop = 18;
  const padBottom = 8;
  const innerH = Math.max(height - padTop - padBottom, 40);
  const ySpan = yMax - yMin || 1;
  const xSpan = domain.maxPrice - domain.minPrice || 1;
  const yOf = (pnl) => padTop + (1 - (pnl - yMin) / ySpan) * innerH;
  const xOf = (price) => ((price - domain.minPrice) / xSpan) * plotWidth;
  state.payoffMap = { domain, plotWidth };

  const ordered = [...curves.filter((curve) => !curve.primary), ...curves.filter((curve) => curve.primary)];
  const paths = ordered.map((curve) => {
    const d = curve.points.map((point, index) => {
      const cmd = index === 0 ? "M" : "L";
      return `${cmd}${xOf(point.price).toFixed(1)},${yOf(point.pnl).toFixed(1)}`;
    }).join(" ");
    return `<path d="${d}" fill="none" stroke="${curve.color}" stroke-width="${curve.primary ? 2.75 : 1.75}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>`;
  }).join("");
  const dots = curves.map((curve) => {
    const value = Math.max(curve.right === "call" ? target - curve.strike : curve.strike - target, 0);
    const pnl = value - (curve.premium || 0);
    return `<circle cx="${xOf(target).toFixed(1)}" cy="${yOf(pnl).toFixed(1)}" r="${curve.primary ? 4.5 : 3.5}" fill="${curve.color}" stroke="#0c1117" stroke-width="1.5"></circle>`;
  }).join("");
  const zeroY = yOf(0);
  const spotX = xOf(spot);
  const targetX = xOf(target);
  const targetLabelX = targetX > plotWidth - 64 ? targetX - 4 : targetX + 4;
  const targetAnchor = targetX > plotWidth - 64 ? "end" : "start";
  const yLabels = [
    { value: yMax, y: yOf(yMax) },
    { value: 0, y: zeroY },
    { value: yMin, y: yOf(yMin) },
  ];

  els.payoffLegend.innerHTML = curves.map((curve) => {
    const ret = curve.premium > 0 && curve.returnPct != null ? Calc.formatPct(curve.returnPct) : "—";
    return `<span class="legend-item"><i style="background:${curve.color}"></i>${legName(curve)} <em>${ret}</em></span>`;
  }).join("");

  els.payoff.innerHTML = `
    <div class="chart-yaxis payoff-yaxis" aria-hidden="true">
      ${yLabels.map((label) => `<span style="top:${(label.y / height) * 100}%">${formatSignedMoney(label.value, Math.abs(label.value) >= 10 ? 1 : 2)}</span>`).join("")}
    </div>
    <div class="chart-plot">
      <svg viewBox="0 0 ${plotWidth} ${height}" preserveAspectRatio="none" role="img" aria-label="Payoff at expiry">
        <line x1="0" x2="${plotWidth}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="rgba(232,238,246,0.35)" stroke-width="1" vector-effect="non-scaling-stroke"></line>
        <line x1="${spotX.toFixed(1)}" x2="${spotX.toFixed(1)}" y1="0" y2="${height}" stroke="rgba(232,238,246,0.4)" stroke-width="1" stroke-dasharray="4 4" vector-effect="non-scaling-stroke"></line>
        <line x1="${targetX.toFixed(1)}" x2="${targetX.toFixed(1)}" y1="0" y2="${height}" stroke="#f0c35b" stroke-width="1.5" vector-effect="non-scaling-stroke"></line>
        ${paths}
        ${dots}
        <text x="${Math.min(plotWidth - 28, spotX + 4)}" y="12" fill="#8b98a8" font-size="10">Now</text>
        <text x="${targetLabelX.toFixed(1)}" y="24" fill="#f0c35b" font-size="10" text-anchor="${targetAnchor}">${formatPrice(target)}</text>
      </svg>
      <div class="payoff-tip" hidden></div>
    </div>
  `;

  if (retry && (els.payoff.clientWidth || 0) < 40) requestAnimationFrame(() => renderPayoff(false));
}

function priceFromClientX(clientX) {
  const plot = els.payoff.querySelector(".chart-plot");
  const map = state.payoffMap;
  if (!plot || !map) return state.targetPrice;
  const rect = plot.getBoundingClientRect();
  const t = Calc.clamp((clientX - rect.left) / (rect.width || 1), 0, 1);
  return map.domain.minPrice + t * (map.domain.maxPrice - map.domain.minPrice);
}

function updatePayoffTip(price) {
  const tip = els.payoff.querySelector(".payoff-tip");
  const snap = legSnapshot(primarySpec());
  if (!tip || !snap || snap.pending || snap.missing || state.targetPrice == null) return;
  const value = Math.max(snap.right === "call" ? price - snap.strike : snap.strike - price, 0);
  const pnl = (value - (snap.premium || 0)) * 100;
  tip.hidden = false;
  tip.textContent = `${formatPrice(price)} · ${formatSignedContract(pnl)}`;
  const map = state.payoffMap;
  const t = (price - map.domain.minPrice) / (map.domain.maxPrice - map.domain.minPrice || 1);
  tip.style.left = `${Math.min(78, Math.max(12, t * 100))}%`;
}

function setTarget(price, { touched = true } = {}) {
  if (!state.info || !Number.isFinite(price)) return;
  const step = priceStep(state.info.currentPrice);
  const bounds = targetBounds();
  state.targetPrice = Calc.clamp(snapPrice(price, step), bounds.min, bounds.max);
  if (touched) state.targetTouched = true;
  renderTargetControls();
  renderHero();
  renderPayoff();
  renderCompareNumbers();
  queueUrl();
}

function strikesFor(expiry, right) {
  const chain = chainFor(expiry);
  if (!chain) return [];
  const rows = right === "put" ? chain.puts : chain.calls;
  return rows.map((row) => row.strike);
}

function editorHtml(index) {
  const slot = materializedSlot(index);
  const color = LEG_COLORS[index + 1];
  if (slot.empty) return "";
  if (slot.hidden) {
    return `<button type="button" class="add-leg" data-slot="${index}" data-action="add">Add a strike</button>`;
  }
  const strikeOptions = strikesFor(slot.expiry, slot.right);
  const strikes = strikeOptions.length ? strikeOptions : [slot.strike];
  const expiryOptions = state.expirations.length ? state.expirations : [slot.expiry];
  return `
    <div class="leg-editor" style="--leg:${color}">
      <div class="leg-editor-top">
        <strong><i class="dot" style="background:${color}"></i>Compare</strong>
        <button type="button" class="text-btn" data-slot="${index}" data-action="hide">Remove</button>
      </div>
      <div class="segmented mini">
        <button type="button" data-slot="${index}" data-action="right" data-right="call" class="${slot.right === "call" ? "active" : ""}">Call</button>
        <button type="button" data-slot="${index}" data-action="right" data-right="put" class="${slot.right === "put" ? "active" : ""}">Put</button>
      </div>
      <label>Strike
        <select data-slot="${index}" data-field="strike">
          ${strikes.map((strike) => `<option value="${strike}" ${strike === slot.strike ? "selected" : ""}>${formatPrice(strike)}</option>`).join("")}
        </select>
      </label>
      <label>Expiration
        <select data-slot="${index}" data-field="expiry">
          ${expiryOptions.map((date) => `<option value="${date}" ${date === slot.expiry ? "selected" : ""}>${expiryLabel(date)}</option>`).join("")}
        </select>
      </label>
    </div>
  `;
}

function renderCompareEditors() {
  els.compareEditors.innerHTML = [0, 1].map((index) => editorHtml(index)).join("");
  ensureCompareChains();
}

function cellHtml(snap, html) {
  if (!snap || snap.pending) return "…";
  if (snap.missing || !(snap.premium > 0)) return "—";
  return html;
}

function pair(main, sub) {
  return `<span class="pair"><b>${main}</b><small>${sub}</small></span>`;
}

function renderCompareNumbers() {
  const snaps = activeLegs().map(legSnapshot);
  renderInsight(snaps);
  if (!snaps.length) {
    els.compareTable.innerHTML = "";
    return;
  }
  const targetLabel = formatPrice(state.targetPrice);
  let bestIndex = -1;
  snaps.forEach((snap, index) => {
    if (snap.returnPct == null) return;
    if (bestIndex < 0 || snap.returnPct > snaps[bestIndex].returnPct + 0.05) bestIndex = index;
  });
  const rows = [
    ["Premium", (snap) => cellHtml(snap, pair(formatPrice(snap.premium), formatUnsignedContract(snap.maxLossPerContract)))],
    ["Breakeven", (snap) => cellHtml(snap, formatPrice(snap.breakeven))],
    ["Max loss", (snap) => cellHtml(snap, formatUnsignedContract(snap.maxLossPerContract))],
    [`Worth at ${targetLabel}`, (snap) => cellHtml(snap, pair(formatPrice(snap.value), formatUnsignedContract(snap.value * 100)))],
    [`Return at ${targetLabel}`, (snap, index) => cellHtml(snap, pair(Calc.formatPct(snap.returnPct), formatSignedContract(snap.pnlPerContract))), "return"],
    ["IV", (snap) => cellHtml(snap, `${snap.option.impliedVolatility.toFixed(1)}%`)],
    ["Expiration", (snap) => snap.pending ? "…" : expiryLabel(snap.expiry)],
    ["Delta", (snap) => cellHtml(snap, formatDelta(snap.delta))],
    ["Gamma", (snap) => cellHtml(snap, snap.gamma == null ? "—" : snap.gamma.toFixed(3))],
    ["Theta / day", (snap) => cellHtml(snap, formatTheta(snap.theta))],
    ["Vega / 1% IV", (snap) => cellHtml(snap, formatVega(snap.vega))],
  ];
  const head = snaps.map((snap) => `
    <th style="color:${snap.color}">
      <span class="dot" style="background:${snap.color}"></span>${legName(snap)}
      <small>${snap.primary ? "Chosen" : "Compare"}</small>
    </th>
  `).join("");
  const body = rows.map(([label, render, kind]) => {
    const cells = snaps.map((snap, index) => {
      const best = kind === "return" && index === bestIndex ? "best" : "";
      return `<td class="${best}">${render(snap, index)}</td>`;
    }).join("");
    return `<tr><th>${label}</th>${cells}</tr>`;
  }).join("");
  els.compareTable.innerHTML = `<thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody>`;
}

function renderInsight(snaps) {
  const priced = snaps.filter((snap) => !snap.pending && !snap.missing && snap.premium > 0 && snap.returnPct != null);
  if (priced.length < 2) {
    els.compareInsight.textContent = "Add another strike to see which contract makes more at your target.";
    return;
  }
  const primary = priced.find((snap) => snap.primary) ?? priced[0];
  const best = priced.reduce((left, right) => (right.returnPct > left.returnPct ? right : left));
  const other = best === primary
    ? priced.filter((snap) => snap !== primary).reduce((left, right) => (right.returnPct > left.returnPct ? right : left))
    : primary;
  const at = formatPrice(state.targetPrice);
  const name = (snap) => `${formatPrice(snap.strike)} ${snap.right}`;
  const risk = (snap) => formatUnsignedContract(snap.maxLossPerContract);
  if (best === primary) {
    els.compareInsight.textContent = `Your ${name(primary)} returns ${Calc.formatPct(primary.returnPct)} if the stock is at ${at} by expiry. The ${name(other)} returns ${Calc.formatPct(other.returnPct)}, risks ${risk(other)} per contract, and breaks even at ${formatPrice(other.breakeven)}.`;
  } else {
    els.compareInsight.textContent = `At ${at}, the ${name(best)} returns ${Calc.formatPct(best.returnPct)}, ahead of your ${name(primary)} at ${Calc.formatPct(primary.returnPct)}. It risks ${risk(best)} per contract and breaks even at ${formatPrice(best.breakeven)}.`;
  }
}

function headerCell(column) {
  if (column.helpKey) {
    return `<th><button type="button" class="th-help" data-help="${column.helpKey}">${column.label}</button></th>`;
  }
  return `<th>${column.label}</th>`;
}

function renderChainTable() {
  const rows = currentOptions();
  const spot = state.info?.currentPrice ?? 0;
  const thead = els.chainTable.querySelector("thead");
  const tbody = els.chainTable.querySelector("tbody");
  if (!rows.length) {
    thead.innerHTML = "";
    tbody.innerHTML = `<tr><td class="chain-empty" colspan="6">No contracts for this expiration.</td></tr>`;
    return;
  }
  if (state.selectedStrike == null || !rows.some((row) => row.strike === state.selectedStrike)) {
    state.selectedStrike = rows[Calc.nearestIndex(rows.map((row) => row.strike), spot)].strike;
  }
  const maxVol = Calc.maxMetric(rows, "volume");
  const maxOi = Calc.maxMetric(rows, "openInterest");
  thead.innerHTML = `<tr><th>Strike</th>${CHAIN_COLUMNS.map(headerCell).join("")}</tr>`;
  tbody.innerHTML = rows.map((row) => {
    const selected = row.strike === state.selectedStrike ? "selected" : "";
    const atm = row.moneyness === "ATM" ? "atm" : "";
    const cells = CHAIN_COLUMNS.map((column) => chainCell(row, column.id, maxVol, maxOi)).join("");
    return `<tr class="${[selected, atm].filter(Boolean).join(" ")}" data-strike="${row.strike}" tabindex="0" aria-selected="${row.strike === state.selectedStrike ? "true" : "false"}"><td>${Calc.money(row.strike)}</td>${cells}</tr>`;
  }).join("");
  revealSelectedRow();
}

function revealSelectedRow() {
  const wrap = els.chainTable.closest(".chain-scroll");
  const row = els.chainTable.querySelector("tr.selected");
  if (!wrap || !row) return;
  const rowTop = row.offsetTop;
  const rowBottom = rowTop + row.offsetHeight;
  const viewTop = wrap.scrollTop;
  const viewBottom = viewTop + wrap.clientHeight;
  if (rowTop < viewTop || rowBottom > viewBottom) {
    wrap.scrollTop = Math.max(0, rowTop - wrap.clientHeight / 2 + row.offsetHeight / 2);
  }
}

function chainCell(row, field, maxVol, maxOi) {
  if (field === "last") return `<td>${row.lastPrice > 0 ? Calc.money(row.lastPrice) : "—"}</td>`;
  if (field === "bidAsk") return `<td>${quotePair(row.bid, row.ask)}</td>`;
  if (field === "iv") return `<td>${row.impliedVolatility.toFixed(1)}%</td>`;
  if (field === "volume") return barCell(row.volume, maxVol, "vol");
  if (field === "oi") return barCell(row.openInterest, maxOi, "oi");
  return "<td>—</td>";
}

function barCell(value, max, kind) {
  const width = Calc.barWidthPct(value, max);
  return `<td class="bar-cell"><div class="bar-metric"><span>${value ? Calc.compactNumber(value) : "—"}</span><div class="bar-track" aria-hidden="true"><div class="bar ${kind}" style="width:${width.toFixed(1)}%"></div></div></div></td>`;
}

function syncStrikeWindowInputs() {
  if (state.strikeMin == null || state.strikeMax == null) return;
  els.strikeMinInput.value = state.strikeMin;
  els.strikeMaxInput.value = state.strikeMax;
  els.strikeMinRange.min = state.chainMin;
  els.strikeMinRange.max = state.chainMax;
  els.strikeMinRange.step = typicalStrikeStep();
  els.strikeMaxRange.min = state.chainMin;
  els.strikeMaxRange.max = state.chainMax;
  els.strikeMaxRange.step = typicalStrikeStep();
  els.strikeMinRange.value = state.strikeMin;
  els.strikeMaxRange.value = state.strikeMax;
  const span = state.chainMax - state.chainMin || 1;
  const minPosition = ((state.strikeMin - state.chainMin) / span) * 100;
  const maxPosition = ((state.strikeMax - state.chainMin) / span) * 100;
  els.strikeMinRange.parentElement.style.setProperty("--min-position", `${minPosition}%`);
  els.strikeMinRange.parentElement.style.setProperty("--max-position", `${maxPosition}%`);
}

function typicalStrikeStep() {
  const strikes = chainStrikes();
  if (strikes.length < 2) return 0.5;
  const step = Calc.typicalStep(strikes);
  return step >= 1 ? step : 0.5;
}

function setStrikeWindow(minStrike, maxStrike, { rebuild = true, sync = true } = {}) {
  const lo = Math.min(minStrike, maxStrike);
  const hi = Math.max(minStrike, maxStrike);
  state.strikeMin = Calc.clamp(lo, state.chainMin, state.chainMax);
  state.strikeMax = Calc.clamp(hi, state.chainMin, state.chainMax);
  if (state.strikeMin > state.strikeMax) {
    state.strikeMin = state.chainMin;
    state.strikeMax = state.chainMax;
  }
  syncStrikeWindowInputs();
  if (rebuild) rebuildHeatmap();
  if (sync) syncUrl({ replace: true });
}

function initStrikeWindow(option) {
  const strikes = chainStrikes();
  const years = Math.max(Calc.yearsBetween(Calc.todayISO(), state.selectedExpiry), 2 / 365.25);
  const bounds = Calc.defaultStrikeWindow(
    state.info.currentPrice,
    strikes,
    option.impliedVolatility,
    years,
    option.strike,
  );
  state.chainMin = bounds.chainMin;
  state.chainMax = bounds.chainMax;
  state.strikeMin = bounds.minStrike;
  state.strikeMax = bounds.maxStrike;
  syncStrikeWindowInputs();
}

function contractKey() {
  return `${state.ticker}|${state.selectedExpiry}|${state.right}|${state.selectedStrike}`;
}

function ensureWindow() {
  const option = selectedOption();
  if (!option) return;
  const key = contractKey();
  if (state.windowKey === key) return;
  initStrikeWindow(option);
  if (state.pendingMin != null && state.pendingMax != null && state.pendingMin < state.pendingMax) {
    setStrikeWindow(state.pendingMin, state.pendingMax, { rebuild: false, sync: false });
  }
  state.pendingMin = null;
  state.pendingMax = null;
  state.windowKey = key;
}

function renderHeatmap() {
  const grid = state.heatmap;
  const option = selectedOption();
  if (!grid || !option || !state.info) return;
  const spot = state.info.currentPrice;
  const cols = grid.columns.length;
  els.heatmap.style.gridTemplateColumns = `minmax(48px, 14%) repeat(${cols}, minmax(0, 1fr))`;
  els.heatmap.style.gridTemplateRows = `auto repeat(${grid.rows.length}, minmax(0, 1fr))`;

  const head = [
    `<div class="cell head">Price</div>`,
    ...grid.columns.map((column) => {
      const label = Calc.formatDateLabel(column.date, Calc.todayISO(), state.selectedExpiry);
      return `<div class="cell head">${label}</div>`;
    }),
  ];

  const body = grid.rows.flatMap((price, rowIndex) => {
    const delta = ((price - spot) / spot) * 100;
    const rowClass = [
      "cell rowhead",
      price === grid.spotRow ? "spot" : "",
      price === grid.strikeRow ? "strike" : "",
    ].join(" ");
    const header = `<div class="${rowClass}">${Calc.money(price, price >= 100 ? 0 : 2)}<small>${delta >= 0 ? "+" : "−"}${Math.abs(delta).toFixed(0)}%</small></div>`;
    const cells = grid.cells[rowIndex].map((cell) => {
      const text = state.display === "pct" ? Calc.formatPct(cell.pct) : Calc.formatMultiple(cell.multiple);
      const classes = [
        "cell",
        price === grid.spotRow ? "spot" : "",
        price === grid.strikeRow ? "strike" : "",
      ].join(" ");
      return `<div class="${classes}" style="background:${Calc.heatColor(cell.multiple, cell.pct)}">${text}</div>`;
    });
    return [header, ...cells];
  });

  els.heatmap.innerHTML = [...head, ...body].join("");
}

function rebuildHeatmap() {
  const option = selectedOption();
  if (!option || !state.info || state.strikeMin == null || state.strikeMax == null) return;
  const { maxCols, maxRows } = Calc.tableCapacity(window.innerWidth, window.innerHeight);
  state.heatmap = Calc.buildHeatmap({
    spot: state.info.currentPrice,
    option,
    isCall: state.right === "call",
    expiry: state.selectedExpiry,
    today: Calc.todayISO(),
    term: state.term,
    strikeMin: state.strikeMin,
    strikeMax: state.strikeMax,
    maxRows,
    maxCols,
    strikes: chainStrikes(),
  });
  renderHeatmap();
}

function present() {
  renderQuote();
  ensureWindow();
  renderScenario();
  renderHero();
  renderPayoff();
  renderCompareEditors();
  renderCompareNumbers();
  renderChainTable();
  rebuildHeatmap();
  if (els.history.open) renderChart();
}

function scheduleTerm() {
  clearTimeout(state.termTimer);
  state.termTimer = setTimeout(() => {
    refreshTerm();
  }, 180);
}

async function refreshTerm() {
  const option = selectedOption();
  if (!option || !state.selectedExpiry || !state.ticker) return;
  const key = `${state.ticker}|${state.selectedExpiry}|${option.strike}|${state.right}`;
  if (state.termKey === key && state.term.length) return;
  const token = ++state.termToken;
  try {
    const payload = await client.ivTerm({
      ticker: state.ticker,
      expiry: state.selectedExpiry,
      strike: option.strike,
      right: state.right,
    });
    if (token !== state.termToken) return;
    if (key !== `${state.ticker}|${state.selectedExpiry}|${state.selectedStrike}|${state.right}`) return;
    state.term = payload.term ?? [];
    state.termKey = key;
    rebuildHeatmap();
  } catch {
    // The grid still prices off this contract's own IV.
  }
}

async function fetchChain(expiry) {
  const payload = await client.chain(state.ticker, expiry);
  const chain = {
    calls: payload.calls ?? [],
    puts: payload.puts ?? [],
    atmCallIv: payload.atmCallIv ?? null,
    atmPutIv: payload.atmPutIv ?? null,
  };
  state.chainCache[expiry] = chain;
  return chain;
}

async function ensureCompareChains() {
  const expiries = new Set();
  [0, 1].forEach((index) => {
    const slot = materializedSlot(index);
    if (slot && !slot.hidden && !slot.empty && slot.expiry && slot.expiry !== state.selectedExpiry && !state.chainCache[slot.expiry]) {
      expiries.add(slot.expiry);
    }
  });
  await Promise.all([...expiries].map(async (expiry) => {
    if (state.chainLoading[expiry]) return;
    state.chainLoading[expiry] = true;
    try {
      await fetchChain(expiry);
      [0, 1].forEach((index) => {
        const slot = state.compare[index];
        if (!slot || slot.auto !== false || slot.hidden || slot.expiry !== expiry) return;
        const chain = state.chainCache[expiry];
        const rows = slot.right === "put" ? chain.puts : chain.calls;
        if (rows.length && !rows.some((row) => row.strike === slot.strike)) {
          slot.strike = rows.map((row) => row.strike)[Calc.nearestIndex(rows.map((row) => row.strike), slot.strike)];
        }
      });
      renderCompareEditors();
      renderPayoff();
      renderCompareNumbers();
    } catch (error) {
      setBanner(els.analyzerError, error.message);
    } finally {
      state.chainLoading[expiry] = false;
    }
  }));
}

async function loadChain() {
  const expiry = state.selectedExpiry;
  const previous = state.loadedExpiry;
  els.expiry.disabled = true;
  try {
    const chain = await fetchChain(expiry);
    if (expiry !== state.selectedExpiry) return;
    state.calls = chain.calls;
    state.puts = chain.puts;
    state.atmCallIv = chain.atmCallIv;
    state.atmPutIv = chain.atmPutIv;
    state.loadedExpiry = expiry;
    if (!currentOptions().some((row) => row.strike === state.selectedStrike)) {
      const strikes = chainStrikes();
      const anchor = state.selectedStrike ?? state.info.currentPrice;
      state.selectedStrike = strikes.length ? strikes[Calc.nearestIndex(strikes, anchor)] : null;
    }
    if (!state.targetTouched) {
      state.targetPrice = Calc.suggestedTarget(state.info.currentPrice, state.right === "call");
    }
    state.term = [];
    state.termKey = "";
    state.windowKey = "";
    setBanner(els.analyzerError, "");
    present();
    scheduleTerm();
  } catch (error) {
    if (previous && previous !== expiry) {
      state.selectedExpiry = previous;
      renderExpiries();
    }
    setBanner(els.analyzerError, error.message);
  } finally {
    els.expiry.disabled = false;
  }
}

async function loadTicker(ticker, {
  expiry,
  right,
  strike,
  target = null,
  compare = null,
  pushUrl = true,
} = {}) {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) return;
  const cameFromPick = state.view === "pick";
  const sameTicker = state.ticker === symbol && state.info;
  els.lookup.disabled = true;
  els.refresh.disabled = true;
  setBanner(els.pickError, "");
  toast(sameTicker ? "Refreshing…" : "Loading stock…");
  try {
    const [stock, expirationsPayload] = await Promise.all([
      client.stock(symbol),
      client.expirations(symbol),
    ]);
    state.ticker = symbol;
    state.info = stock.info;
    state.history = stock.history ?? [];
    state.expirations = expirationsPayload.expirationDates ?? [];
    state.chainCache = {};
    state.chainLoading = {};
    state.term = [];
    state.termKey = "";
    state.windowKey = "";
    if (expiry && state.expirations.includes(expiry)) state.selectedExpiry = expiry;
    else if (!sameTicker || !state.expirations.includes(state.selectedExpiry)) {
      state.selectedExpiry = pickDefaultExpiry(state.expirations);
    }
    if (right === "put" || right === "call") state.right = right;
    if (strike != null) state.selectedStrike = strike;
    else if (!sameTicker) state.selectedStrike = null;
    if (!sameTicker) {
      state.compare = compare ?? defaultCompare();
      state.targetTouched = target != null && Number.isFinite(target);
      state.targetPrice = state.targetTouched
        ? target
        : Calc.suggestedTarget(stock.info.currentPrice, state.right === "call");
    } else {
      if (compare) state.compare = compare;
      if (target != null && Number.isFinite(target)) {
        state.targetPrice = target;
        state.targetTouched = true;
      }
    }
    els.input.value = symbol;
    els.switchInput.value = symbol;
    showView("analyzer", { push: false });
    renderQuote();
    if (!state.selectedExpiry) {
      setBanner(els.analyzerError, "No options are listed for this ticker.");
      renderQuote();
      return;
    }
    await loadChain();
    if (strike != null && currentOptions().some((row) => row.strike === strike) && state.selectedStrike !== strike) {
      state.selectedStrike = strike;
      present();
      scheduleTerm();
    }
    if (cameFromPick) window.scrollTo(0, 0);
    if (pushUrl && cameFromPick) syncUrl({ push: true });
    else if (pushUrl) syncUrl({ replace: true });
  } catch (error) {
    if (sameTicker && state.info) setBanner(els.analyzerError, error.message);
    else {
      setBanner(els.pickError, error.message);
      showView("pick", { push: false });
    }
  } finally {
    els.lookup.disabled = false;
    els.refresh.disabled = false;
    toast("");
  }
}

function selectStrike(strike, { focus = false, sync = true } = {}) {
  if (!Number.isFinite(strike) || strike === state.selectedStrike) {
    if (focus) els.chainTable.querySelector("tr.selected")?.focus();
    return;
  }
  state.selectedStrike = strike;
  state.term = [];
  state.termKey = "";
  state.windowKey = "";
  present();
  if (focus) els.chainTable.querySelector("tr.selected")?.focus();
  if (sync) queueUrl();
  scheduleTerm();
}

function setRight(right) {
  if (state.right === right) return;
  state.right = right;
  if (!currentOptions().some((row) => row.strike === state.selectedStrike)) {
    const strikes = chainStrikes();
    const anchor = state.selectedStrike ?? state.info?.currentPrice ?? 0;
    state.selectedStrike = strikes.length ? strikes[Calc.nearestIndex(strikes, anchor)] : null;
  }
  if (!state.targetTouched && state.info) {
    state.targetPrice = Calc.suggestedTarget(state.info.currentPrice, right === "call");
  }
  state.term = [];
  state.termKey = "";
  state.windowKey = "";
  present();
  queueUrl();
  scheduleTerm();
}

function setCompare(index, patch) {
  const base = materializedSlot(index);
  const next = { ...base, ...patch, auto: false, hidden: patch.hidden ?? false, empty: false };
  if ((patch.expiry || patch.right) && chainFor(next.expiry)) {
    const strikes = strikesFor(next.expiry, next.right);
    if (strikes.length && !strikes.includes(next.strike)) {
      next.strike = strikes[Calc.nearestIndex(strikes, next.strike)];
    }
  }
  state.compare[index] = next;
  renderCompareEditors();
  renderPayoff();
  renderCompareNumbers();
  queueUrl();
}

function openHelp(key) {
  const copy = HELP_COPY[key];
  if (!copy) return;
  els.helpTitle.textContent = copy.title;
  els.helpBody.textContent = copy.body;
  els.helpModal.showModal();
}

renderChips();

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadTicker(els.input.value);
});

els.switchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  loadTicker(els.switchInput.value);
});

els.chips.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-ticker]");
  if (button) loadTicker(button.dataset.ticker);
});

els.backPick.addEventListener("click", goBack);
els.refresh.addEventListener("click", () => loadTicker(state.ticker, { pushUrl: false }));

els.periods.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-period]");
  if (!button) return;
  state.period = button.dataset.period;
  [...els.periods.querySelectorAll("button")].forEach((node) => node.classList.toggle("active", node === button));
  renderChart();
  syncUrl({ replace: true });
});

els.expiry.addEventListener("change", () => {
  state.selectedExpiry = els.expiry.value;
  loadChain().then(() => {
    if (!state.restoring) queueUrl();
  });
});

els.typeCall.addEventListener("click", () => setRight("call"));
els.typePut.addEventListener("click", () => setRight("put"));

els.chartToggle.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-chart]");
  if (!button) return;
  state.chart = button.dataset.chart;
  [...els.chartToggle.querySelectorAll("button")].forEach((node) => node.classList.toggle("active", node === button));
  renderChart();
  syncUrl({ replace: true });
});

els.strikeScroll.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-strike]");
  if (!button) return;
  selectStrike(Number(button.dataset.strike));
});

els.moveChips.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-move]");
  if (!button || !state.info) return;
  const pct = Number(button.dataset.move);
  setTarget(state.info.currentPrice * (1 + pct / 100));
});

els.targetRange.addEventListener("input", () => {
  setTarget(Number(els.targetRange.value));
});

els.targetInput.addEventListener("input", () => {
  const value = Number(els.targetInput.value);
  if (!Number.isFinite(value) || value <= 0 || !state.info) return;
  state.targetPrice = value;
  state.targetTouched = true;
  els.targetRange.value = String(Calc.clamp(value, Number(els.targetRange.min), Number(els.targetRange.max)));
  const pct = ((value - state.info.currentPrice) / state.info.currentPrice) * 100;
  els.targetMove.className = `target-move ${pct > 0.05 ? "up" : pct < -0.05 ? "down" : ""}`;
  els.targetMove.textContent = formatMove(value, state.info.currentPrice);
  renderMoveChips();
  renderHero();
  renderPayoff();
  renderCompareNumbers();
});

els.targetInput.addEventListener("change", () => {
  setTarget(Number(els.targetInput.value));
});

els.payoff.addEventListener("pointerdown", (event) => {
  const plot = els.payoff.querySelector(".chart-plot");
  if (!plot || !plot.contains(event.target)) return;
  els.payoff.setPointerCapture(event.pointerId);
  setTarget(priceFromClientX(event.clientX));
});

els.payoff.addEventListener("pointermove", (event) => {
  const plot = els.payoff.querySelector(".chart-plot");
  if (!plot) return;
  if (els.payoff.hasPointerCapture(event.pointerId)) {
    setTarget(priceFromClientX(event.clientX));
    return;
  }
  if (event.pointerType === "mouse" && plot.contains(event.target)) {
    updatePayoffTip(snapPrice(priceFromClientX(event.clientX), priceStep(state.info?.currentPrice || 1)));
  }
});

els.payoff.addEventListener("pointerup", (event) => {
  if (els.payoff.hasPointerCapture(event.pointerId)) els.payoff.releasePointerCapture(event.pointerId);
});

els.payoff.addEventListener("pointerleave", () => {
  const tip = els.payoff.querySelector(".payoff-tip");
  if (tip) tip.hidden = true;
});

els.compareReset.addEventListener("click", () => {
  state.compare = defaultCompare();
  renderCompareEditors();
  renderPayoff();
  renderCompareNumbers();
  queueUrl();
});

els.compareEditors.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-slot]");
  if (!button) return;
  const index = Number(button.dataset.slot);
  const action = button.dataset.action;
  if (action === "hide") {
    state.compare[index] = { ...materializedSlot(index), hidden: true, auto: false, empty: false };
    renderCompareEditors();
    renderPayoff();
    renderCompareNumbers();
    queueUrl();
  } else if (action === "add") {
    state.compare[index] = { auto: true, hidden: false };
    renderCompareEditors();
    renderPayoff();
    renderCompareNumbers();
    queueUrl();
  } else if (action === "right") {
    setCompare(index, { right: button.dataset.right === "put" ? "put" : "call" });
  }
});

els.compareEditors.addEventListener("change", (event) => {
  const field = event.target.dataset.field;
  const index = Number(event.target.dataset.slot);
  if (!Number.isInteger(index) || !field) return;
  if (field === "strike") setCompare(index, { strike: Number(event.target.value) });
  if (field === "expiry") setCompare(index, { expiry: event.target.value });
});

els.chainTable.addEventListener("click", (event) => {
  const help = event.target.closest("button[data-help]");
  if (help) {
    event.stopPropagation();
    openHelp(help.dataset.help);
    return;
  }
  const row = event.target.closest("tr[data-strike]");
  if (!row) return;
  selectStrike(Number(row.dataset.strike));
});

els.chainTable.addEventListener("keydown", (event) => {
  const row = event.target.closest("tr[data-strike]");
  if (!row) return;
  const rows = [...els.chainTable.querySelectorAll("tr[data-strike]")];
  const index = rows.indexOf(row);
  if (event.key === "ArrowDown" && rows[index + 1]) {
    event.preventDefault();
    selectStrike(Number(rows[index + 1].dataset.strike), { focus: true });
  } else if (event.key === "ArrowUp" && rows[index - 1]) {
    event.preventDefault();
    selectStrike(Number(rows[index - 1].dataset.strike), { focus: true });
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    selectStrike(Number(row.dataset.strike), { focus: true });
  }
});

els.strikeMinRange.addEventListener("input", () => {
  const min = Number(els.strikeMinRange.value);
  const max = Math.max(min, Number(els.strikeMaxRange.value));
  setStrikeWindow(min, max);
});

els.strikeMaxRange.addEventListener("input", () => {
  const max = Number(els.strikeMaxRange.value);
  const min = Math.min(max, Number(els.strikeMinRange.value));
  setStrikeWindow(min, max);
});

els.strikeMinInput.addEventListener("change", () => {
  setStrikeWindow(Number(els.strikeMinInput.value), Number(els.strikeMaxInput.value));
});

els.strikeMaxInput.addEventListener("change", () => {
  setStrikeWindow(Number(els.strikeMinInput.value), Number(els.strikeMaxInput.value));
});

els.modeMultiple.addEventListener("click", () => {
  state.display = "multiple";
  els.modeMultiple.classList.add("active");
  els.modePct.classList.remove("active");
  renderHeatmap();
  syncUrl({ replace: true });
});

els.modePct.addEventListener("click", () => {
  state.display = "pct";
  els.modePct.classList.add("active");
  els.modeMultiple.classList.remove("active");
  renderHeatmap();
  syncUrl({ replace: true });
});

els.history.addEventListener("toggle", () => {
  if (!els.history.open) return;
  requestAnimationFrame(() => renderChart());
});

els.helpClose.addEventListener("click", () => els.helpModal.close());
els.helpModal.addEventListener("click", (event) => {
  if (event.target === els.helpModal) els.helpModal.close();
});

window.addEventListener("resize", () => {
  if (els.analyzer.hidden) return;
  renderPayoff();
  rebuildHeatmap();
  if (els.history.open) renderChart();
});

restoreFromUrl();
