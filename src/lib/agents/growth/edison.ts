import type { sql } from "@/lib/data-store/connection";
import { loadStatePrices, priceCheck, PRICE_CHECK_FEES, type PriceCheckFee } from "@/lib/price-check";
import { STATE_CODES } from "@/lib/us-states";

type SqlTag = typeof sql;

/**
 * EDISON's tool check (`growth-os/agents/edison.md`), step `growth-tools`. It runs the free
 * price check (`src/lib/price-check.ts`) on one state a day, in turn, for every fee the tool
 * offers, and records what a visitor would see: how many institutions are source-checked, how
 * many are left out, the state median, and whether the state clears the median floor. Read-only
 * and free; it writes nothing beyond its own step.
 */

export interface ToolCheckFee {
  fee: PriceCheckFee;
  checked: number;
  unchecked: number;
  /** The state median of the source-checked figures; null below the floor. */
  median: number | null;
  shown: boolean;
}

export interface ToolCheckResult {
  dryRun: boolean;
  state: string;
  fees: ToolCheckFee[];
}

const DAY_MS = 86_400_000;

/** The state for a day: every state in turn, one a day. */
export function stateForDay(now: Date): string {
  const codes = [...STATE_CODES].sort();
  return codes[Math.floor(now.getTime() / DAY_MS) % codes.length];
}

export async function runToolCheck(input: { db: SqlTag; runId: number | null; dryRun: boolean; state?: string | null; now?: Date }): Promise<ToolCheckResult> {
  const state = (input.state ?? stateForDay(input.now ?? new Date())).toUpperCase();
  const fees: ToolCheckFee[] = [];
  for (const fee of PRICE_CHECK_FEES) {
    const prices = await loadStatePrices(state, fee, input.db);
    if (!prices) continue;
    const check = priceCheck(0, prices);
    fees.push({ fee, checked: prices.institutions.length, unchecked: prices.uncheckedCount, median: check?.median ?? null, shown: check !== null });
  }
  return { dryRun: input.dryRun, state, fees };
}

export function summarizeToolCheck(result: ToolCheckResult): string {
  if (!result.fees.length) return `Ran the price check for ${result.state}; it isn't a state the tool covers.`;
  const parts = result.fees.map((fee) =>
    fee.shown
      ? `${fee.fee} ${fee.checked} source-checked (median $${fee.median}), ${fee.unchecked} left out`
      : `${fee.fee} ${fee.checked} source-checked, too few to show (${fee.unchecked} left out)`,
  );
  return `Ran the price check for ${result.state}: ${parts.join("; ")}.`;
}
