import { useEffect, useState } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX", "CUSTOM"] as const;
export type Range = (typeof RANGES)[number];

const PRESETS: Range[] = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"];

/**
 * Resolve the inclusive lower bound of a preset range, anchored at `latest`.
 * For CUSTOM, callers should not invoke this and should use their own dates.
 */
export const rangeStartDate = (
  range: Range,
  latest: string,
  earliest: string,
): string => {
  const d = new Date(`${latest}T00:00:00Z`);
  const apply = (fn: (x: Date) => void) => {
    const c = new Date(d);
    fn(c);
    return c.toISOString().slice(0, 10);
  };
  switch (range) {
    case "1D":
      return apply((c) => c.setUTCDate(c.getUTCDate() - 1));
    case "5D":
      return apply((c) => c.setUTCDate(c.getUTCDate() - 5));
    case "1M":
      return apply((c) => c.setUTCMonth(c.getUTCMonth() - 1));
    case "6M":
      return apply((c) => c.setUTCMonth(c.getUTCMonth() - 6));
    case "YTD":
      return `${d.getUTCFullYear()}-01-01`;
    case "1Y":
      return apply((c) => c.setUTCFullYear(c.getUTCFullYear() - 1));
    case "5Y":
      return apply((c) => c.setUTCFullYear(c.getUTCFullYear() - 5));
    case "MAX":
    case "CUSTOM":
      return earliest;
  }
};

const isoToDate = (s: string): Date | undefined =>
  s ? new Date(`${s}T00:00:00Z`) : undefined;
const dateToIso = (d: Date): string => d.toISOString().slice(0, 10);

const fmtShort = (s: string): string => {
  if (!s) return "";
  const d = new Date(`${s}T00:00:00Z`);
  return d.toLocaleDateString("nl-NL", {
    day: "2-digit",
    month: "short",
    year: "2-digit",
  });
};

type Props = {
  value: Range;
  onChange: (r: Range) => void;
  customRange: { from: string; to: string };
  onCustomChange: (range: { from: string; to: string }) => void;
  earliestDate: string;
  latestDate: string;
};

export const RangeSelector = ({
  value,
  onChange,
  customRange,
  onCustomChange,
  earliestDate,
  latestDate,
}: Props) => {
  const [open, setOpen] = useState(false);
  // Buffered selection so the popover only commits on Apply — avoids the
  // confusion of "did I just set From, or did I overwrite To?".
  const [pending, setPending] = useState<DateRange | undefined>(undefined);

  // Always start a fresh selection when opening — the next click is the new
  // start date. The previously-applied range is still visible on the trigger
  // button, so the user has it as reference.
  useEffect(() => {
    if (open) setPending(undefined);
  }, [open]);

  const isCustomActive = value === "CUSTOM";
  const hasFrom = !!pending?.from;
  const hasTo = !!pending?.to;
  const canApply = hasFrom && hasTo;

  const apply = () => {
    if (!pending?.from || !pending?.to) return;
    onCustomChange({
      from: dateToIso(pending.from),
      to: dateToIso(pending.to),
    });
    onChange("CUSTOM");
    setOpen(false);
  };

  const disabledMatchers = [
    ...(isoToDate(earliestDate) ? [{ before: isoToDate(earliestDate)! }] : []),
    ...(isoToDate(latestDate) ? [{ after: isoToDate(latestDate)! }] : []),
  ];

  return (
    <div className="flex items-center gap-1">
      {PRESETS.map((r) => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={
            "px-3 py-1.5 rounded-md text-sm font-medium transition-colors " +
            (value === r
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")
          }
        >
          {r}
        </button>
      ))}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            className={
              "px-3 py-1.5 rounded-md text-sm font-medium transition-colors inline-flex items-center gap-1.5 " +
              (isCustomActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")
            }
          >
            <CalendarIcon className="h-3.5 w-3.5" />
            {isCustomActive && customRange.from && customRange.to
              ? `${fmtShort(customRange.from)} – ${fmtShort(customRange.to)}`
              : "Custom"}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="end">
          <div className="px-3 pt-3 pb-2 border-b grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            <div
              className={
                "rounded-md border px-3 py-1.5 " +
                (hasFrom && !hasTo
                  ? "border-primary bg-primary/5"
                  : "border-border")
              }
            >
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Start
              </div>
              <div
                className={
                  "text-sm tabular-nums " +
                  (hasFrom ? "text-foreground" : "text-muted-foreground")
                }
              >
                {pending?.from ? fmtShort(dateToIso(pending.from)) : "Pick a date"}
              </div>
            </div>
            <div className="text-muted-foreground">→</div>
            <div
              className={
                "rounded-md border px-3 py-1.5 " +
                (hasFrom && hasTo
                  ? "border-border"
                  : hasFrom
                    ? "border-primary bg-primary/5"
                    : "border-border")
              }
            >
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                End
              </div>
              <div
                className={
                  "text-sm tabular-nums " +
                  (hasTo ? "text-foreground" : "text-muted-foreground")
                }
              >
                {pending?.to
                  ? fmtShort(dateToIso(pending.to))
                  : hasFrom
                    ? "Click a later date"
                    : "—"}
              </div>
            </div>
          </div>
          <Calendar
            mode="range"
            numberOfMonths={2}
            showOutsideDays={false}
            selected={pending}
            defaultMonth={pending?.from ?? isoToDate(latestDate)}
            onSelect={setPending}
            disabled={disabledMatchers}
          />
          <div className="px-3 py-2 border-t flex items-center justify-between">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPending(undefined)}
              disabled={!hasFrom && !hasTo}
            >
              Reset
            </Button>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={apply} disabled={!canApply}>
                Apply
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
};
