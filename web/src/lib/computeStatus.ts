export type ComputeStatus =
  | { phase: "idle" }
  | { phase: "tickers" }
  | { phase: "prices"; done: number; total: number }
  | { phase: "fx"; done: number; total: number }
  | { phase: "computing" }
  | { phase: "done" }
  | { phase: "error"; message: string };

export const isBusy = (s: ComputeStatus): boolean =>
  s.phase !== "idle" && s.phase !== "done" && s.phase !== "error";

export const statusMessage = (s: ComputeStatus): string | null => {
  switch (s.phase) {
    case "tickers":
      return "Resolving ISINs…";
    case "prices":
      return `Fetching prices ${s.done}/${s.total}…`;
    case "fx":
      return `Fetching FX rates ${s.done}/${s.total}…`;
    case "computing":
      return "Computing valuation…";
    default:
      return null;
  }
};
