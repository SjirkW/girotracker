import { useMemo, useState } from "react";
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
import {
  computeHoldings,
  type ValuationDay,
} from "@/lib/portfolio";
import type { Transaction } from "@/lib/parseCsv";
import { fmtEur, fmtNum } from "@/lib/format";
import { matchesQuery } from "@/lib/filter";
import { Blurred } from "@/components/Blurred";

type Props = {
  hasValuation: boolean;
  transactions: Transaction[];
  valuation: ValuationDay[];
  rangeStart: string;
  rangeEnd: string;
  productByIsin: Map<string, string>;
  tickerByIsin: Map<string, string>;
  privacy: boolean;
  query: string;
  onQueryChange: (v: string) => void;
  range: Range;
  onRangeChange: (r: Range) => void;
  customRange: { from: string; to: string };
  onCustomRangeChange: (r: { from: string; to: string }) => void;
  earliestDate: string;
  latestDate: string;
  selectedIsin: string | null;
  onSelectIsin: (isin: string | null) => void;
};

export function HoldingsTab({
  hasValuation,
  transactions,
  valuation,
  rangeStart,
  rangeEnd,
  productByIsin,
  tickerByIsin,
  privacy,
  query,
  onQueryChange,
  range,
  onRangeChange,
  customRange,
  onCustomRangeChange,
  earliestDate,
  latestDate,
  selectedIsin,
  onSelectIsin,
}: Props) {
  const [sort, setSort] = useState<SortState>({ key: "valueEur", dir: "desc" });
  const toggleSort = (key: HoldingSortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );

  const rows = useMemo(() => {
    if (!hasValuation || valuation.length === 0) return [];
    const all = computeHoldings(
      transactions,
      valuation,
      rangeStart,
      rangeEnd,
      productByIsin,
      tickerByIsin,
    );
    const dir = sort.dir === "asc" ? 1 : -1;
    return all
      .filter((h) => matchesQuery(query, h.product, h.ticker, h.isin))
      .sort((a, b) => {
        const av = a[sort.key];
        const bv = b[sort.key];
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
      });
  }, [
    hasValuation,
    transactions,
    valuation,
    rangeStart,
    rangeEnd,
    productByIsin,
    tickerByIsin,
    sort,
    query,
  ]);

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
              <SortableTh sortKey="product" sort={sort} onToggle={toggleSort}>
                Stock
              </SortableTh>
              <SortableTh sortKey="valueEur" sort={sort} onToggle={toggleSort} align="right">
                Value
              </SortableTh>
              <SortableTh sortKey="returnEur" sort={sort} onToggle={toggleSort} align="right">
                Return
              </SortableTh>
              <SortableTh sortKey="returnPct" sort={sort} onToggle={toggleSort} align="right">
                Return %
              </SortableTh>
              <SortableTh sortKey="investedEur" sort={sort} onToggle={toggleSort} align="right">
                Invested
              </SortableTh>
              <SortableTh sortKey="quantity" sort={sort} onToggle={toggleSort} align="right">
                Qty
              </SortableTh>
              <SortableTh sortKey="ticker" sort={sort} onToggle={toggleSort}>
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
                  {privacy ? <Blurred /> : fmtEur(h.valueEur)}
                </TableCell>
                <TableCell
                  className={
                    "text-right tabular-nums " +
                    (h.returnEur >= 0 ? "text-emerald-500" : "text-red-500")
                  }
                >
                  {privacy ? (
                    <Blurred />
                  ) : (
                    `${h.returnEur >= 0 ? "+" : ""}${fmtEur(h.returnEur)}`
                  )}
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
                  {privacy ? <Blurred /> : fmtEur(h.investedEur)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {privacy ? <Blurred variant="narrow" /> : fmtNum(h.quantity, 0)}
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
