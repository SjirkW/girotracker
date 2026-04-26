/**
 * Cloudflare Worker entrypoint for the production deployment.
 *
 * Handles `/api/*` itself (Yahoo + OpenFIGI proxies) and delegates everything
 * else to the Static Assets binding, which serves the Vite-built SPA from
 * `web/dist`. SPA-style fallback to `/index.html` is configured via
 * `not_found_handling = "single-page-application"` in wrangler.jsonc.
 *
 * Local dev still uses the Express server in `server/`; this Worker is only
 * exercised on Cloudflare deploys (or via `wrangler dev`).
 */

import { lookupIsins } from "./lib/figi";
import { fetchHistorical, fetchQuote, type YahooQuote } from "./lib/yahoo";
import { errorResponse, jsonResponse, pMapLimit } from "./lib/util";

type AssetsBinding = { fetch: (req: Request) => Promise<Response> };

interface Env {
  ASSETS: AssetsBinding;
  OPENFIGI_API_KEY?: string;
}

type PriceBatchResult = {
  ticker: string;
  prices: Array<{
    date: string;
    close: number;
    high: number | null;
    low: number | null;
    currency: string | null;
  }>;
  error?: string;
};

const handleApi = async (
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> => {
  if (url.pathname === "/api/health" && request.method === "GET") {
    return jsonResponse({ ok: true, runtime: "cloudflare-workers" });
  }

  if (url.pathname === "/api/tickers" && request.method === "POST") {
    let body: { isins?: Array<{ isin: string; beurs?: string }> };
    try {
      body = await request.json();
    } catch {
      return errorResponse("invalid JSON body", 400);
    }
    const isins = body?.isins ?? [];
    if (!Array.isArray(isins) || isins.length === 0) {
      return errorResponse("body.isins must be a non-empty array", 400);
    }
    try {
      const looked = await lookupIsins(isins, env.OPENFIGI_API_KEY);
      const results = looked.map((r) => ({ ...r, source: "openfigi" as const }));
      return jsonResponse({ results });
    } catch (err) {
      return errorResponse(
        `OpenFIGI lookup failed: ${(err as Error).message}`,
        502,
      );
    }
  }

  if (url.pathname === "/api/prices" && request.method === "POST") {
    let body: { tickers?: unknown; from?: unknown; to?: unknown };
    try {
      body = await request.json();
    } catch {
      return errorResponse("invalid JSON body", 400);
    }
    const { tickers, from, to } = body;
    if (
      !Array.isArray(tickers) ||
      tickers.some((t) => typeof t !== "string") ||
      typeof from !== "string" ||
      typeof to !== "string"
    ) {
      return errorResponse(
        "body must be { tickers: string[], from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }",
        400,
      );
    }
    const uniqueTickers = [...new Set(tickers as string[])];
    const results = await pMapLimit<string, PriceBatchResult>(
      uniqueTickers,
      5,
      async (ticker) => {
        try {
          const bars = await fetchHistorical(ticker, from, to);
          return {
            ticker,
            prices: bars.map((b) => ({
              date: b.date,
              close: b.close,
              high: b.high,
              low: b.low,
              currency: b.currency,
            })),
          };
        } catch (err) {
          return {
            ticker,
            prices: [],
            error: `Yahoo fetch failed for ${ticker} ${from}..${to}: ${(err as Error).message}`,
          };
        }
      },
    );
    return jsonResponse({ results });
  }

  if (url.pathname === "/api/quote" && request.method === "POST") {
    let body: { tickers?: unknown };
    try {
      body = await request.json();
    } catch {
      return errorResponse("invalid JSON body", 400);
    }
    const { tickers } = body;
    if (!Array.isArray(tickers) || tickers.some((t) => typeof t !== "string")) {
      return errorResponse("body must be { tickers: string[] }", 400);
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
    return jsonResponse({ results });
  }

  return errorResponse("not found", 404);
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return handleApi(request, env, url);
    }
    return env.ASSETS.fetch(request);
  },
};
