import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PortfolioChart, type ChartPoint } from "@/components/PortfolioChart";
import {
  RangeSelector,
  type Range,
} from "@/components/RangeSelector";
import { fmtEur, fmtFullDate, fmtPct, today } from "@/lib/format";
import { BENCHMARK_LABEL } from "@/lib/session";
import type { ValuationDay } from "@/lib/portfolio";

const MODES = [
  { id: "return", label: "Return" },
  { id: "value", label: "Value" },
] as const;
export type Mode = (typeof MODES)[number]["id"];

type RangeChange = {
  abs: number;
  pct: number;
  start: number;
  end: number;
} | null;

type Props = {
  selectedIsin: string | null;
  productByIsin: Map<string, string>;
  onClearSelection: () => void;

  privacy: boolean;
  onTogglePrivacy: () => void;

  hasBenchmarkData: boolean;
  showBenchmark: boolean;
  onToggleBenchmark: () => void;

  mode: Mode;
  onModeChange: (m: Mode) => void;

  endDay: ValuationDay | null;
  latest: ValuationDay;
  earliestDate: string;
  rangeStart: string;
  rangeChange: RangeChange;
  headlineValue: number;

  investedAtEnd: number;
  marketAtEnd: number;
  twr: number | null;

  range: Range;
  onRangeChange: (r: Range) => void;
  customRange: { from: string; to: string };
  onCustomRangeChange: (r: { from: string; to: string }) => void;

  rangeData: ChartPoint[];
  benchmarkRangeData: ChartPoint[] | null;
  pctDenomByDate: Map<string, number> | undefined;
};

export function ChartCard({
  selectedIsin,
  productByIsin,
  onClearSelection,
  privacy,
  onTogglePrivacy,
  hasBenchmarkData,
  showBenchmark,
  onToggleBenchmark,
  mode,
  onModeChange,
  endDay,
  latest,
  earliestDate,
  rangeStart,
  rangeChange,
  headlineValue,
  investedAtEnd,
  marketAtEnd,
  twr,
  range,
  onRangeChange,
  customRange,
  onCustomRangeChange,
  rangeData,
  benchmarkRangeData,
  pctDenomByDate,
}: Props) {
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
                Capital invested: {fmtEur(investedAtEnd)} · Market value:{" "}
                {fmtEur(marketAtEnd)}
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
          pctDenomByDate={pctDenomByDate}
          benchmark={benchmarkRangeData}
          benchmarkLabel={BENCHMARK_LABEL}
        />
      </CardContent>
    </Card>
  );
}

export { MODES };
