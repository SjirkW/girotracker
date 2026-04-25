import { memo, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartPoint = { date: string; value: number };

type Props = {
  data: ChartPoint[];
  privacy: boolean;
  fmtEur: (n: number) => string;
  // Optional per-date denominator for the drag selection's % change. When the
  // chart values are themselves a return (which can be near zero), dividing
  // by `startEntry.value` makes percentages explode. Pass capital deployed
  // at each date here so the chart matches the headline range %.
  pctDenomByDate?: Map<string, number>;
};

/**
 * Self-contained chart with Google-style drag-to-inspect. The drag selection
 * state lives here so chart movement doesn't re-render the parent App (and
 * its Holdings/Transactions tables, which would otherwise tank performance
 * on every mouse move).
 */
// Recharts re-paints every data point on every state change, so 1800+ daily
// points on a ~1000px chart make drag interactions janky. Sub-pixel detail
// is invisible anyway — decimate to ~MAX_POINTS by uniform sampling, always
// keeping the first and last point.
const MAX_POINTS = 600;
const decimate = (data: ChartPoint[]): ChartPoint[] => {
  if (data.length <= MAX_POINTS) return data;
  const step = data.length / MAX_POINTS;
  const out: ChartPoint[] = [];
  for (let i = 0; i < MAX_POINTS; i++) {
    out.push(data[Math.floor(i * step)]);
  }
  const last = data[data.length - 1];
  if (out[out.length - 1].date !== last.date) out.push(last);
  return out;
};

function PortfolioChartImpl({ data, privacy, fmtEur, pctDenomByDate }: Props) {
  const [dragSel, setDragSel] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);
  const dragging = useRef(false);
  const rafPending = useRef(false);
  const pendingLabel = useRef<string | null>(null);

  const chartData = useMemo(() => decimate(data), [data]);

  const dragStats = useMemo(() => {
    if (!dragSel || dragSel.startDate === dragSel.endDate) return null;
    const [a, b] =
      dragSel.startDate <= dragSel.endDate
        ? [dragSel.startDate, dragSel.endDate]
        : [dragSel.endDate, dragSel.startDate];
    const startEntry = chartData.find((d) => d.date === a);
    const endEntry = chartData.find((d) => d.date === b);
    if (!startEntry || !endEntry) return null;
    const abs = endEntry.value - startEntry.value;
    const overrideDenom = pctDenomByDate?.get(b);
    const denom = overrideDenom != null ? Math.abs(overrideDenom) : Math.abs(startEntry.value);
    const pct = denom !== 0 ? abs / denom : 0;
    return { from: a, to: b, abs, pct };
  }, [dragSel, chartData, pctDenomByDate]);

  const flushPending = () => {
    rafPending.current = false;
    const lbl = pendingLabel.current;
    if (!lbl) return;
    setDragSel((prev) => {
      if (!prev || prev.endDate === lbl) return prev;
      return { ...prev, endDate: lbl };
    });
  };

  return (
    <div className="relative h-[420px] select-none">
      {dragStats && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none rounded-md border bg-popover/95 backdrop-blur px-3 py-1.5 shadow-sm text-xs tabular-nums flex items-center gap-2">
          <span className="text-muted-foreground">
            {dragStats.from} → {dragStats.to}
          </span>
          <span className={dragStats.abs >= 0 ? "text-emerald-500" : "text-red-500"}>
            {dragStats.abs >= 0 ? "+" : ""}
            {fmtEur(dragStats.abs)}
            {" ("}
            {dragStats.abs >= 0 ? "+" : ""}
            {(dragStats.pct * 100).toLocaleString("nl-NL", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            %)
          </span>
          <button
            onClick={() => setDragSel(null)}
            className="pointer-events-auto text-muted-foreground hover:text-foreground ml-1"
            title="Clear selection"
          >
            ✕
          </button>
        </div>
      )}
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
          onMouseDown={(e) => {
            if (!e?.activeLabel) return;
            const lbl = String(e.activeLabel);
            setDragSel({ startDate: lbl, endDate: lbl });
            dragging.current = true;
          }}
          onMouseMove={(e) => {
            if (!dragging.current || !e?.activeLabel) return;
            pendingLabel.current = String(e.activeLabel);
            // Coalesce mouse moves into one update per frame.
            if (rafPending.current) return;
            rafPending.current = true;
            requestAnimationFrame(flushPending);
          }}
          onMouseUp={() => {
            dragging.current = false;
            // A click without a drag (start === end) clears the selection.
            setDragSel((prev) =>
              prev && prev.startDate === prev.endDate ? null : prev,
            );
          }}
          onMouseLeave={() => {
            dragging.current = false;
          }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            minTickGap={48}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
          />
          <YAxis
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(v) =>
              privacy
                ? ""
                : new Intl.NumberFormat("nl-NL", { notation: "compact" }).format(v)
            }
            width={privacy ? 0 : 72}
          />
          <Tooltip
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--popover-foreground)",
            }}
            formatter={(v) => (privacy ? "•••" : fmtEur(Number(v)))}
            labelStyle={{ color: "var(--muted-foreground)" }}
            isAnimationActive={false}
          />
          {dragStats && (
            <ReferenceArea
              x1={dragStats.from}
              x2={dragStats.to}
              fill="var(--primary)"
              fillOpacity={0.12}
              stroke="var(--primary)"
              strokeOpacity={0.4}
              ifOverflow="visible"
            />
          )}
          <Line
            type="linear"
            dataKey="value"
            stroke="var(--primary)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
            activeDot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export const PortfolioChart = memo(PortfolioChartImpl);
