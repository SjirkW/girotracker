import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HoldingsTab } from "@/components/tabs/HoldingsTab";
import { LiveTab } from "@/components/tabs/LiveTab";
import { CandlesTab } from "@/components/tabs/CandlesTab";
import { StopLossTab } from "@/components/tabs/StopLossTab";
import { CurrencyTab } from "@/components/tabs/CurrencyTab";
import { TaxTab } from "@/components/tabs/TaxTab";
import { TickersTab } from "@/components/tabs/TickersTab";
import { TransactionsTab } from "@/components/tabs/TransactionsTab";
import type { Range } from "@/components/RangeSelector";
import type { Transaction } from "@/lib/parseCsv";
import type { HoldingRow, ValuationDay } from "@/lib/portfolio";
import type { TickerLookupResult } from "@/lib/api";
import type { NativePrice } from "@/lib/session";

type Props = {
  // Raw data
  transactions: Transaction[];
  valuation: ValuationDay[];
  tickers: TickerLookupResult[];
  nativePrices: Record<string, NativePrice>;
  lifetimeHoldings: HoldingRow[];
  dividendsByYear: Record<string, number>;
  dividendsByIsin: Record<string, number>;

  // Shared derivations / metadata
  productByIsin: Map<string, string>;
  tickerByIsin: Map<string, string>;
  rangeStart: string;
  rangeEnd: string;
  earliestDate: string;
  latestDate: string;

  // Shared UI state (lifted because the chart also reads/writes it)
  privacy: boolean;
  onTogglePrivacy: () => void;
  range: Range;
  onRangeChange: (r: Range) => void;
  customRange: { from: string; to: string };
  onCustomRangeChange: (r: { from: string; to: string }) => void;
  selectedIsin: string | null;
  onSelectIsin: (isin: string | null) => void;
};

