import * as Calc from "./calc.js";

const POPULAR = ["AAPL", "MSFT", "NVDA", "TSLA", "AMZN", "GOOGL", "META", "SPY", "QQQ", "IWM"];

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
  periods: document.getElementById("period-toggle"),
  stats: document.getElementById("stock-stats"),
  expiry: document.getElementById("expiry-select"),
  typeCall: document.getElementById("type-call"),
  typePut: document.getElementById("type-put"),
  strike: document.getElementById("strike-select"),
  optionMeta: document.getElementById("option-meta"),
  calculate: document.getElementById("calculate-btn"),
  backTrade: document.getElementById("back-trade"),
  resultTitle: document.getElementById("result-title"),
  resultSub: document.getElementById("result-sub"),
  range: document.getElementById("range-input"),
  rangeLabel: document.getElementById("range-label"),
  modeMultiple: document.getElementById("mode-multiple"),
  modePct: document.getElementById("mode-pct"),
  ivNote: document.getElementById("result-iv"),
  heatmap: document.getElementById("heatmap"),
  status: document.getElementById("status"),
};

const state = {
  ticker: "",
  info: null,
  history: [],
  period: "3m",
  expirations: [],
  selectedExpiry: "",
  right: "call",
  calls: [],
  puts: [],
  selectedStrike: null,
  rangePct: 15,
  display: "multiple",
  term: [],
  heatmap: null,
};

function showView(name) {
  els.pick.hidden = name !== "pick";
  els.trade.hidden = name !== "trade";
  els.results.hidden = name !== "results";
}

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
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
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

