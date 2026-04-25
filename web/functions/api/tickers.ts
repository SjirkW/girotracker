import { lookupIsins } from "../_lib/figi";
import { errorResponse, jsonResponse } from "../_lib/util";

type Env = { OPENFIGI_API_KEY?: string };

interface Context {
  request: Request;
  env: Env;
}

export const onRequestPost = async (ctx: Context): Promise<Response> => {
  let body: { isins?: Array<{ isin: string; beurs?: string }> };
  try {
    body = await ctx.request.json();
  } catch {
    return errorResponse("invalid JSON body", 400);
  }
  const isins = body?.isins ?? [];
  if (!Array.isArray(isins) || isins.length === 0) {
    return errorResponse("body.isins must be a non-empty array", 400);
  }

  try {
    const looked = await lookupIsins(isins, ctx.env.OPENFIGI_API_KEY);
    // Source is always "openfigi" here — Pages Functions deployment has no
    // server-side cache. (Client-side localStorage handles persistence.)
    const results = looked.map((r) => ({ ...r, source: "openfigi" as const }));
    return jsonResponse({ results });
  } catch (err) {
    return errorResponse(
      `OpenFIGI lookup failed: ${(err as Error).message}`,
      502,
    );
  }
};
