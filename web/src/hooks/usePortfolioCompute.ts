import { useCallback, useState } from "react";
import {
  fetchDividends,
  fetchPricesBatch,
  resolveTickers,
  type TickerLookupResult,
} from "@/lib/api";
import type { Transaction } from "@/lib/parseCsv";
import {
  buildDailyHoldings,
  computeValuation,
  enumerateDates,
  forwardFillDaily,
  fxSymbolFor,
  isinMetaFromTransactions,
  normalizePriceCurrency,
  type ValuationDay,
} from "@/lib/portfolio";
import { computeAtr } from "@/lib/atr";
import { today } from "@/lib/format";
import {
  BENCHMARK_TICKER,
  type NativePrice,
} from "@/lib/session";
import type { ComputeStatus } from "@/lib/computeStatus";

type Snapshot = {
  tickers?: TickerLookupResult[];
  valuation?: ValuationDay[];
  nativePrices?: Record<string, NativePrice>;
  benchmarkSeries?: Record<string, number>;
  dividendsByYear?: Record<string, number>;
  dividendsByIsin?: Record<string, number>;
};

export type PortfolioCompute = {
  tickers: TickerLookupResult[];
  valuation: ValuationDay[];
  nativePrices: Record<string, NativePrice>;
  benchmarkSeries: Record<string, number>;
  dividendsByYear: Record<string, number>;
  dividendsByIsin: Record<string, number>;
  status: ComputeStatus;
  compute: (transactions: Transaction[]) => Promise<void>;
  reset: () => void;
  restore: (snapshot: Snapshot) => void;
};

/**
 * Owns the full price/valuation pipeline + its result state. Compute orchestrates:
 *   ISIN→ticker resolution → batched price fetch (incl. ^GSPC for benchmark) →
 *   FX fetch (incl. EURUSD for benchmark) → daily valuation → per-ISIN native
 *   prices+ATR → S&P 500 EUR-per-unit series.
 *
 * State stays here so the orchestration and the data it produces live together;
 * the host component just reads the result + persists/restores via reset/restore.
 */
