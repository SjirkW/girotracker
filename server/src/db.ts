import Database from "better-sqlite3";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = resolve(here, "../data");
mkdirSync(dataDir, { recursive: true });

export const db = new Database(resolve(dataDir, "cache.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS isin_ticker_map (
    isin TEXT PRIMARY KEY,
    ticker TEXT,
    exchange TEXT,
    name TEXT,
    fetched_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS prices (
    ticker TEXT NOT NULL,
    date TEXT NOT NULL,
    close REAL NOT NULL,
    high REAL,
    low REAL,
    currency TEXT,
    PRIMARY KEY (ticker, date)
  );

  CREATE TABLE IF NOT EXISTS fetch_log (
    ticker TEXT PRIMARY KEY,
    first_fetched_date TEXT NOT NULL,
    last_fetched_date TEXT NOT NULL,
    last_fetched_at TEXT NOT NULL
  );
`);

// Add high/low columns to pre-existing prices tables (older installs created
// the table without them). SQLite will throw "duplicate column" if they exist
// already — swallow that.
const addColumnIfMissing = (column: string) => {
  try {
    db.exec(`ALTER TABLE prices ADD COLUMN ${column} REAL`);
  } catch (err) {
    if (!String(err).includes("duplicate column name")) throw err;
  }
};
addColumnIfMissing("high");
addColumnIfMissing("low");

export type IsinMapRow = {
  isin: string;
  ticker: string | null;
  exchange: string | null;
  name: string | null;
  fetched_at: string;
};

export type PriceRow = {
  ticker: string;
  date: string;
  close: number;
  high: number | null;
  low: number | null;
  currency: string | null;
};

export type FetchLogRow = {
  ticker: string;
  first_fetched_date: string;
  last_fetched_date: string;
  last_fetched_at: string;
};
