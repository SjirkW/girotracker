import type { RefObject } from "react";

type Props = {
  inputRef: RefObject<HTMLInputElement | null>;
  onFile: (file: File) => void;
};

export function HiddenFileInput({ inputRef, onFile }: Props) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept=".csv,text/csv"
      className="hidden"
      onChange={(e) => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        // Reset so picking the same file again still triggers onChange.
        e.target.value = "";
      }}
    />
  );
}
