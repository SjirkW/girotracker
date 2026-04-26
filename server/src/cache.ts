import { db, type IsinMapRow, type PriceRow, type FetchLogRow } from "./db.js";

const today = (): string => new Date().toISOString().slice(0, 10);

const getIsinStmt = db.prepare<[string], IsinMapRow>(
  "SELECT * FROM isin_ticker_map WHERE isin = ?",
);
const upsertIsinStmt = db.prepare(
  `INSERT INTO isin_ticker_map (isin, ticker, exchange, name, fetched_at)
   VALUES (@isin, @ticker, @exchange, @name, @fetched_at)
   ON CONFLICT(isin) DO UPDATE SET
     ticker = excluded.ticker,
     exchange = excluded.exchange,
     name = excluded.name,
     fetched_at = excluded.fetched_at`,
);

export const getCachedIsin = (isin: string): IsinMapRow | undefined =>
  getIsinStmt.get(isin);

export const upsertIsin = (entry: {
  isin: string;
  ticker: string | null;
  exchange?: string | null;
  name?: string | null;
}) => {
  upsertIsinStmt.run({
    isin: entry.isin,
    ticker: entry.ticker,
    exchange: entry.exchange ?? null,
    name: entry.name ?? null,
    fetched_at: new Date().toISOString(),
  });
};

const getPricesStmt = db.prepare<[string, string, string], PriceRow>(
  "SELECT * FROM prices WHERE ticker = ? AND date >= ? AND date <= ? ORDER BY date ASC",
);
const insertPriceStmt = db.prepare(
  `INSERT INTO prices (ticker, date, close, open, high, low, currency)
   VALUES (@ticker, @date, @close, @open, @high, @low, @currency)
   ON CONFLICT(ticker, date) DO UPDATE SET
     close = excluded.close,
     open = excluded.open,
     high = excluded.high,
     low = excluded.low,
     currency = excluded.currency`,
);
const insertPricesTx = db.transaction((rows: PriceRow[]) => {
  for (const row of rows) insertPriceStmt.run(row);
});

export const getCachedPrices = (
  ticker: string,
  fromDate: string,
  toDate: string,
): PriceRow[] => getPricesStmt.all(ticker, fromDate, toDate);

export const insertPrices = (rows: PriceRow[]) => {
  if (rows.length === 0) return;
  insertPricesTx(rows);
};

const getFetchLogStmt = db.prepare<[string], FetchLogRow>(
  "SELECT * FROM fetch_log WHERE ticker = ?",
);
const upsertFetchLogStmt = db.prepare(
  `INSERT INTO fetch_log (ticker, first_fetched_date, last_fetched_date, last_fetched_at)
   VALUES (@ticker, @first_fetched_date, @last_fetched_date, @last_fetched_at)
   ON CONFLICT(ticker) DO UPDATE SET
     first_fetched_date = MIN(fetch_log.first_fetched_date, excluded.first_fetched_date),
     last_fetched_date = MAX(fetch_log.last_fetched_date, excluded.last_fetched_date),
     last_fetched_at = excluded.last_fetched_at`,
);

export const getFetchLog = (ticker: string): FetchLogRow | undefined =>
  getFetchLogStmt.get(ticker);

export const recordFetch = (
  ticker: string,
  firstDate: string,
  lastDate: string,
) => {
  upsertFetchLogStmt.run({
    ticker,
    first_fetched_date: firstDate,
    last_fetched_date: lastDate,
    last_fetched_at: new Date().toISOString(),
  });
};

const countMissingOhlcStmt = db.prepare<[string, string, string], { c: number }>(
  "SELECT COUNT(*) AS c FROM prices WHERE ticker = ? AND date >= ? AND date <= ? " +
    "AND (open IS NULL OR high IS NULL OR low IS NULL)",
);

/**
 * Given a requested [from, to] window for a ticker, return the sub-windows
 * that are NOT yet covered by previous fetches. We treat any date <= today
 * as final (markets close), so historic gaps never need re-fetching, only
 * gaps at the head/tail of what we already have. Empty window means: nothing
 * to fetch, cache is sufficient.
 *
 * Also forces a refresh of the trailing 30-day window when any cached row in
 * that window is missing high/low (added later than close). This lets ATR
 * work without nuking the whole cache after the schema upgrade.
 */
export const computeMissingRanges = (
  ticker: string,
  fromDate: string,
  toDate: string,
): Array<{ from: string; to: string }> => {
  const log = getFetchLog(ticker);
  const cap = today();
  // Never request future dates from Yahoo.
  const effTo = toDate > cap ? cap : toDate;
  if (fromDate > effTo) return [];

  if (!log) return [{ from: fromDate, to: effTo }];

  const ranges: Array<{ from: string; to: string }> = [];
  if (fromDate < log.first_fetched_date) {
    ranges.push({
      from: fromDate,
      to: addDays(log.first_fetched_date, -1),
    });
  }
  if (effTo > log.last_fetched_date) {
    ranges.push({
      from: addDays(log.last_fetched_date, 1),
      to: effTo,
    });
  }

  // Backfill OHLC across the full requested window when any cached row is
  // missing open/high/low. Older installs cached close-only rows; later we
  // added high/low; later still we added open. Each addition needs a refill,
  // so the check stays generic across the full OHLC quartet. A full refill
  // subsumes any head/tail gaps we already queued, so just return it alone.
  const ohlcRow = countMissingOhlcStmt.get(ticker, fromDate, effTo);
  if (ohlcRow && ohlcRow.c > 0) {
    return [{ from: fromDate, to: effTo }];
  }

  return ranges;
};

const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
