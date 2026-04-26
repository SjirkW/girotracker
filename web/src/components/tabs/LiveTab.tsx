import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SortableTh,
  makeToggleSort,
  type SortState,
} from "@/components/SortableTh";
import { fetchQuotes, type QuoteResult } from "@/lib/api";
import { fmtNum } from "@/lib/format";
import type { HoldingRow } from "@/lib/portfolio";

type LiveSortKey =
  | "product"
  | "ticker"
  | "quantity"
  | "price"
  | "previousClose"
  | "change"
  | "changePct";

type Props = {
  hasValuation: boolean;
  lifetimeHoldings: HoldingRow[];
  privacy: boolean;
};

const fmtTimeAgo = (epochSec: number): string => {
  const ms = Date.now() - epochSec * 1000;
  if (ms < 0) return "now";
  const min = Math.floor(ms / 60000);
  if (min < 1) return "<1m ago";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
};

export function LiveTab({ hasValuation, lifetimeHoldings, privacy }: Props) {
  const [quotes, setQuotes] = useState<Record<string, QuoteResult>>({});
  const [loading, setLoading] = useState(false);
  const [lastFetched, setLastFetched] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState<LiveSortKey>>({
    key: "changePct",
    dir: "desc",
  });
  const toggleSort = makeToggleSort<LiveSortKey>(setSort);
  // 1d = vs previous trading day; 5d = ~one trading week back.
  const [lookbackDays, setLookbackDays] = useState<1 | 5>(1);
  const lookbackLabel =
    lookbackDays === 1 ? "Today" : `${lookbackDays}D`;

  // Open positions only — no point fetching live prices for stocks we no
  // longer hold.
  const baseRows = useMemo(
    () =>
      lifetimeHoldings.filter((h) => h.quantity > 0 && h.ticker),
    [lifetimeHoldings],
  );

  const rows = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    // Materialize the live-derived numbers so the comparator can sort by them.
    const enriched = baseRows.map((h) => {
      const q = quotes[h.ticker!];
      const price = q?.price ?? null;
      // 1D uses Yahoo's "last trading day before market time" reference; 5D
      // and 10D step back N completed bars from the latest. Falls back to
      // null when not enough bars are available.
      let previousClose: number | null = null;
      if (lookbackDays === 1) {
        previousClose = q?.previousClose ?? null;
      } else if (q?.bars && q.bars.length > lookbackDays) {
        previousClose = q.bars[q.bars.length - 1 - lookbackDays].close;
      }
      const change =
        price != null && previousClose != null ? price - previousClose : null;
      const changePct =
        change != null && previousClose != null && previousClose !== 0
          ? change / previousClose
          : null;
      return { h, q, price, previousClose, change, changePct };
    });
    const pick = (e: (typeof enriched)[number]): number | string | null => {
      switch (sort.key) {
        case "product":
          return e.h.product;
        case "ticker":
          return e.h.ticker ?? "";
        case "quantity":
          return e.h.quantity;
        case "price":
          return e.price;
        case "previousClose":
          return e.previousClose;
        case "change":
          return e.change;
        case "changePct":
          return e.changePct;
      }
    };
    return [...enriched].sort((a, b) => {
      const av = pick(a);
      const bv = pick(b);
      // Push nulls to the bottom regardless of direction.
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number")
        return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [baseRows, quotes, sort, lookbackDays]);

  const tickers = useMemo(
    () => [...new Set(baseRows.map((h) => h.ticker!).filter(Boolean))],
    [baseRows],
  );

  const refresh = useCallback(async () => {
    if (tickers.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const results = await fetchQuotes(tickers);
      const byTicker: Record<string, QuoteResult> = {};
      for (const r of results) byTicker[r.symbol] = r;
      setQuotes(byTicker);
      setLastFetched(Date.now());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [tickers]);

  // Auto-fetch on mount once we have something to fetch.
  useEffect(() => {
    if (tickers.length > 0 && lastFetched == null) {
      void refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickers.length]);

  if (!hasValuation) {
    return (
      <p className="text-sm text-muted-foreground">
        Click "Compute portfolio" first — the live tab pulls quotes for your
        current holdings.
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No open positions.</p>;
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          {loading ? "Refreshing…" : "Refresh"}
        </Button>
        <div className="inline-flex items-center rounded-lg border bg-muted/40 p-0.5">
          {([1, 5] as const).map((n) => (
            <button
              key={n}
              onClick={() => setLookbackDays(n)}
              className={
                "px-3 py-1 rounded-md text-sm font-medium transition-colors " +
                (lookbackDays === n
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground")
              }
            >
              {n === 1 ? "1D" : `${n}D`}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          Live prices via Yahoo Finance.
          {lastFetched != null && (
            <>
              {" Last fetched "}
              {fmtTimeAgo(Math.floor(lastFetched / 1000))}.
            </>
          )}
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
      <div className="overflow-x-auto">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <SortableTh sortKey="product" sort={sort} onToggle={toggleSort}>
                Stock
              </SortableTh>
              <SortableTh sortKey="change" sort={sort} onToggle={toggleSort} align="right">
                {lookbackLabel}
              </SortableTh>
              <SortableTh sortKey="changePct" sort={sort} onToggle={toggleSort} align="right">
                {lookbackLabel} %
              </SortableTh>
              <SortableTh sortKey="quantity" sort={sort} onToggle={toggleSort} align="right">
                Qty
              </SortableTh>
              <SortableTh sortKey="price" sort={sort} onToggle={toggleSort} align="right">
                Price
              </SortableTh>
              <SortableTh sortKey="previousClose" sort={sort} onToggle={toggleSort} align="right">
                {lookbackDays === 1 ? "Prev close" : `${lookbackDays}D ago`}
              </SortableTh>
              <TableHead>Market</TableHead>
              <SortableTh sortKey="ticker" sort={sort} onToggle={toggleSort}>
                Ticker
              </SortableTh>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(({ h, q, price, previousClose, change, changePct }) => (
              <TableRow key={h.isin}>
                <TableCell
                  className="max-w-[140px] sm:max-w-[280px] truncate"
                  title={h.product}
                >
                  {h.product}
                </TableCell>
                <TableCell
                  className={
                    "text-right tabular-nums " +
                    (change == null
                      ? ""
                      : change >= 0
                        ? "text-emerald-500"
                        : "text-red-500")
                  }
                >
                  {change != null
                    ? `${change >= 0 ? "+" : ""}${fmtNum(change, 2)}`
                    : "—"}
                </TableCell>
                <TableCell
                  className={
                    "text-right tabular-nums " +
                    (changePct == null
                      ? ""
                      : changePct >= 0
                        ? "text-emerald-500"
                        : "text-red-500")
                  }
                >
                  {changePct != null
                    ? `${changePct >= 0 ? "+" : ""}${(changePct * 100).toLocaleString("nl-NL", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}%`
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {privacy ? "•••" : fmtNum(h.quantity, 0)}
                </TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {price != null
                    ? `${fmtNum(price, 2)} ${q?.currency ?? ""}`
                    : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {previousClose != null ? fmtNum(previousClose, 2) : "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {q?.marketState ?? "—"}
                  {q?.error && (
                    <span
                      className="text-destructive ml-1"
                      title={q.error}
                    >
                      ✕
                    </span>
                  )}
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
