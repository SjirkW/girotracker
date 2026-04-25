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
  exchCode?: string;
  micCode?: string;
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

// DEGIRO "Beurs" code → OpenFIGI exchange code hint.
const beursToExch: Record<string, string> = {
  NDQ: "US",
  NSY: "US",
  ASE: "US",
  XET: "GY",
  OMX: "SS",
  EAM: "NA",
  EPA: "FP",
  LSE: "LN",
  TDG: "GR",
};

// OpenFIGI exchCode → Yahoo Finance suffix.
const yahooSuffixForExch: Record<string, string> = {
  US: "",
  GY: ".DE",
  GR: ".F",
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
    const body: FigiRequest[] = batch.map(({ isin, beurs }) => ({
      idType: "ID_ISIN",
      idValue: isin,
      ...(beurs && beursToExch[beurs] ? { exchCode: beursToExch[beurs] } : {}),
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
      const { isin } = batch[j];
      const entry = json[j];
      if (!entry || !("data" in entry) || entry.data.length === 0) {
        out.push({ isin, ticker: null, name: null, exchange: null });
        continue;
      }
      const hit = entry.data.find((h) => h.securityType === "Common Stock") ??
        entry.data.find((h) => h.securityType2 === "Common Stock") ??
        entry.data[0];
      const suffix = yahooSuffixForExch[hit.exchCode ?? ""] ?? "";
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
