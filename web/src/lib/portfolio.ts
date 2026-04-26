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

export type HoldingRow = {
  isin: string;
  product: string;
  ticker: string | null;
  quantity: number;
  valueEur: number;        // market value at endDate
  investedEur: number;     // peak net capital ever deployed in this ISIN (high-water mark)
  returnEur: number;       // profit change over [startDate, endDate]
  returnPct: number;       // returnEur / peak capital
};

/**
 * Per-ISIN summary at `endDate`, with profit/return scoped to [startDate, endDate].
 *
 * `investedEur` is the **peak net capital deployed** — the high-water mark
 * of (cumulative buys − cumulative sells) walked over time. This is the
 * right answer to "how much money did I commit to this stock?":
 *   - Closed-profitable: peak right before the sale (Intel: €2,200).
 *   - Cycled positions: doesn't double-count recycled proceeds (HIMS shows
 *     ~€4k peak even with €11k of gross buys, because sells freed capital
 *     to be reused for the next buy).
 *   - Net-cash-out positions: the original buy amount.
 *
 * `returnEur` is the change in cumulative profit over the window. Profit at
 * a point in time = market_value − net_invested, so the change captures only
 * what the market did during the window (fresh capital and proceeds are
 * accounted for, not counted as profit).
 *
 * `returnPct` divides by peak capital — the most realistic denominator since
 * it represents the most money this position ever held.
 */
export const computeHoldings = (
  txs: Transaction[],
  valuation: ValuationDay[],
  startDate: string,
  endDate: string,
  productByIsin: Map<string, string>,
  tickerByIsin: Map<string, string>,
): HoldingRow[] => {
  if (valuation.length === 0) return [];

  // Net invested cumulative deltas, used both for profit math AND for walking
  // the high-water mark of capital deployed.
  const txsByIsin = new Map<string, Transaction[]>();
  for (const t of txs) {
    let arr = txsByIsin.get(t.isin);
    if (!arr) {
      arr = [];
      txsByIsin.set(t.isin, arr);
    }
    arr.push(t);
  }
  for (const arr of txsByIsin.values()) {
    arr.sort((a, b) =>
      a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date),
    );
  }

  const netInvestedAt = (isin: string, date: string): number => {
    const arr = txsByIsin.get(isin);
    if (!arr) return 0;
    let net = 0;
    for (const t of arr) {
      if (t.date > date) break;
      net -= t.totalEur;
    }
    return net;
  };

  const peakNetInvested = (isin: string, throughDate: string): number => {
    const arr = txsByIsin.get(isin);
    if (!arr) return 0;
    let net = 0;
    let peak = 0;
    for (const t of arr) {
      if (t.date > throughDate) break;
      net -= t.totalEur;
      if (net > peak) peak = net;
    }
    return peak;
  };

  const endDay = valuation.find((v) => v.date === endDate) ?? valuation[valuation.length - 1];
  const startDay = valuation.find((v) => v.date === startDate);

  const qtyAtEnd = new Map<string, number>();
  for (const t of txs) {
    if (t.date <= endDate) {
      qtyAtEnd.set(t.isin, (qtyAtEnd.get(t.isin) ?? 0) + t.quantity);
    }
  }

  const rows: HoldingRow[] = [];
  for (const isin of txsByIsin.keys()) {
    const endValue = endDay.perIsinEur[isin] ?? 0;
    const endNet = netInvestedAt(isin, endDate);
    const startValue = startDay?.perIsinEur[isin] ?? 0;
    const startNet = startDay ? netInvestedAt(isin, startDate) : 0;

    const returnEur = endValue - endNet - (startValue - startNet);
    const peak = peakNetInvested(isin, endDate);
    const returnPct = peak > 0 ? returnEur / peak : 0;

    rows.push({
      isin,
      product: productByIsin.get(isin) ?? isin,
      ticker: tickerByIsin.get(isin) ?? null,
      quantity: qtyAtEnd.get(isin) ?? 0,
      valueEur: endValue,
      investedEur: peak,
      returnEur,
      returnPct,
    });
  }

  return rows.filter(
    (r) =>
      r.quantity !== 0 ||
      Math.abs(r.returnEur) > 0.01 ||
      r.investedEur > 0.01,
  );
};

/**
 * Time-weighted return over [startDate, endDate], computed via daily Modified
 * Dietz: each day's return = (V_today − V_yesterday − CF_today) / (V_yesterday
 * + 0.5·CF_today), then geometrically chained. Treats CF as occurring mid-day.
 *
 * TWR isolates investment performance from the timing of deposits/withdrawals,
 * which is what you compare against an index. (Money-weighted/IRR — what the
 * existing headline shows — is dominated by *when* money was added.)
 *
 * `cashFlowEurByDate` is positive for net cash IN (a buy) and negative for net
 * cash OUT (a sell) on a given date. Compute it as `−Σ totalEur` over a day's
 * transactions (since totalEur is negative for buys in the CSV convention).
 *
 * Returns null when the window is too short or has no usable starting value.
 */
export const computeTwr = (
  valuation: ValuationDay[],
  cashFlowEurByDate: Map<string, number>,
  startDate: string,
  endDate: string,
  marketValueOf: (d: ValuationDay) => number = (d) => d.totalEur,
): number | null => {
  if (valuation.length < 2) return null;
  const window = valuation.filter(
    (v) => v.date >= startDate && v.date <= endDate,
  );
  if (window.length < 2) return null;
  let chain = 1;
  let any = false;
  for (let i = 1; i < window.length; i++) {
    const prev = marketValueOf(window[i - 1]);
    const cur = marketValueOf(window[i]);
    const cf = cashFlowEurByDate.get(window[i].date) ?? 0;
    const denom = prev + 0.5 * cf;
    // Skip days where there's no meaningful starting capital (e.g. the
    // position was opened that day with no prior value to grow).
    if (denom <= 0.01) continue;
    const r = (cur - prev - cf) / denom;
    chain *= 1 + r;
    any = true;
  }
  return any ? chain - 1 : null;
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
