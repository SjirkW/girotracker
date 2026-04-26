/**
 * Wilder's ATR(period) on a sequence of OHLC bars (oldest → newest).
 *
 * True Range = max(high − low, |high − prevClose|, |low − prevClose|).
 * The first ATR is a simple average of the first `period` true ranges; each
 * subsequent ATR is `(prevATR * (period-1) + TR) / period` (Wilder's smoothing).
 *
 * Returns null when there aren't enough complete OHLC bars (≥ period+1).
 */
export const computeAtr = (
  bars: Array<{ close: number; high: number | null; low: number | null }>,
  period = 14,
): number | null => {
  const usable = bars.filter((b) => b.high != null && b.low != null);
  if (usable.length < period + 1) return null;
  const trs: number[] = [];
  for (let i = 1; i < usable.length; i++) {
    const cur = usable[i];
    const prevClose = usable[i - 1].close;
    const tr = Math.max(
      cur.high! - cur.low!,
      Math.abs(cur.high! - prevClose),
      Math.abs(cur.low! - prevClose),
    );
    trs.push(tr);
  }
  if (trs.length < period) return null;
  let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trs.length; i++) {
    atr = (atr * (period - 1) + trs[i]) / period;
  }
  return atr;
};
