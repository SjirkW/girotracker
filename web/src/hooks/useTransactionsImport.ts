import { useCallback, useRef, useState, type RefObject } from "react";
import { parseDegiroCsv, type Transaction } from "@/lib/parseCsv";

export type TransactionsImport = {
  transactions: Transaction[];
  parseErrors: string[];
  fileName: string | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  /** Read a File, parse it, and replace the current import state. */
  handleFile: (file: File) => Promise<void>;
  /** Trigger the hidden file input — wire this to "upload" buttons. */
  openFilePicker: () => void;
  /** Restore from persisted session (does NOT reset). */
  restore: (s: { transactions?: Transaction[]; fileName?: string | null }) => void;
};

/**
 * Owns the CSV import state: the parsed transactions, parse errors, the
 * filename, and the hidden file input ref. The hook itself does not render
 * anything — render the hidden <input> with `fileInputRef` once at the top of
 * your tree and let any button call `openFilePicker()`.
 *
 * `handleFile` clears parse errors before re-parsing, but does NOT clear the
 * downstream compute state — the caller decides when to call its own reset
 * (typically right after handleFile returns).
 */
export function useTransactionsImport(): TransactionsImport {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    const text = await file.text();
    const { transactions: parsed, errors } = parseDegiroCsv(text);
    setTransactions(parsed);
    setParseErrors(errors);
    setFileName(file.name);
  }, []);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const restore = useCallback(
    (s: { transactions?: Transaction[]; fileName?: string | null }) => {
      if (s.transactions) setTransactions(s.transactions);
      if (s.fileName !== undefined) setFileName(s.fileName);
    },
    [],
  );

  return {
    transactions,
    parseErrors,
    fileName,
    fileInputRef,
    handleFile,
    openFilePicker,
    restore,
  };
}
