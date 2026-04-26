export type TickerLookupResult = {
  isin: string;
  ticker: string | null;
  name: string | null;
  exchange: string | null;
  source: "cache" | "openfigi";
};

export type PricePoint = {
  date: string;
  close: number;
  high?: number | null;
  low?: number | null;
  currency: string | null;
};

export type PriceBatchResult = {
  ticker: string;
  prices: PricePoint[];
  error?: string;
};

const json = async <T>(res: Response): Promise<T> => {
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
};

export const resolveTickers = async (
  isins: Array<{ isin: string; beurs?: string }>,
): Promise<TickerLookupResult[]> => {
  const res = await fetch("/api/tickers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ isins }),
  });
  const out = await json<{ results: TickerLookupResult[] }>(res);
  return out.results;
};

/**
 * Fetch daily prices for many tickers in one request. The server fans out to
 * Yahoo in parallel (cache-aware) and returns one entry per ticker. Per-ticker
 * fetch failures are returned with an `error` string so a single delisted
 * symbol doesn't fail the whole batch.
 */
export const fetchPricesBatch = async (
  tickers: string[],
  from: string,
  to: string,
): Promise<PriceBatchResult[]> => {
  if (tickers.length === 0) return [];
  const res = await fetch("/api/prices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tickers, from, to }),
  });
  const out = await json<{ results: PriceBatchResult[] }>(res);
  return out.results;
};
