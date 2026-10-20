import { ArrowDown, ArrowUp, Minus } from "lucide-react";
import { formatFeeAmount } from "@/lib/format";

const money = (n: number) => formatFeeAmount(n) ?? `$${n.toFixed(2)}`;

/** Within 1% of the median reads as about the same. */
export const ABOUT_SAME_SHARE = 0.01;

/** The direction and size of a gap from a median, or "same" within 1%. */
export function peerGap(value: number, median: number): { direction: "above" | "below" | "same"; amount: number } {
  const gap = value - median;
  const share = median > 0 ? Math.abs(gap) / median : Math.abs(gap);
  if (share <= ABOUT_SAME_SHARE) return { direction: "same", amount: 0 };
  return { direction: gap > 0 ? "above" : "below", amount: Math.abs(gap) };
}

/**
 * Above and below a median, one pair for every peer view (institution and state pages). Neither is
 * red: a price above or below the median is a position, not a verdict (James, Oct 20 review). Above
 * is the site's accent blue, below its neutral slate, and each is always paired with an arrow or word.
 */
export const MEDIAN_TONE = { above: "var(--fi-viz-above)", below: "var(--fi-viz-bar)" } as const;

/** The legend line wherever the pair is used. */
export const MEDIAN_TONE_NOTE = "Colour shows direction only: above or below the median is not good or bad.";

const TONE = {
  above: { color: MEDIAN_TONE.above, backgroundColor: `color-mix(in srgb, ${MEDIAN_TONE.above} 12%, transparent)` },
  below: { color: MEDIAN_TONE.below, backgroundColor: `color-mix(in srgb, ${MEDIAN_TONE.below} 12%, transparent)` },
  same: { backgroundColor: "color-mix(in srgb, var(--fi-ink) 7%, transparent)" },
} as const;

/** A fee's gap from its peer median as a small colored chip with an up or down arrow. */
export function PeerGapChip({ value, median }: { value: number; median: number }) {
  const { direction, amount } = peerGap(value, median);
  const Icon = direction === "above" ? ArrowUp : direction === "below" ? ArrowDown : Minus;
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 font-sans text-[12px] sm:px-2.5 sm:text-[13px] font-semibold leading-none tabular-nums ${
        direction === "same" ? "text-ink-soft" : ""
      }`}
      style={TONE[direction]}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
      {direction === "same" ? "Within 1%" : `${money(amount)} ${direction}`}
    </span>
  );
}