export function usePortfolioCompute(): PortfolioCompute {
  const [tickers, setTickers] = useState<TickerLookupResult[]>([]);
  const [valuation, setValuation] = useState<ValuationDay[]>([]);
  const [nativePrices, setNativePrices] = useState<Record<string, NativePrice>>({});
  const [benchmarkSeries, setBenchmarkSeries] = useState<Record<string, number>>({});
  const [dividendsByYear, setDividendsByYear] = useState<Record<string, number>>({});
  const [dividendsByIsin, setDividendsByIsin] = useState<Record<string, number>>({});
  const [status, setStatus] = useState<ComputeStatus>({ phase: "idle" });

  const reset = useCallback(() => {
    setTickers([]);
    setValuation([]);
    setNativePrices({});
    setBenchmarkSeries({});
    setDividendsByYear({});
    setDividendsByIsin({});
    setStatus({ phase: "idle" });
  }, []);

  const restore = useCallback((snapshot: Snapshot) => {
    if (snapshot.tickers) setTickers(snapshot.tickers);
    if (snapshot.valuation) setValuation(snapshot.valuation);
    if (snapshot.nativePrices) setNativePrices(snapshot.nativePrices);
    if (snapshot.benchmarkSeries) setBenchmarkSeries(snapshot.benchmarkSeries);
    if (snapshot.dividendsByYear) setDividendsByYear(snapshot.dividendsByYear);
    if (snapshot.dividendsByIsin) setDividendsByIsin(snapshot.dividendsByIsin);
    if (snapshot.valuation && snapshot.valuation.length > 0) {
      setStatus({ phase: "done" });
    }
  }, []);

  const compute = useCallback(async (transactions: Transaction[]) => {
    if (transactions.length === 0) return;
    try {
      const meta = isinMetaFromTransactions(transactions);

      setStatus({ phase: "tickers" });
      const tickerResults = await resolveTickers(
        meta.map((m) => ({ isin: m.isin, beurs: m.beurs })),
      );
      setTickers(tickerResults);

      const isinToTicker = new Map<string, string>();
      for (const r of tickerResults) {
        if (r.ticker) isinToTicker.set(r.isin, r.ticker);
      }

      const fromDate = transactions[0].date;
      const toDate = today();

      // Fetch prices for every resolved ticker in one batched request. The
      // server fans out to Yahoo with bounded concurrency. We capture each
      // ticker's currency from Yahoo's metadata (NOT the CSV's transaction
      // currency, which can differ from the actual listing currency — e.g. an
      // ETF bought in EUR on Milan but resolved to a London listing in GBp).
      const tickersToFetch = [
        ...new Set([...isinToTicker.values(), BENCHMARK_TICKER]),
      ];
      const priceDates = enumerateDates(fromDate, toDate);
      const pricesByTicker = new Map<string, Map<string, number>>();
      const currencyByTicker = new Map<string, string>();
      // Pre-normalization scale factor per ticker (1 by default, 0.01 for
      // pence-quoted listings like LON GBp). Dividend events from Yahoo are
      // raw native units, so they need the same scaling that we already apply
      // to OHLC closes via `normalizePriceCurrency`.
      const nativeScaleByTicker = new Map<string, number>();

      setStatus({ phase: "prices", done: 0, total: tickersToFetch.length });
      const priceResults = await fetchPricesBatch(tickersToFetch, fromDate, toDate);
      // Per-ticker ATR(14) on the most recent ~60 bars in native currency —
      // used for the Stop loss tab. The same currency-normalization (e.g.
      // GBp → GBP) is applied so high/low scale matches close.
      const atrByTicker = new Map<string, number>();
      for (const r of priceResults) {
        if (r.error) {
          console.warn(`prices failed for ${r.ticker}:`, r.error);
          pricesByTicker.set(r.ticker, new Map());
          continue;
        }
        const normalized = r.prices.map((p) => {
          const n = normalizePriceCurrency(p.close, p.currency);
          // GBp → GBP scaling on close also has to apply to high/low so the
          // OHLC bar stays internally consistent.
          const scale = p.close > 0 ? n.close / p.close : 1;
          return {
            date: p.date,
            close: n.close,
            high: p.high != null ? p.high * scale : null,
            low: p.low != null ? p.low * scale : null,
            currency: n.currency,
          };
        });
        if (normalized.length > 0) {
          currencyByTicker.set(r.ticker, normalized[0].currency);
          // Derive the scale factor we just applied: e.g. for GBp the
          // normalized close = raw / 100, so scale = 0.01.
          const firstRaw = r.prices[0]?.close;
          const scale =
            firstRaw != null && firstRaw > 0 && normalized[0].close > 0
              ? normalized[0].close / firstRaw
              : 1;
          nativeScaleByTicker.set(r.ticker, scale);
          const atr = computeAtr(normalized.slice(-60), 14);
          if (atr != null) atrByTicker.set(r.ticker, atr);
        }
        pricesByTicker.set(r.ticker, forwardFillDaily(normalized, priceDates));
      }
      setStatus({
        phase: "prices",
        done: tickersToFetch.length,
        total: tickersToFetch.length,
      });

      // Fetch FX for every non-EUR currency that any ticker is actually quoted
      // in on Yahoo — also one batched request. Always include USD so we can
      // convert the S&P 500 (USD-denominated) into EUR for the benchmark line.
      const currencies = [
        ...new Set([...currencyByTicker.values(), "USD"]),
      ].filter((c) => c !== "EUR");
      const fxByCurrency = new Map<string, Map<string, number>>();
      const ccyForSymbol = new Map<string, string>();
      const fxSymbols: string[] = [];
      for (const ccy of currencies) {
        const sym = fxSymbolFor(ccy);
        if (sym) {
          fxSymbols.push(sym);
          ccyForSymbol.set(sym, ccy);
        }
      }
      setStatus({ phase: "fx", done: 0, total: fxSymbols.length });
      const fxResults = await fetchPricesBatch(fxSymbols, fromDate, toDate);
      for (const r of fxResults) {
        const ccy = ccyForSymbol.get(r.ticker);
        if (!ccy) continue;
        if (r.error) {
          console.warn(`fx failed for ${ccy}:`, r.error);
          fxByCurrency.set(ccy, new Map());
          continue;
        }
        fxByCurrency.set(ccy, forwardFillDaily(r.prices, priceDates));
      }
      setStatus({ phase: "fx", done: fxSymbols.length, total: fxSymbols.length });

      setStatus({ phase: "computing" });
      const holdings = buildDailyHoldings(transactions, toDate);
      const newValuation = computeValuation({
        holdings,
        pricesByTicker,
        fxByCurrency,
        isinToTicker,
        currencyByTicker,
      });
      setValuation(newValuation);

      // Capture latest native (ticker-currency) close + ATR per ISIN — this
      // is what a broker stop-loss order takes, since orders are priced in
      // the listing's currency, not the user's home currency.
      const nativeByIsin: Record<string, NativePrice> = {};
      for (const [isin, ticker] of isinToTicker) {
        const series = pricesByTicker.get(ticker);
        const ccy = currencyByTicker.get(ticker);
        if (!series || series.size === 0 || !ccy) continue;
        // Use the most recent date in the forward-filled series (Yahoo skips
        // weekends/holidays so toDate may not be a key).
        let latestDate = "";
        for (const d of series.keys()) if (d > latestDate) latestDate = d;
        const price = series.get(latestDate);
        if (price == null) continue;
        nativeByIsin[isin] = {
          price,
          currency: ccy,
          atr: atrByTicker.get(ticker) ?? null,
        };
      }
      setNativePrices(nativeByIsin);

      // Build the S&P 500 price series in EUR per ^GSPC unit, forward-filled
      // across every date in the window so simulating buys on weekends/holidays
      // just picks up the prior trading day's close.
      const spxNative = pricesByTicker.get(BENCHMARK_TICKER);
      const usdFx = fxByCurrency.get("USD");
      const benchSeries: Record<string, number> = {};
      if (spxNative && usdFx) {
        for (const date of priceDates) {
          const px = spxNative.get(date);
          const fx = usdFx.get(date);
          if (px != null && fx != null && fx > 0) {
            // EURUSD=X close = USD per 1 EUR; EUR price = USD price / fx.
            benchSeries[date] = px / fx;
          }
        }
      }
      setBenchmarkSeries(benchSeries);

      // Per-year EUR dividends. For each held ticker, fetch dividend events
      // from Yahoo, multiply each event's per-share amount by the qty held
      // on the ex-div date, and convert to EUR using that day's FX. These
      // are GROSS dividends (before any DEGIRO-collected withholding).
      // Resilient: if the dividend fetch fails entirely, valuation/etc. is
      // already set, so the user just doesn't see a dividend column.
      try {
        const tickerToIsin = new Map<string, string>();
        for (const [isin, ticker] of isinToTicker) tickerToIsin.set(ticker, isin);
        const divResults = await fetchDividends(
          tickersToFetch.filter((t) => t !== BENCHMARK_TICKER),
          fromDate,
          toDate,
        );
        // Build per-ISIN qty-by-date lookup once. holdings[i].qtyByIsin maps
        // to running quantity that day (already forward-filled).
        const qtyByDateByIsin = new Map<string, Map<string, number>>();
        for (const day of holdings) {
          for (const [isin, qty] of day.qtyByIsin) {
            let m = qtyByDateByIsin.get(isin);
            if (!m) {
              m = new Map();
              qtyByDateByIsin.set(isin, m);
            }
            m.set(day.date, qty);
          }
        }
        const divsByYear: Record<string, number> = {};
        const divsByIsin: Record<string, number> = {};
        for (const r of divResults) {
          if (r.error) {
            console.warn(`dividends failed for ${r.ticker}:`, r.error);
            continue;
          }
          const isin = tickerToIsin.get(r.ticker);
          if (!isin) continue;
          const qtyMap = qtyByDateByIsin.get(isin);
          const ccy = currencyByTicker.get(r.ticker);
          if (!qtyMap || !ccy) continue;
          // Pence-quoted listings need the same /100 scaling we apply to
          // closes, otherwise dividends end up 100× too high (a pence amount
          // gets divided by GBP/EUR, treated as if it were pounds).
          const nativeScale = nativeScaleByTicker.get(r.ticker) ?? 1;
          for (const ev of r.dividends) {
            const qty = qtyMap.get(ev.date) ?? 0;
            if (qty <= 0) continue;
            const nativeAmount = ev.amount * qty * nativeScale;
            let eurAmount = nativeAmount;
            if (ccy !== "EUR") {
              const fx = fxByCurrency.get(ccy)?.get(ev.date);
              if (fx == null || fx <= 0) continue;
              // EUR<X>=X close = X per 1 EUR; EUR amount = native / fx.
              eurAmount = nativeAmount / fx;
            }
            const year = ev.date.slice(0, 4);
            divsByYear[year] = (divsByYear[year] ?? 0) + eurAmount;
            divsByIsin[isin] = (divsByIsin[isin] ?? 0) + eurAmount;
          }
        }
        setDividendsByYear(divsByYear);
        setDividendsByIsin(divsByIsin);
      } catch (err) {
        console.warn("dividend pipeline failed:", err);
      }

      setStatus({ phase: "done" });
    } catch (err) {
      setStatus({ phase: "error", message: (err as Error).message });
    }
  }, []);

  return {
    tickers,
    valuation,
    nativePrices,
    benchmarkSeries,
    dividendsByYear,
    dividendsByIsin,
    status,
    compute,
    reset,
    restore,
  };
}
