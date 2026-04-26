import { memo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type Candle = {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
};

type Props = {
  data: Candle[];
};

// Daily bars come in as "YYYY-MM-DD" (a date); intraday bars as a full ISO
// timestamp ("YYYY-MM-DDTHH:MM:SSZ"). Detect by length and format accordingly.
const fmtAxisDate = (iso: string): string => {
  if (!iso) return "";
  if (iso.length <= 10) {
    const d = new Date(`${iso}T00:00:00Z`);
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(d);
  }
  const d = new Date(iso);
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
};

const fmt = (n: number): string =>
  n.toLocaleString("nl-NL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

/**
 * Custom Bar shape that draws a full OHLC candlestick:
 *   - Wick: thin vertical line spanning low → high
 *   - Body: filled rectangle spanning open → close, green when close ≥ open
 *
 * Recharts gives us the bar's pixel rect (`x, y, width, height`) which represents
 * the dataKey `range = [low, high]`. We derive open/close pixel positions by
 * linearly mapping inside that rect.
 */
type CandleShapeProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: Candle;
};

function CandleShape(props: CandleShapeProps) {
  const { x, y, width, height, payload } = props;
  if (
    x == null ||
    y == null ||
    width == null ||
    height == null ||
    !payload
  ) {
    return null;
  }
  const { open, high, low, close } = payload;
  const isUp = close >= open;
  const color = isUp ? "rgb(16 185 129)" : "rgb(239 68 68)"; // emerald-500 / red-500
  const cx = x + width / 2;
  // Y maps high → y, low → y+height (Y axis is inverted in screen coords).
  const range = high - low || 1;
  const yFor = (v: number) => y + ((high - v) / range) * height;
  const openY = yFor(open);
  const closeY = yFor(close);
  const bodyTop = Math.min(openY, closeY);
  const bodyHeight = Math.max(1, Math.abs(closeY - openY));
  // Body width: keep candles slim (~60% of bar slot) but never less than 2px.
  const bodyWidth = Math.max(2, width * 0.6);
  return (
    <g>
      <line
        x1={cx}
        x2={cx}
        y1={y}
        y2={y + height}
        stroke={color}
        strokeWidth={1}
      />
      <rect
        x={cx - bodyWidth / 2}
        y={bodyTop}
        width={bodyWidth}
        height={bodyHeight}
        fill={color}
        stroke={color}
      />
    </g>
  );
}

const CustomTooltip = ({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: Candle }>;
}) => {
  const c = active && payload?.[0]?.payload;
  if (!c) return null;
  const isUp = c.close >= c.open;
  return (
    <div className="rounded-md border bg-popover/95 backdrop-blur px-2.5 py-1.5 shadow-sm text-xs tabular-nums space-y-0.5">
      <div className="text-muted-foreground">{fmtAxisDate(c.date)}</div>
      <div className="flex gap-3">
        <span className="text-muted-foreground">O</span>
        <span>{fmt(c.open)}</span>
      </div>
      <div className="flex gap-3">
        <span className="text-muted-foreground">H</span>
        <span>{fmt(c.high)}</span>
      </div>
      <div className="flex gap-3">
        <span className="text-muted-foreground">L</span>
        <span>{fmt(c.low)}</span>
      </div>
      <div className="flex gap-3">
        <span className="text-muted-foreground">C</span>
        <span className={isUp ? "text-emerald-500" : "text-red-500"}>
          {fmt(c.close)}
        </span>
      </div>
    </div>
  );
};

function CandleChartImpl({ data }: Props) {
  // Build a "range" array per row so the Bar's pixel rect spans low → high;
  // the shape uses payload.{open, close} to position the body inside it.
  const chartData = data.map((d) => ({
    ...d,
    range: [d.low, d.high] as [number, number],
  }));
  return (
    <div className="h-[300px] md:h-[420px] [&_*]:outline-none [&_*]:focus:outline-none [&_*]:focus-visible:outline-none">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
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
            domain={["dataMin", "dataMax"]}
            tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
            tickFormatter={(v) =>
              new Intl.NumberFormat("nl-NL", { notation: "compact" }).format(v)
            }
            width={48}
          />
          <Tooltip
            cursor={{ stroke: "var(--foreground)", strokeOpacity: 0.2 }}
            content={<CustomTooltip />}
          />
          <Bar
            dataKey="range"
            shape={CandleShape as never}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export const CandleChart = memo(CandleChartImpl);