export function DataTabsCard({
  transactions,
  valuation,
  tickers,
  nativePrices,
  lifetimeHoldings,
  dividendsByYear,
  dividendsByIsin,
  productByIsin,
  tickerByIsin,
  rangeStart,
  rangeEnd,
  earliestDate,
  latestDate,
  privacy,
  onTogglePrivacy,
  range,
  onRangeChange,
  customRange,
  onCustomRangeChange,
  selectedIsin,
  onSelectIsin,
}: Props) {
  const [activeTab, setActiveTab] = useState("holdings");
  const [holdingsQuery, setHoldingsQuery] = useState("");
  const [tickersQuery, setTickersQuery] = useState("");
  const [txQuery, setTxQuery] = useState("");

  const unresolvedCount = useMemo(
    () => tickers.filter((t) => !t.ticker).length,
    [tickers],
  );

  // The shared filter input above the tabs writes into whichever query state
  // matches the active tab. Stop loss / currency / live don't need a text filter.
  const sharedFilter = (() => {
    if (
      activeTab === "stoploss" ||
      activeTab === "currency" ||
      activeTab === "live" ||
      activeTab === "candles" ||
      activeTab === "tax"
    )
      return null;
    const placeholder =
      activeTab === "tickers"
        ? "Filter by ISIN, name, ticker or exchange…"
        : activeTab === "transactions"
          ? "Filter by date, product, ISIN or currency…"
          : "Filter by name, ticker or ISIN…";
    const value =
      activeTab === "tickers"
        ? tickersQuery
        : activeTab === "transactions"
          ? txQuery
          : holdingsQuery;
    const setValue =
      activeTab === "tickers"
        ? setTickersQuery
        : activeTab === "transactions"
          ? setTxQuery
          : setHoldingsQuery;
    return { placeholder, value, setValue };
  })();

  return (
    <Card>
      <CardContent>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
              <TabsList>
                <TabsTrigger value="holdings">Holdings</TabsTrigger>
                <TabsTrigger value="live">Live</TabsTrigger>
                <TabsTrigger value="candles">Candles</TabsTrigger>
                <TabsTrigger value="stoploss">Stop loss</TabsTrigger>
                <TabsTrigger value="currency">Currency</TabsTrigger>
                <TabsTrigger value="tax">Box 3</TabsTrigger>
                <TabsTrigger value="tickers">
                  Tickers
                  {tickers.length > 0 &&
                    ` (${tickers.length - unresolvedCount}/${tickers.length})`}
                </TabsTrigger>
                <TabsTrigger value="transactions">
                  Transactions ({transactions.length})
                </TabsTrigger>
              </TabsList>
            </div>
            {/* Inline filter on viewports wide enough to fit it next to the
                tabs; on narrower screens, each tab's content shows its own
                filter input below. The eye sits left of the search on desktop;
                on mobile (search hidden) it lands at the right end via the
                parent's justify-between. */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onTogglePrivacy}
                title={privacy ? "Show values" : "Hide values"}
                aria-label={privacy ? "Show values" : "Hide values"}
                className="shrink-0"
              >
                {privacy ? <EyeOff /> : <Eye />}
              </Button>
              {sharedFilter && (
                <Input
                  type="search"
                  placeholder={sharedFilter.placeholder}
                  value={sharedFilter.value}
                  onChange={(e) => sharedFilter.setValue(e.target.value)}
                  className="hidden md:block max-w-xs"
                />
              )}
            </div>
          </div>

          <TabsContent value="holdings" className="mt-4 space-y-3">
            <HoldingsTab
              hasValuation={valuation.length > 0}
              transactions={transactions}
              valuation={valuation}
              rangeStart={rangeStart}
              rangeEnd={rangeEnd}
              productByIsin={productByIsin}
              tickerByIsin={tickerByIsin}
              dividendsByIsin={dividendsByIsin}
              privacy={privacy}
              query={holdingsQuery}
              onQueryChange={setHoldingsQuery}
              range={range}
              onRangeChange={onRangeChange}
              customRange={customRange}
              onCustomRangeChange={onCustomRangeChange}
              earliestDate={earliestDate}
              latestDate={latestDate}
              selectedIsin={selectedIsin}
              onSelectIsin={onSelectIsin}
            />
          </TabsContent>

          <TabsContent value="live" className="mt-4 space-y-3">
            <LiveTab
              hasValuation={valuation.length > 0}
              lifetimeHoldings={lifetimeHoldings}
              privacy={privacy}
            />
          </TabsContent>

          <TabsContent value="candles" className="mt-4 space-y-3">
            <CandlesTab
              hasValuation={valuation.length > 0}
              lifetimeHoldings={lifetimeHoldings}
            />
          </TabsContent>

          <TabsContent value="stoploss" className="mt-4 space-y-3">
            <StopLossTab
              hasValuation={valuation.length > 0}
              lifetimeHoldings={lifetimeHoldings}
              nativePrices={nativePrices}
              privacy={privacy}
            />
          </TabsContent>

          <TabsContent value="currency" className="mt-4 space-y-3">
            <CurrencyTab
              hasValuation={valuation.length > 0}
              lifetimeHoldings={lifetimeHoldings}
              transactions={transactions}
              nativePrices={nativePrices}
              privacy={privacy}
            />
          </TabsContent>

          <TabsContent value="tax" className="mt-4 space-y-3">
            <TaxTab
              hasValuation={valuation.length > 0}
              valuation={valuation}
              transactions={transactions}
              dividendsByYear={dividendsByYear}
              privacy={privacy}
            />
          </TabsContent>

          <TabsContent value="tickers" className="mt-4 space-y-3">
            <TickersTab
              tickers={tickers}
              query={tickersQuery}
              onQueryChange={setTickersQuery}
            />
          </TabsContent>

          <TabsContent value="transactions" className="mt-4 space-y-3">
            <TransactionsTab
              transactions={transactions}
              query={txQuery}
              onQueryChange={setTxQuery}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
