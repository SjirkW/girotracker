import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RangeSelector,
  type Range,
} from "@/components/RangeSelector";
import {
  SortableTh,
  type HoldingSortKey,
  type SortState,
} from "@/components/SortableTh";
import type { HoldingRow } from "@/lib/portfolio";
import { fmtEur, fmtNum } from "@/lib/format";

type Props = {
  hasValuation: boolean;
  rows: HoldingRow[];
  privacy: boolean;
  query: string;
  onQueryChange: (v: string) => void;
  range: Range;
  onRangeChange: (r: Range) => void;
  customRange: { from: string; to: string };
  onCustomRangeChange: (r: { from: string; to: string }) => void;
  earliestDate: string;
  latestDate: string;
  sort: SortState;
  onToggleSort: (k: HoldingSortKey) => void;
  selectedIsin: string | null;
  onSelectIsin: (isin: string | null) => void;
};

export function HoldingsTab({
  hasValuation,
  rows,
  privacy,
  query,
  onQueryChange,
  range,
  onRangeChange,
  customRange,
  onCustomRangeChange,
  earliestDate,
  latestDate,
  sort,
  onToggleSort,
  selectedIsin,
  onSelectIsin,
}: Props) {
  if (!hasValuation) {
    return (
      <p className="text-sm text-muted-foreground">
        Click "Compute portfolio" to see per-stock returns.
      </p>
    );
  }
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          type="search"
          placeholder="Filter by name, ticker or ISIN…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="md:hidden"
        />
        <RangeSelector
          value={range}
          onChange={onRangeChange}
          customRange={customRange}
          onCustomChange={onCustomRangeChange}
          earliestDate={earliestDate}
          latestDate={latestDate}
        />
      </div>
      <div className="overflow-x-auto">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <SortableTh sortKey="product" sort={sort} onToggle={onToggleSort}>
                Stock
              </SortableTh>
              <SortableTh sortKey="valueEur" sort={sort} onToggle={onToggleSort} align="right">
                Value
              </SortableTh>
              <SortableTh sortKey="returnEur" sort={sort} onToggle={onToggleSort} align="right">
                Return
              </SortableTh>
              <SortableTh sortKey="returnPct" sort={sort} onToggle={onToggleSort} align="right">
                Return %
              </SortableTh>
              <SortableTh sortKey="investedEur" sort={sort} onToggle={onToggleSort} align="right">
                Invested
              </SortableTh>
              <SortableTh sortKey="quantity" sort={sort} onToggle={onToggleSort} align="right">
                Qty
              </SortableTh>
              <SortableTh sortKey="ticker" sort={sort} onToggle={onToggleSort}>
                Ticker
              </SortableTh>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((h) => (
              <TableRow
                key={h.isin}
                onClick={() =>
                  onSelectIsin(selectedIsin === h.isin ? null : h.isin)
                }
                className={
                  "cursor-pointer " +
                  (selectedIsin === h.isin ? "bg-muted/60" : "")
                }
              >
                <TableCell
                  className="max-w-[140px] sm:max-w-[280px] truncate"
                  title={h.product}
                >
                  {h.product}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {privacy ? "•••" : fmtEur(h.valueEur)}
                </TableCell>
                <TableCell
                  className={
                    "text-right tabular-nums " +
                    (h.returnEur >= 0 ? "text-emerald-500" : "text-red-500")
                  }
                >
                  {privacy
                    ? "•••"
                    : `${h.returnEur >= 0 ? "+" : ""}${fmtEur(h.returnEur)}`}
                </TableCell>
                <TableCell
                  className={
                    "text-right tabular-nums " +
                    (h.returnPct >= 0 ? "text-emerald-500" : "text-red-500")
                  }
                >
                  {h.returnPct >= 0 ? "+" : ""}
                  {(h.returnPct * 100).toLocaleString("nl-NL", {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}
                  %
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {privacy ? "•••" : fmtEur(h.investedEur)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {privacy ? "•••" : fmtNum(h.quantity, 0)}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  {h.ticker ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
