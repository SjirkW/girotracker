import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { TickerLookupResult } from "@/lib/api";
import { matchesQuery } from "@/lib/filter";

type Props = {
  tickers: TickerLookupResult[];
  query: string;
  onQueryChange: (v: string) => void;
};

export function TickersTab({ tickers, query, onQueryChange }: Props) {
  const unresolved = useMemo(() => tickers.filter((t) => !t.ticker), [tickers]);
  const filtered = useMemo(
    () =>
      tickers.filter((t) =>
        matchesQuery(query, t.isin, t.name, t.ticker, t.exchange),
      ),
    [tickers, query],
  );

  if (tickers.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Click "Compute portfolio" to resolve tickers.
      </p>
    );
  }
  return (
    <>
      <Input
        type="search"
        placeholder="Filter by ISIN, name, ticker or exchange…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        className="md:hidden"
      />
      {unresolved.length > 0 && (
        <p className="text-sm text-destructive">
          Unresolved ISINs (excluded from valuation):{" "}
          {unresolved.map((u) => u.isin).join(", ")}
        </p>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ISIN</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Yahoo ticker</TableHead>
              <TableHead>Exchange</TableHead>
              <TableHead>Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((t) => (
              <TableRow key={t.isin}>
                <TableCell className="font-mono text-xs">{t.isin}</TableCell>
                <TableCell
                  className="max-w-[280px] truncate"
                  title={t.name ?? ""}
                >
                  {t.name ?? "—"}
                </TableCell>
                <TableCell className="font-mono">{t.ticker ?? "—"}</TableCell>
                <TableCell>{t.exchange ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground">{t.source}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
