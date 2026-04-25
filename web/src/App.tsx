import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchPrices, resolveTickers, type TickerLookupResult } from "@/lib/api";
import { parseDegiroCsv, type Transaction } from "@/lib/parseCsv";
import {
  buildDailyHoldings,
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

// Run async tasks with bounded concurrency, returning results in input order.
async function pMapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

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

      // Fetch prices for every resolved ticker. We also capture each ticker's
      // currency from Yahoo's metadata (NOT the CSV's transaction currency,
      // which can differ from the actual listing currency on Yahoo — e.g. an
      // ETF bought in EUR on Milan but resolved to a London listing in GBp).
      const tickersToFetch = [...new Set(isinToTicker.values())];
      let pricesDone = 0;
      setStatus({ phase: "prices", done: 0, total: tickersToFetch.length });
      const pricesByTicker = new Map<string, Map<string, number>>();
      const currencyByTicker = new Map<string, string>();
      const priceDates = enumerateDates(fromDate, toDate);
      await pMapLimit(tickersToFetch, 4, async (ticker) => {
        try {
          const raw = await fetchPrices(ticker, fromDate, toDate);
          // Normalize per-row (handles GBp → GBP scaling).
          const normalized = raw.map((p) => {
            const n = normalizePriceCurrency(p.close, p.currency);
            return { date: p.date, close: n.close, currency: n.currency };
          });
          if (normalized.length > 0) {
            currencyByTicker.set(ticker, normalized[0].currency);
          }
          pricesByTicker.set(ticker, forwardFillDaily(normalized, priceDates));
        } catch (err) {
          console.warn(`prices failed for ${ticker}:`, err);
          pricesByTicker.set(ticker, new Map());
        }
        pricesDone++;
        setStatus({ phase: "prices", done: pricesDone, total: tickersToFetch.length });
      });

      // Fetch FX for every non-EUR currency that any ticker is actually quoted
      // in on Yahoo.
      const currencies = [...new Set(currencyByTicker.values())].filter(
        (c) => c !== "EUR",
      );
      let fxDone = 0;
      setStatus({ phase: "fx", done: 0, total: currencies.length });
      const fxByCurrency = new Map<string, Map<string, number>>();
      await pMapLimit(currencies, 3, async (ccy) => {
        const symbol = fxSymbolFor(ccy);
        if (!symbol) return;
        try {
          const prices = await fetchPrices(symbol, fromDate, toDate);
          fxByCurrency.set(ccy, forwardFillDaily(prices, priceDates));
        } catch (err) {
          console.warn(`fx failed for ${ccy}:`, err);
          fxByCurrency.set(ccy, new Map());
        }
        fxDone++;
        setStatus({ phase: "fx", done: fxDone, total: currencies.length });
      });

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
  const peak = valuation.reduce(
    (acc, d) => (d.totalEur > acc ? d.totalEur : acc),
    0,
  );

  const unresolved = tickers.filter((t) => !t.ticker);

  const chartData = useMemo(
    () =>
      valuation.map((d) => ({
        date: d.date,
        value: Math.round(d.totalEur),
      })),
    [valuation],
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
          <CardHeader>
            <CardTitle>Upload DEGIRO transactions CSV</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleFile(f);
              }}
            />
            {fileName && (
              <p className="text-sm text-muted-foreground">
                Loaded <span className="font-medium">{fileName}</span>
              </p>
            )}
            {parseErrors.length > 0 && (
              <div className="text-sm text-destructive">
                {parseErrors.length} parse error{parseErrors.length === 1 ? "" : "s"}:
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
                  {status.phase === "done" ? "Recompute portfolio" : "Compute portfolio"}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {status.phase === "tickers" && "Resolving ISINs…"}
                  {status.phase === "prices" &&
                    `Fetching prices ${status.done}/${status.total}…`}
                  {status.phase === "fx" &&
                    `Fetching FX rates ${status.done}/${status.total}…`}
                  {status.phase === "computing" && "Computing valuation…"}
                  {status.phase === "error" && (
                    <span className="text-destructive">Error: {status.message}</span>
                  )}
                </span>
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
              <CardTitle>Portfolio value over time</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
                <div>
                  <dt className="text-muted-foreground">Latest ({latest.date})</dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    {fmtEur(latest.totalEur)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">All-time peak</dt>
                  <dd className="text-2xl font-semibold tabular-nums">{fmtEur(peak)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Days</dt>
                  <dd className="text-2xl font-semibold tabular-nums">
                    {valuation.length}
                  </dd>
                </div>
              </div>
              <div className="h-[420px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis
                      dataKey="date"
                      minTickGap={48}
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    />
                    <YAxis
                      tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                      tickFormatter={(v) =>
                        new Intl.NumberFormat("nl-NL", { notation: "compact" }).format(v)
                      }
                      width={72}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        color: "var(--popover-foreground)",
                      }}
                      formatter={(v) => fmtEur(Number(v))}
                      labelStyle={{ color: "var(--muted-foreground)" }}
                    />
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

        {tickers.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>
                Resolved tickers ({tickers.length - unresolved.length}/{tickers.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {unresolved.length > 0 && (
                <p className="text-sm text-destructive mb-3">
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
                    {tickers.map((t) => (
                      <TableRow key={t.isin}>
                        <TableCell className="font-mono text-xs">{t.isin}</TableCell>
                        <TableCell className="max-w-[280px] truncate" title={t.name ?? ""}>
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
            </CardContent>
          </Card>
        )}

        {transactions.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Transactions</CardTitle>
            </CardHeader>
            <CardContent>
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
                    {transactions
                      .slice()
                      .reverse()
                      .map((t, i) => (
                        <TableRow key={`${t.orderId}-${i}`}>
                          <TableCell className="whitespace-nowrap">{t.date}</TableCell>
                          <TableCell className="max-w-[280px] truncate" title={t.product}>
                            {t.product}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{t.isin}</TableCell>
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
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

export default App;
