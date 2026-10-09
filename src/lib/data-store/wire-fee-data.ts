import type { IndexEntry } from "./fee-index";
import { getNationalIndexCached } from "./fee-index";
import { getStateFeeIndexesCached } from "./public-cached-reads";

/**
 * The fee indexes behind the Regulatory Wire's "In the fee data" strips. No new SQL: a
 * state's figures are its `all` index from getStateFeeIndexes (the State fee report's own
 * read), and a federal item's are the national index (getNationalIndexCached). Both read
 * published_fee_catalog dollar fees under the statistics contract (fee-stats.ts), so the
 * strip's median and count are the same numbers the report and category pages show.
 *
 * A read that fails is left out (not returned as empty), so its items show no strip
 * instead of a false "no published fees".
 */
export interface WireFeeIndexes {
  byState: Map<string, IndexEntry[]>;
  national: IndexEntry[] | null;
}

export async function getWireFeeIndexes(need: { states: string[]; national: boolean }): Promise<WireFeeIndexes> {
  const byState = new Map<string, IndexEntry[]>();
  const [stateResults, national] = await Promise.all([
    Promise.all(
      need.states.map(async (code) => {
        try {
          return [code, (await getStateFeeIndexesCached(code)).all] as const;
        } catch (error) {
          console.error(`[wire-fee-data] ${code} index read failed`, error);
          return null;
        }
      }),
    ),
    need.national
      ? getNationalIndexCached().catch((error: unknown) => {
          console.error("[wire-fee-data] national index read failed", error);
          return null;
        })
      : Promise.resolve(null),
  ]);
  for (const result of stateResults) {
    if (result) byState.set(result[0], result[1]);
  }
  return { byState, national };
}
