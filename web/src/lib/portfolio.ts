import type { Transaction } from "./parseCsv";

export type DailyHolding = {
  date: string;          // YYYY-MM-DD
  qtyByIsin: Map<string, number>;
};

export type ValuationDay = {
  date: string;
  totalEur: number;
  perIsinEur: Record<string, number>;
};

export type IsinMeta = {
  isin: string;
  product: string;
  currency: string;        // local trading currency from CSV
  beurs: string;
};

export const isinMetaFromTransactions = (txs: Transaction[]): IsinMeta[] => {
  const map = new Map<string, IsinMeta>();
  for (const t of txs) {
    if (!map.has(t.isin)) {
      map.set(t.isin, {
        isin: t.isin,
        product: t.product,
        currency: t.currency,
        beurs: t.exchange,
      });
    }
  }
  return [...map.values()];
};

const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export const enumerateDates = (from: string, to: string): string[] => {
  const out: string[] = [];
  let cursor = from;
  while (cursor <= to) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
};

/**
 * For each date from the first trade through `lastDate`, compute the running
 * quantity per ISIN. Days without a trade carry forward the prior position.
 */
export const buildDailyHoldings = (
  txs: Transaction[],
  lastDate: string,
): DailyHolding[] => {
  if (txs.length === 0) return [];
  const sorted = [...txs].sort((a, b) =>
    a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date),
  );
  const firstDate = sorted[0].date;
  const dates = enumerateDates(firstDate, lastDate);

  // Pre-bucket transaction qty deltas by date.
  const deltasByDate = new Map<string, Map<string, number>>();
  for (const t of sorted) {
    let m = deltasByDate.get(t.date);
    if (!m) {
      m = new Map();
      deltasByDate.set(t.date, m);
    }
    m.set(t.isin, (m.get(t.isin) ?? 0) + t.quantity);
  }

  const running = new Map<string, number>();
  const out: DailyHolding[] = [];
  for (const date of dates) {
    const deltas = deltasByDate.get(date);
    if (deltas) {
      for (const [isin, dq] of deltas) {
        running.set(isin, (running.get(isin) ?? 0) + dq);
      }
    }
    out.push({ date, qtyByIsin: new Map(running) });
  }
  return out;
};

/**
 * Cumulative net capital deployed into the portfolio per day. Buys (negative
 * `totalEur`) increase deployed capital; sells (positive `totalEur`) reduce
 * it. So "invested(t) = − Σ totalEur for transactions on or before t".
 *
 * This is *net* cash put in: sell proceeds reduce it, even if not withdrawn
 * — for return calculations that's the right denominator since proceeds are
 * sitting in cash and not exposed to market risk.
 */
export const buildDailyInvested = (
  txs: Transaction[],
  dates: string[],
): Map<string, number> => {
  const deltasByDate = new Map<string, number>();
  for (const t of txs) {
    deltasByDate.set(t.date, (deltasByDate.get(t.date) ?? 0) - t.totalEur);
  }
  const out = new Map<string, number>();
  let running = 0;
  for (const d of dates) {
    const delta = deltasByDate.get(d);
    if (delta != null) running += delta;
    out.set(d, running);
  }
  return out;
};

/**
 * Yahoo only returns trading-day rows. For valuation on non-trading days, we
 * carry the most-recent close forward across the full date range.
 */
export const forwardFillDaily = (
  prices: Array<{ date: string; close: number }>,
  dates: string[],
): Map<string, number> => {
  const sorted = [...prices].sort((a, b) => a.date.localeCompare(b.date));
  const out = new Map<string, number>();
  let i = 0;
  let last: number | null = null;
  for (const date of dates) {
    while (i < sorted.length && sorted[i].date <= date) {
      last = sorted[i].close;
      i++;
    }
    if (last != null) out.set(date, last);
  }
  return out;
};

/**
 * Yahoo FX symbol for converting `localCurrency` → EUR.
 * Returns null when the local currency IS EUR (no conversion needed).
 *
 * Convention: Yahoo's "EURUSD=X" close = USD per 1 EUR, so to convert a USD
 * amount to EUR we DIVIDE by the close. We use that throughout, so `EUR<X>=X`
 * is the right symbol for any non-EUR currency X.
 */
export const fxSymbolFor = (localCurrency: string): string | null => {
  if (localCurrency === "EUR") return null;
  return `EUR${localCurrency}=X`;
};

/**
 * Some Yahoo listings (e.g. London-listed ETFs) are quoted in GBp (pence).
 * Yahoo metadata reports the currency as "GBp" and prices as 100× the GBP
 * value. Normalize to GBP so downstream FX conversion just works.
 */
export const normalizePriceCurrency = (
  close: number,
  currency: string | null,
): { close: number; currency: string } => {
  if (currency === "GBp" || currency === "GBX") {
    return { close: close / 100, currency: "GBP" };
  }
  return { close, currency: currency ?? "EUR" };
};

export type ValuationInput = {
  holdings: DailyHolding[];
  pricesByTicker: Map<string, Map<string, number>>;  // ticker → date → close (already in `currencyByTicker` units)
  fxByCurrency: Map<string, Map<string, number>>;    // currency → date → EUR<X> close
  isinToTicker: Map<string, string>;                 // isin → yahoo ticker
  currencyByTicker: Map<string, string>;             // yahoo ticker → currency Yahoo reports for it
};

export const computeValuation = (input: ValuationInput): ValuationDay[] => {
  const out: ValuationDay[] = [];
  for (const day of input.holdings) {
    let total = 0;
    const perIsin: Record<string, number> = {};
    for (const [isin, qty] of day.qtyByIsin) {
      if (qty === 0) continue;
      const ticker = input.isinToTicker.get(isin);
      if (!ticker) continue;
      const px = input.pricesByTicker.get(ticker)?.get(day.date);
      if (px == null) continue;
      const ccy = input.currencyByTicker.get(ticker) ?? "EUR";
      const valueLocal = qty * px;
      let valueEur = valueLocal;
      if (ccy !== "EUR") {
        const fx = input.fxByCurrency.get(ccy)?.get(day.date);
        if (fx == null) continue;
        valueEur = valueLocal / fx;
      }
      perIsin[isin] = valueEur;
      total += valueEur;
    }
    out.push({ date: day.date, totalEur: total, perIsinEur: perIsin });
  }
  return out;
};
