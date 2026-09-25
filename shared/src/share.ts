import type { CompareSlot, OptionRight } from "./types.ts";

const PERIODS = new Set(["1m", "3m", "6m", "1y"]);

export function encodeSlot(slot: CompareSlot | undefined): string {
  if (!slot) return "";
  if (slot.hidden) return "off";
  if (slot.auto !== false) return "";
  return `${slot.strike},${slot.right},${slot.expiry}`;
}

export function parseSlot(raw: string | null): CompareSlot {
  if (!raw) return { auto: true, hidden: false };
  if (raw === "off") return { auto: false, hidden: true };
  const [strikeRaw, rightRaw, expiry] = raw.split(",");
  const strike = Number(strikeRaw);
  const right: OptionRight = rightRaw === "put" ? "put" : "call";
  if (!Number.isFinite(strike) || !/^\d{4}-\d{2}-\d{2}$/.test(expiry || "")) {
    return { auto: true, hidden: false };
  }
  return { auto: false, hidden: false, strike, right, expiry };
}

export type ShareInput = {
  ticker: string;
  selectedExpiry: string;
  right: OptionRight;
  selectedStrike: number | null;
  targetPrice: number | null;
  compare: CompareSlot[];
  period: string;
  chart: string;
  strikeMin: number | null;
  strikeMax: number | null;
  display: string;
};

export function buildShareParams(state: ShareInput): URLSearchParams {
  const params = new URLSearchParams();
  if (!state.ticker) return params;
  params.set("symbol", state.ticker);
  if (state.selectedExpiry) params.set("expiry", state.selectedExpiry);
  if (state.right) params.set("type", state.right);
  if (state.selectedStrike != null) params.set("strike", String(state.selectedStrike));
  if (state.targetPrice != null) params.set("target", String(state.targetPrice));
  const encodedB = encodeSlot(state.compare[0]);
  const encodedC = encodeSlot(state.compare[1]);
  if (encodedB) params.set("b", encodedB);
  if (encodedC) params.set("c", encodedC);
  if (state.period !== "3m") params.set("period", state.period);
  if (state.chart !== "price") params.set("chart", state.chart);
  if (state.strikeMin != null) params.set("min", String(state.strikeMin));
  if (state.strikeMax != null) params.set("max", String(state.strikeMax));
  if (state.display !== "multiple") params.set("mode", state.display);
  return params;
}

export type ShareSelection = {
  symbol: string;
  expiry?: string;
  right?: OptionRight;
  strike: number | null;
  target: number | null;
  period?: string;
  chart?: "iv" | "price";
  display?: "pct" | "multiple";
  compare: [CompareSlot, CompareSlot] | null;
  strikeMin: number | null;
  strikeMax: number | null;
};

export function readShareParams(params: URLSearchParams): ShareSelection {
  const symbol = (params.get("symbol") || params.get("ticker") || "").trim().toUpperCase();
  const type = params.get("type");
  const right: OptionRight | undefined = type === "put" ? "put" : type === "call" ? "call" : undefined;
  const strike = params.get("strike") ? Number(params.get("strike")) : null;
  const target = params.get("target") ? Number(params.get("target")) : null;
  const period = params.get("period") ?? undefined;
  const chart = params.get("chart");
  const mode = params.get("mode");
  return {
    symbol,
    expiry: params.get("expiry") || undefined,
    right,
    strike: Number.isFinite(strike) ? strike : null,
    target: Number.isFinite(target) ? target : null,
    period: period && PERIODS.has(period) ? period : undefined,
    chart: chart === "iv" || chart === "price" ? chart : undefined,
    display: mode === "pct" || mode === "multiple" ? mode : undefined,
    compare: params.has("b") || params.has("c") ? [parseSlot(params.get("b")), parseSlot(params.get("c"))] : null,
    strikeMin: params.get("min") ? Number(params.get("min")) : null,
    strikeMax: params.get("max") ? Number(params.get("max")) : null,
  };
}
