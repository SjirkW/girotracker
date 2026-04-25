export const RANGES = ["1D", "5D", "1M", "6M", "YTD", "1Y", "5Y", "MAX"] as const;
export type Range = (typeof RANGES)[number];

/**
 * Resolve the inclusive lower bound of a named range, anchored at `latest`.
 * `earliest` is used for "MAX" so the bound never falls before the dataset.
 */
export const rangeStartDate = (
  range: Range,
  latest: string,
  earliest: string,
): string => {
  const d = new Date(`${latest}T00:00:00Z`);
  const apply = (fn: (x: Date) => void) => {
    const c = new Date(d);
    fn(c);
    return c.toISOString().slice(0, 10);
  };
  switch (range) {
    case "1D":
      return apply((c) => c.setUTCDate(c.getUTCDate() - 1));
    case "5D":
      return apply((c) => c.setUTCDate(c.getUTCDate() - 5));
    case "1M":
      return apply((c) => c.setUTCMonth(c.getUTCMonth() - 1));
    case "6M":
      return apply((c) => c.setUTCMonth(c.getUTCMonth() - 6));
    case "YTD":
      return `${d.getUTCFullYear()}-01-01`;
    case "1Y":
      return apply((c) => c.setUTCFullYear(c.getUTCFullYear() - 1));
    case "5Y":
      return apply((c) => c.setUTCFullYear(c.getUTCFullYear() - 5));
    case "MAX":
      return earliest;
  }
};

type Props = {
  value: Range;
  onChange: (r: Range) => void;
};

export const RangeSelector = ({ value, onChange }: Props) => (
  <div className="flex items-center gap-1">
    {RANGES.map((r) => (
      <button
        key={r}
        onClick={() => onChange(r)}
        className={
          "px-3 py-1.5 rounded-md text-sm font-medium transition-colors " +
          (value === r
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground")
        }
      >
        {r}
      </button>
    ))}
  </div>
);
