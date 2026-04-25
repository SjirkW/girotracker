import { memo, useEffect, useMemo, useRef } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
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

const fmtFullDate = (iso: string): string => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
};

const fmtAxisDate = (iso: string): string => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
};

// Recharts re-paints every data point on every state change, so 1800+ daily
// points on a ~1000px chart make drag interactions janky. Sub-pixel detail is
// invisible anyway — decimate to ~MAX_POINTS by uniform sampling, always
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
 * Self-contained chart with Google-style drag-to-inspect.
 *
 * Hover and drag both bypass React entirely — they're handled by native DOM
 * mouse listeners that update plain `<div>` overlays via `transform: translate3d`
 * and `width`. The chart's SVG never re-paints during interaction; the only
 * React state change is the boolean that toggles the post-drag close button.
 *
 * Plot-area math: the YAxis on the left takes `yAxisWidth` px, and the
 * LineChart's `margin.right` reserves 16 px on the right. Everything in
 * between is the data area, which we use to map pixel x ↔ data index.
 */
function PortfolioChartImpl({ data, privacy, fmtEur, pctDenomByDate }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Hover overlay refs.
  const cursorRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const tooltipDateRef = useRef<HTMLDivElement>(null);
  const tooltipValueRef = useRef<HTMLDivElement>(null);

  // Drag overlay refs.
  const dragRectRef = useRef<HTMLDivElement>(null);
  const dragLabelRef = useRef<HTMLDivElement>(null);
  const dragLabelDateRef = useRef<HTMLSpanElement>(null);
  const dragLabelDeltaRef = useRef<HTMLSpanElement>(null);

  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef<number | null>(null);
  const hasRectRef = useRef(false);

  const chartData = useMemo(() => decimate(data), [data]);

  // Refs for current props/data so the (one-time-bound) DOM listeners can
  // read the latest values without being re-attached on every render.
  const chartDataRef = useRef(chartData);
  chartDataRef.current = chartData;
  const privacyRef = useRef(privacy);
  privacyRef.current = privacy;
  const fmtEurRef = useRef(fmtEur);
  fmtEurRef.current = fmtEur;
  const pctDenomRef = useRef(pctDenomByDate);
  pctDenomRef.current = pctDenomByDate;

  const hideHover = () => {
    if (cursorRef.current) cursorRef.current.style.opacity = "0";
    if (tooltipRef.current) tooltipRef.current.style.opacity = "0";
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const layout = () => {
      const rect = container.getBoundingClientRect();
      const yAxisWidth = privacyRef.current ? 0 : 72;
      const plotLeft = yAxisWidth;
      const plotRight = rect.width - 16;
      const plotWidth = Math.max(1, plotRight - plotLeft);
      return { rect, plotLeft, plotRight, plotWidth };
    };

    const xToIdx = (x: number, plotLeft: number, plotWidth: number) => {
      const dataset = chartDataRef.current;
      if (dataset.length === 0) return 0;
      const ratio = (x - plotLeft) / plotWidth;
      return Math.min(
        dataset.length - 1,
        Math.max(0, Math.round(ratio * (dataset.length - 1))),
      );
    };

    const idxToX = (idx: number, plotLeft: number, plotWidth: number) => {
      const n = Math.max(1, chartDataRef.current.length - 1);
      return plotLeft + (idx / n) * plotWidth;
    };

    const showHover = (e: PointerEvent) => {
      if (isDraggingRef.current) return;
      const dataset = chartDataRef.current;
      if (dataset.length === 0) return;
      const { rect, plotLeft, plotRight, plotWidth } = layout();
      const x = e.clientX - rect.left;
      if (x < plotLeft || x > plotRight) {
        hideHover();
        return;
      }
      const idx = xToIdx(x, plotLeft, plotWidth);
      const point = dataset[idx];
      const snappedX = idxToX(idx, plotLeft, plotWidth);

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
      if (tooltipDateRef.current)
        tooltipDateRef.current.textContent = fmtFullDate(point.date);
      if (tooltipValueRef.current) {
        tooltipValueRef.current.textContent = privacyRef.current
          ? "•••"
          : fmtEurRef.current(point.value);
      }
    };

    const updateDragVisuals = (snappedX: number, e?: PointerEvent) => {
      const sx = dragStartXRef.current;
      if (sx == null) return;
      const x1 = Math.min(sx, snappedX);
      const x2 = Math.max(sx, snappedX);
      const w = x2 - x1;
      if (dragRectRef.current) {
        dragRectRef.current.style.transform = `translate3d(${x1}px, 0, 0)`;
        dragRectRef.current.style.width = `${w}px`;
        dragRectRef.current.style.opacity = w > 0 ? "1" : "0";
      }
      if (w <= 0) {
        if (dragLabelRef.current) dragLabelRef.current.style.opacity = "0";
        return;
      }
      const { plotLeft, plotWidth } = layout();
      const startIdx = xToIdx(x1, plotLeft, plotWidth);
      const endIdx = xToIdx(x2, plotLeft, plotWidth);
      const startPoint = chartDataRef.current[startIdx];
      const endPoint = chartDataRef.current[endIdx];
      if (!startPoint || !endPoint) return;
      const abs = endPoint.value - startPoint.value;
      const overrideDenom = pctDenomRef.current?.get(endPoint.date);
      const denom =
        overrideDenom != null ? Math.abs(overrideDenom) : Math.abs(startPoint.value);
      const pct = denom > 0 ? abs / denom : 0;

      if (dragLabelDateRef.current) {
        dragLabelDateRef.current.textContent = `${fmtFullDate(startPoint.date)} → ${fmtFullDate(endPoint.date)}`;
      }
      if (dragLabelDeltaRef.current) {
        const sign = abs >= 0 ? "+" : "";
        const pctStr = (pct * 100).toLocaleString("nl-NL", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
        dragLabelDeltaRef.current.textContent = `${sign}${fmtEurRef.current(abs)} (${sign}${pctStr}%)`;
        dragLabelDeltaRef.current.style.color =
          abs >= 0 ? "rgb(16 185 129)" : "rgb(239 68 68)";
      }
      if (dragLabelRef.current) dragLabelRef.current.style.opacity = "1";
      // Reference the event so eslint doesn't complain about unused param.
      void e;
    };

    const onDown = (e: PointerEvent) => {
      // Touch sometimes triggers a hover — ignore non-primary buttons for mouse.
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const { rect, plotLeft, plotRight, plotWidth } = layout();
      const x = e.clientX - rect.left;
      if (x < plotLeft || x > plotRight) return;
      const idx = xToIdx(x, plotLeft, plotWidth);
      const snappedX = idxToX(idx, plotLeft, plotWidth);
      // Show the hover tooltip at the press position FIRST (before flipping
      // the drag flag, since showHover bails out while dragging). A tap with
      // no drag will leave this visible; a real drag will hide it on the
      // first significant pointermove.
      showHover(e);
      isDraggingRef.current = true;
      dragStartXRef.current = snappedX;
      if (dragRectRef.current) {
        dragRectRef.current.style.transform = `translate3d(${snappedX}px, 0, 0)`;
        dragRectRef.current.style.width = "0px";
        dragRectRef.current.style.opacity = "0";
      }
      if (dragLabelRef.current) dragLabelRef.current.style.opacity = "0";
      hasRectRef.current = false;
      // Capture the pointer so we keep getting events even if the finger /
      // mouse leaves the chart bounds during the drag.
      try {
        container.setPointerCapture(e.pointerId);
      } catch {
        /* not all browsers always allow this */
      }
      // Don't preventDefault here — we want the browser to keep evaluating
      // whether this gesture is a vertical scroll (per touch-action: pan-y).
      // Once it commits to firing pointermove on us, scrolling is off the
      // table for that pointer anyway.
    };

    const onMove = (e: PointerEvent) => {
      if (!isDraggingRef.current) {
        if (e.pointerType !== "touch") showHover(e);
        return;
      }
      const { rect, plotLeft, plotRight, plotWidth } = layout();
      const x = Math.max(plotLeft, Math.min(plotRight, e.clientX - rect.left));
      const idx = xToIdx(x, plotLeft, plotWidth);
      const snappedX = idxToX(idx, plotLeft, plotWidth);
      // Once the drag is large enough to actually be a drag (>2px), hide the
      // hover tooltip so the drag rectangle and label take over.
      if (Math.abs(snappedX - (dragStartXRef.current ?? snappedX)) > 2) {
        hideHover();
      }
      updateDragVisuals(snappedX, e);
      e.preventDefault();
    };

    const onUp = (e: PointerEvent) => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      try {
        container.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const w = dragRectRef.current?.offsetWidth ?? 0;
      if (w < 2) {
        // Tap without drag — clear any prior selection rectangle, but leave
        // the hover tooltip visible so the user sees the value at the tap.
        if (dragRectRef.current) dragRectRef.current.style.opacity = "0";
        if (dragLabelRef.current) dragLabelRef.current.style.opacity = "0";
        hasRectRef.current = false;
        return;
      }
      hasRectRef.current = true;
      if (dragLabelRef.current) dragLabelRef.current.style.opacity = "0";
    };

    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointerleave", () => {
      if (!isDraggingRef.current) hideHover();
    });
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onUp);
    container.addEventListener("pointercancel", onUp);
    return () => {
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onUp);
      container.removeEventListener("pointercancel", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative h-[420px] select-none"
      // pan-y lets the browser keep handling vertical page scroll on touch
      // devices; horizontal gestures fall through to our pointer handlers.
      style={{ touchAction: "pan-y" }}
    >
      {/* Drag rectangle — imperatively positioned/sized via transform + width. */}
      <div
        ref={dragRectRef}
        className="absolute top-0 bottom-6 left-0 pointer-events-none opacity-0 bg-primary/15 border-l border-r border-primary/50"
        style={{
          width: 0,
          transform: "translate3d(0,0,0)",
          willChange: "transform, width, opacity",
        }}
      />
      {/* Drag label — imperatively updated text. */}
      <div
        ref={dragLabelRef}
        className="absolute top-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none rounded-md border bg-popover/95 backdrop-blur px-3 py-1.5 shadow-sm text-xs tabular-nums opacity-0 flex items-center gap-2"
        style={{ willChange: "opacity" }}
      >
        <span ref={dragLabelDateRef} className="text-muted-foreground" />
        <span ref={dragLabelDeltaRef} />
      </div>
      {/* Hover cursor — never re-renders. */}
      <div
        ref={cursorRef}
        className="absolute top-0 bottom-6 w-px bg-foreground/40 pointer-events-none opacity-0"
        style={{
          left: 0,
          transform: "translate3d(0,0,0)",
          willChange: "transform, opacity",
        }}
      />
      {/* Hover tooltip — never re-renders. */}
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

      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={chartData}
          margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
        >
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            dataKey="date"
            minTickGap={48}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={fmtAxisDate}
          />
          <YAxis
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(v) =>
              privacy
                ? ""
                : new Intl.NumberFormat("nl-NL", { notation: "compact" }).format(v)
            }
            width={privacy ? 0 : 36}
          />
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
