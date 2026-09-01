import * as Calc from "./calc.js";

const POPULAR = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "SPY", "QQQ", "IWM"];

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
  trade: document.getElementById("view-trade"),
  results: document.getElementById("view-results"),
  form: document.getElementById("ticker-form"),
  input: document.getElementById("ticker-input"),
  lookup: document.getElementById("lookup-btn"),
  chips: document.getElementById("popular-chips"),
  pickError: document.getElementById("pick-error"),
  tradeError: document.getElementById("trade-error"),
  backPick: document.getElementById("back-pick"),
  refresh: document.getElementById("refresh-btn"),
  tradeSymbol: document.getElementById("trade-symbol"),
  company: document.getElementById("company-name"),
  price: document.getElementById("stock-price"),
  change: document.getElementById("price-change"),
  hv: document.getElementById("hv-pill"),
  chart: document.getElementById("price-chart"),
  chartToggle: document.getElementById("chart-toggle"),
  chartCaption: document.getElementById("chart-caption"),
  periods: document.getElementById("period-toggle"),
  stats: document.getElementById("stock-stats"),
  expiry: document.getElementById("expiry-select"),
  typeCall: document.getElementById("type-call"),
  typePut: document.getElementById("type-put"),
  chainTable: document.getElementById("chain-table"),
  calculateBar: document.getElementById("calculate-bar"),
  selectedContract: document.getElementById("selected-contract"),
  selectedPremium: document.getElementById("selected-premium"),
  calculate: document.getElementById("calculate-btn"),
  backTrade: document.getElementById("back-trade"),
  resultTitle: document.getElementById("result-title"),
  resultSub: document.getElementById("result-sub"),
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
  heatmap: null,
  view: "pick",
};

function showView(name, { push = true } = {}) {
  state.view = name;
  els.pick.hidden = name !== "pick";
  els.trade.hidden = name !== "trade";
  els.results.hidden = name !== "results";
  document.body.dataset.view = name;
  if (push) {
    const url = name === "pick" ? `${location.pathname}${location.search}` : `#${name}`;
    history.pushState({ view: name }, "", url);
  }
  updateBottomBar();
}

function goBack() {
  if (history.length > 1) {
    history.back();
    return;
  }
  if (state.view === "results") showView("trade", { push: false });
  else if (state.view === "trade") showView("pick", { push: false });
}

window.addEventListener("popstate", (event) => {
  const view = event.state?.view ?? "pick";
  showView(view, { push: false });
});

history.replaceState({ view: "pick" }, "", `${location.pathname}${location.search}`);
if (location.hash === "#trade") showView("trade", { push: false });
else if (location.hash === "#results") showView("results", { push: false });

function toast(message) {
  els.status.hidden = !message;
  els.status.textContent = message || "";
}

function setBanner(el, message) {
  el.hidden = !message;
  el.textContent = message || "";
}

async function api(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}

