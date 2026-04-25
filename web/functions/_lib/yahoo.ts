/**
 * Yahoo Finance daily-bar fetcher for Cloudflare Pages Functions.
 * Mirrors server/src/yahoo.ts but talks to Yahoo's public chart endpoint
 * directly via fetch() — no Node deps, runs on Workerd.
 */

export type YahooBar = {
  date: string; // YYYY-MM-DD
  close: number;
  currency: string | null;
};

type YahooChartResponse = {
  chart: {
    result?: Array<{
      meta?: { currency?: string };
      timestamp?: number[];
      indicators?: {
        quote?: Array<{ close?: Array<number | null> }>;
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
  const closes = result.indicators?.quote?.[0]?.close ?? [];
  const adjcloses = result.indicators?.adjclose?.[0]?.adjclose ?? [];

  const bars: YahooBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const close = adjcloses[i] ?? closes[i];
    if (close == null) continue;
    bars.push({
      date: new Date(timestamps[i] * 1000).toISOString().slice(0, 10),
      close,
      currency,
    });
  }
  return bars;
};
