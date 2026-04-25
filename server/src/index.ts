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
import { fetchHistorical } from "./yahoo.js";

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
 * POST /api/prices
 * body: { ticker, from: "YYYY-MM-DD", to: "YYYY-MM-DD" }
 * Returns: { ticker, prices: [{ date, close, currency }] }
 *
 * Reads cache first, fetches only the missing date ranges from Yahoo, writes
 * them back, and serves the merged result. Daily TTL is implicit: prices for
 * dates <= today never need refetching, and we only ever extend the cached
 * window forward to today.
 */
app.post("/api/prices", async (req: Request, res: Response) => {
  const { ticker, from, to } = req.body ?? {};
  if (typeof ticker !== "string" || typeof from !== "string" || typeof to !== "string") {
    return res
      .status(400)
      .json({ error: "body must be { ticker: string, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }" });
  }

  const missing = computeMissingRanges(ticker, from, to);
  for (const range of missing) {
    try {
      const bars = await fetchHistorical(ticker, range.from, range.to);
      insertPrices(
        bars.map((b) => ({
          ticker,
          date: b.date,
          close: b.close,
          currency: b.currency,
        })),
      );
      recordFetch(ticker, range.from, range.to);
    } catch (err) {
      return res.status(502).json({
        error: `Yahoo fetch failed for ${ticker} ${range.from}..${range.to}: ${(err as Error).message}`,
      });
    }
  }

  const prices = getCachedPrices(ticker, from, to).map((p) => ({
    date: p.date,
    close: p.close,
    currency: p.currency,
  }));
  res.json({ ticker, prices });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`girotracker server listening on http://localhost:${port}`);
});
