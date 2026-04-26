export const fmtNum = (n: number, digits = 2): string =>
  Number.isFinite(n)
    ? n.toLocaleString("nl-NL", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })
    : "—";

export const fmtEur = (n: number): string =>
  n.toLocaleString("nl-NL", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  });

export const fmtPct = (p: number): string =>
  `${p >= 0 ? "+" : ""}${(p * 100).toLocaleString("nl-NL", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}%`;

export const today = (): string => new Date().toISOString().slice(0, 10);

export const fmtFullDate = (iso: string): string => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
};
