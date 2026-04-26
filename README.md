# GIROTRACKER

**Live app: <https://tracker.girotools.workers.dev/>**

A web app that turns a DEGIRO `Transactions.csv` export into an interactive view of your portfolio's value and returns over time, using Yahoo Finance for prices and OpenFIGI for ISIN→ticker resolution.

## Features

### Portfolio chart
- **Return** or **Value** mode — see total P/L over time, or raw market value.
- **Date range** presets (1M / 3M / YTD / 1Y / 5Y / MAX) plus a custom from/to picker.
- **Per-stock drill-down** — click any row in the Holdings table to redraw the chart for that single position. The chart auto-trims to the date you first bought it.
- **vs S&P 500 benchmark** — toggle a "what if you'd put each cash flow into the index instead" curve, computed apples-to-apples against your actual contributions.
- **Time-weighted return (TWR)** — strips out deposit timing so it's directly comparable to an index.
- **Privacy mode** — one-click toggle that masks all EUR amounts, leaving percentages visible (handy for screen sharing).

### Holdings tab
- Per-stock value, return (€ and %), invested amount, quantity, ticker.
- Sortable by any column; filterable by name / ticker / ISIN.
- Date-range aware: shows return *over the selected window*, not just lifetime.

### Stop loss tab
- Suggests trailing stop-loss levels for your winning positions.
- Two methods: **fixed %** (e.g. 15% below current price) or **ATR-based** (multiplier × 14-day ATR — adapts to each stock's volatility).
- Filter by minimum return % so you only see positions worth protecting.
- Toggle between **native ticker currency** and **EUR** for the price and stop level.
- Shows the locked-in return you'd realize if the stop triggers today.

### Currency tab
- Breaks down portfolio exposure by the native currency of each holding.

### Tickers tab
- Lists every ISIN in your CSV with its resolved Yahoo Finance ticker and exchange.
- Header counter shows resolved-vs-total at a glance.

### Transactions tab
- Full transaction log from your CSV, filterable by date / product / ISIN / currency.

### Session persistence
- Your CSV, parsed transactions, and computed valuation are stored in `localStorage`, so reloading the page doesn't re-fetch anything.

## Running locally

```bash
npm install && npm run install:all
npm run degiro
```

This starts the backend (port 3001) and frontend (port 5173) together. Open <http://localhost:5173>, upload your CSV, and click **Compute portfolio**. First run takes ~30s; subsequent runs are instant from the SQLite cache (`server/data/cache.db`).

Requires Node 20+. To wipe the cache: `rm server/data/cache.db`.

### Optional: faster ISIN resolution

Without an OpenFIGI key you get 25 req/min. With one, you get 25 req/6s:

```bash
OPENFIGI_API_KEY=your_key npm run degiro
```

## Deploying to Cloudflare

Production runs as a single Cloudflare Worker with Static Assets — `worker/index.ts` serves `/api/*` (proxying Yahoo + OpenFIGI directly), and the Vite-built SPA in `web/dist/` is served via the assets binding. Everything fits in the free tier for personal use. There is no server-side cache in prod; the browser's `localStorage` carries derived data between sessions.

### One-time setup

```bash
npx wrangler login
npx wrangler secret put OPENFIGI_API_KEY   # optional
```

### Deploy

```bash
npm run deploy        # builds web/dist then `wrangler deploy`
npm run preview       # runs the production setup locally on Workerd
```

Pushes to `main` also trigger a build automatically if you've connected the repo to Cloudflare (build command: `npm run deploy`).

## Stack

- **web/** — Vite + React + TypeScript, Tailwind v4, shadcn/ui, recharts
- **worker/** — Cloudflare Worker entrypoint (production); raw `fetch` to Yahoo + OpenFIGI
- **server/** — Node + Express + `better-sqlite3` (local-dev only); same `/api/*` shape as the worker, with caching via `yahoo-finance2`

## API

- `GET /api/health` — sanity check
- `POST /api/tickers` — `{ isins: [{ isin, beurs }] }` → ISIN→Yahoo ticker
- `POST /api/prices` — `{ ticker, from, to }` → daily closes
