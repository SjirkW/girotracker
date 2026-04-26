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

export type SortState = { key: HoldingSortKey; dir: "asc" | "desc" };

export const SortableTh = ({
  sortKey,
  sort,
  onToggle,
  align = "left",
  children,
}: {
  sortKey: HoldingSortKey;
  sort: SortState;
  onToggle: (key: HoldingSortKey) => void;
  align?: "left" | "right";
  children: ReactNode;
}) => {
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
};
