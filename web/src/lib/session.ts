import type { TickerLookupResult } from "./api";
import type { Transaction } from "./parseCsv";
import type { ValuationDay } from "./portfolio";

export const STORAGE_KEY = "girotracker:session:v1";

export const BENCHMARK_TICKER = "^GSPC";
export const BENCHMARK_LABEL = "S&P 500";

export type NativePrice = {
  price: number;
  currency: string;
  atr?: number | null;
};

export type PersistedSession = {
  fileName: string | null;
  transactions: Transaction[];
  tickers: TickerLookupResult[];
  valuation: ValuationDay[];
  nativePrices?: Record<string, NativePrice>;
  benchmarkSeries?: Record<string, number>;
  /** Dividends received per calendar year, in EUR (gross, before withholding). */
  dividendsByYear?: Record<string, number>;
  /** Lifetime dividends per ISIN, in EUR (gross, before withholding). */
  dividendsByIsin?: Record<string, number>;
};

export const loadSession = (): PersistedSession | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedSession;
  } catch {
    return null;
  }
};

export const saveSession = (s: PersistedSession): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Quota exceeded or storage unavailable — fail silently.
  }
};

export const clearSession = (): void => {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
};
