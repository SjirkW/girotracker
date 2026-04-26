// Privacy-mode placeholder: fixed-width blurred text. Width is fixed (not
// derived from the real value) so digit count can't be inferred from the
// rendered cell width, and the blur makes the underlying glyphs unreadable.
type Props = {
  /** Visual width hint. "wide" for currency amounts, "narrow" for quantities/percents. */
  variant?: "wide" | "narrow";
};

export function Blurred({ variant = "wide" }: Props) {
  const placeholder = variant === "wide" ? "888.888" : "888";
  return (
    <span
      aria-hidden="true"
      className="inline-block select-none align-middle blur-[6px] tabular-nums"
    >
      {placeholder}
    </span>
  );
}
