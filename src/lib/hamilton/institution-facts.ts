import { getSegmentLabel } from "@/app/(public)/institution/[id]/enum-labels";
import { STATE_NAMES } from "@/lib/us-states";

/**
 * The line the context bar shows under the subject's name (#2043): its state, charter and size,
 * e.g. "Florida · Community bank, $1B to $10B". Null when nothing is on file.
 */
export function institutionFacts(input: {
  stateCode?: string | null;
  charterType?: string | null;
  /** The size label, or the raw tier when no label was read. */
  segment?: string | null;
}): string | null {
  const state = input.stateCode ? STATE_NAMES[input.stateCode] ?? input.stateCode : null;
  const segment = (input.segment && (getSegmentLabel(input.segment, input.charterType) ?? (input.segment.includes(",") ? input.segment : null)))
    ?? (input.charterType === "credit_union" ? "Credit union" : input.charterType === "bank" ? "Bank" : null);
  // The public size labels call the largest tier "National bank"; here it reads as a charter, which
  // it is not, so the bar names the charter plainly.
  const plain = segment?.replace(/^National (bank|credit union), over/, (_, kind: string) => `${kind[0].toUpperCase()}${kind.slice(1)}, over`) ?? null;
  const parts = [state, plain].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}
