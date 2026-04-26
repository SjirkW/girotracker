/**
 * Yahoo Finance daily-bar fetcher for Cloudflare Pages Functions.
 * Mirrors server/src/yahoo.ts but talks to Yahoo's public chart endpoint
 * directly via fetch() — no Node deps, runs on Workerd.
 */

export type YahooBar = {
  date: string; // YYYY-MM-DD
  close: number;
  high: number | null;
  low: number | null;
  currency: string | null;
};

type YahooChartResponse = {
  chart: {
    result?: Array<{
      meta?: { currency?: string };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
          high?: Array<number | null>;
          low?: Array<number | null>;
        }>;
        adjclose?: Array<{ adjclose?: Array<number | null> }>;
      };
    }>;
    error?: { code: string; description: string } | null;
  };
};

export const fetchHistorical = async (
  ticker: string,
  from: string,
  to: string,
): Promise<YahooBar[]> => {
  const period1 = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
  // chart()'s period2 is exclusive; bump by 1 day for an inclusive end.
  const period2Date = new Date(`${to}T00:00:00Z`);
  period2Date.setUTCDate(period2Date.getUTCDate() + 1);
  const period2 = Math.floor(period2Date.getTime() / 1000);

  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}` +
    `?period1=${period1}&period2=${period2}&interval=1d`;

  const res = await fetch(url, {
    headers: {
      // Yahoo sometimes 403s requests with no UA.
      "User-Agent": "Mozilla/5.0 (girotracker)",
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(`Yahoo ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as YahooChartResponse;
  if (json.chart?.error) {
    throw new Error(`Yahoo: ${json.chart.error.description}`);
  }
  const result = json.chart?.result?.[0];
  if (!result) return [];

  const currency = result.meta?.currency ?? null;
  const timestamps = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0];
  const closes = quote?.close ?? [];
  const highs = quote?.high ?? [];
  const lows = quote?.low ?? [];
  const adjcloses = result.indicators?.adjclose?.[0]?.adjclose ?? [];

  // adjclose differs from close by historical splits/dividends; high/low are
  // raw, so when we surface adjclose we scale highs/lows by the same factor
  // to keep the bar internally consistent for things like ATR.
  const bars: YahooBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const rawClose = closes[i];
    const close = adjcloses[i] ?? rawClose;
    if (close == null) continue;
    const factor = adjcloses[i] != null && rawClose != null && rawClose > 0
      ? adjcloses[i]! / rawClose
      : 1;
    const high = highs[i] != null ? highs[i]! * factor : null;
    const low = lows[i] != null ? lows[i]! * factor : null;
    bars.push({
      date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      close,
      high,
      low,
      currency,
    });
  }
  return bars;
};
