import { useState, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  isBusy,
  statusMessage,
  type ComputeStatus,
} from "@/lib/computeStatus";

type Props = {
  fileName: string | null;
  parseErrors: string[];
  hasTransactions: boolean;
  status: ComputeStatus;
  onFile: (file: File) => void;
  onCompute: () => void;
  inputRef: RefObject<HTMLInputElement | null>;
};

export function UploadCard({
  fileName,
  parseErrors,
  hasTransactions,
  status,
  onFile,
  onCompute,
  inputRef,
}: Props) {
  const [dragOver, setDragOver] = useState(false);
  const message = statusMessage(status);
  return (
    <Card>
      <CardContent className="pt-6 space-y-3">
        <div
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onFile(f);
          }}
          className={
            "flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed p-6 cursor-pointer transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring " +
            (dragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-accent/30")
          }
        >
          <p className="text-sm">
            <span className="font-medium text-primary">Click to upload</span> or
            drag and drop a CSV
          </p>
          <p className="text-xs text-muted-foreground text-center">
            In DEGIRO:{" "}
            <span className="font-medium">Inbox → Activity → Transactions</span>,
            pick the full date range, then{" "}
            <span className="font-medium">Export → CSV</span>.
          </p>
        </div>
        {fileName && (
          <p className="text-sm text-muted-foreground">
            Loaded <span className="font-medium">{fileName}</span>
          </p>
        )}
        {parseErrors.length > 0 && (
          <div className="text-sm text-destructive">
            {parseErrors.length} parse error
            {parseErrors.length === 1 ? "" : "s"}:
            <ul className="list-disc list-inside">
              {parseErrors.slice(0, 5).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          </div>
        )}
        {hasTransactions && (
          <div className="flex items-center gap-3">
            <Button onClick={onCompute} disabled={isBusy(status)}>
              Compute portfolio
            </Button>
            <span className="text-sm text-muted-foreground">
              {message}
              {status.phase === "error" && (
                <span className="text-destructive">
                  Error: {status.message}
                </span>
              )}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

