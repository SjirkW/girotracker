import Papa from "papaparse";

export type Transaction = {
  date: string;          // ISO YYYY-MM-DD
  time: string;          // HH:MM
  product: string;
  isin: string;
  exchange: string;
  venue: string;
  quantity: number;      // signed: positive = buy, negative = sell
  price: number;         // price per share in local currency
  currency: string;      // local currency (USD, EUR, SEK, ...)
  localValue: number;    // signed local-currency value of the trade
  valueEur: number;      // signed EUR value of the trade (excl. fees)
  fxRate: number | null; // local→EUR exchange rate at trade time
  fxFee: number;         // signed EUR
  txFee: number;         // signed EUR
  totalEur: number;      // signed EUR including fees
  orderId: string;
};

const parseDutchNumber = (raw: string | undefined | null): number => {
  if (raw == null) return NaN;
  const s = String(raw).trim();
  if (s === "") return NaN;
  return Number(s.replace(/\./g, "").replace(",", "."));
};

const parseDutchDate = (raw: string): string => {
  const [d, m, y] = raw.split("-");
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
};

export type ParseResult = {
  transactions: Transaction[];
  errors: string[];
};

export const parseDegiroCsv = (csvText: string): ParseResult => {
  const result = Papa.parse<string[]>(csvText, {
    skipEmptyLines: true,
  });

  const errors: string[] = result.errors.map(
    (e) => `Row ${e.row}: ${e.message}`,
  );
  const rows = result.data;
  if (rows.length === 0) {
    return { transactions: [], errors: ["CSV is empty"] };
  }

  const transactions: Transaction[] = [];
  // First row is the header — skip it.
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length === 0) continue;
    try {
      const tx: Transaction = {
        date: parseDutchDate(r[0]),
        time: r[1] ?? "",
        product: r[2] ?? "",
        isin: r[3] ?? "",
        exchange: r[4] ?? "",
        venue: r[5] ?? "",
        quantity: parseDutchNumber(r[6]),
        price: parseDutchNumber(r[7]),
        currency: r[8] ?? "",
        localValue: parseDutchNumber(r[9]),
        // r[10] is the local-currency code (duplicate)
        valueEur: parseDutchNumber(r[11]),
        fxRate: r[12] ? parseDutchNumber(r[12]) : null,
        fxFee: parseDutchNumber(r[13]) || 0,
        txFee: parseDutchNumber(r[14]) || 0,
        totalEur: parseDutchNumber(r[15]),
        orderId: r[16] ?? "",
      };
      transactions.push(tx);
    } catch (err) {
      errors.push(`Row ${i}: ${(err as Error).message}`);
    }
  }

  // CSV is newest-first; sort oldest-first for downstream processing.
  transactions.sort((a, b) =>
    a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date),
  );

  return { transactions, errors };
};
