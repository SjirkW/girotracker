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
import { computeTwr, type ValuationDay } from "@/lib/portfolio";
import type { Transaction } from "@/lib/parseCsv";

type Props = {
  hasValuation: boolean;
  valuation: ValuationDay[];
  transactions: Transaction[];
  privacy: boolean;
};

type Row = {
  year: number;
  startDate: string | null; // first trading day ≥ Jan 1 of this year (peildatum proxy)
  startValueEur: number | null;
  endDate: string | null; // last valuation date within this year
  endValueEur: number | null;
  netDepositedEur: number; // sum of (−totalEur) for buys minus sells
  capitalReturnEur: number | null; // endValue − startValue − netDeposited
  capitalReturnPct: number | null; // capitalReturnEur / startValueEur
};

/**
 * Two boxen-3 regimes covered side by side:
 *
 *  - **Current (forfaitair)**: tax on a *fictional* yield computed from the
 *    asset value on the peildatum (1 January). Only the start-of-year value
 *    matters → "Jan 1 value" column.
 *  - **New (werkelijk rendement, 2027+ / tegenbewijsregeling 2023-2026)**:
 *    tax on the *actual* return = change in value + dividends − costs.
 *    We can compute the change-in-value piece exactly from the valuation
 *    history; dividends would need a separate DEGIRO report.
 *
 * Capital return formula: end_value − start_value − net_deposited_during_year.
 * This isolates market gains/losses from cash you put in or took out.
 */
