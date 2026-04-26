import type { ReactNode } from "react";
import { TableHead } from "@/components/ui/table";

export type HoldingSortKey =
  | "product"
  | "ticker"
  | "quantity"
  | "valueEur"
  | "investedEur"
  | "returnEur"
  | "returnPct";

export type SortState<K extends string = HoldingSortKey> = {
  key: K;
  dir: "asc" | "desc";
};

export function SortableTh<K extends string>({
  sortKey,
  sort,
  onToggle,
  align = "left",
  children,
}: {
  sortKey: K;
  sort: SortState<K>;
  onToggle: (key: K) => void;
  align?: "left" | "right";
  children: ReactNode;
}) {
  const active = sort.key === sortKey;
  const arrow = sort.dir === "desc" ? "↓" : "↑";
  return (
    <TableHead className={align === "right" ? "text-right" : ""}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={
          "inline-flex items-center gap-0.5 transition-colors " +
          (active ? "text-foreground" : "hover:text-foreground")
        }
      >
        {children}
        {active && <span className="text-xs opacity-70">{arrow}</span>}
      </button>
    </TableHead>
  );
}

/**
 * Reusable toggle: clicking the same key flips direction; switching keys
 * starts in `desc` (the most useful default for value/return columns).
 */
export const makeToggleSort =
  <K extends string>(setSort: (updater: (s: SortState<K>) => SortState<K>) => void) =>
  (key: K) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === "asc" ? "desc" : "asc" }
        : { key, dir: "desc" },
    );
