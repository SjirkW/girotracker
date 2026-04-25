# GIROTRACKER

**Live app: <https://tracker.girotools.workers.dev/>**

A web app that visualises a DEGIRO portfolio's value and returns over time, using the broker's Transactions CSV export plus Yahoo Finance prices.

## Stack

- **server/** — Node + Express, SQLite cache (`better-sqlite3`), `yahoo-finance2`, OpenFIGI for ISIN→ticker resolution
- **web/** — Vite + React + TypeScript, Tailwind v4, shadcn/ui, recharts

The server caches every Yahoo and OpenFIGI response in `server/data/cache.db` so repeated runs are instant and historical prices are never re-fetched.

## Prerequisites

- Node.js 20 or later (the server runs fine on 20; `yahoo-finance2@3` prints a notice asking for ≥22 but works)
- A DEGIRO `Transactions.csv` export

## First-time setup

```bash
npm install            # installs concurrently at root
npm run install:all    # installs server/ and web/ deps
```

## Running locally

```bash
npm run degiro
```

This starts the backend (port 3001) and frontend (port 5173) together with prefixed/colored logs (`server` in blue, `web` in magenta) and ties their lifetimes together — kill one and the other stops too.

Then open <http://localhost:5173>. Vite proxies `/api/*` to the backend, so the frontend doesn't need any extra config.

If you'd rather run them separately, each folder still has its own `npm run dev`.

In the app: click the upload area, pick your DEGIRO Transactions CSV, then hit **Compute portfolio**. First run takes ~30s (resolves ~30–40 ISINs and fetches their full price history); subsequent runs are nearly instant from the SQLite cache.

## Endpoints

- `GET /api/health` — sanity check, lists DB tables
- `POST /api/tickers` — body `{ isins: [{ isin, beurs }] }` → ISIN→Yahoo ticker (cached forever)
- `POST /api/prices` — body `{ ticker, from, to }` → daily closes (gap-fills only the missing days)

## Optional: OpenFIGI API key

Without a key, OpenFIGI allows 25 requests/min, max 10 jobs per request. If you have many ISINs and want faster resolution, set `OPENFIGI_API_KEY` in the server's environment — that bumps it to 25 req/6s and 100 jobs/request.

```bash
OPENFIGI_API_KEY=your_key npm run dev
```

## Resetting the cache

```bash
rm server/data/cache.db
```

The server will recreate the schema on next start.

## Deploying to Cloudflare (free)

Production runs as a single **Cloudflare Worker with Static Assets**: the Worker entrypoint (`worker/index.ts`) serves the `/api/*` routes by proxying directly to Yahoo and OpenFIGI, and the Vite-built SPA in `web/dist/` is served via the assets binding. Everything stays inside the free tier (100k Worker requests/day) for personal use.

There is no server-side cache in production — your CSV, parsed transactions, and computed valuation live in the browser's `localStorage`, so reloads don't re-trigger upstream calls. The Express + SQLite server in `server/` is local-dev only.

### One-time setup

1. `npm install` at the repo root (pulls in wrangler).
2. `npx wrangler login`.
3. Optional: add an `OPENFIGI_API_KEY` secret for faster ISIN resolution: `npx wrangler secret put OPENFIGI_API_KEY`.

### Deploy

```bash
npm run deploy        # builds web/dist then `wrangler deploy`
```

Or, if you've connected the GitHub repo to Cloudflare (Workers & Pages → your Worker → Settings → Build), pushes to `main` trigger an automatic build. Make sure the Cloudflare build command is `npm run deploy` (or `npm install && npm run build:web && npx wrangler deploy`).

### Local preview of the production setup

```bash
npm run preview       # builds web/dist then `wrangler dev`
```

This runs the Worker locally on Workerd and serves the built SPA + the API routes on a single localhost port — useful for verifying everything before pushing.
