import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
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

/**
 * Self-contained chart with Google-style drag-to-inspect. The drag selection
 * state lives here so chart movement doesn't re-render the parent App.
 *
 * For hover, we bypass React entirely: a vertical cursor line and tooltip
 * card live as plain DOM elements, repositioned via `transform: translate3d`
 * on every mouse move. No state changes, no recharts re-paint, no React
 * reconciliation. The browser promotes the elements to GPU layers so the
 * compositor handles the movement at native frame rate.
 */
function PortfolioChartImpl({ data, privacy, fmtEur, pctDenomByDate }: Props) {
  const [dragSel, setDragSel] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);
  const dragging = useRef(false);
  const rafPending = useRef(false);
  const pendingLabel = useRef<string | null>(null);

  // Refs for the imperative hover overlay.
  const cursorRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipDateRef = useRef<HTMLDivElement>(null);
  const tooltipValueRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

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

  // Keep latest props/data accessible from native mouse handlers without
  // re-binding listeners on every render.
  const chartDataRef = useRef(chartData);
  chartDataRef.current = chartData;
  const privacyRef = useRef(privacy);
  privacyRef.current = privacy;
  const fmtEurRef = useRef(fmtEur);
  fmtEurRef.current = fmtEur;

  const hideHoverOverlay = () => {
    if (cursorRef.current) cursorRef.current.style.opacity = "0";
    if (tooltipRef.current) tooltipRef.current.style.opacity = "0";
  };

  // Native mouse listener: bypasses recharts entirely for hover, so no SVG
  // re-paint and no React reconciliation. We compute the data index from the
  // pixel x using the chart's known layout (left padding = YAxis width,
  // right padding = LineChart margin.right).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onMove = (e: MouseEvent) => {
      const dataset = chartDataRef.current;
      if (dataset.length === 0) return;
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const yAxisWidth = privacyRef.current ? 0 : 72;
      const plotLeft = yAxisWidth;
      const plotRight = rect.width - 16; // matches LineChart margin.right
      const plotWidth = plotRight - plotLeft;
      if (x < plotLeft || x > plotRight || plotWidth <= 0) {
        hideHoverOverlay();
        return;
      }
      const ratio = (x - plotLeft) / plotWidth;
      const idx = Math.min(
        dataset.length - 1,
        Math.max(0, Math.round(ratio * (dataset.length - 1))),
      );
      const point = dataset[idx];
      const snappedX = plotLeft + (idx / Math.max(1, dataset.length - 1)) * plotWidth;

      if (cursorRef.current) {
        cursorRef.current.style.transform = `translate3d(${snappedX}px, 0, 0)`;
        cursorRef.current.style.opacity = "1";
      }
      if (tooltipRef.current) {
        const cw = container.clientWidth;
        const tw = tooltipRef.current.offsetWidth || 160;
        const tx = snappedX + tw + 12 > cw ? snappedX - tw - 8 : snappedX + 8;
        tooltipRef.current.style.transform = `translate3d(${tx}px, 0, 0)`;
        tooltipRef.current.style.opacity = "1";
      }
      if (tooltipDateRef.current) tooltipDateRef.current.textContent = point.date;
      if (tooltipValueRef.current) {
        tooltipValueRef.current.textContent = privacyRef.current
          ? "•••"
          : fmtEurRef.current(point.value);
      }
    };

    container.addEventListener("mousemove", onMove);
    container.addEventListener("mouseleave", hideHoverOverlay);
    return () => {
      container.removeEventListener("mousemove", onMove);
      container.removeEventListener("mouseleave", hideHoverOverlay);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative h-[420px] select-none">
      {/* Imperatively-updated cursor line — never re-renders via React. */}
      <div
        ref={cursorRef}
        className="absolute top-0 bottom-6 w-px bg-foreground/40 pointer-events-none opacity-0"
        style={{
          left: 0,
          transform: "translate3d(0,0,0)",
          willChange: "transform, opacity",
        }}
      />
      {/* Imperatively-updated tooltip card. */}
      <div
        ref={tooltipRef}
        className="absolute top-2 left-0 pointer-events-none opacity-0 rounded-md border bg-popover/95 backdrop-blur px-2.5 py-1.5 shadow-sm text-xs tabular-nums"
        style={{
          transform: "translate3d(0,0,0)",
          willChange: "transform, opacity",
        }}
      >
        <div ref={tooltipDateRef} className="text-muted-foreground" />
        <div ref={tooltipValueRef} className="font-medium" />
      </div>

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
            if (rafPending.current) return;
            rafPending.current = true;
            requestAnimationFrame(flushPending);
          }}
          onMouseUp={() => {
            dragging.current = false;
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
