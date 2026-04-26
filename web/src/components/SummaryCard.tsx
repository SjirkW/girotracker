import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Props = {
  count: number;
  isins: number;
  buys: number;
  sells: number;
  first: string;
  last: string;
};

export function SummaryCard({ count, isins, buys, sells, first, last }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 sm:grid-cols-5 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Transactions</dt>
            <dd className="text-lg font-medium">{count}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Unique ISINs</dt>
            <dd className="text-lg font-medium">{isins}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Buys / Sells</dt>
            <dd className="text-lg font-medium">
              {buys} / {sells}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">First trade</dt>
            <dd className="text-lg font-medium">{first}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Last trade</dt>
            <dd className="text-lg font-medium">{last}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
