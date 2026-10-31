import { countedAmounts } from "@/lib/data-store/counted-amounts";
import type { PeerFeeValue } from "@/lib/data-store/fee-index";

/**
 * The amounts a group's band and position are built from: one per institution, and sister
 * charters of one shared fee schedule once (statistics rule 7, `counted_as`), as the index's
 * medians count them. Sorted ascending.
 *
 * Kept in its own module, apart from workspace/research.ts, so the Simulate server action can use
 * it without loading the whole research module graph (several seconds cold under vitest).
 */
export function peerAmounts(values: readonly PeerFeeValue[]): number[] {
  return countedAmounts(values.map((v) => ({ institutionId: v.institution_id, amount: v.amount, countedAs: v.counted_as })));
}
