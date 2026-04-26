export function AppFooter() {
  return (
    <footer className="text-xs text-muted-foreground max-w-3xl mx-auto pt-8 pb-6 px-1 space-y-2">
      <p className="font-medium text-foreground">Privacy</p>
      <p>
        Your CSV, parsed transactions, and computed valuation stay in your
        browser's <code className="font-mono">localStorage</code> — they are
        never sent to a server. Stock prices and ISIN lookups are proxied
        through this app's Cloudflare Worker to{" "}
        <a
          href="https://finance.yahoo.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          Yahoo Finance
        </a>{" "}
        and{" "}
        <a
          href="https://www.openfigi.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          OpenFIGI
        </a>{" "}
        — those requests carry only the ticker / ISIN, not your portfolio.
      </p>
      <p>
        No cookies for analytics or advertising. No tracking. No account
        required.
      </p>
    </footer>
  );
}
