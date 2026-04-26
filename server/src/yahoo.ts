import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance();

export type YahooBar = {
  date: string; // YYYY-MM-DD
  close: number;
  high: number | null;
  low: number | null;
  currency: string | null;
};

/**
 * Fetch daily bars for a single ticker over [from, to] (inclusive).
 * Returns rows sorted ascending by date. Forward dates beyond Yahoo's coverage
 * are silently dropped.
 */
export const fetchHistorical = async (
  ticker: string,
  from: string,
  to: string,
): Promise<YahooBar[]> => {
  // chart()'s period2 is exclusive, so add 1 day to get an inclusive end.
  const period2 = new Date(`${to}T00:00:00Z`);
  period2.setUTCDate(period2.getUTCDate() + 1);

  const result = await yf.chart(ticker, {
    period1: `${from}T00:00:00Z`,
    period2: period2.toISOString(),
    interval: "1d",
  });

  const currency = result.meta?.currency ?? null;
  const quotes = result.quotes ?? [];
  const bars: YahooBar[] = [];
  for (const q of quotes) {
    if (!q.date) continue;
    const rawClose = q.close;
    const close = q.adjclose ?? rawClose;
    if (close == null) continue;
    // adjclose folds in splits/dividends; rescale high/low so the bar stays
    // internally consistent (matters for ATR).
    const factor =
      q.adjclose != null && rawClose != null && rawClose > 0
        ? q.adjclose / rawClose
        : 1;
    const high = q.high != null ? q.high * factor : null;
    const low = q.low != null ? q.low * factor : null;
    bars.push({
      date: new Date(q.date).toISOString().slice(0, 10),
      close,
      high,
      low,
      currency,
    });
  }
  return bars;
};
