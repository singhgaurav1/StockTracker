export type OptionRight = "call" | "put";

export type Moneyness = "ITM" | "ATM" | "OTM";

export type StockInfo = {
  longName: string;
  symbol: string;
  currentPrice: number;
  previousClose: number;
  dayHigh: number;
  dayLow: number;
  volume: number;
  averageVolume: number;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
};

export type HistoryBar = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  historicalVolatility: number | null;
};

export type OptionRow = {
  strike: number;
  lastPrice: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  impliedVolatility: number;
  moneyness: Moneyness;
};

export type StockResponse = {
  info: StockInfo;
  history: HistoryBar[];
};

export type ExpirationsResponse = {
  expirationDates: string[];
};

export type ChainResponse = {
  expirationDates: string[];
  currentPrice: number;
  calls: OptionRow[];
  puts: OptionRow[];
  atmCallIv: number | null;
  atmPutIv: number | null;
  ivSkew: number | null;
};

export type IvTermPoint = {
  date: string;
  iv: number | null;
  atmIv: number | null;
};

export type IvTermResponse = {
  ticker: string;
  expiry: string;
  strike: number;
  right: OptionRight;
  expirationDates: string[];
  term: IvTermPoint[];
};

export type ApiErrorBody = {
  error: string;
};

export type QuoteContract = {
  strike: number;
  lastPrice: number;
  bid: number;
  ask: number;
  volume: number;
  openInterest: number;
  /** Yahoo's quoted IV as a percent, before usability checks. */
  impliedVolatilityPct: number;
};

export type CompareSlot = {
  auto: boolean;
  hidden: boolean;
  empty?: boolean;
  strike?: number;
  right?: OptionRight;
  expiry?: string;
};
