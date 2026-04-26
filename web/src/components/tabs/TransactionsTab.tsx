import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Transaction } from "@/lib/parseCsv";
import { fmtNum } from "@/lib/format";

type Props = {
  filtered: Transaction[];
  query: string;
  onQueryChange: (v: string) => void;
};

export function TransactionsTab({ filtered, query, onQueryChange }: Props) {
  return (
    <>
      <Input
        type="search"
        placeholder="Filter by date, product, ISIN or currency…"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        className="md:hidden"
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
            {filtered
              .slice()
              .reverse()
              .map((t, i) => (
                <TableRow key={`${t.orderId}-${i}`}>
                  <TableCell className="whitespace-nowrap">{t.date}</TableCell>
                  <TableCell
                    className="max-w-[280px] truncate"
                    title={t.product}
                  >
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
    </>
  );
}
