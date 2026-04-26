import { useMemo } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortfolioChart } from "@/components/PortfolioChart";
import {
  RangeSelector,
  type Range,
} from "@/components/RangeSelector";
import { fmtEur, fmtFullDate, fmtPct, today } from "@/lib/format";
import { BENCHMARK_LABEL } from "@/lib/session";
import {
  buildDailyInvested,
  computeTwr,
  type ValuationDay,
} from "@/lib/portfolio";
import type { Transaction } from "@/lib/parseCsv";

const MODES = [
  { id: "return", label: "Return" },
  { id: "value", label: "Value" },
] as const;
export type Mode = (typeof MODES)[number]["id"];

type Props = {
  transactions: Transaction[];
  valuation: ValuationDay[];
  benchmarkSeries: Record<string, number>;
  productByIsin: Map<string, string>;

  latest: ValuationDay;
  earliestDate: string;
  rangeStart: string;
  rangeEnd: string;

  selectedIsin: string | null;
  onClearSelection: () => void;

  privacy: boolean;
  onTogglePrivacy: () => void;

  showBenchmark: boolean;
  onToggleBenchmark: () => void;

  mode: Mode;
  onModeChange: (m: Mode) => void;

  range: Range;
  onRangeChange: (r: Range) => void;
  customRange: { from: string; to: string };
  onCustomRangeChange: (r: { from: string; to: string }) => void;
};

export function ChartCard({
  transactions,
  valuation,
  benchmarkSeries,
  productByIsin,
  latest,
  earliestDate,
  rangeStart,
  rangeEnd,
  selectedIsin,
  onClearSelection,
  privacy,
  onTogglePrivacy,
  showBenchmark,
  onToggleBenchmark,
  mode,
  onModeChange,
  range,
  onRangeChange,
  customRange,
  onCustomRangeChange,
}: Props) {
  const investedByDate = useMemo(() => {
    if (valuation.length === 0) return new Map<string, number>();
    return buildDailyInvested(transactions, valuation.map((v) => v.date));
  }, [transactions, valuation]);

  const investedByDateForSelected = useMemo(() => {
    if (valuation.length === 0 || !selectedIsin) return new Map<string, number>();
    return buildDailyInvested(
      transactions.filter((t) => t.isin === selectedIsin),
      valuation.map((v) => v.date),
    );
  }, [transactions, valuation, selectedIsin]);

  const investedForChart = selectedIsin
    ? investedByDateForSelected
    : investedByDate;

  const marketValueForDay = (d: ValuationDay): number =>
    selectedIsin ? d.perIsinEur[selectedIsin] ?? 0 : d.totalEur;

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
      const spx: number | null = benchmarkSeries[v.date] ?? lastSpx;
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
    return { abs, pct };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuation, rangeStart, endDay, mode, investedForChart, selectedIsin, rangeData.length]);

  const headlineValue = endDay ? valueForDay(endDay) : 0;

  // Per-day net cash flow into the portfolio (positive = buys, negative = sells).
  // totalEur is negative for buys in our CSV convention, so we negate.
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

  const hasBenchmarkData = Object.keys(benchmarkSeries).length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2 min-w-0">
          <span className="truncate">
            {selectedIsin
              ? `${productByIsin.get(selectedIsin) ?? selectedIsin} over time`
              : "Portfolio value over time"}
          </span>
          {selectedIsin && (
            <Button variant="ghost" size="xs" onClick={onClearSelection}>
              ← Back
            </Button>
          )}
        </CardTitle>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onTogglePrivacy}
            title={privacy ? "Show values" : "Hide values"}
            aria-label={privacy ? "Show values" : "Hide values"}
          >
            {privacy ? <EyeOff /> : <Eye />}
          </Button>
          {hasBenchmarkData && (
            <Button
              variant={showBenchmark ? "secondary" : "ghost"}
              size="xs"
              onClick={onToggleBenchmark}
              title={`What if you'd put each cash flow into ${BENCHMARK_LABEL} instead`}
            >
              vs {BENCHMARK_LABEL}
            </Button>
          )}
          <div className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
            {MODES.map((m) => (
              <button
                key={m.id}
                onClick={() => onModeChange(m.id)}
                className={
                  "px-3 py-1 rounded-md text-sm font-medium transition-colors " +
                  (mode === m.id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-sm text-muted-foreground">
              {selectedIsin
                ? mode === "return"
                  ? "Stock return"
                  : "Stock value"
                : mode === "return"
                  ? "Total return"
                  : "Portfolio value"}{" "}
              ({fmtFullDate(endDay?.date ?? latest.date)})
            </div>
            <div className="flex items-baseline gap-3">
              {privacy ? (
                rangeChange && (
                  <span
                    className={
                      "text-3xl font-semibold tabular-nums " +
                      (rangeChange.pct >= 0
                        ? "text-emerald-500"
                        : "text-red-500")
                    }
                  >
                    {fmtPct(rangeChange.pct)}
                  </span>
                )
              ) : (
                <>
                  <span
                    className={
                      "text-3xl font-semibold tabular-nums " +
                      (mode === "return"
                        ? headlineValue >= 0
                          ? "text-emerald-500"
                          : "text-red-500"
                        : "")
                    }
                  >
                    {mode === "return" && headlineValue >= 0 ? "+" : ""}
                    {fmtEur(headlineValue)}
                  </span>
                  {rangeChange && (
                    <span
                      className={
                        "text-base tabular-nums " +
                        (rangeChange.abs >= 0
                          ? "text-emerald-500"
                          : "text-red-500")
                      }
                    >
                      {rangeStart > earliestDate ? (
                        <>
                          {rangeChange.abs >= 0 ? "+" : ""}
                          {fmtEur(rangeChange.abs)} ({fmtPct(rangeChange.pct)})
                        </>
                      ) : (
                        fmtPct(rangeChange.pct)
                      )}
                    </span>
                  )}
                </>
              )}
            </div>
            {!privacy && mode === "return" && endDay && (
              <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                Capital invested:{" "}
                {fmtEur(investedForChart.get(endDay.date) ?? 0)} · Market value:{" "}
                {fmtEur(marketValueForDay(endDay))}
                {twr != null && (
                  <>
                    {" · "}
                    <span title="Time-weighted return: strips out the timing of deposits, so it's directly comparable to an index">
                      TWR:{" "}
                      <span
                        className={
                          twr >= 0 ? "text-emerald-500" : "text-red-500"
                        }
                      >
                        {fmtPct(twr)}
                      </span>
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
          <RangeSelector
            value={range}
            onChange={onRangeChange}
            customRange={customRange}
            onCustomChange={onCustomRangeChange}
            earliestDate={earliestDate}
            latestDate={latest?.date ?? today()}
          />
        </div>
        <PortfolioChart
          data={rangeData}
          privacy={privacy}
          fmtEur={fmtEur}
          pctDenomByDate={mode === "return" ? investedForChart : undefined}
          benchmark={benchmarkRangeData}
          benchmarkLabel={BENCHMARK_LABEL}
        />
      </CardContent>
    </Card>
  );
}
