import type { YahooSearchHit } from "./yahoo";

// DEGIRO beurs → set of Yahoo internal exchange codes to prefer when ranking
// search hits. Used as a fallback when OpenFIGI orphans an ISIN.
const yahooExchByBeurs: Record<string, Set<string>> = {
  NDQ: new Set(["NMS", "NCM", "NGM"]),
  NSY: new Set(["NYQ"]),
  ASE: new Set(["ASE", "PCX"]),
  XET: new Set(["GER", "ETR"]),
  EAM: new Set(["AMS"]),
  EPA: new Set(["PAR"]),
  LSE: new Set(["LSE"]),
  OMX: new Set(["STO"]),
  TDG: new Set(["FRA"]),
};

/**
 * Pick the best Yahoo search hit for a given DEGIRO beurs hint. Prefers
 * EQUITY quotes on the user's exchange, then falls back to the first equity,
 * then the first hit overall.
 */
export const pickYahooHit = (
  hits: YahooSearchHit[],
  beurs?: string,
): YahooSearchHit | null => {
  if (hits.length === 0) return null;
  const equityHits = hits.filter((h) => h.quoteType === "EQUITY");
  const candidates = equityHits.length > 0 ? equityHits : hits;
  const preferred = beurs ? yahooExchByBeurs[beurs] : undefined;
  if (preferred) {
    const onPreferred = candidates.find(
      (h) => h.exchange && preferred.has(h.exchange),
    );
    if (onPreferred) return onPreferred;
  }
  return candidates[0];
};