export function TaxTab({
  hasValuation,
  valuation,
  transactions,
  privacy,
}: Props) {
  const rows = useMemo<Row[]>(() => {
    if (valuation.length === 0) return [];
    const firstYear = Number(valuation[0].date.slice(0, 4));
    const lastYear = Number(valuation[valuation.length - 1].date.slice(0, 4));
    // Cash-flow map for the TWR helper: positive on buys, negative on sells.
    // totalEur is negative for buys in our CSV convention.
    const cfByDate = new Map<string, number>();
    for (const t of transactions)
      cfByDate.set(t.date, (cfByDate.get(t.date) ?? 0) - t.totalEur);

    const out: Row[] = [];
    for (let year = firstYear; year <= lastYear; year++) {
      const yearStart = `${year}-01-01`;
      const yearEnd = `${year}-12-31`;

      // peildatum value: ZERO if the user wasn't invested yet on Jan 1
      // (i.e. their first valuation entry is later in this year). Otherwise
      // use the first trading-day close on/after Jan 1 as a proxy.
      const startIdx = valuation.findIndex((v) => v.date >= yearStart);
      const startDay = startIdx >= 0 ? valuation[startIdx] : null;
      const peildatumIsBeforeData =
        startDay != null && startDay.date > yearStart;
      const startValue: number | null = startDay
        ? peildatumIsBeforeData
          ? 0
          : startDay.totalEur
        : null;

      // End-of-year value: last valuation entry ≤ Dec 31.
      let endDay: ValuationDay | null = null;
      for (let i = valuation.length - 1; i >= 0; i--) {
        if (valuation[i].date <= yearEnd) {
          endDay = valuation[i];
          break;
        }
      }

      let netDeposited = 0;
      for (const t of transactions) {
        if (t.date >= yearStart && t.date <= yearEnd) {
          netDeposited += -t.totalEur;
        }
      }
      const endValue = endDay?.totalEur ?? null;
      const capitalReturn =
        startValue != null && endValue != null
          ? endValue - startValue - netDeposited
          : null;

      // Return % via TWR (Modified Dietz, daily-chained) — handles
      // intra-year deposits properly so a year with a tiny start value and
      // big mid-year deposits doesn't produce a -138% phantom.
      const twrFrom = peildatumIsBeforeData ? startDay!.date : yearStart;
      const twrTo = endDay?.date ?? yearEnd;
      const capitalReturnPct =
        endDay && startDay ? computeTwr(valuation, cfByDate, twrFrom, twrTo) : null;

      out.push({
        year,
        startDate: peildatumIsBeforeData ? yearStart : startDay?.date ?? null,
        startValueEur: startValue,
        endDate: endDay?.date ?? null,
        endValueEur: endValue,
        netDepositedEur: netDeposited,
        capitalReturnEur: capitalReturn,
        capitalReturnPct,
      });
    }
    return out;
  }, [valuation, transactions]);

  if (!hasValuation) {
    return (
      <p className="text-sm text-muted-foreground">
        Click "Compute portfolio" to see the box 3 snapshot per year.
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No valuation data.</p>;
  }
  return (
    <>
      <p className="text-xs text-muted-foreground max-w-2xl">
        Snapshots for both Dutch box 3 regimes:{" "}
        <span className="font-medium">huidig forfaitair</span> (peildatum 1
        januari) en <span className="font-medium">werkelijk rendement</span>{" "}
        (vanaf 2027, of via de tegenbewijsregeling 2023+). Markten zijn op 1
        januari gesloten, dus we tonen de slotkoers van de eerstvolgende
        handelsdag.
      </p>
      <div className="overflow-x-auto">
        <Table className="text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead>Year</TableHead>
              <TableHead className="text-right">
                Jan 1 value (€)
                <div className="text-[10px] font-normal text-muted-foreground">
                  forfaitair / peildatum
                </div>
              </TableHead>
              <TableHead className="text-right">Year-end value (€)</TableHead>
              <TableHead className="text-right">Net deposited (€)</TableHead>
              <TableHead className="text-right">
                Capital return (€)
                <div className="text-[10px] font-normal text-muted-foreground">
                  werkelijk rendement
                </div>
              </TableHead>
              <TableHead className="text-right">Return %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.year}>
                <TableCell className="font-medium">{r.year}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {privacy
                    ? "•••"
                    : r.startValueEur != null
                      ? fmtEur(r.startValueEur)
                      : "—"}
                  {r.startDate && r.startDate !== `${r.year}-01-02` && (
                    <div className="text-[10px] font-normal text-muted-foreground">
                      {r.startValueEur === 0
                        ? "not invested yet"
                        : r.startDate}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {privacy
                    ? "•••"
                    : r.endValueEur != null
                      ? fmtEur(r.endValueEur)
                      : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {privacy
                    ? "•••"
                    : `${r.netDepositedEur >= 0 ? "+" : ""}${fmtEur(r.netDepositedEur)}`}
                </TableCell>
                <TableCell
                  className={
                    "text-right tabular-nums font-medium " +
                    (r.capitalReturnEur == null
                      ? ""
                      : r.capitalReturnEur >= 0
                        ? "text-emerald-500"
                        : "text-red-500")
                  }
                >
                  {privacy
                    ? "•••"
                    : r.capitalReturnEur != null
                      ? `${r.capitalReturnEur >= 0 ? "+" : ""}${fmtEur(r.capitalReturnEur)}`
                      : "—"}
                </TableCell>
                <TableCell
                  className={
                    "text-right tabular-nums " +
                    (r.capitalReturnPct == null
                      ? ""
                      : r.capitalReturnPct >= 0
                        ? "text-emerald-500"
                        : "text-red-500")
                  }
                >
                  {r.capitalReturnPct != null
                    ? `${r.capitalReturnPct >= 0 ? "+" : ""}${(r.capitalReturnPct * 100).toLocaleString(
                        "nl-NL",
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 },
                      )}%`
                    : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground max-w-2xl">
        <span className="font-medium">Capital return (€)</span> = year-end
        value − Jan 1 value − net deposited during the year. The{" "}
        <span className="font-medium">Return %</span> is a time-weighted
        return (Modified Dietz, daily-chained) so a year with a small Jan 1
        balance and big mid-year deposits doesn't produce a phantom
        triple-digit figure.{" "}
        <span className="font-medium">
          Dividends, interest, and broker costs are NOT included
        </span>{" "}
        — DEGIRO's <code>Transactions.csv</code> doesn't carry them. For a
        complete <em>werkelijk rendement</em> figure you'd add dividends from
        DEGIRO's account/dividend report. Convenience only, not tax advice.
      </p>
    </>
  );
}
