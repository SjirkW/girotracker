import { useMemo, useRef, useState, type ReactNode } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  RangeSelector,
  rangeStartDate,
  type Range,
} from "@/components/RangeSelector";
import { fetchPricesBatch, resolveTickers, type TickerLookupResult } from "@/lib/api";
import { parseDegiroCsv, type Transaction } from "@/lib/parseCsv";
import {
  buildDailyHoldings,
  buildDailyInvested,
  computeHoldings,
  computeValuation,
  enumerateDates,
  forwardFillDaily,
  fxSymbolFor,
  isinMetaFromTransactions,
  normalizePriceCurrency,
  type ValuationDay,
} from "@/lib/portfolio";

const fmtNum = (n: number, digits = 2) =>
  Number.isFinite(n)
    ? n.toLocaleString("nl-NL", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";

const fmtEur = (n: number) =>
  n.toLocaleString("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

const today = (): string => new Date().toISOString().slice(0, 10);

const MODES = [
  { id: "return", label: "Return" },
  { id: "value", label: "Value" },
] as const;
type Mode = (typeof MODES)[number]["id"];

type HoldingSortKey =
  | "product"
  | "ticker"
  | "quantity"
  | "valueEur"
  | "investedEur"
  | "returnEur"
  | "returnPct";

type SortState = { key: HoldingSortKey; dir: "asc" | "desc" };

const SortableTh = ({
  sortKey,
  sort,
  onToggle,
  align = "left",
  children,
}: {
  sortKey: HoldingSortKey;
  sort: SortState;
  onToggle: (key: HoldingSortKey) => void;
  align?: "left" | "right";
  children: ReactNode;
}) => {
  const active = sort.key === sortKey;
  const arrow = !active ? "" : sort.dir === "desc" ? "↓" : "↑";
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={
          "inline-flex items-center gap-1 transition-colors " +
          (active ? "text-foreground" : "hover:text-foreground")
        }
      >
        {children}
        <span className="text-xs opacity-70 w-3 inline-block text-left">{arrow}</span>
      </button>
    </TableHead>
  );
};

type ComputeStatus =
  | { phase: "idle" }
  | { phase: "tickers" }
  | { phase: "prices"; done: number; total: number }
  | { phase: "fx"; done: number; total: number }
  | { phase: "computing" }
  | { phase: "done" }
  | { phase: "error"; message: string };

function App() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [tickers, setTickers] = useState<TickerLookupResult[]>([]);
  const [valuation, setValuation] = useState<ValuationDay[]>([]);
  const [status, setStatus] = useState<ComputeStatus>({ phase: "idle" });
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [range, setRange] = useState<Range>("MAX");
  const [customRange, setCustomRange] = useState<{ from: string; to: string }>({
    from: "",
    to: "",
  });
  const [mode, setMode] = useState<Mode>("return");
  const [privacy, setPrivacy] = useState(false);
  const [selectedIsin, setSelectedIsin] = useState<string | null>(null);
  const [holdingsQuery, setHoldingsQuery] = useState("");
  const [tickersQuery, setTickersQuery] = useState("");
  const [txQuery, setTxQuery] = useState("");
  const [dragSel, setDragSel] = useState<{
    startDate: string;
    endDate: string;
  } | null>(null);
  const [dragging, setDragging] = useState(false);

  const fmtPct = (p: number) =>
    `${p >= 0 ? "+" : ""}${(p * 100).toLocaleString("nl-NL", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}%`;

  const handleFile = async (file: File) => {
    const text = await file.text();
    const { transactions, errors } = parseDegiroCsv(text);
    setTransactions(transactions);
    setParseErrors(errors);
    setFileName(file.name);
    setTickers([]);
    setValuation([]);
    setStatus({ phase: "idle" });
  };

  const stats = useMemo(() => {
    if (transactions.length === 0) return null;
    const isins = new Set(transactions.map((t) => t.isin));
    const buys = transactions.filter((t) => t.quantity > 0).length;
    const sells = transactions.filter((t) => t.quantity < 0).length;
    return {
      count: transactions.length,
      isins: isins.size,
      buys,
      sells,
      first: transactions[0].date,
      last: transactions[transactions.length - 1].date,
    };
  }, [transactions]);

  const compute = async () => {
    if (transactions.length === 0) return;
    try {
      const meta = isinMetaFromTransactions(transactions);

      setStatus({ phase: "tickers" });
      const tickerResults = await resolveTickers(
        meta.map((m) => ({ isin: m.isin, beurs: m.beurs })),
      );
      setTickers(tickerResults);

      const isinToTicker = new Map<string, string>();
      for (const r of tickerResults) {
        if (r.ticker) isinToTicker.set(r.isin, r.ticker);
      }

      const fromDate = transactions[0].date;
      const toDate = today();

      // Fetch prices for every resolved ticker in one batched request. The
      // server fans out to Yahoo with bounded concurrency. We capture each
      // ticker's currency from Yahoo's metadata (NOT the CSV's transaction
      // currency, which can differ from the actual listing currency — e.g. an
      // ETF bought in EUR on Milan but resolved to a London listing in GBp).
      const tickersToFetch = [...new Set(isinToTicker.values())];
      const priceDates = enumerateDates(fromDate, toDate);
      const pricesByTicker = new Map<string, Map<string, number>>();
      const currencyByTicker = new Map<string, string>();

      setStatus({ phase: "prices", done: 0, total: tickersToFetch.length });
      const priceResults = await fetchPricesBatch(tickersToFetch, fromDate, toDate);
      for (const r of priceResults) {
        if (r.error) {
          console.warn(`prices failed for ${r.ticker}:`, r.error);
          pricesByTicker.set(r.ticker, new Map());
          continue;
        }
        const normalized = r.prices.map((p) => {
          const n = normalizePriceCurrency(p.close, p.currency);
          return { date: p.date, close: n.close, currency: n.currency };
        });
        if (normalized.length > 0) {
          currencyByTicker.set(r.ticker, normalized[0].currency);
        }
        pricesByTicker.set(r.ticker, forwardFillDaily(normalized, priceDates));
      }
      setStatus({
        phase: "prices",
        done: tickersToFetch.length,
        total: tickersToFetch.length,
      });

      // Fetch FX for every non-EUR currency that any ticker is actually quoted
      // in on Yahoo — also one batched request.
      const currencies = [...new Set(currencyByTicker.values())].filter(
        (c) => c !== "EUR",
      );
      const fxByCurrency = new Map<string, Map<string, number>>();
      const ccyForSymbol = new Map<string, string>();
      const fxSymbols: string[] = [];
      for (const ccy of currencies) {
        const sym = fxSymbolFor(ccy);
        if (sym) {
          fxSymbols.push(sym);
          ccyForSymbol.set(sym, ccy);
        }
      }
      setStatus({ phase: "fx", done: 0, total: fxSymbols.length });
      const fxResults = await fetchPricesBatch(fxSymbols, fromDate, toDate);
      for (const r of fxResults) {
        const ccy = ccyForSymbol.get(r.ticker);
        if (!ccy) continue;
        if (r.error) {
          console.warn(`fx failed for ${ccy}:`, r.error);
          fxByCurrency.set(ccy, new Map());
          continue;
        }
        fxByCurrency.set(ccy, forwardFillDaily(r.prices, priceDates));
      }
      setStatus({ phase: "fx", done: fxSymbols.length, total: fxSymbols.length });

      setStatus({ phase: "computing" });
      const holdings = buildDailyHoldings(transactions, toDate);
      const valuation = computeValuation({
        holdings,
        pricesByTicker,
        fxByCurrency,
        isinToTicker,
        currencyByTicker,
      });
      setValuation(valuation);
      setStatus({ phase: "done" });
    } catch (err) {
      setStatus({ phase: "error", message: (err as Error).message });
    }
  };

  const latest = valuation.length > 0 ? valuation[valuation.length - 1] : null;
  const earliestDate = valuation.length > 0 ? valuation[0].date : "";

  const unresolved = tickers.filter((t) => !t.ticker);

  const investedByDate = useMemo(() => {
    if (valuation.length === 0) return new Map<string, number>();
    return buildDailyInvested(
      transactions,
      valuation.map((v) => v.date),
    );
  }, [transactions, valuation]);

  const investedByDateForSelected = useMemo(() => {
    if (valuation.length === 0 || !selectedIsin) return new Map<string, number>();
    return buildDailyInvested(
      transactions.filter((t) => t.isin === selectedIsin),
      valuation.map((v) => v.date),
    );
  }, [transactions, valuation, selectedIsin]);

  const investedForChart = selectedIsin ? investedByDateForSelected : investedByDate;

  const marketValueForDay = (d: ValuationDay): number =>
    selectedIsin ? (d.perIsinEur[selectedIsin] ?? 0) : d.totalEur;

  const valueForDay = useMemo(
    () => (d: ValuationDay) => {
      const market = marketValueForDay(d);
      if (mode === "value") return market;
      const invested = investedForChart.get(d.date) ?? 0;
      return market - invested;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, investedForChart, selectedIsin],
  );

  const rangeStart = useMemo(() => {
    if (!latest) return "";
    if (range === "CUSTOM") return customRange.from || earliestDate;
    return rangeStartDate(range, latest.date, earliestDate);
  }, [range, customRange, latest, earliestDate]);

  const rangeEnd = useMemo(() => {
    if (!latest) return "";
    if (range === "CUSTOM" && customRange.to) return customRange.to;
    return latest.date;
  }, [range, customRange, latest]);

  const endDay = useMemo(
    () => valuation.find((v) => v.date === rangeEnd) ?? latest,
    [valuation, rangeEnd, latest],
  );

  const stockFirstDate = useMemo(() => {
    if (!selectedIsin) return null;
    const dates = transactions
      .filter((t) => t.isin === selectedIsin)
      .map((t) => t.date)
      .sort();
    return dates[0] ?? null;
  }, [transactions, selectedIsin]);

  const rangeData = useMemo(() => {
    const effectiveStart =
      stockFirstDate && stockFirstDate > rangeStart ? stockFirstDate : rangeStart;
    return valuation
      .filter((d) => d.date >= effectiveStart && d.date <= rangeEnd)
      .map((d) => ({ date: d.date, value: Math.round(valueForDay(d)) }));
  }, [valuation, rangeStart, rangeEnd, valueForDay, stockFirstDate]);

  const rangeChange = useMemo(() => {
    if (rangeData.length < 2 || !endDay) return null;
    // Anchor to the requested rangeStart (not the trimmed first chart point), so
    // shares purchased *during* the window are accounted as capital flow rather
    // than market gains. Without this, the chart's "+€/€%" disagreed with the
    // holdings table whenever a position was opened mid-window.
    const startDay = valuation.find((v) => v.date === rangeStart);
    const startMarket = startDay ? marketValueForDay(startDay) : 0;
    const endMarket = marketValueForDay(endDay);
    const startInvested = investedForChart.get(rangeStart) ?? 0;
    const endInvested = investedForChart.get(endDay.date) ?? 0;
    const abs = endMarket - startMarket - (endInvested - startInvested);
    const denom = mode === "value" ? startMarket || endInvested : endInvested;
    const pct = denom !== 0 ? abs / Math.abs(denom) : 0;
    return { abs, pct, start: startMarket, end: endMarket };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valuation, rangeStart, endDay, mode, investedForChart, selectedIsin]);

  const headlineValue = endDay ? valueForDay(endDay) : 0;

  // Drag-to-select on the chart: report the delta and % change between the two
  // anchor dates without affecting the chart's range.
  const dragStats = useMemo(() => {
    if (!dragSel || dragSel.startDate === dragSel.endDate) return null;
    const [a, b] =
      dragSel.startDate <= dragSel.endDate
        ? [dragSel.startDate, dragSel.endDate]
        : [dragSel.endDate, dragSel.startDate];
    const startEntry = rangeData.find((d) => d.date === a);
    const endEntry = rangeData.find((d) => d.date === b);
    if (!startEntry || !endEntry) return null;
    const abs = endEntry.value - startEntry.value;
    const pct = startEntry.value !== 0 ? abs / Math.abs(startEntry.value) : 0;
    return { from: a, to: b, abs, pct };
  }, [dragSel, rangeData]);

  const productByIsin = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of transactions) if (!m.has(t.isin)) m.set(t.isin, t.product);
    return m;
  }, [transactions]);

  const tickerByIsin = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of tickers) if (r.ticker) m.set(r.isin, r.ticker);
    return m;
  }, [tickers]);

  const holdings = useMemo(() => {
    if (!latest) return [];
    return computeHoldings(
      transactions,
      valuation,
      rangeStart,
      rangeEnd,
      productByIsin,
      tickerByIsin,
    );
  }, [transactions, valuation, rangeStart, rangeEnd, productByIsin, tickerByIsin]);

  const [sort, setSort] = useState<{ key: HoldingSortKey; dir: "asc" | "desc" }>({
    key: "valueEur",
    dir: "desc",
  });

  const toggleSort = (key: HoldingSortKey) =>
    setSort((s) =>
      s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
    );

  const matchesQuery = (q: string, ...fields: Array<string | null | undefined>) => {
    if (!q.trim()) return true;
    const needle = q.trim().toLowerCase();
    return fields.some((f) => f && f.toLowerCase().includes(needle));
  };

  const sortedHoldings = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...holdings]
      .filter((h) => matchesQuery(holdingsQuery, h.product, h.ticker, h.isin))
      .sort((a, b) => {
        const av = a[sort.key];
        const bv = b[sort.key];
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
      });
  }, [holdings, sort, holdingsQuery]);

  const filteredTickers = useMemo(
    () =>
      tickers.filter((t) =>
        matchesQuery(tickersQuery, t.isin, t.name, t.ticker, t.exchange),
      ),
    [tickers, tickersQuery],
  );

  const filteredTransactions = useMemo(
    () =>
      transactions.filter((t) =>
        matchesQuery(txQuery, t.product, t.isin, t.date, t.currency),
      ),
    [transactions, txQuery],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <header>
          <h1 className="text-3xl font-semibold tracking-tight">Girotracker</h1>
          <p className="text-muted-foreground text-sm">
            DEGIRO portfolio value over time
          </p>
        </header>

        <Card>
          <CardContent className={valuation.length > 0 ? "py-3" : "pt-6 space-y-3"}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
                e.target.value = "";
              }}
            />
            {valuation.length === 0 ? (
              <>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragOver(false);
                    const f = e.dataTransfer.files?.[0];
                    if (f) void handleFile(f);
                  }}
                  className={
                    "flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                    (dragOver
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50 hover:bg-accent/30")
                  }
                >
                  <p className="text-sm">
                    <span className="font-medium text-primary">Click to upload</span> or
                    drag and drop a CSV
                  </p>
                  <p className="text-xs text-muted-foreground">
                    DEGIRO Transactions export
                  </p>
                </div>
                {fileName && (
                  <p className="text-sm text-muted-foreground">
                    Loaded <span className="font-medium">{fileName}</span>
                  </p>
                )}
                {parseErrors.length > 0 && (
                  <div className="text-sm text-destructive">
                    {parseErrors.length} parse error
                    {parseErrors.length === 1 ? "" : "s"}:
                    <ul className="list-disc list-inside">
                      {parseErrors.slice(0, 5).map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {transactions.length > 0 && (
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={() => void compute()}
                      disabled={
                        status.phase !== "idle" &&
                        status.phase !== "done" &&
                        status.phase !== "error"
                      }
                    >
                      Compute portfolio
                    </Button>
                    <span className="text-sm text-muted-foreground">
                      {status.phase === "tickers" && "Resolving ISINs…"}
                      {status.phase === "prices" &&
                        `Fetching prices ${status.done}/${status.total}…`}
                      {status.phase === "fx" &&
                        `Fetching FX rates ${status.done}/${status.total}…`}
                      {status.phase === "computing" && "Computing valuation…"}
                      {status.phase === "error" && (
                        <span className="text-destructive">
                          Error: {status.message}
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-muted-foreground truncate">
                  Loaded <span className="font-medium text-foreground">{fileName}</span>
                  {status.phase !== "done" && status.phase !== "idle" && (
                    <span className="ml-3">
                      {status.phase === "tickers" && "Resolving ISINs…"}
                      {status.phase === "prices" &&
                        `Fetching prices ${status.done}/${status.total}…`}
                      {status.phase === "fx" &&
                        `Fetching FX rates ${status.done}/${status.total}…`}
                      {status.phase === "computing" && "Computing valuation…"}
                    </span>
                  )}
                  {status.phase === "error" && (
                    <span className="ml-3 text-destructive">
                      Error: {status.message}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    Upload new file
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => void compute()}
                    disabled={
                      status.phase !== "idle" &&
                      status.phase !== "done" &&
                      status.phase !== "error"
                    }
                  >
                    Recompute
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {stats && (
          <Card>
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Transactions</dt>
                  <dd className="text-lg font-medium">{stats.count}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Unique ISINs</dt>
                  <dd className="text-lg font-medium">{stats.isins}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Buys / Sells</dt>
                  <dd className="text-lg font-medium">
                    {stats.buys} / {stats.sells}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">First trade</dt>
                  <dd className="text-lg font-medium">{stats.first}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Last trade</dt>
                  <dd className="text-lg font-medium">{stats.last}</dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        )}

        {valuation.length > 0 && latest && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <span>
                  {selectedIsin
                    ? `${productByIsin.get(selectedIsin) ?? selectedIsin} over time`
                    : "Portfolio value over time"}
                </span>
                {selectedIsin && (
                  <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => setSelectedIsin(null)}
                  >
                    ← Back to portfolio
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <div className="text-sm text-muted-foreground">
                    {selectedIsin
                      ? mode === "return"
                        ? "Stock return"
                        : "Stock value"
                      : mode === "return"
                        ? "Total return"
                        : "Portfolio value"}{" "}
                    ({endDay?.date ?? latest.date})
                  </div>
                  <div className="flex items-baseline gap-3">
                    {privacy ? (
                      rangeChange && (
                        <span
                          className={
                            "text-3xl font-semibold tabular-nums " +
                            (rangeChange.pct >= 0 ? "text-emerald-500" : "text-red-500")
                          }
                        >
                          {fmtPct(rangeChange.pct)}
                        </span>
                      )
                    ) : (
                      <>
                        <span
                          className={
                            "text-3xl font-semibold tabular-nums " +
                            (mode === "return"
                              ? headlineValue >= 0
                                ? "text-emerald-500"
                                : "text-red-500"
                              : "")
                          }
                        >
                          {mode === "return" && headlineValue >= 0 ? "+" : ""}
                          {fmtEur(headlineValue)}
                        </span>
                        {rangeChange && (
                          <span
                            className={
                              "text-base tabular-nums " +
                              (rangeChange.abs >= 0 ? "text-emerald-500" : "text-red-500")
                            }
                          >
                            {rangeChange.abs >= 0 ? "+" : ""}
                            {fmtEur(rangeChange.abs)} ({fmtPct(rangeChange.pct)})
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  {!privacy && mode === "return" && endDay && (
                    <div className="text-xs text-muted-foreground mt-1 tabular-nums">
                      Capital invested:{" "}
                      {fmtEur(investedForChart.get(endDay.date) ?? 0)} · Market value:{" "}
                      {fmtEur(marketValueForDay(endDay))}
                    </div>
                  )}
                </div>
                <div className="flex flex-col items-end gap-3 ml-auto">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setPrivacy((p) => !p)}
                      title={privacy ? "Show values" : "Hide values"}
                      aria-label={privacy ? "Show values" : "Hide values"}
                    >
                      {privacy ? <EyeOff /> : <Eye />}
                    </Button>
                    <div className="inline-flex items-center rounded-lg border bg-muted/40 p-1">
                      {MODES.map((m) => (
                        <button
                          key={m.id}
                          onClick={() => setMode(m.id)}
                          className={
                            "px-4 py-1.5 rounded-md text-sm font-medium transition-colors " +
                            (mode === m.id
                              ? "bg-background text-foreground shadow-sm"
                              : "text-muted-foreground hover:text-foreground")
                          }
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <RangeSelector
                    value={range}
                    onChange={setRange}
                    customRange={customRange}
                    onCustomChange={setCustomRange}
                    earliestDate={earliestDate}
                    latestDate={latest?.date ?? today()}
                  />
                </div>
              </div>
              <div className="relative h-[420px] select-none">
                {dragStats && (
                  <div className="absolute top-2 left-1/2 -translate-x-1/2 z-10 pointer-events-none rounded-md border bg-popover/95 backdrop-blur px-3 py-1.5 shadow-sm text-xs tabular-nums flex items-center gap-2">
                    <span className="text-muted-foreground">{dragStats.from} → {dragStats.to}</span>
                    <span
                      className={
                        dragStats.abs >= 0 ? "text-emerald-500" : "text-red-500"
                      }
                    >
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
                    data={rangeData}
                    margin={{ top: 8, right: 16, bottom: 0, left: 0 }}
                    onMouseDown={(e) => {
                      if (!e?.activeLabel) return;
                      setDragSel({
                        startDate: String(e.activeLabel),
                        endDate: String(e.activeLabel),
                      });
                      setDragging(true);
                    }}
                    onMouseMove={(e) => {
                      if (!dragging || !e?.activeLabel) return;
                      setDragSel((prev) =>
                        prev
                          ? { ...prev, endDate: String(e.activeLabel) }
                          : prev,
                      );
                    }}
                    onMouseUp={() => {
                      setDragging(false);
                      // A click without a drag (start === end) clears the selection.
                      setDragSel((prev) =>
                        prev && prev.startDate === prev.endDate ? null : prev,
                      );
                    }}
                    onMouseLeave={() => setDragging(false)}
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
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--popover-foreground)",
                      }}
                      formatter={(v) => (privacy ? "•••" : fmtEur(Number(v)))}
                      labelStyle={{ color: "var(--muted-foreground)" }}
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
                      type="monotone"
                      dataKey="value"
                      stroke="var(--primary)"
                      strokeWidth={2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        )}

        {transactions.length > 0 && (
          <Card>
            <CardContent className="pt-6">
              <Tabs defaultValue="holdings">
                <TabsList>
                  <TabsTrigger value="holdings">Holdings</TabsTrigger>
                  <TabsTrigger value="tickers">
                    Tickers
                    {tickers.length > 0 &&
                      ` (${tickers.length - unresolved.length}/${tickers.length})`}
                  </TabsTrigger>
                  <TabsTrigger value="transactions">
                    Transactions ({transactions.length})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="holdings" className="mt-4 space-y-3">
                  {valuation.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Click "Compute portfolio" to see per-stock returns.
                    </p>
                  ) : (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <Input
                          type="search"
                          placeholder="Filter by name, ticker or ISIN…"
                          value={holdingsQuery}
                          onChange={(e) => setHoldingsQuery(e.target.value)}
                          className="max-w-xs"
                        />
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => setPrivacy((p) => !p)}
                            title={privacy ? "Show values" : "Hide values"}
                            aria-label={privacy ? "Show values" : "Hide values"}
                          >
                            {privacy ? <EyeOff /> : <Eye />}
                          </Button>
                          <RangeSelector
                            value={range}
                            onChange={setRange}
                            customRange={customRange}
                            onCustomChange={setCustomRange}
                            earliestDate={earliestDate}
                            latestDate={latest?.date ?? today()}
                          />
                        </div>
                      </div>
                      <div className="overflow-x-auto">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <SortableTh sortKey="product" sort={sort} onToggle={toggleSort}>
                                Stock
                              </SortableTh>
                              <SortableTh sortKey="ticker" sort={sort} onToggle={toggleSort}>
                                Ticker
                              </SortableTh>
                              <SortableTh sortKey="quantity" sort={sort} onToggle={toggleSort} align="right">
                                Qty
                              </SortableTh>
                              <SortableTh sortKey="valueEur" sort={sort} onToggle={toggleSort} align="right">
                                Value
                              </SortableTh>
                              <SortableTh sortKey="investedEur" sort={sort} onToggle={toggleSort} align="right">
                                Invested
                              </SortableTh>
                              <SortableTh sortKey="returnEur" sort={sort} onToggle={toggleSort} align="right">
                                Return
                              </SortableTh>
                              <SortableTh sortKey="returnPct" sort={sort} onToggle={toggleSort} align="right">
                                Return %
                              </SortableTh>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sortedHoldings.map((h) => (
                              <TableRow
                                key={h.isin}
                                onClick={() =>
                                  setSelectedIsin((prev) =>
                                    prev === h.isin ? null : h.isin,
                                  )
                                }
                                className={
                                  "cursor-pointer " +
                                  (selectedIsin === h.isin ? "bg-muted/60" : "")
                                }
                              >
                                <TableCell
                                  className="max-w-[280px] truncate"
                                  title={h.product}
                                >
                                  {h.product}
                                </TableCell>
                                <TableCell className="font-mono text-xs">
                                  {h.ticker ?? "—"}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {fmtNum(h.quantity, 0)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums">
                                  {privacy ? "•••" : fmtEur(h.valueEur)}
                                </TableCell>
                                <TableCell className="text-right tabular-nums text-muted-foreground">
                                  {privacy ? "•••" : fmtEur(h.investedEur)}
                                </TableCell>
                                <TableCell
                                  className={
                                    "text-right tabular-nums " +
                                    (h.returnEur >= 0
                                      ? "text-emerald-500"
                                      : "text-red-500")
                                  }
                                >
                                  {privacy
                                    ? "•••"
                                    : `${h.returnEur >= 0 ? "+" : ""}${fmtEur(h.returnEur)}`}
                                </TableCell>
                                <TableCell
                                  className={
                                    "text-right tabular-nums " +
                                    (h.returnPct >= 0
                                      ? "text-emerald-500"
                                      : "text-red-500")
                                  }
                                >
                                  {h.returnPct >= 0 ? "+" : ""}
                                  {(h.returnPct * 100).toLocaleString("nl-NL", {
                                    minimumFractionDigits: 1,
                                    maximumFractionDigits: 1,
                                  })}
                                  %
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="tickers" className="mt-4 space-y-3">
                  {tickers.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Click "Compute portfolio" to resolve tickers.
                    </p>
                  ) : (
                    <>
                      <Input
                        type="search"
                        placeholder="Filter by ISIN, name, ticker or exchange…"
                        value={tickersQuery}
                        onChange={(e) => setTickersQuery(e.target.value)}
                        className="max-w-xs"
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
                            {filteredTickers.map((t) => (
                              <TableRow key={t.isin}>
                                <TableCell className="font-mono text-xs">
                                  {t.isin}
                                </TableCell>
                                <TableCell
                                  className="max-w-[280px] truncate"
                                  title={t.name ?? ""}
                                >
                                  {t.name ?? "—"}
                                </TableCell>
                                <TableCell className="font-mono">
                                  {t.ticker ?? "—"}
                                </TableCell>
                                <TableCell>{t.exchange ?? "—"}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {t.source}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </>
                  )}
                </TabsContent>

                <TabsContent value="transactions" className="mt-4 space-y-3">
                  <Input
                    type="search"
                    placeholder="Filter by date, product, ISIN or currency…"
                    value={txQuery}
                    onChange={(e) => setTxQuery(e.target.value)}
                    className="max-w-xs"
                  />
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Date</TableHead>
                          <TableHead>Product</TableHead>
                          <TableHead>ISIN</TableHead>
                          <TableHead className="text-right">Qty</TableHead>
                          <TableHead className="text-right">Price</TableHead>
                          <TableHead>Ccy</TableHead>
                          <TableHead className="text-right">Total EUR</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredTransactions
                          .slice()
                          .reverse()
                          .map((t, i) => (
                            <TableRow key={`${t.orderId}-${i}`}>
                              <TableCell className="whitespace-nowrap">
                                {t.date}
                              </TableCell>
                              <TableCell
                                className="max-w-[280px] truncate"
                                title={t.product}
                              >
                                {t.product}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {t.isin}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {fmtNum(t.quantity, 0)}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {fmtNum(t.price, 4)}
                              </TableCell>
                              <TableCell>{t.currency}</TableCell>
                              <TableCell className="text-right tabular-nums">
                                {fmtNum(t.totalEur)}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default App;
