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

export type YahooQuote = {
  symbol: string;
  price: number | null;
  previousClose: number | null;
  currency: string | null;
  marketState: string | null;
  marketTime: number | null;
  // Last ~10 trading days, oldest → newest. Used by the client to compute
  // change vs N days back (1D / 5D / 10D pickers).
  bars: Array<{ date: string; close: number }>;
};

/**
 * Latest "live" snapshot for a single ticker via the chart endpoint's meta.
 * regularMarketPrice updates intraday without needing the v7 quote endpoint's
 * crumb cookie. We pull ~10 days of 1d bars so we can derive previousClose
 * properly (Yahoo's `chartPreviousClose` field is "close before the first bar
 * of the requested range" — NOT yesterday — so we ignore it and use the last
 * bar dated strictly before the latest price's date instead).
 */
export const fetchQuote = async (ticker: string): Promise<YahooQuote> => {
  const period2 = new Date();
  const period1 = new Date();
  period1.setUTCDate(period1.getUTCDate() - 10);
  const result = await yf.chart(ticker, {
    period1: period1.toISOString(),
    period2: period2.toISOString(),
    interval: "1d",
  });
  const meta = (result.meta ?? {}) as {
    currency?: string | null;
    regularMarketPrice?: number;
    regularMarketTime?: number | Date;
    marketState?: string;
  };
  const quotes = (result.quotes ?? []) as Array<{
    date?: Date | null;
    close?: number | null;
  }>;
  const price = meta.regularMarketPrice ?? null;
  const marketTime =
    meta.regularMarketTime instanceof Date
      ? Math.floor(meta.regularMarketTime.getTime() / 1000)
      : meta.regularMarketTime ?? null;
  const marketDay =
    marketTime != null
      ? new Date(marketTime * 1000).toISOString().slice(0, 10)
      : null;
  const bars: Array<{ date: string; close: number }> = [];
  for (const q of quotes) {
    if (q.close == null || !q.date) continue;
    bars.push({ date: q.date.toISOString().slice(0, 10), close: q.close });
  }
  // Walk bars newest → oldest, picking the first close from a day strictly
  // before `marketTime`'s date. Falls back to the second-to-last bar when we
  // don't have a marketTime to anchor against.
  let previousClose: number | null = null;
  for (let i = bars.length - 1; i >= 0; i--) {
    if (marketDay == null) {
      if (i < bars.length - 1) {
        previousClose = bars[i].close;
        break;
      }
      continue;
    }
    if (bars[i].date < marketDay) {
      previousClose = bars[i].close;
      break;
    }
  }
  return {
    symbol: ticker,
    price,
    previousClose,
    currency: meta.currency ?? null,
    marketState: meta.marketState ?? null,
    marketTime,
    bars,
  };
};
