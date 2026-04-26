import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { HoldingRow } from "@/lib/portfolio";
import { fmtEur, fmtNum } from "@/lib/format";

export type StopLossRow = HoldingRow & {
  pricePerShareEur: number;
  stopPricePerShareEur: number;
  lockedReturnEur: number;
  lockedReturnPct: number;
  nativePrice: number | null;
  nativeStopPrice: number | null;
  nativeCurrency: string | null;
  nativeAtr: number | null;
  dropFrac: number;
  usingAtr: boolean;
};

type Props = {
  hasValuation: boolean;
  rows: StopLossRow[];
  privacy: boolean;
  hasNativePrices: boolean;

  minReturnPct: number;
  onMinReturnPctChange: (n: number) => void;

  method: "pct" | "atr";
  onMethodChange: (m: "pct" | "atr") => void;

  pct: number;
  onPctChange: (n: number) => void;

  atrMultiplier: number;
  onAtrMultiplierChange: (n: number) => void;

  ccy: "native" | "eur";
  onCcyChange: (c: "native" | "eur") => void;
};

export function StopLossTab({
  hasValuation,
  rows,
  privacy,
  hasNativePrices,
  minReturnPct,
  onMinReturnPctChange,
  method,
  onMethodChange,
  pct,
  onPctChange,
  atrMultiplier,
  onAtrMultiplierChange,
  ccy,
  onCcyChange,
}: Props) {
  if (!hasValuation) {
    return (
      <p className="text-sm text-muted-foreground">
        Click "Compute portfolio" to see stop-loss suggestions.
      </p>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Min return %
          </label>
          <Input
            type="number"
            min={0}
            step={5}
            value={minReturnPct}
            onChange={(e) =>
              onMinReturnPctChange(Math.max(0, Number(e.target.value) || 0))
            }
            className="w-24"
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Method
          </label>
          <div className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
            {(["pct", "atr"] as const).map((m) => (
              <button
                key={m}
                onClick={() => onMethodChange(m)}
                className={
                  "px-3 py-1 rounded-md text-sm font-medium transition-colors " +
                  (method === m
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {m === "pct" ? "Fixed %" : "ATR"}
              </button>
            ))}
          </div>
        </div>
        {method === "pct" ? (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              Trailing stop %
            </label>
            <Input
              type="number"
              min={1}
              max={50}
              step={1}
              value={pct}
              onChange={(e) =>
                onPctChange(
                  Math.min(50, Math.max(1, Number(e.target.value) || 1)),
                )
              }
              className="w-24"
            />
          </div>
        ) : (
          <div>
            <label className="text-xs text-muted-foreground block mb-1">
              ATR × multiplier
            </label>
            <Input
              type="number"
              min={0.5}
              max={10}
              step={0.5}
              value={atrMultiplier}
              onChange={(e) =>
                onAtrMultiplierChange(
                  Math.min(10, Math.max(0.5, Number(e.target.value) || 0.5)),
                )
              }
              className="w-24"
            />
          </div>
        )}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">
            Currency
          </label>
          <div className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
            {(["native", "eur"] as const).map((c) => (
              <button
                key={c}
                onClick={() => onCcyChange(c)}
                className={
                  "px-3 py-1 rounded-md text-sm font-medium transition-colors " +
                  (ccy === c
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                {c === "native" ? "Ticker" : "EUR"}
              </button>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground max-w-md">
          Showing positions up {minReturnPct}% or more.
          {method === "pct"
            ? ` Stop loss is ${pct}% below the current price.`
            : ` Stop loss is ${atrMultiplier}× ATR(14) below the current price — adapts to each stock's volatility (typical multipliers: 2–3).`}
        </p>
      </div>
      {ccy === "native" && !hasNativePrices && (
        <p className="text-sm text-amber-500">
          Native ticker prices not loaded yet — click "Compute portfolio" to
          refresh, or switch to EUR.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No open positions with return ≥ {minReturnPct}%.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table className="text-[13px]">
            <TableHeader>
              <TableRow>
                <TableHead>Stock</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Price</TableHead>
                <TableHead className="text-right">Return %</TableHead>
                <TableHead className="text-right">Stop loss</TableHead>
                <TableHead className="text-right">Drop</TableHead>
                <TableHead className="text-right">Locked-in return</TableHead>
                <TableHead>Ticker</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.isin}>
                  <TableCell
                    className="max-w-[140px] sm:max-w-[280px] truncate"
                    title={r.product}
                  >
                    {r.product}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {privacy ? "•••" : fmtNum(r.quantity, 0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {privacy
                      ? "•••"
                      : ccy === "native" && r.nativePrice != null
                        ? `${fmtNum(r.nativePrice, 2)} ${r.nativeCurrency}`
                        : `${fmtNum(r.pricePerShareEur, 2)} EUR`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-emerald-500">
                    +
                    {(r.returnPct * 100).toLocaleString("nl-NL", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                    %
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {privacy
                      ? "•••"
                      : ccy === "native" && r.nativeStopPrice != null
                        ? `${fmtNum(r.nativeStopPrice, 2)} ${r.nativeCurrency}`
                        : `${fmtNum(r.stopPricePerShareEur, 2)} EUR`}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    -
                    {(r.dropFrac * 100).toLocaleString("nl-NL", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                    %
                    {method === "atr" && !r.usingAtr && (
                      <span
                        className="text-amber-500 ml-1"
                        title="No ATR data — using fixed % fallback"
                      >
                        *
                      </span>
                    )}
                  </TableCell>
                  <TableCell
                    className={
                      "text-right tabular-nums " +
                      (r.lockedReturnPct >= 0
                        ? "text-emerald-500"
                        : "text-red-500")
                    }
                  >
                    {r.lockedReturnPct >= 0 ? "+" : ""}
                    {(r.lockedReturnPct * 100).toLocaleString("nl-NL", {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}
                    %
                    {!privacy && (
                      <span className="text-xs text-muted-foreground ml-1">
                        ({r.lockedReturnEur >= 0 ? "+" : ""}
                        {fmtEur(r.lockedReturnEur)})
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {r.ticker ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </>
  );
}
