import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { type HoldingSortKey } from "@/components/SortableTh";
import { HoldingsTab } from "@/components/tabs/HoldingsTab";
import { StopLossTab } from "@/components/tabs/StopLossTab";
import { CurrencyTab } from "@/components/tabs/CurrencyTab";
import { TickersTab } from "@/components/tabs/TickersTab";
import { TransactionsTab } from "@/components/tabs/TransactionsTab";
import { rangeStartDate, type Range } from "@/components/RangeSelector";
import { ChartCard, type Mode } from "@/components/ChartCard";
import { UploadCard } from "@/components/UploadCard";
import { SummaryCard } from "@/components/SummaryCard";
import {
  isBusy,
  statusMessage,
  type ComputeStatus,
} from "@/lib/computeStatus";
import { fetchPricesBatch, resolveTickers, type TickerLookupResult } from "@/lib/api";
import { parseDegiroCsv, type Transaction } from "@/lib/parseCsv";
import {
  buildDailyHoldings,
  buildDailyInvested,
  computeHoldings,
  computeTwr,
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
  BENCHMARK_LABEL,
  BENCHMARK_TICKER,
  clearSession,
  loadSession,
  saveSession,
  type NativePrice,
} from "@/lib/session";

function App() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [tickers, setTickers] = useState<TickerLookupResult[]>([]);
  const [valuation, setValuation] = useState<ValuationDay[]>([]);
  const [nativePrices, setNativePrices] = useState<Record<string, NativePrice>>({});
  const [benchmarkSeries, setBenchmarkSeries] = useState<Record<string, number>>({});
  const [showBenchmark, setShowBenchmark] = useState(false);
  const [status, setStatus] = useState<ComputeStatus>({ phase: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [range, setRange] = useState<Range>("MAX");
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });
  const [mode, setMode] = useState<Mode>("return");
  const [privacy, setPrivacy] = useState(false);
  const [selectedIsin, setSelectedIsin] = useState<string | null>(null);
  const [holdingsQuery, setHoldingsQuery] = useState("");
  const [tickersQuery, setTickersQuery] = useState("");
  const [txQuery, setTxQuery] = useState("");
  const [activeTab, setActiveTab] = useState("holdings");
  const [hydrated, setHydrated] = useState(false);
  const [stopLossPct, setStopLossPct] = useState(15);
  const [stopLossMinReturnPct, setStopLossMinReturnPct] = useState(25);
  const [stopLossCcy, setStopLossCcy] = useState<"native" | "eur">("native");
  const [stopLossMethod, setStopLossMethod] = useState<"pct" | "atr">("pct");
  const [atrMultiplier, setAtrMultiplier] = useState(2.5);

  // Restore previous session on first mount.
  useEffect(() => {
    const s = loadSession();
    if (s) {
      setFileName(s.fileName);
      setTransactions(s.transactions ?? []);
      setTickers(s.tickers ?? []);
      setValuation(s.valuation ?? []);
      setNativePrices(s.nativePrices ?? {});
      setBenchmarkSeries(s.benchmarkSeries ?? {});
      if (s.valuation && s.valuation.length > 0) setStatus({ phase: "done" });
    }
    setHydrated(true);
  }, []);

  // Persist session whenever the meaningful pieces change (after initial hydration).
  useEffect(() => {
    if (!hydrated) return;
    if (transactions.length === 0 && !fileName) {
      clearSession();
      return;
    }
    saveSession({ fileName, transactions, tickers, valuation, nativePrices, benchmarkSeries });
  }, [hydrated, fileName, transactions, tickers, valuation, nativePrices, benchmarkSeries]);

  const handleFile = async (file: File) => {
    const text = await file.text();
    const { transactions, errors } = parseDegiroCsv(text);
    setTransactions(transactions);
    setParseErrors(errors);
    setFileName(file.name);
    setTickers([]);
    setValuation([]);
    setNativePrices({});
    setBenchmarkSeries({});
    setStatus({ phase: "idle" });
  };

  const stats = useMemo(() => {
    if (transactions.length === 0) return null;
    const isins = new Set(transactions.map((t) => t.isin));
    const buys = transactions.filter((t) => t.quantity > 0).length;
    const sells = transactions.filter((t) => t.quantity < 0).length;
    return {
      count: transactions.length,
      isins: isins.size,
      buys,
      sells,
      first: transactions[0].date,
      last: transactions[transactions.length - 1].date,
    };
  }, [transactions]);

  const compute = async () => {
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
      const valuation = computeValuation({
        holdings,
        pricesByTicker,
        fxByCurrency,
        isinToTicker,
        currencyByTicker,
      });
      setValuation(valuation);

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
      const withAtr = Object.values(nativeByIsin).filter((n) => n.atr != null).length;
      console.log(
        `[stoploss] captured native prices for ${Object.keys(nativeByIsin).length}/${isinToTicker.size} tickers (${withAtr} with ATR)`,
        nativeByIsin,
      );
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
      console.log(
        `[benchmark] captured ${Object.keys(benchSeries).length} S&P 500 EUR prices`,
      );
      setBenchmarkSeries(benchSeries);
      setStatus({ phase: "done" });
    } catch (err) {
      setStatus({ phase: "error", message: (err as Error).message });
    }
  };

  const latest = valuation.length > 0 ? valuation[valuation.length - 1] : null;
  const earliestDate = valuation.length > 0 ? valuation[0].date : "";

  const unresolved = tickers.filter((t) => !t.ticker);

  const investedByDate = useMemo(() => {
    if (valuation.length === 0) return new Map<string, number>();
    return buildDailyInvested(
      transactions,
      valuation.map((v) => v.date),
    );
  }, [transactions, valuation]);

  const investedByDateForSelected = useMemo(() => {
    if (valuation.length === 0 || !selectedIsin) return new Map<string, number>();
    return buildDailyInvested(
      transactions.filter((t) => t.isin === selectedIsin),
      valuation.map((v) => v.date),
    );
  }, [transactions, valuation, selectedIsin]);

  const investedForChart = selectedIsin ? investedByDateForSelected : investedByDate;

  const marketValueForDay = (d: ValuationDay): number =>
    selectedIsin ? (d.perIsinEur[selectedIsin] ?? 0) : d.totalEur;

  const valueForDay = useMemo(
    () => (d: ValuationDay) => {
      const market = marketValueForDay(d);
      if (mode === "value") return market;
      const invested = investedForChart.get(d.date) ?? 0;
      return market - invested;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, investedForChart, selectedIsin],
  );

  const rangeStart = useMemo(() => {
    if (!latest) return "";
    if (range === "CUSTOM") return customRange.from || earliestDate;
    return rangeStartDate(range, latest.date, earliestDate);
  }, [range, customRange, latest, earliestDate]);

  const rangeEnd = useMemo(() => {
    if (!latest) return "";
    if (range === "CUSTOM" && customRange.to) return customRange.to;
    return latest.date;
  }, [range, customRange, latest]);

  const endDay = useMemo(
    () => valuation.find((v) => v.date === rangeEnd) ?? latest,
    [valuation, rangeEnd, latest],
  );

  const stockFirstDate = useMemo(() => {
    if (!selectedIsin) return null;
    const dates = transactions
      .filter((t) => t.isin === selectedIsin)
      .map((t) => t.date)
      .sort();
    return dates[0] ?? null;
  }, [transactions, selectedIsin]);

  const rangeData = useMemo(() => {
    const effectiveStart =
      stockFirstDate && stockFirstDate > rangeStart ? stockFirstDate : rangeStart;
    return valuation
      .filter((d) => d.date >= effectiveStart && d.date <= rangeEnd)
      .map((d) => ({ date: d.date, value: Math.round(valueForDay(d)) }));
  }, [valuation, rangeStart, rangeEnd, valueForDay, stockFirstDate]);

  // "What-if you'd put each cash flow into the S&P 500 instead" curve.
  // Apples-to-apples: at every transaction date, treat the EUR amount as a
  // purchase of the index at that day's EUR-denominated S&P 500 price; then
  // mark to market every day. For mode="return", subtract cumulative
  // contributions so the chart shows return, matching the portfolio side.
  const benchmarkRangeData = useMemo(() => {
    if (!showBenchmark) return null;
    if (Object.keys(benchmarkSeries).length === 0) return null;
    if (valuation.length === 0) return null;

    const txs = selectedIsin
      ? transactions.filter((t) => t.isin === selectedIsin)
      : transactions;
    if (txs.length === 0) return null;
    const cfByDate = new Map<string, number>();
    for (const t of txs) cfByDate.set(t.date, (cfByDate.get(t.date) ?? 0) - t.totalEur);

    const effectiveStart =
      stockFirstDate && stockFirstDate > rangeStart ? stockFirstDate : rangeStart;

    let units = 0;
    let cumulativeCf = 0;
    let lastSpx: number | null = null;
    const out: Array<{ date: string; value: number }> = [];
    for (const v of valuation) {
      if (v.date > rangeEnd) break;
      const spx: number = benchmarkSeries[v.date] ?? lastSpx;
      const cf = cfByDate.get(v.date) ?? 0;
      if (cf !== 0 && spx != null && spx > 0) {
        units += cf / spx;
        cumulativeCf += cf;
      }
      if (spx != null) lastSpx = spx;
      if (v.date < effectiveStart) continue;
      const market = lastSpx != null ? units * lastSpx : 0;
      const value = mode === "value" ? market : market - cumulativeCf;
      out.push({ date: v.date, value: Math.round(value) });
    }
    return out;
  }, [
    showBenchmark,
    benchmarkSeries,
    valuation,
    transactions,
    selectedIsin,
    rangeStart,
    rangeEnd,
    mode,
    stockFirstDate,
  ]);

  const rangeChange = useMemo(() => {
    if (rangeData.length < 2 || !endDay) return null;
    // Anchor to the requested rangeStart (not the trimmed first chart point), so
    // shares purchased *during* the window are accounted as capital flow rather
    // than market gains. Without this, the chart's "+€/€%" disagreed with the
    // holdings table whenever a position was opened mid-window.
    const startDay = valuation.find((v) => v.date === rangeStart);
    const startMarket = startDay ? marketValueForDay(startDay) : 0;
    const endMarket = marketValueForDay(endDay);
    const startInvested = investedForChart.get(rangeStart) ?? 0;
    const endInvested = investedForChart.get(endDay.date) ?? 0;
    const abs = endMarket - startMarket - (endInvested - startInvested);
    const denom = mode === "value" ? startMarket || endInvested : endInvested;
    const pct = denom !== 0 ? abs / Math.abs(denom) : 0;
    return { abs, pct, start: startMarket, end: endMarket };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuation, rangeStart, endDay, mode, investedForChart, selectedIsin]);

  const headlineValue = endDay ? valueForDay(endDay) : 0;

  // Per-day net cash flow into the portfolio (positive = buys, negative =
  // sells). totalEur is negative for buys in our CSV convention, so we negate.
  const cashFlowEurByDate = useMemo(() => {
    const m = new Map<string, number>();
    const filtered = selectedIsin
      ? transactions.filter((t) => t.isin === selectedIsin)
      : transactions;
    for (const t of filtered) m.set(t.date, (m.get(t.date) ?? 0) - t.totalEur);
    return m;
  }, [transactions, selectedIsin]);

  const twr = useMemo(() => {
    if (valuation.length < 2 || !endDay) return null;
    return computeTwr(
      valuation,
      cashFlowEurByDate,
      rangeStart,
      endDay.date,
      marketValueForDay,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuation, cashFlowEurByDate, rangeStart, endDay, selectedIsin]);

  const productByIsin = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of transactions) if (!m.has(t.isin)) m.set(t.isin, t.product);
    return m;
  }, [transactions]);

  const tickerByIsin = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of tickers) if (r.ticker) m.set(r.isin, r.ticker);
    return m;
  }, [tickers]);

  const holdings = useMemo(() => {
    if (!latest) return [];
    return computeHoldings(
      transactions,
      valuation,
      rangeStart,
      rangeEnd,
      productByIsin,
      tickerByIsin,
    );
  }, [transactions, valuation, rangeStart, rangeEnd, productByIsin, tickerByIsin]);

  const lifetimeHoldings = useMemo(() => {
    if (!latest || !earliestDate) return [];
    return computeHoldings(
      transactions,
      valuation,
      earliestDate,
      latest.date,
      productByIsin,
      tickerByIsin,
    );
  }, [transactions, valuation, earliestDate, latest, productByIsin, tickerByIsin]);

  const txCurrencyByIsin = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of transactions) if (!m.has(t.isin)) m.set(t.isin, t.currency);
    return m;
  }, [transactions]);

  const currencyExposure = useMemo(() => {
    type Row = {
      currency: string;
      valueEur: number;
      positions: number;
      pct: number;
    };
    const byCcy = new Map<string, Row>();
    let total = 0;
    for (const h of lifetimeHoldings) {
      if (h.quantity <= 0 || h.valueEur <= 0) continue;
      const ccy =
        nativePrices[h.isin]?.currency ??
        txCurrencyByIsin.get(h.isin) ??
        "EUR";
      const row = byCcy.get(ccy) ?? {
        currency: ccy,
        valueEur: 0,
        positions: 0,
        pct: 0,
      };
      row.valueEur += h.valueEur;
      row.positions += 1;
      byCcy.set(ccy, row);
      total += h.valueEur;
    }
    const rows = [...byCcy.values()].map((r) => ({
      ...r,
      pct: total > 0 ? r.valueEur / total : 0,
    }));
    rows.sort((a, b) => b.valueEur - a.valueEur);
    return { rows, total };
  }, [lifetimeHoldings, nativePrices, txCurrencyByIsin]);

  const stopLossRows = useMemo(() => {
    const stopFrac = stopLossPct / 100;
    const minFrac = stopLossMinReturnPct / 100;
    return lifetimeHoldings
      .filter((h) => h.quantity > 0 && h.valueEur > 0 && h.returnPct >= minFrac)
      .map((h) => {
        const native = nativePrices[h.isin] ?? null;
        const pricePerShareEur = h.valueEur / h.quantity;
        const nativePrice = native?.price ?? null;
        const nativeAtr = native?.atr ?? null;

        // ATR-based drop is computed in native units, then converted into a
        // fractional drop so the same fraction can be applied to EUR too.
        // Falls back to the fixed % when ATR isn't available for this ticker.
        let atrFrac: number | null = null;
        if (nativePrice != null && nativeAtr != null && nativePrice > 0) {
          atrFrac = (atrMultiplier * nativeAtr) / nativePrice;
        }
        const usingAtr = stopLossMethod === "atr" && atrFrac != null;
        const dropFrac = usingAtr ? atrFrac! : stopFrac;

        const stopPricePerShareEur = pricePerShareEur * (1 - dropFrac);
        const valueAtStopEur = h.valueEur * (1 - dropFrac);
        const investedNetEur = h.valueEur - h.returnEur;
        const lockedReturnEur = valueAtStopEur - investedNetEur;
        const lockedReturnPct = h.investedEur > 0 ? lockedReturnEur / h.investedEur : 0;
        const nativeStopPrice =
          nativePrice != null ? nativePrice * (1 - dropFrac) : null;

        return {
          ...h,
          pricePerShareEur,
          stopPricePerShareEur,
          lockedReturnEur,
          lockedReturnPct,
          nativePrice,
          nativeStopPrice,
          nativeCurrency: native?.currency ?? null,
          nativeAtr,
          dropFrac,
          usingAtr,
        };
      })
      .sort((a, b) => b.returnPct - a.returnPct);
  }, [lifetimeHoldings, stopLossPct, stopLossMinReturnPct, stopLossMethod, atrMultiplier, nativePrices]);

  const [sort, setSort] = useState<{ key: HoldingSortKey; dir: "asc" | "desc" }>({
    key: "valueEur",
    dir: "desc",
  });

  const toggleSort = (key: HoldingSortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );

  const matchesQuery = (q: string, ...fields: Array<string | null | undefined>) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return fields.some((f) => f && f.toLowerCase().includes(needle));
  };

  const sortedHoldings = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...holdings]
      .filter((h) => matchesQuery(holdingsQuery, h.product, h.ticker, h.isin))
      .sort((a, b) => {
        const av = a[sort.key];
        const bv = b[sort.key];
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
      });
  }, [holdings, sort, holdingsQuery]);

  const filteredTickers = useMemo(
    () =>
      tickers.filter((t) =>
        matchesQuery(tickersQuery, t.isin, t.name, t.ticker, t.exchange),
      ),
    [tickers, tickersQuery],
  );

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((t) =>
        matchesQuery(txQuery, t.product, t.isin, t.date, t.currency),
      ),
    [transactions, txQuery],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl p-4 space-y-4">
        {/* Hidden file input lives at the top so any button (header on mobile,
            card on desktop) can trigger it without depending on card visibility. */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = "";
          }}
        />

        <header className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">GIROTRACKER</h1>
            <p className="text-muted-foreground text-sm">
              DEGIRO portfolio value over time
            </p>
          </div>
          {valuation.length > 0 && (
            <div className="flex flex-col items-end gap-1 shrink-0">
              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => fileInputRef.current?.click()}
                  title="Upload new file"
                  aria-label="Upload new file"
                >
                  <Upload />
                </Button>
                <Button
                  size="sm"
                  onClick={() => void compute()}
                  disabled={isBusy(status)}
                >
                  Recompute
                </Button>
              </div>
              {(isBusy(status) || status.phase === "error") && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {statusMessage(status)}
                  {status.phase === "error" && (
                    <span className="text-destructive">Error: {status.message}</span>
                  )}
                </span>
              )}
            </div>
          )}
        </header>

        {valuation.length === 0 && (
          <UploadCard
            fileName={fileName}
            parseErrors={parseErrors}
            hasTransactions={transactions.length > 0}
            status={status}
            onFile={(f) => void handleFile(f)}
            onCompute={() => void compute()}
            inputRef={fileInputRef}
          />
        )}

        {valuation.length > 0 && latest && (
          <ChartCard
            selectedIsin={selectedIsin}
            productByIsin={productByIsin}
            onClearSelection={() => setSelectedIsin(null)}
            privacy={privacy}
            onTogglePrivacy={() => setPrivacy((p) => !p)}
            hasBenchmarkData={Object.keys(benchmarkSeries).length > 0}
            showBenchmark={showBenchmark}
            onToggleBenchmark={() => setShowBenchmark((b) => !b)}
            mode={mode}
            onModeChange={setMode}
            endDay={endDay}
            latest={latest}
            earliestDate={earliestDate}
            rangeStart={rangeStart}
            rangeChange={rangeChange}
            headlineValue={headlineValue}
            investedAtEnd={endDay ? investedForChart.get(endDay.date) ?? 0 : 0}
            marketAtEnd={endDay ? marketValueForDay(endDay) : 0}
            twr={twr}
            range={range}
            onRangeChange={setRange}
            customRange={customRange}
            onCustomRangeChange={setCustomRange}
            rangeData={rangeData}
            benchmarkRangeData={benchmarkRangeData}
            pctDenomByDate={mode === "return" ? investedForChart : undefined}
          />
        )}

        {transactions.length > 0 && (
          <Card>
            <CardContent>
              <Tabs value={activeTab} onValueChange={setActiveTab}>
                <div className="flex items-center justify-between gap-3">
                  <TabsList>
                    <TabsTrigger value="holdings">Holdings</TabsTrigger>
                    <TabsTrigger value="stoploss">Stop loss</TabsTrigger>
                    <TabsTrigger value="currency">Currency</TabsTrigger>
                    <TabsTrigger value="tickers">
                      Tickers
                      {tickers.length > 0 &&
                        ` (${tickers.length - unresolved.length}/${tickers.length})`}
                    </TabsTrigger>
                    <TabsTrigger value="transactions">
                      Transactions ({transactions.length})
                    </TabsTrigger>
                  </TabsList>
                  {/* Inline filter on viewports wide enough to fit it next to the
                      tabs; on narrower screens, each tab's content shows its
                      own filter input below. The eye sits left of the search
                      on desktop; on mobile (search hidden) it lands at the
                      right end via the parent's justify-between. */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setPrivacy((p) => !p)}
                      title={privacy ? "Show values" : "Hide values"}
                      aria-label={privacy ? "Show values" : "Hide values"}
                      className="shrink-0"
                    >
                      {privacy ? <EyeOff /> : <Eye />}
                    </Button>
                    {activeTab !== "stoploss" && activeTab !== "currency" && (
                      <Input
                        type="search"
                        placeholder={
                          activeTab === "tickers"
                            ? "Filter by ISIN, name, ticker or exchange…"
                            : activeTab === "transactions"
                              ? "Filter by date, product, ISIN or currency…"
                              : "Filter by name, ticker or ISIN…"
                        }
                        value={
                          activeTab === "tickers"
                            ? tickersQuery
                            : activeTab === "transactions"
                              ? txQuery
                              : holdingsQuery
                        }
                        onChange={(e) => {
                          const v = e.target.value;
                          if (activeTab === "tickers") setTickersQuery(v);
                          else if (activeTab === "transactions") setTxQuery(v);
                          else setHoldingsQuery(v);
                        }}
                        className="hidden md:block max-w-xs"
                      />
                    )}
                  </div>
                </div>

                <TabsContent value="holdings" className="mt-4 space-y-3">
                  <HoldingsTab
                    hasValuation={valuation.length > 0}
                    rows={sortedHoldings}
                    privacy={privacy}
                    query={holdingsQuery}
                    onQueryChange={setHoldingsQuery}
                    range={range}
                    onRangeChange={setRange}
                    customRange={customRange}
                    onCustomRangeChange={setCustomRange}
                    earliestDate={earliestDate}
                    latestDate={latest?.date ?? today()}
                    sort={sort}
                    onToggleSort={toggleSort}
                    selectedIsin={selectedIsin}
                    onSelectIsin={setSelectedIsin}
                  />
                </TabsContent>

                <TabsContent value="stoploss" className="mt-4 space-y-3">
                  <StopLossTab
                    hasValuation={valuation.length > 0}
                    rows={stopLossRows}
                    privacy={privacy}
                    hasNativePrices={Object.keys(nativePrices).length > 0}
                    minReturnPct={stopLossMinReturnPct}
                    onMinReturnPctChange={setStopLossMinReturnPct}
                    method={stopLossMethod}
                    onMethodChange={setStopLossMethod}
                    pct={stopLossPct}
                    onPctChange={setStopLossPct}
                    atrMultiplier={atrMultiplier}
                    onAtrMultiplierChange={setAtrMultiplier}
                    ccy={stopLossCcy}
                    onCcyChange={setStopLossCcy}
                  />
                </TabsContent>

                <TabsContent value="currency" className="mt-4 space-y-3">
                  <CurrencyTab
                    hasValuation={valuation.length > 0}
                    rows={currencyExposure.rows}
                    privacy={privacy}
                  />
                </TabsContent>

                <TabsContent value="tickers" className="mt-4 space-y-3">
                  <TickersTab
                    tickers={tickers}
                    unresolved={unresolved}
                    filtered={filteredTickers}
                    query={tickersQuery}
                    onQueryChange={setTickersQuery}
                  />
                </TabsContent>

                <TabsContent value="transactions" className="mt-4 space-y-3">
                  <TransactionsTab
                    filtered={filteredTransactions}
                    query={txQuery}
                    onQueryChange={setTxQuery}
                  />
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        {stats && <SummaryCard {...stats} />}
      </div>
    </div>
  );
}

export default App;
