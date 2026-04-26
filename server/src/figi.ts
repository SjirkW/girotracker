/**
 * OpenFIGI ISIN → ticker lookup.
 *
 * No API key: 25 requests/minute, max 10 jobs per request. With a key (set
 * OPENFIGI_API_KEY env var): 25 requests/6 seconds, 100 jobs per request.
 *
 * We map OpenFIGI's exchange code to a Yahoo Finance suffix so the resulting
 * ticker can be queried against Yahoo directly.
 */

const FIGI_URL = "https://api.openfigi.com/v3/mapping";

type FigiRequest = {
  idType: "ID_ISIN";
  idValue: string;
};

type FigiHit = {
  figi: string;
  ticker: string;
  name?: string;
  exchCode?: string;
  micCode?: string;
  marketSector?: string;
  securityType?: string;
  securityType2?: string;
};

type FigiResponse = Array<
  { data: FigiHit[] } | { warning: string } | { error: string }
>;

// DEGIRO "Beurs" → set of OpenFIGI exchange codes to PREFER when ranking
// candidates. We send no exchCode in the request (too strict — composite
// codes like "GY" return zero hits for ETFs that only list on per-floor
// codes like GR/GD/GS/GM). Instead we get all hits and bias selection.
const beursPreferredExch: Record<string, Set<string>> = {
  NDQ: new Set(["US", "UW", "UQ"]),
  NSY: new Set(["US", "UN"]),
  ASE: new Set(["US", "UA"]),
  XET: new Set(["GY", "GR", "GD", "GS", "GM", "GT", "GF"]),
  TDG: new Set(["GR", "GF", "GY"]),
  OMX: new Set(["SS"]),
  EAM: new Set(["NA"]),
  EPA: new Set(["FP"]),
  LSE: new Set(["LN"]),
};

// DEGIRO beurs → Yahoo Finance suffix (canonical). When the user tells us
// where they trade, that's the source of truth for the Yahoo URL. Exported
// so the cache layer can detect "cached ticker doesn't match user's
// exchange" and re-resolve.
export const beursToYahooSuffix: Record<string, string> = {
  NDQ: "",
  NSY: "",
  ASE: "",
  XET: ".DE",
  OMX: ".ST",
  EAM: ".AS",
  EPA: ".PA",
  LSE: ".L",
  TDG: ".F",
};

// Fallback OpenFIGI exchCode → Yahoo suffix (only used when no beurs hint).
const yahooSuffixForExch: Record<string, string> = {
  US: "",
  GY: ".DE",
  GR: ".F",
  GD: ".DE",
  GS: ".DE",
  GM: ".DE",
  GT: ".DE",
  GF: ".DE",
  SS: ".ST",
  NA: ".AS",
  FP: ".PA",
  LN: ".L",
};

export type TickerLookup = {
  isin: string;
  ticker: string | null;
  name: string | null;
  exchange: string | null;
};

const apiKey = process.env.OPENFIGI_API_KEY;
const batchSize = apiKey ? 100 : 10;

export const lookupIsins = async (
  isins: Array<{ isin: string; beurs?: string }>,
): Promise<TickerLookup[]> => {
  const out: TickerLookup[] = [];
  for (let i = 0; i < isins.length; i += batchSize) {
    const batch = isins.slice(i, i + batchSize);
    // No exchCode filter — see beursPreferredExch.
    const body: FigiRequest[] = batch.map(({ isin }) => ({
      idType: "ID_ISIN",
      idValue: isin,
    }));

    const res = await fetch(FIGI_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { "X-OPENFIGI-APIKEY": apiKey } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`OpenFIGI ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as FigiResponse;
    for (let j = 0; j < batch.length; j++) {
      const { isin, beurs } = batch[j];
      const entry = json[j];
      if (!entry || !("data" in entry) || entry.data.length === 0) {
        out.push({ isin, ticker: null, name: null, exchange: null });
        continue;
      }
      const preferredExch = beurs ? beursPreferredExch[beurs] : undefined;
      // Rank candidates: prefer hits on the user's exchange, then Common
      // Stock, then ETP/Mutual Fund (covers ETFs), then anything else.
      const score = (h: FigiHit): number => {
        const exch = h.exchCode ?? "";
        const onPreferredExch = preferredExch?.has(exch) ? 100 : 0;
        const isCommon =
          h.securityType === "Common Stock" ||
          h.securityType2 === "Common Stock"
            ? 10
            : 0;
        const isEtp =
          h.securityType === "ETP" || h.securityType2 === "Mutual Fund"
            ? 5
            : 0;
        return onPreferredExch + isCommon + isEtp;
      };
      const hit = [...entry.data].sort((a, b) => score(b) - score(a))[0];
      // Suffix: prefer the user's beurs (DEGIRO knows where they actually
      // trade); fall back to mapping the FIGI hit's exchange code.
      const suffix =
        (beurs && beursToYahooSuffix[beurs]) ??
        yahooSuffixForExch[hit.exchCode ?? ""] ??
        "";
      // Bloomberg/OpenFIGI uses "BRK/B" for share classes; Yahoo uses "BRK-B".
      // Yahoo's URL routing breaks on the slash, so translate it.
      const yahooBase = hit.ticker.replace(/\//g, "-");
      out.push({
        isin,
        ticker: `${yahooBase}${suffix}`,
        name: hit.name ?? null,
        exchange: hit.exchCode ?? null,
      });
    }
  }
  return out;
};
