import { FEE_FAMILIES, publicFeeTypes } from "@/lib/fee-taxonomy";

/**
 * One definition for each headline count the public site states more than once (#1951, #1928).
 *
 * Every page that prints one of these counts reads it from the shared public snapshot
 * (public-stats.ts getPublicSnapshot) or the shared coverage read (public-cached-reads.ts
 * getResearchCoverageCached) through the helpers below, so two pages can only differ by the
 * time each was rendered, never by the rule. Pure: no database imports, so client components
 * may read the definitions too.
 */

/** The words a page puts near a count so a reader knows what it counts. No em-dashes, no agent names. */
export const COUNT_DEFINITIONS = {
  /** A fee's national institution count (overdraft 2,502, NSF 2,670, ...). */
  feeInstitutions:
    "Institutions that publish this fee in a sourced consumer fee schedule. Sister charters that share one schedule count once.",
  /** Institutions whose every published price for the fee is $0 (zero_count). */
  feeZeroOnly: "Institutions whose every published price for this fee is $0.",
  /** The fee categories the index publishes. */
  categories: "The fee categories the Bank Fee Index publishes, each with at least one published fee.",
  /** A state's coverage, three nested counts. */
  stateMonitored: "Banks and credit unions headquartered in the state that the index tracks.",
  stateWithFees: "Of those, institutions with at least one published fee.",
  stateCounted: "Of those, institutions with at least one fee that counts toward the state's medians.",
  /** Why asset-size (or state) groups need not add up to the national count. */
  groupSums:
    "Sister charters that share one fee schedule count once in the total but once in each size group they fall in, so the groups can add to a few more than the total.",
} as const;

const TAXONOMY = new Set(Object.values(FEE_FAMILIES).flat());

interface CategoryCountRow {
  fee_category: string;
  institution_count: number | null | undefined;
}

/**
 * How many fee categories the public site says it covers: the taxonomy types inside the public
 * top 50 (`publicFeeTypes`, James's Oct 17 decision) that have at least one counted institution
 * in the snapshot. The homepage, /fees, /research, /api-docs and the upgrade prompts all state
 * this one number. Null when the snapshot's categories failed to read (an empty list), so a
 * failed read never prints as 0.
 */
export function publicCategoryCount(categories: readonly CategoryCountRow[]): number | null {
  if (categories.length === 0) return null;
  const listed = publicFeeTypes(categories);
  return categories.filter(
    (c) => TAXONOMY.has(c.fee_category) && listed.has(c.fee_category) && Number(c.institution_count ?? 0) > 0,
  ).length;
}

/**
 * A fee's national counts from the snapshot: the institutions counted toward its median, and of
 * those, how many publish only $0. Null when the snapshot has no row for the fee.
 */
export function feeHeadlineCounts(
  categories: readonly (CategoryCountRow & { zero_count?: number | null })[],
  fee: string,
): { institutions: number; zeroOnly: number } | null {
  const row = categories.find((c) => c.fee_category === fee);
  if (!row) return null;
  return { institutions: Number(row.institution_count ?? 0), zeroOnly: Number(row.zero_count ?? 0) };
}

export interface StateCoverageCounts {
  /** Institutions headquartered in the state (every institution_sources row there). */
  monitored: number;
  /** Of those, institutions with at least one approved published fee. */
  withFees: number;
  /**
   * Of those, institutions with at least one fee that passes the statistics contract's row rules
   * (fee-stats.ts), the population behind the state's medians. Null on a coverage entry cached
   * before the field existed.
   */
  counted: number | null;
}

/** One state's coverage counts from the shared coverage read, or null when the state is absent. */
export function stateCoverageCounts(
  coverage: {
    states: readonly {
      state_code: string;
      monitored: number;
      verified_institutions: number;
      counted_institutions?: number | null;
    }[];
  } | null,
  stateCode: string,
): StateCoverageCounts | null {
  const row = coverage?.states.find((s) => s.state_code === stateCode);
  if (!row) return null;
  return {
    monitored: row.monitored,
    withFees: row.verified_institutions,
    counted: row.counted_institutions ?? null,
  };
}

const COUNT_FORMAT = new Intl.NumberFormat("en-US");

/**
 * The state page's coverage sentence, every number from one coverage read (#1955): "{withFees} of
 * the {monitored} institutions headquartered in {state} have published fees here, and {counted} of
 * them have fees that count toward the medians on this page." The medians clause is left out when
 * the counted number is unknown (an entry cached before the field existed) or larger than the
 * institutions with fees, which a nested count can never be. Empty when there is nothing to say.
 */
export function stateCoverageSentence(counts: StateCoverageCounts | null, stateName: string): string {
  if (!counts || counts.monitored <= 0 || counts.withFees <= 0) return "";
  const fmt = (n: number) => COUNT_FORMAT.format(Math.max(0, Math.round(n)));
  const lead = `${fmt(counts.withFees)} of the ${fmt(counts.monitored)} institutions headquartered in ${stateName} have published fees here`;
  const { counted } = counts;
  if (counted == null || counted <= 0 || counted > counts.withFees) return `${lead}. `;
  return `${lead}, and ${fmt(counted)} of them have fees that count toward the medians on this page. `;
}
