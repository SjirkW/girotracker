import { fetchHistorical } from "../_lib/yahoo";
import { errorResponse, jsonResponse, pMapLimit } from "../_lib/util";

interface Context {
  request: Request;
}

type PriceBatchResult = {
  ticker: string;
  prices: Array<{ date: string; close: number; currency: string | null }>;
  error?: string;
};

export const onRequestPost = async (ctx: Context): Promise<Response> => {
  let body: { tickers?: unknown; from?: unknown; to?: unknown };
  try {
    body = await ctx.request.json();
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
};