function pickDefaultExpiry(dates) {
  const today = Calc.todayISO();
  const ranked = dates.map((date) => ({ date, dte: Calc.daysBetween(today, date) }));
  return ranked.find((row) => row.dte >= 14)?.date
    ?? ranked.find((row) => row.dte >= 7)?.date
    ?? dates[0]
    ?? "";
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

function renderChips() {
  els.chips.innerHTML = POPULAR.map(
    (ticker) => `<button type="button" data-ticker="${ticker}">${ticker}</button>`,
  ).join("");
}

function filterHistory() {
  const days = { "1m": 31, "3m": 93, "6m": 186, "1y": 400 }[state.period] ?? 93;
  const cutoff = Date.now() - days * 86400000;
  return state.history.filter((bar) => Date.parse(bar.date) >= cutoff);
}

function latestHv() {
  return [...state.history].reverse().find((bar) => bar.historicalVolatility != null)?.historicalVolatility ?? null;
}

function currentAtmIv() {
  return state.right === "put" ? state.atmPutIv : state.atmCallIv;
}

function chartHeight() {
  return window.innerWidth < 720 ? 88 : 120;
}

function renderChart() {
  if (state.chart === "iv") renderIvChart();
  else renderPriceChart();
}

function renderPriceChart() {
  const bars = filterHistory();
  const width = Math.max(els.chart.clientWidth || 320, 280);
  const height = chartHeight();
  els.chartCaption.textContent = "";
  if (bars.length < 2) {
    els.chart.innerHTML = "";
    return;
  }
  const closes = bars.map((bar) => bar.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const span = max - min || 1;
  const coords = closes.map((close, index) => {
    const x = (index / (closes.length - 1)) * width;
    const y = height - 8 - ((close - min) / span) * (height - 16);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const line = `M${coords.join(" L")}`;
  const area = `${line} L${width},${height} L0,${height} Z`;
  const up = (state.info?.currentPrice ?? 0) >= (state.info?.previousClose ?? 0);
  const color = up ? "#3ddc91" : "#ff6b6b";
  els.chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Price chart">
      <defs>
        <linearGradient id="fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${color}" stop-opacity="0.35" />
          <stop offset="100%" stop-color="${color}" stop-opacity="0.02" />
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#fill)"></path>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"></path>
    </svg>
  `;
}

function renderIvChart() {
  const bars = filterHistory().filter((bar) => bar.historicalVolatility != null);
  const width = Math.max(els.chart.clientWidth || 320, 280);
  const height = chartHeight();
  const atmIv = currentAtmIv();
  const hvNow = bars.length ? bars[bars.length - 1].historicalVolatility : null;
  els.chartCaption.textContent = [
    hvNow != null ? `HV ${hvNow.toFixed(1)}%` : null,
    atmIv != null ? `ATM IV ${atmIv.toFixed(1)}%` : null,
  ].filter(Boolean).join(" · ");
  if (bars.length < 2) {
    els.chart.innerHTML = `<p class="chain-empty">Not enough history yet.</p>`;
    return;
  }
  const values = bars.map((bar) => bar.historicalVolatility);
  if (atmIv != null) values.push(atmIv);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.12, 1);
  const lo = Math.max(0, min - pad);
  const hi = max + pad;
  const span = hi - lo || 1;
  const yOf = (value) => height - 10 - ((value - lo) / span) * (height - 20);
  const coords = bars.map((bar, index) => {
    const x = (index / (bars.length - 1)) * width;
    return `${x.toFixed(1)},${yOf(bar.historicalVolatility).toFixed(1)}`;
  });
  const line = `M${coords.join(" L")}`;
  const area = `${line} L${width},${height} L0,${height} Z`;
  const atmLine = atmIv != null ? `
    <line x1="0" x2="${width}" y1="${yOf(atmIv).toFixed(1)}" y2="${yOf(atmIv).toFixed(1)}" stroke="#f0c35b" stroke-width="1.5" stroke-dasharray="5 4" vector-effect="non-scaling-stroke" />
  ` : "";
  els.chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Historical implied volatility">
      <defs>
        <linearGradient id="iv-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#8b7cff" stop-opacity="0.38" />
          <stop offset="100%" stop-color="#8b7cff" stop-opacity="0.03" />
        </linearGradient>
      </defs>
      <path d="${area}" fill="url(#iv-fill)"></path>
      <path d="${line}" fill="none" stroke="#b7adff" stroke-width="2" vector-effect="non-scaling-stroke"></path>
      ${atmLine}
    </svg>
  `;
}

function stat(label, value) {
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

function renderQuote() {
  const { info } = state;
  const change = info.currentPrice - info.previousClose;
  const changePct = info.previousClose ? (change / info.previousClose) * 100 : 0;
  const hv = latestHv();
  const atmIv = currentAtmIv();
  els.tradeSymbol.textContent = info.symbol;
  els.company.textContent = info.longName;
  els.price.textContent = Calc.money(info.currentPrice);
  els.change.className = `change ${changeClass(change)}`;
  els.change.textContent = `${change >= 0 ? "+" : "−"}${Calc.money(Math.abs(change)).slice(1)} (${changePct >= 0 ? "+" : "−"}${Math.abs(changePct).toFixed(2)}%)`;
  els.hv.textContent = [
    hv != null ? `HV ${hv.toFixed(1)}%` : "HV —",
    atmIv != null ? `IV ${atmIv.toFixed(1)}%` : null,
  ].filter(Boolean).join(" · ");
  els.stats.innerHTML = [
    stat("High", Calc.money(info.dayHigh)),
    stat("Low", Calc.money(info.dayLow)),
    stat("Vol", Calc.compactNumber(info.volume)),
    stat("52w", `${Calc.money(info.fiftyTwoWeekLow, 0)}–${Calc.money(info.fiftyTwoWeekHigh, 0)}`),
  ].join("");
  renderChart();
}

function expiryLabel(date) {
  const dte = Calc.daysBetween(Calc.todayISO(), date);
  const pretty = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
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

function headerCell(column) {
  if (column.helpKey) {
    return `<th><button type="button" class="th-help" data-help="${column.helpKey}">${column.label}</button></th>`;
  }
  return `<th>${column.label}</th>`;
}

function renderStrikes() {
  const rows = currentOptions();
  const spot = state.info?.currentPrice ?? 0;
  const thead = els.chainTable.querySelector("thead");
  const tbody = els.chainTable.querySelector("tbody");
  if (!rows.length) {
    thead.innerHTML = "";
    tbody.innerHTML = `<tr><td class="chain-empty" colspan="6">No contracts for this expiration.</td></tr>`;
    updateBottomBar();
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
  updateBottomBar();
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

function updateBottomBar() {
  const option = selectedOption();
  const show = state.view === "trade" && option != null;
  els.calculateBar.hidden = !show;
  if (!show) return;
  const premium = Calc.optionPremium(option);
  els.selectedContract.textContent = `${Calc.money(option.strike)} ${state.right === "call" ? "Call" : "Put"}`;
  els.selectedPremium.textContent = premium > 0 ? `Premium ${Calc.money(premium)}` : "No premium yet";
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
}

function typicalStrikeStep() {
  const strikes = chainStrikes();
  if (strikes.length < 2) return 0.5;
  const step = Calc.typicalStep(strikes);
  return step >= 1 ? step : 0.5;
}

function setStrikeWindow(minStrike, maxStrike, { rebuild = true } = {}) {
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

function renderHeatmap() {
  const grid = state.heatmap;
  if (!grid) return;
  const option = selectedOption();
  const spot = state.info.currentPrice;
  els.resultTitle.textContent = `${state.info.symbol} ${Calc.money(option.strike)} ${state.right === "call" ? "Call" : "Put"}`;
  els.resultSub.textContent = `${state.selectedExpiry} · paid ${Calc.money(grid.premium)}`;

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

async function loadTicker(ticker) {
  const symbol = ticker.trim().toUpperCase();
  if (!symbol) return;
  els.lookup.disabled = true;
  els.refresh.disabled = true;
  setBanner(els.pickError, "");
  toast("Loading stock…");
  try {
    const [stock, expirationsPayload] = await Promise.all([
      api(`/api/stock?ticker=${encodeURIComponent(symbol)}`),
      api(`/api/options?ticker=${encodeURIComponent(symbol)}`),
    ]);
    state.ticker = symbol;
    state.info = stock.info;
    state.history = stock.history ?? [];
    state.expirations = expirationsPayload.expirationDates ?? [];
    state.selectedExpiry = pickDefaultExpiry(state.expirations);
    state.selectedStrike = null;
    state.heatmap = null;
    els.input.value = symbol;
    renderQuote();
    renderExpiries();
    renderType();
    showView("trade");
    if (!state.selectedExpiry) {
      setBanner(els.tradeError, "No options are listed for this ticker.");
      els.chainTable.querySelector("thead").innerHTML = "";
      els.chainTable.querySelector("tbody").innerHTML = "";
      return;
    }
    await loadChain();
    setBanner(els.tradeError, "");
  } catch (error) {
    setBanner(els.pickError, error.message);
    showView("pick", { push: false });
  } finally {
    els.lookup.disabled = false;
    els.refresh.disabled = false;
    toast("");
  }
}

async function loadChain() {
  toast("Loading options…");
  const payload = await api(
    `/api/options?ticker=${encodeURIComponent(state.ticker)}&date=${encodeURIComponent(state.selectedExpiry)}`,
  );
  state.calls = payload.calls ?? [];
  state.puts = payload.puts ?? [];
  state.atmCallIv = payload.atmCallIv ?? null;
  state.atmPutIv = payload.atmPutIv ?? null;
  renderQuote();
  renderStrikes();
  toast("");
}

async function calculate() {
  const option = selectedOption();
  if (!option) {
    setBanner(els.tradeError, "Select a call or put strike first.");
    return;
  }
  if (!Calc.optionPremium(option)) {
    setBanner(els.tradeError, "That option has no usable premium yet.");
    return;
  }
  els.calculate.disabled = true;
  toast("Calculating…");
  try {
    const payload = await api(
      `/api/iv-term?ticker=${encodeURIComponent(state.ticker)}&expiry=${encodeURIComponent(state.selectedExpiry)}&strike=${encodeURIComponent(option.strike)}&right=${encodeURIComponent(state.right)}`,
    );
    state.term = payload.term ?? [];
    initStrikeWindow(option);
    rebuildHeatmap();
    showView("results");
    setBanner(els.tradeError, "");
  } catch (error) {
    setBanner(els.tradeError, error.message);
  } finally {
    els.calculate.disabled = false;
    toast("");
  }
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

els.chips.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-ticker]");
  if (button) loadTicker(button.dataset.ticker);
});

els.backPick.addEventListener("click", goBack);
els.backTrade.addEventListener("click", goBack);
els.refresh.addEventListener("click", () => loadTicker(state.ticker));

els.periods.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-period]");
  if (!button) return;
  state.period = button.dataset.period;
  [...els.periods.querySelectorAll("button")].forEach((node) => node.classList.toggle("active", node === button));
  renderChart();
});

els.expiry.addEventListener("change", async () => {
  state.selectedExpiry = els.expiry.value;
  state.selectedStrike = null;
  try {
    await loadChain();
  } catch (error) {
    setBanner(els.tradeError, error.message);
  }
});

els.typeCall.addEventListener("click", () => {
  state.right = "call";
  renderType();
  renderQuote();
  renderStrikes();
});

els.typePut.addEventListener("click", () => {
  state.right = "put";
  renderType();
  renderQuote();
  renderStrikes();
});

els.chartToggle.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-chart]");
  if (!button) return;
  state.chart = button.dataset.chart;
  [...els.chartToggle.querySelectorAll("button")].forEach((node) => node.classList.toggle("active", node === button));
  renderChart();
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

function selectStrike(strike, { focus = false } = {}) {
  if (!Number.isFinite(strike)) return;
  state.selectedStrike = strike;
  renderStrikes();
  if (focus) els.chainTable.querySelector("tr.selected")?.focus();
}

els.calculate.addEventListener("click", calculate);

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
});

els.modePct.addEventListener("click", () => {
  state.display = "pct";
  els.modePct.classList.add("active");
  els.modeMultiple.classList.remove("active");
  renderHeatmap();
});

els.helpClose.addEventListener("click", () => els.helpModal.close());
els.helpModal.addEventListener("click", (event) => {
  if (event.target === els.helpModal) els.helpModal.close();
});

window.addEventListener("resize", () => {
  if (!els.trade.hidden) renderChart();
  if (!els.results.hidden) rebuildHeatmap();
});
