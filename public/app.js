const state = {
  ticker: "AAPL",
  info: null,
  history: [],
  expirations: [],
  selectedDate: null,
  calls: [],
  puts: [],
  selectedCall: 0,
  selectedPut: 0,
};

const els = {
  form: document.getElementById("ticker-form"),
  input: document.getElementById("ticker-input"),
  refresh: document.getElementById("refresh-btn"),
  status: document.getElementById("status"),
  error: document.getElementById("error"),
  app: document.getElementById("app"),
  expiry: document.getElementById("expiry-select"),
  callSelect: document.getElementById("call-select"),
  putSelect: document.getElementById("put-select"),
  calcCall: document.getElementById("calc-call"),
  calcPut: document.getElementById("calc-put"),
};

function money(value) {
  return `$${Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function compact(value) {
  return Number(value).toLocaleString();
}

function formatChange(change, percentage = false) {
  const formatted = percentage ? `${change.toFixed(2)}%` : money(change);
  if (change > 0) return `<span class="price-change-positive">+${formatted}</span>`;
  if (change < 0) return `<span class="price-change-negative">${formatted}</span>`;
  return formatted;
}

function showStatus(message) {
  els.status.hidden = !message;
  els.status.textContent = message;
}

function showError(message) {
  els.error.hidden = !message;
  els.error.textContent = message;
}

async function api(path) {
  const response = await fetch(path);
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }
  return data;
}

function layout() {
  return {
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    font: { color: "#262730" },
    margin: { l: 48, r: 16, t: 36, b: 40 },
    legend: { orientation: "h" },
  };
}

function renderStock() {
  const { info, history } = state;
  document.getElementById("company-name").textContent = `${info.longName} (${info.symbol})`;
  document.getElementById("stock-price").textContent = money(info.currentPrice);
  const change = info.currentPrice - info.previousClose;
  const changePct = info.previousClose ? (change / info.previousClose) * 100 : 0;
  document.getElementById("price-change").innerHTML = `${formatChange(change)} (${formatChange(changePct, true)})`;
  document.getElementById("day-high").textContent = money(info.dayHigh);
  document.getElementById("day-low").textContent = money(info.dayLow);
  document.getElementById("volume").textContent = compact(info.volume);
  document.getElementById("avg-volume").textContent = compact(info.averageVolume);

  const hv = history.filter((bar) => bar.historicalVolatility != null);
  const currentHv = hv.at(-1)?.historicalVolatility;
  document.getElementById("current-hv").textContent = currentHv != null ? `${currentHv.toFixed(2)}%` : "N/A";

  Plotly.react("hv-chart", [{
    x: hv.map((bar) => bar.date),
    y: hv.map((bar) => bar.historicalVolatility),
    name: "30-Day Historical Volatility",
    line: { color: "#1e88e5" },
  }], {
    ...layout(),
    title: "Historical Volatility (30-Day)",
    xaxis: { title: "Date" },
    yaxis: { title: "Volatility (%)" },
    height: 300,
  }, { displayModeBar: false, responsive: true });

  Plotly.react("price-chart", [{
    x: history.map((bar) => bar.date),
    open: history.map((bar) => bar.open),
    high: history.map((bar) => bar.high),
    low: history.map((bar) => bar.low),
    close: history.map((bar) => bar.close),
    type: "candlestick",
    increasing: { line: { color: "#4caf50" } },
    decreasing: { line: { color: "#f44336" } },
  }], {
    ...layout(),
    xaxis: { title: "Date", rangeslider: { visible: false } },
    yaxis: { title: "Price ($)" },
    height: 500,
  }, { displayModeBar: false, responsive: true });
}

function optionLabel(row) {
  return `Strike: ${money(row.strike)} - IV: ${row.impliedVolatility.toFixed(1)}%`;
}

function renderTable(targetId, rows, selectedIndex) {
  const columns = ["strike", "lastPrice", "bid", "ask", "volume", "openInterest", "impliedVolatility", "moneyness"];
  const labels = ["Strike", "Last", "Bid", "Ask", "Volume", "OI", "IV", "Moneyness"];
  const moneyCols = new Set(["strike", "lastPrice", "bid", "ask"]);
  const html = `
    <table>
      <thead><tr>${labels.map((label) => `<th>${label}</th>`).join("")}</tr></thead>
      <tbody>
        ${rows.map((row, index) => `
          <tr class="${index === selectedIndex ? "selected" : ""}">
            ${columns.map((col) => {
              let value = row[col];
              if (moneyCols.has(col)) value = money(value);
              else if (col === "impliedVolatility") value = `${Number(value).toFixed(2)}%`;
              else if (typeof value === "number") value = compact(value);
              return `<td>${value}</td>`;
            }).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
  document.getElementById(targetId).innerHTML = html;
}

function renderSmile() {
  const rangeLow = state.info.currentPrice * 0.8;
  const rangeHigh = state.info.currentPrice * 1.2;
  const calls = state.calls.filter((row) => row.strike >= rangeLow && row.strike <= rangeHigh);
  const puts = state.puts.filter((row) => row.strike >= rangeLow && row.strike <= rangeHigh);
  Plotly.react("smile-chart", [
    {
      x: calls.map((row) => row.strike),
      y: calls.map((row) => row.impliedVolatility),
      name: "Calls IV",
      mode: "lines+markers",
      marker: { size: 6, color: "blue" },
      line: { color: "blue" },
    },
    {
      x: puts.map((row) => row.strike),
      y: puts.map((row) => row.impliedVolatility),
      name: "Puts IV",
      mode: "lines+markers",
      marker: { size: 6, color: "red" },
      line: { color: "red" },
    },
  ], {
    ...layout(),
    title: "Volatility Smile",
    xaxis: { title: "Strike Price ($)" },
    yaxis: { title: "Implied Volatility (%)" },
    height: 300,
  }, { displayModeBar: false, responsive: true });
}

function fillSelect(select, rows, selectedIndex, formatter) {
  select.innerHTML = rows.map((row, index) =>
    `<option value="${index}" ${index === selectedIndex ? "selected" : ""}>${formatter(row)}</option>`
  ).join("");
}

function metric(id, value) {
  document.getElementById(id).textContent = value == null ? "N/A" : `${Number(value).toFixed(2)}%`;
}

function renderOptions(payload) {
  state.calls = payload.calls ?? [];
  state.puts = payload.puts ?? [];
  state.selectedCall = 0;
  state.selectedPut = 0;
  metric("atm-call-iv", payload.atmCallIv);
  metric("atm-put-iv", payload.atmPutIv);
  metric("iv-skew", payload.ivSkew);
  fillSelect(els.callSelect, state.calls, 0, optionLabel);
  fillSelect(els.putSelect, state.puts, 0, optionLabel);
  renderTable("calls-table", state.calls, 0);
  renderTable("puts-table", state.puts, 0);
  renderSmile();
  document.getElementById("call-profit").innerHTML = "";
  document.getElementById("put-profit").innerHTML = "";
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const abs = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * abs);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-abs * abs);
  return sign * y;
}

function normCdf(x) {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function blackScholes(spot, strike, years, rate, sigma, isCall) {
  if (years <= 0) return Math.max(isCall ? spot - strike : strike - spot, 0);
  if (sigma <= 0) return Math.max(isCall ? spot - strike : strike - spot, 0);
  const d1 = (Math.log(spot / strike) + (rate + (sigma ** 2) / 2) * years) / (sigma * Math.sqrt(years));
  const d2 = d1 - sigma * Math.sqrt(years);
  if (isCall) return spot * normCdf(d1) - strike * Math.exp(-rate * years) * normCdf(d2);
  return strike * Math.exp(-rate * years) * normCdf(-d2) - spot * normCdf(-d1);
}

function monthsToExpiry(dateStr) {
  const today = new Date();
  const expiry = new Date(`${dateStr}T00:00:00`);
  const days = Math.max(1, Math.round((expiry - today) / 86400000));
  return Math.max(1, Math.round(days / 30));
}

function monthHeaders(count) {
  const headers = [];
  const now = new Date();
  for (let i = 1; i <= count; i += 1) {
    const next = new Date(now);
    next.setDate(now.getDate() + 30 * i);
    headers.push(next.toLocaleString("en-US", { month: "short", year: "numeric" }));
  }
  return headers;
}

function profitColor(value) {
  const intensity = Math.min(Math.abs(value) / 200, 1);
  if (value > 0) return `rgba(0, 255, 0, ${intensity})`;
  if (value < 0) return `rgba(255, 0, 0, ${intensity})`;
  return "transparent";
}

function renderProfit(targetId, option, isCall) {
  const optionPrice = option.lastPrice || (option.bid + option.ask) / 2;
  if (!optionPrice) {
    document.getElementById(targetId).innerHTML = "<p class='error'>Selected option has no price.</p>";
    return;
  }
  const months = monthsToExpiry(state.selectedDate);
  const headers = monthHeaders(months);
  const iv = option.impliedVolatility / 100;
  const rows = [];
  for (let pct = -100; pct <= 100; pct += 5) {
    const price = option.strike * (1 + pct / 100);
    if (price <= 0) continue;
    const values = headers.map((_, index) => {
      const value = blackScholes(price, option.strike, (index + 1) / 12, 0.05, iv, isCall);
      return ((value - optionPrice) / optionPrice) * 100;
    });
    rows.push({ price, pct, values });
  }

  document.getElementById(targetId).innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Price</th>
          <th>% Change</th>
          ${headers.map((header) => `<th>${header}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td>${money(row.price)}</td>
            <td>${row.pct}%</td>
            ${row.values.map((value) => `<td style="background:${profitColor(value)}">${value.toFixed(1)}%</td>`).join("")}
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

async function loadTicker(ticker) {
  state.ticker = ticker.toUpperCase();
  els.input.value = state.ticker;
  els.refresh.disabled = true;
  showError("");
  showStatus("Loading data...");
  try {
    const [stock, expirationsPayload] = await Promise.all([
      api(`/api/stock?ticker=${encodeURIComponent(state.ticker)}`),
      api(`/api/options?ticker=${encodeURIComponent(state.ticker)}`),
    ]);
    state.info = stock.info;
    state.history = stock.history;
    state.expirations = expirationsPayload.expirationDates ?? [];
    els.app.hidden = false;
    renderStock();

    if (!state.expirations.length) {
      els.expiry.innerHTML = "";
      document.getElementById("calls-table").innerHTML = "";
      document.getElementById("puts-table").innerHTML = "";
      Plotly.purge("smile-chart");
      showError("No options data available for this ticker.");
      return;
    }

    state.selectedDate = state.expirations[0];
    fillSelect(els.expiry, state.expirations, 0, (date) => date);
    const chain = await api(`/api/options?ticker=${encodeURIComponent(state.ticker)}&date=${state.selectedDate}`);
    renderOptions(chain);
    showStatus("");
  } catch (error) {
    els.app.hidden = true;
    showError(`${error.message} Please check the ticker symbol and try again.`);
  } finally {
    els.refresh.disabled = false;
    if (!els.error.hidden && els.status.textContent === "Loading data...") {
      showStatus("");
    }
  }
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  loadTicker(els.input.value.trim() || "AAPL");
});

els.expiry.addEventListener("change", async () => {
  state.selectedDate = els.expiry.value;
  showStatus("Loading options...");
  try {
    const chain = await api(`/api/options?ticker=${encodeURIComponent(state.ticker)}&date=${state.selectedDate}`);
    renderOptions(chain);
    showStatus("");
  } catch (error) {
    showError(error.message);
  }
});

els.callSelect.addEventListener("change", () => {
  state.selectedCall = Number(els.callSelect.value);
  renderTable("calls-table", state.calls, state.selectedCall);
});

els.putSelect.addEventListener("change", () => {
  state.selectedPut = Number(els.putSelect.value);
  renderTable("puts-table", state.puts, state.selectedPut);
});

els.calcCall.addEventListener("click", () => {
  const option = state.calls[state.selectedCall];
  if (option) renderProfit("call-profit", option, true);
});

els.calcPut.addEventListener("click", () => {
  const option = state.puts[state.selectedPut];
  if (option) renderProfit("put-profit", option, false);
});

loadTicker("AAPL");
