import { useEffect, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { CandleChart, type Candle } from "@/components/CandleChart";
import { fetchBars } from "@/lib/api";
import type { HoldingRow } from "@/lib/portfolio";

type Props = {
  hasValuation: boolean;
  lifetimeHoldings: HoldingRow[];
};

// Range = how far back the chart goes; interval = bar granularity. The
// allowed intervals depend on the range (Yahoo caps intraday history). Each
// row's first interval is the default.
const RANGES = [
  { id: "1D", label: "1D", yahooRange: "1d", intervals: ["5m", "15m", "30m"] },
  { id: "1W", label: "1W", yahooRange: "5d", intervals: ["30m", "1h", "1d"] },
  { id: "1M", label: "1M", yahooRange: "1mo", intervals: ["1h", "1d", "1wk"] },
  { id: "1Y", label: "1Y", yahooRange: "1y", intervals: ["1d", "1wk", "1mo"] },
  {
    id: "ALL",
    label: "ALL",
    yahooRange: "max",
    intervals: ["1wk", "1mo", "3mo"],
  },
] as const;
type RangeId = (typeof RANGES)[number]["id"];

/**
 * Pill-styled dropdown matching the RangeSelector "More" popover. Uses a
 * Popover so the rendered list inherits app theming (vs. the unstyled native
 * <select>).
 */
function PillSelect<T extends string>({
  value,
  options,
  onChange,
  align = "start",
  width = "w-44",
  renderOption,
}: {
  value: T;
  options: T[];
  onChange: (v: T) => void;
  align?: "start" | "end";
  width?: string;
  renderOption?: (v: T) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const label = renderOption ? renderOption(value) : value;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={
            "h-8 inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors max-w-full"
          }
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent className={`${width} p-1`} align={align}>
        <div className="flex flex-col max-h-80 overflow-y-auto">
          {options.map((opt) => (
            <button
              key={opt}
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={
                "px-3 py-2 rounded-md text-sm font-medium text-left transition-colors " +
                (value === opt
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")
              }
            >
              {renderOption ? renderOption(opt) : opt}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function CandlesTab({ hasValuation, lifetimeHoldings }: Props) {
  const openHoldings = useMemo(
    () =>
      lifetimeHoldings
        .filter((h) => h.quantity > 0 && h.ticker)
        .sort((a, b) => b.valueEur - a.valueEur),
    [lifetimeHoldings],
  );

  const [selectedTicker, setSelectedTicker] = useState<string | null>(null);
  const [rangeId, setRangeId] = useState<RangeId>("1D");
  const [interval, setInterval] = useState<string>("5m");
  const [candles, setCandles] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const range = RANGES.find((r) => r.id === rangeId) ?? RANGES[0];

  // Default to the most-valuable open holding.
  useEffect(() => {
    if (selectedTicker == null && openHoldings.length > 0) {
      setSelectedTicker(openHoldings[0].ticker!);
    }
  }, [selectedTicker, openHoldings]);

  // When the range changes, snap interval to the new range's first option if
  // the current interval isn't valid for it.
  useEffect(() => {
    if (!range.intervals.includes(interval as never)) {
      setInterval(range.intervals[0]);
    }
  }, [range, interval]);

  useEffect(() => {
    if (!selectedTicker) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBars(selectedTicker, interval, range.yahooRange)
      .then((bars) => {
        if (cancelled) return;
        const usable: Candle[] = [];
        for (const b of bars) {
          if (b.open == null || b.high == null || b.low == null) continue;
          usable.push({
            date: b.time,
            open: b.open,
            high: b.high,
            low: b.low,
            close: b.close,
          });
        }
        setCandles(usable);
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedTicker, interval, range]);

  if (!hasValuation) {
    return (
      <p className="text-sm text-muted-foreground">
        Click "Compute portfolio" first — candles are pulled per stock.
      </p>
    );
  }
  if (openHoldings.length === 0) {
    return <p className="text-sm text-muted-foreground">No open positions.</p>;
  }

  const selectedHolding = openHoldings.find((h) => h.ticker === selectedTicker);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <PillSelect
          value={selectedTicker ?? ""}
          options={openHoldings.map((h) => h.ticker!)}
          onChange={(t) => setSelectedTicker(t)}
          width="w-72"
          renderOption={(t) => {
            const h = openHoldings.find((x) => x.ticker === t);
            return h ? `${h.product} (${h.ticker})` : t;
          }}
        />

        <div className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRangeId(r.id)}
              className={
                "px-3 py-1 rounded-md text-sm font-medium transition-colors " +
                (rangeId === r.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {r.label}
            </button>
          ))}
        </div>

        <PillSelect
          value={interval}
          options={[...range.intervals]}
          onChange={(i) => setInterval(i)}
          width="w-24"
          align="end"
        />

        {loading && (
          <span className="text-xs text-muted-foreground">Loading…</span>
        )}
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>

      {selectedHolding && (
        <p className="text-xs text-muted-foreground">
          {range.label} OHLC for {selectedHolding.product} ({selectedHolding.ticker})
          at {interval} granularity.
        </p>
      )}

      {candles.length === 0 && !loading ? (
        <p className="text-sm text-muted-foreground">
          No data returned for this range / interval.
        </p>
      ) : (
        <CandleChart data={candles} />
      )}
    </>
  );
}
