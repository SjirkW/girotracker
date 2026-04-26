import express, { type Request, type Response } from "express";
import cors from "cors";
import { db } from "./db.js";
import {
  computeMissingRanges,
  getCachedIsin,
  getCachedPrices,
  insertPrices,
  recordFetch,
  upsertIsin,
} from "./cache.js";
import { lookupIsins } from "./figi.js";
import { fetchHistorical, fetchQuote, type YahooQuote } from "./yahoo.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_req, res) => {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table'")
    .all();
  res.json({ ok: true, tables });
});

/**
 * POST /api/tickers
 * body: { isins: [{ isin, beurs?, name? }] }
 * Returns: { results: [{ isin, ticker, name, exchange, source }] }
 *
 * Cached entries (including null tickers from prior failed lookups) are served
 * from SQLite; misses go to OpenFIGI in batched requests.
 */
app.post("/api/tickers", async (req: Request, res: Response) => {
  const isins: Array<{ isin: string; beurs?: string; name?: string }> =
    req.body?.isins ?? [];
  if (!Array.isArray(isins) || isins.length === 0) {
    return res.status(400).json({ error: "body.isins must be a non-empty array" });
  }

  const results: Array<{
    isin: string;
    ticker: string | null;
    name: string | null;
    exchange: string | null;
    source: "cache" | "openfigi";
  }> = [];
  const misses: Array<{ isin: string; beurs?: string }> = [];

  for (const entry of isins) {
    const cached = getCachedIsin(entry.isin);
    if (cached) {
      results.push({
        isin: cached.isin,
        ticker: cached.ticker,
        name: cached.name,
        exchange: cached.exchange,
        source: "cache",
      });
    } else {
      misses.push({ isin: entry.isin, beurs: entry.beurs });
    }
  }

  if (misses.length > 0) {
    try {
      const looked = await lookupIsins(misses);
      for (const r of looked) {
        upsertIsin({
          isin: r.isin,
          ticker: r.ticker,
          name: r.name,
          exchange: r.exchange,
        });
        results.push({ ...r, source: "openfigi" });
      }
    } catch (err) {
      return res
        .status(502)
        .json({ error: `OpenFIGI lookup failed: ${(err as Error).message}` });
    }
  }

  res.json({ results });
});

/**
 * Run async work over `items` with at most `limit` in flight at once. Used to
 * fan-out per-ticker price fetches without hammering Yahoo.
 */
async function pMapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        results[i] = await fn(items[i], i);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * POST /api/prices
 * body: { tickers: string[], from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 * Returns: { results: [{ ticker, prices: [{ date, close, currency }], error? }] }
 *
 * Batched: caller asks for many tickers in one request, server fans out to
 * Yahoo in parallel (capped). Per-ticker errors are returned in-band so one
 * delisted symbol doesn't fail the whole batch.
 *
 * Cache behaviour: per ticker we read from SQLite, fetch only the missing
 * date ranges from Yahoo, write them back, and return the merged result.
 * Prices for dates <= today are treated as final (we only ever extend the
 * cached window forward).
 */
app.post("/api/prices", async (req: Request, res: Response) => {
  const { tickers, from, to } = req.body ?? {};
  if (
    !Array.isArray(tickers) ||
    tickers.some((t) => typeof t !== "string") ||
    typeof from !== "string" ||
    typeof to !== "string"
  ) {
    return res.status(400).json({
      error:
        "body must be { tickers: string[], from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }",
    });
  }

  const uniqueTickers = [...new Set(tickers as string[])];

  const results = await pMapLimit(uniqueTickers, 5, async (ticker) => {
    const missing = computeMissingRanges(ticker, from, to);
    for (const range of missing) {
      try {
        const bars = await fetchHistorical(ticker, range.from, range.to);
        insertPrices(
          bars.map((b) => ({
            ticker,
            date: b.date,
            close: b.close,
            high: b.high,
            low: b.low,
            currency: b.currency,
          })),
        );
        recordFetch(ticker, range.from, range.to);
      } catch (err) {
        return {
          ticker,
          prices: [],
          error: `Yahoo fetch failed for ${ticker} ${range.from}..${range.to}: ${(err as Error).message}`,
        };
      }
    }
    const prices = getCachedPrices(ticker, from, to).map((p) => ({
      date: p.date,
      close: p.close,
      high: p.high,
      low: p.low,
      currency: p.currency,
    }));
    return { ticker, prices };
  });

  res.json({ results });
});

/**
 * POST /api/quote
 * body: { tickers: string[] }
 * Returns: { results: [{ symbol, price, previousClose, currency, marketState, marketTime, error? }] }
 *
 * Live (intraday) snapshot per ticker. NOT cached — every call hits Yahoo,
 * since the whole point is "what's the current price". Per-ticker errors are
 * returned in-band.
 */
app.post("/api/quote", async (req: Request, res: Response) => {
  const { tickers } = req.body ?? {};
  if (!Array.isArray(tickers) || tickers.some((t) => typeof t !== "string")) {
    return res.status(400).json({
      error: "body must be { tickers: string[] }",
    });
  }
  const uniqueTickers = [...new Set(tickers as string[])];
  const results = await pMapLimit<string, YahooQuote & { error?: string }>(
    uniqueTickers,
    8,
    async (ticker) => {
      try {
        return await fetchQuote(ticker);
      } catch (err) {
        return {
          symbol: ticker,
          price: null,
          previousClose: null,
          currency: null,
          marketState: null,
          marketTime: null,
          bars: [],
          error: `Yahoo quote failed for ${ticker}: ${(err as Error).message}`,
        };
      }
    },
  );
  res.json({ results });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`girotracker server listening on http://localhost:${port}`);
});
