import { useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtEur } from "@/lib/format";
import type { HoldingRow } from "@/lib/portfolio";
import type { Transaction } from "@/lib/parseCsv";
import type { NativePrice } from "@/lib/session";

type Props = {
  hasValuation: boolean;
  lifetimeHoldings: HoldingRow[];
  transactions: Transaction[];
  nativePrices: Record<string, NativePrice>;
  privacy: boolean;
};

export function CurrencyTab({
  hasValuation,
  lifetimeHoldings,
  transactions,
  nativePrices,
  privacy,
}: Props) {
  const rows = useMemo(() => {
    type Row = {
      currency: string;
      valueEur: number;
      positions: number;
      pct: number;
    };
    // Fall back to the transaction's currency when a position has no native
    // price loaded yet (e.g. an unresolved ticker, or a stale localStorage
    // session from before we started capturing native prices).
    const txCurrencyByIsin = new Map<string, string>();
    for (const t of transactions)
      if (!txCurrencyByIsin.has(t.isin)) txCurrencyByIsin.set(t.isin, t.currency);

    const byCcy = new Map<string, Row>();
    let total = 0;
    for (const h of lifetimeHoldings) {
      if (h.quantity <= 0 || h.valueEur <= 0) continue;
      const ccy =
        nativePrices[h.isin]?.currency ??
        txCurrencyByIsin.get(h.isin) ??
        "EUR";
      const row = byCcy.get(ccy) ?? {
        currency: ccy,
        valueEur: 0,
        positions: 0,
        pct: 0,
      };
      row.valueEur += h.valueEur;
      row.positions += 1;
      byCcy.set(ccy, row);
      total += h.valueEur;
    }
    return [...byCcy.values()]
      .map((r) => ({ ...r, pct: total > 0 ? r.valueEur / total : 0 }))
      .sort((a, b) => b.valueEur - a.valueEur);
  }, [lifetimeHoldings, nativePrices, transactions]);

  if (!hasValuation) {
    return (
      <p className="text-sm text-muted-foreground">
        Click "Compute portfolio" to see currency exposure.
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No open positions.</p>;
  }
  return (
    <>
      <p className="text-xs text-muted-foreground max-w-md">
        How your open positions break down by listing currency — anything
        outside EUR is FX risk.
      </p>
      <div className="overflow-x-auto">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead>Currency</TableHead>
              <TableHead className="text-right">Value (€)</TableHead>
              <TableHead className="text-right">Share</TableHead>
              <TableHead>{""}</TableHead>
              <TableHead className="text-right">Positions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.currency}>
                <TableCell className="font-mono text-xs">{r.currency}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {privacy ? "•••" : fmtEur(r.valueEur)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {(r.pct * 100).toLocaleString("nl-NL", {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                  %
                </TableCell>
                <TableCell className="w-[180px]">
                  <div className="h-2 w-full rounded bg-muted overflow-hidden">
                    <div
                      className={
                        "h-full " +
                        (r.currency === "EUR"
                          ? "bg-emerald-500/70"
                          : "bg-sky-500/70")
                      }
                      style={{ width: `${r.pct * 100}%` }}
                    />
                  </div>
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {r.positions}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
