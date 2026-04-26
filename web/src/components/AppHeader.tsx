import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  isBusy,
  statusMessage,
  type ComputeStatus,
} from "@/lib/computeStatus";

type Props = {
  showActions: boolean;
  status: ComputeStatus;
  onOpenFilePicker: () => void;
  onCompute: () => void;
};

export function AppHeader({
  showActions,
  status,
  onOpenFilePicker,
  onCompute,
}: Props) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">GIROTRACKER</h1>
        <p className="text-muted-foreground text-sm">
          DEGIRO portfolio value over time
        </p>
      </div>
      {showActions && (
        <div className="flex flex-col items-end gap-1 shrink-0">
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onOpenFilePicker}
              title="Upload new file"
              aria-label="Upload new file"
            >
              <Upload />
            </Button>
            <Button size="sm" onClick={onCompute} disabled={isBusy(status)}>
              Recompute
            </Button>
          </div>
          {(isBusy(status) || status.phase === "error") && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {statusMessage(status)}
              {status.phase === "error" && (
                <span className="text-destructive">Error: {status.message}</span>
              )}
            </span>
          )}
        </div>
      )}
    </header>
  );
}
