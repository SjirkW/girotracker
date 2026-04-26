import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fmtEur } from "@/lib/format";

export type CurrencyExposureRow = {
  currency: string;
  valueEur: number;
  positions: number;
  pct: number;
};

type Props = {
  hasValuation: boolean;
  rows: CurrencyExposureRow[];
  privacy: boolean;
};

export function CurrencyTab({ hasValuation, rows, privacy }: Props) {
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
