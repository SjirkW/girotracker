import { useCallback, useEffect, useMemo, useState } from "react";
import { rangeStartDate, type Range } from "@/components/RangeSelector";
import { ChartCard, type Mode } from "@/components/ChartCard";
import { UploadCard } from "@/components/UploadCard";
import { SummaryCard } from "@/components/SummaryCard";
import { AppHeader } from "@/components/AppHeader";
import { AppFooter } from "@/components/AppFooter";
import { HiddenFileInput } from "@/components/HiddenFileInput";
import { DataTabsCard } from "@/components/DataTabsCard";
import { computeHoldings } from "@/lib/portfolio";
import { today } from "@/lib/format";
import { clearSession, loadSession, saveSession } from "@/lib/session";
import { usePortfolioCompute } from "@/hooks/usePortfolioCompute";
import { useTransactionsImport } from "@/hooks/useTransactionsImport";

function App() {
  const {
    transactions,
    parseErrors,
    fileName,
    fileInputRef,
    handleFile,
    openFilePicker,
    restore: restoreImport,
  } = useTransactionsImport();
  const {
    tickers,
    valuation,
    nativePrices,
    benchmarkSeries,
    status,
    compute,
    reset: resetCompute,
    restore: restoreCompute,
  } = usePortfolioCompute();
  const [showBenchmark, setShowBenchmark] = useState(false);
  const [range, setRange] = useState<Range>("MAX");
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });
  const [mode, setMode] = useState<Mode>("return");
  const [privacy, setPrivacy] = useState(false);
  const [selectedIsin, setSelectedIsin] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Restore previous session on first mount.
  useEffect(() => {
    const s = loadSession();
    if (s) {
      restoreImport({ transactions: s.transactions ?? [], fileName: s.fileName });
      restoreCompute({
        tickers: s.tickers,
        valuation: s.valuation,
        nativePrices: s.nativePrices,
        benchmarkSeries: s.benchmarkSeries,
      });
    }
    setHydrated(true);
  }, [restoreImport, restoreCompute]);

  // Persist session whenever the meaningful pieces change (after initial hydration).
  useEffect(() => {
    if (!hydrated) return;
    if (transactions.length === 0 && !fileName) {
      clearSession();
      return;
    }
    saveSession({ fileName, transactions, tickers, valuation, nativePrices, benchmarkSeries });
  }, [hydrated, fileName, transactions, tickers, valuation, nativePrices, benchmarkSeries]);

  // After parsing a new CSV, also reset the downstream compute state — the
  // hooks own their pieces but the "new file means start over" coordination
  // belongs to the parent.
  const onFile = useCallback(
    async (file: File) => {
      await handleFile(file);
      resetCompute();
    },
    [handleFile, resetCompute],
  );

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

  const latest = valuation.length > 0 ? valuation[valuation.length - 1] : null;
  const earliestDate = valuation.length > 0 ? valuation[0].date : "";

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

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl p-4 space-y-4">
        {/* Hidden file input lives at the top so any button (header on mobile,
            card on desktop) can trigger it without depending on card visibility. */}
        <HiddenFileInput inputRef={fileInputRef} onFile={(f) => void onFile(f)} />

        <AppHeader
          showActions={valuation.length > 0}
          status={status}
          onOpenFilePicker={openFilePicker}
          onCompute={() => void compute(transactions)}
        />

        {valuation.length === 0 && (
          <UploadCard
            fileName={fileName}
            parseErrors={parseErrors}
            hasTransactions={transactions.length > 0}
            status={status}
            onFile={(f) => void onFile(f)}
            onCompute={() => void compute(transactions)}
            inputRef={fileInputRef}
          />
        )}

        {valuation.length > 0 && latest && (
          <ChartCard
            transactions={transactions}
            valuation={valuation}
            benchmarkSeries={benchmarkSeries}
            productByIsin={productByIsin}
            latest={latest}
            earliestDate={earliestDate}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            selectedIsin={selectedIsin}
            onClearSelection={() => setSelectedIsin(null)}
            privacy={privacy}
            onTogglePrivacy={() => setPrivacy((p) => !p)}
            showBenchmark={showBenchmark}
            onToggleBenchmark={() => setShowBenchmark((b) => !b)}
            mode={mode}
            onModeChange={setMode}
            range={range}
            onRangeChange={setRange}
            customRange={customRange}
            onCustomRangeChange={setCustomRange}
          />
        )}

        {transactions.length > 0 && (
          <DataTabsCard
            transactions={transactions}
            valuation={valuation}
            tickers={tickers}
            nativePrices={nativePrices}
            lifetimeHoldings={lifetimeHoldings}
            productByIsin={productByIsin}
            tickerByIsin={tickerByIsin}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            earliestDate={earliestDate}
            latestDate={latest?.date ?? today()}
            privacy={privacy}
            onTogglePrivacy={() => setPrivacy((p) => !p)}
            range={range}
            onRangeChange={setRange}
            customRange={customRange}
            onCustomRangeChange={setCustomRange}
            selectedIsin={selectedIsin}
            onSelectIsin={setSelectedIsin}
          />
        )}

        {stats && <SummaryCard {...stats} />}
        <AppFooter />
      </div>
    </div>
  );
}

export default App;