function renderChart() {
  const bars = filterHistory();
  const width = Math.max(els.chart.clientWidth || 320, 280);
  const height = 140;
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
    const y = height - 10 - ((close - min) / span) * (height - 20);
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

function stat(label, value) {
  return `<div><dt>${label}</dt><dd>${value}</dd></div>`;
}

function renderQuote() {
  const { info, history } = state;
  const change = info.currentPrice - info.previousClose;
  const changePct = info.previousClose ? (change / info.previousClose) * 100 : 0;
  const hv = [...history].reverse().find((bar) => bar.historicalVolatility != null)?.historicalVolatility;
  els.tradeSymbol.textContent = info.symbol;
  els.company.textContent = info.longName;
  els.price.textContent = Calc.money(info.currentPrice);
  els.change.className = `change ${changeClass(change)}`;
  els.change.textContent = `${change >= 0 ? "+" : "−"}${Calc.money(Math.abs(change)).slice(1)} (${changePct >= 0 ? "+" : "−"}${Math.abs(changePct).toFixed(2)}%)`;
  els.hv.textContent = hv != null ? `HV ${hv.toFixed(1)}%` : "HV —";
  els.stats.innerHTML = [
    stat("Day high", Calc.money(info.dayHigh)),
    stat("Day low", Calc.money(info.dayLow)),
    stat("Volume", Calc.compactNumber(info.volume)),
    stat("Avg vol", Calc.compactNumber(info.averageVolume)),
    stat("52w high", Calc.money(info.fiftyTwoWeekHigh)),
    stat("52w low", Calc.money(info.fiftyTwoWeekLow)),
  ].join("");
  renderChart();
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
}

function renderType() {
  els.typeCall.classList.toggle("active", state.right === "call");
  els.typePut.classList.toggle("active", state.right === "put");
}

function renderStrikes() {
  const rows = currentOptions();
  const spot = state.info?.currentPrice ?? 0;
  if (!rows.length) {
    els.strike.innerHTML = "";
    els.optionMeta.innerHTML = "";
    return;
  }
  if (state.selectedStrike == null || !rows.some((row) => row.strike === state.selectedStrike)) {
    state.selectedStrike = rows[Calc.nearestIndex(rows.map((row) => row.strike), spot)].strike;
  }
  els.strike.innerHTML = rows
    .map((row) => {
      const selected = row.strike === state.selectedStrike ? "selected" : "";
      return `<option value="${row.strike}" ${selected}>${Calc.money(row.strike)} · ${row.moneyness} · IV ${row.impliedVolatility.toFixed(1)}%</option>`;
    })
    .join("");
  renderOptionMeta();
}

function renderOptionMeta() {
  const option = selectedOption();
  if (!option) {
    els.optionMeta.innerHTML = "";
    return;
  }
  const premium = Calc.optionPremium(option);
  els.optionMeta.innerHTML = [
    stat("Premium", Calc.money(premium)),
    stat("Bid / ask", quotePair(option.bid, option.ask)),
    stat("IV", `${option.impliedVolatility.toFixed(1)}%`),
    stat("Open interest", Calc.compactNumber(option.openInterest)),
  ].join("");
}

function setRange(value) {
  state.rangePct = Number(value);
  els.range.value = String(state.rangePct);
  els.rangeLabel.textContent = `±${state.rangePct}%`;
}

function renderHeatmap() {
  const grid = state.heatmap;
  if (!grid) return;
  const option = selectedOption();
  const spot = state.info.currentPrice;
  els.resultTitle.textContent = `${state.info.symbol} ${Calc.money(option.strike)} ${state.right === "call" ? "Call" : "Put"}`;
  els.resultSub.textContent = `${state.selectedExpiry} · paid ${Calc.money(grid.premium)}`;
  els.ivNote.textContent = `IV is filled from the options term structure for this strike. ${grid.kind} columns through expiry.`;

  const cols = grid.columns.length;
  els.heatmap.style.gridTemplateColumns = `minmax(52px, 17%) repeat(${cols}, minmax(0, 1fr))`;
  els.heatmap.style.gridTemplateRows = `auto repeat(${grid.rows.length}, minmax(0, 1fr))`;

  const head = [
    `<div class="cell head">Price</div>`,
    ...grid.columns.map((column) => {
      const label = Calc.formatDateLabel(column.date, Calc.todayISO(), state.selectedExpiry);
      const iv = column.ivPct != null ? `IV ${column.ivPct.toFixed(1)}%` : "IV —";
      return `<div class="cell head">${label}<small>${iv}</small></div>`;
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
  if (!option || !state.info) return;
  const { maxCols, maxRows } = Calc.tableCapacity(window.innerWidth, window.innerHeight);
  state.heatmap = Calc.buildHeatmap({
    spot: state.info.currentPrice,
    option,
    isCall: state.right === "call",
    expiry: state.selectedExpiry,
    today: Calc.todayISO(),
    term: state.term,
    rangePct: state.rangePct,
    maxRows,
    maxCols,
    strikes: currentOptions().map((row) => row.strike),
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
      els.strike.innerHTML = "";
      els.optionMeta.innerHTML = "";
      return;
    }
    await loadChain();
    setBanner(els.tradeError, "");
  } catch (error) {
    setBanner(els.pickError, error.message);
    showView("pick");
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
    const years = Math.max(Calc.yearsBetween(Calc.todayISO(), state.selectedExpiry), 2 / 365.25);
    const defaultRange = Calc.defaultRangePct(option.impliedVolatility, years);
    setRange(defaultRange);
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

renderChips();

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadTicker(els.input.value);
});

els.chips.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-ticker]");
  if (button) loadTicker(button.dataset.ticker);
});

els.backPick.addEventListener("click", () => showView("pick"));
els.backTrade.addEventListener("click", () => showView("trade"));
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
  renderStrikes();
});

els.typePut.addEventListener("click", () => {
  state.right = "put";
  renderType();
  renderStrikes();
});

els.strike.addEventListener("change", () => {
  state.selectedStrike = Number(els.strike.value);
  renderOptionMeta();
});

els.calculate.addEventListener("click", calculate);

els.range.addEventListener("input", () => {
  setRange(els.range.value);
  rebuildHeatmap();
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

window.addEventListener("resize", () => {
  if (!els.trade.hidden) renderChart();
  if (!els.results.hidden) rebuildHeatmap();
});
