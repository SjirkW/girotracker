import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance();

export type YahooBar = {
  date: string; // YYYY-MM-DD
  close: number;
  open: number | null;
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
    // adjclose folds in splits/dividends; rescale OHL so the bar stays
    // internally consistent (matters for ATR + candle plotting).
    const factor =
      q.adjclose != null && rawClose != null && rawClose > 0
        ? q.adjclose / rawClose
        : 1;
    const open = q.open != null ? q.open * factor : null;
    const high = q.high != null ? q.high * factor : null;
    const low = q.low != null ? q.low * factor : null;
    bars.push({
      date: new Date(q.date).toISOString().slice(0, 10),
      close,
      open,
      high,
      low,
      currency,
    });
  }
  return bars;
};

export type YahooBarPoint = {
  time: string; // ISO timestamp; second-precision works for both intraday and daily
  open: number | null;
  high: number | null;
  low: number | null;
  close: number;
};

/**
 * OHLC bars at any (interval, range) Yahoo supports. NOT cached: this powers
 * the candles tab where the user picks the granularity, and our SQLite cache
 * is keyed (ticker, date) which collides for intraday.
 *
 * Bypasses yahoo-finance2's typed wrapper and goes through the raw URL since
 * the typed `chart()` narrows interval to a small set.
 */
export const fetchBars = async (
  ticker: string,
  interval: string,
  range: string,
): Promise<YahooBarPoint[]> => {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (girotracker)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Yahoo ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as {
    chart: {
      result?: Array<{
        timestamp?: number[];
        indicators?: {
          quote?: Array<{
            close?: Array<number | null>;
            open?: Array<number | null>;
            high?: Array<number | null>;
            low?: Array<number | null>;
          }>;
        };
      }>;
      error?: { description: string } | null;
    };
  };
  if (json.chart?.error) throw new Error(`Yahoo: ${json.chart.error.description}`);
  const result = json.chart?.result?.[0];
  if (!result) return [];
  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0];
  const bars: YahooBarPoint[] = [];
  for (let i = 0; i < ts.length; i++) {
    const close = q?.close?.[i];
    if (close == null) continue;
    bars.push({
      time: new Date(ts[i] * 1000).toISOString(),
      open: q?.open?.[i] ?? null,
      high: q?.high?.[i] ?? null,
      low: q?.low?.[i] ?? null,
      close,
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
