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

/** Above the median is blue and below is red, the site's above/below colors (James, Oct 16). */
const TONE = {
  above: { color: "var(--fi-viz-above)", backgroundColor: "color-mix(in srgb, var(--fi-viz-above) 12%, transparent)" },
  below: { color: "var(--fi-viz-below)", backgroundColor: "color-mix(in srgb, var(--fi-viz-below) 12%, transparent)" },
  same: undefined,
} as const;

/** A fee's gap from its peer median as a small colored chip with an up or down arrow. */
export function PeerGapChip({ value, median }: { value: number; median: number }) {
  const { direction, amount } = peerGap(value, median);
  const Icon = direction === "above" ? ArrowUp : direction === "below" ? ArrowDown : Minus;
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 font-sans text-[13px] font-semibold leading-none tabular-nums ${
        direction === "same" ? "bg-paper text-ink-soft" : ""
      }`}
      style={TONE[direction]}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={2.5} />
      {direction === "same" ? "Within 1%" : `${money(amount)} ${direction}`}
    </span>
  );
}
