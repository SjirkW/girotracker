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
  currency: string | null;
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

export const fetchPrices = async (
  ticker: string,
  from: string,
  to: string,
): Promise<PricePoint[]> => {
  const res = await fetch("/api/prices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, from, to }),
  });
  const out = await json<{ ticker: string; prices: PricePoint[] }>(res);
  return out.prices;
};
